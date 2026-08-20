import {
  organizationEmailDomainVerifyResponseSchema,
  organizationEmailSettingsResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";

function binding<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return value;
}

const database = binding(env.CONTROL_DB, "CONTROL_DB");
const stores = binding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const adminEmail = "email.settings.admin@example.test";

function api(host: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function write(host: string, path: string, cookie: string, body: unknown, method = "POST") {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  return exports.default.fetch(
    api(host, path, cookie, {
      body: JSON.stringify(body),
      headers,
      method,
    }),
  );
}

async function provision(id: string, slug: string) {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 71, ?, ?, ?)`,
      )
      .bind(id, `Organization ${slug}`, slug, id, now, now, now),
    database
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, id, `${slug}.localhost`, now, now),
    database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, 'email-settings-admin', 'admin', ?)`,
      )
      .bind(`member-${slug}`, id, Date.now()),
  ]);

  const stub = stores.get(stores.idFromName(id));
  const response = await stub.fetch("https://organization.internal/internal/provision", {
    body: JSON.stringify({
      actorUserId: "bootstrap",
      canonicalHostname: `${slug}.localhost`,
      canonicalStatus: "active",
      name: `Organization ${slug}`,
      organizationId: id,
      requestId: crypto.randomUUID(),
      slug,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
}

async function signIn(host = "emailtest1.localhost", email = adminEmail) {
  await exports.default.fetch(
    api(host, "/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const otp = readCapturedPlatformEmailsForTest()
    .find(({ recipient }) => recipient === email)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  const response = await exports.default.fetch(
    api(host, "/api/auth/sign-in/email-otp", undefined, {
      body: JSON.stringify({ email, otp }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

describe("Organization Email Settings & Custom Sending Domain", () => {
  beforeEach(async () => {
    clearCapturedPlatformEmailsForTest();
    await applyD1Migrations(database, [...inject("controlMigrations")]);
    const now = Date.now();
    await database
      .prepare(
        `INSERT INTO user
          (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
         VALUES ('email-settings-admin', 'Email Settings Admin', ?, 0, ?, ?, 0)`,
      )
      .bind(adminEmail, now, now)
      .run();
    await provision("org-email-test-1", "emailtest1");
  });

  afterEach(async () => {
    clearCapturedPlatformEmailsForTest();
    await reset();
  });

  it("reads default unconfigured email settings", async () => {
    const host = "emailtest1.localhost";
    const cookie = await signIn(host);

    const response = await exports.default.fetch(
      api(host, "/api/organization/email-settings", cookie),
    );
    expect(response.status).toBe(200);

    const data = organizationEmailSettingsResponseSchema.parse(await response.json());
    expect(data.settings.fromName).toBeNull();
    expect(data.settings.replyToEmail).toBeNull();
    expect(data.settings.customDomain).toBeNull();
    expect(data.settings.customDomainStatus).toBe("none");
    expect(data.settings.dnsRecords).toEqual([]);
  });

  it("updates fromName, replyToEmail, and configures a custom sending domain", async () => {
    const host = "emailtest1.localhost";
    const cookie = await signIn(host);

    const response = await write(
      host,
      "/api/organization/email-settings",
      cookie,
      {
        customDomain: "mail.emailtest1.org",
        fromName: "Seattle Men's Chorus",
        replyToEmail: "info@emailtest1.org",
      },
      "PUT",
    );
    expect(response.status).toBe(200);

    const data = organizationEmailSettingsResponseSchema.parse(await response.json());
    expect(data.settings.fromName).toBe("Seattle Men's Chorus");
    expect(data.settings.replyToEmail).toBe("info@emailtest1.org");
    expect(data.settings.customDomain).toBe("mail.emailtest1.org");
    expect(data.settings.customDomainStatus).toBe("pending");
    expect(data.settings.dnsRecords.length).toBe(4);

    // Verify D1 routing index was updated
    const d1Row = await database
      .prepare("SELECT * FROM organization_email_domains WHERE domain = ?")
      .bind("mail.emailtest1.org")
      .first<{ domain: string; status: string }>();
    expect(d1Row).not.toBeNull();
    expect(d1Row?.status).toBe("pending");
  });

  it("triggers DNS verification endpoint", async () => {
    const host = "emailtest1.localhost";
    const cookie = await signIn(host);

    // First configure
    await write(
      host,
      "/api/organization/email-settings",
      cookie,
      {
        customDomain: "mail.emailtest1.org",
        fromName: "Seattle Men's Chorus",
        replyToEmail: "info@emailtest1.org",
      },
      "PUT",
    );

    // Now trigger verification
    const verifyResponse = await write(
      host,
      "/api/organization/email-settings/verify",
      cookie,
      {},
      "POST",
    );
    expect(verifyResponse.status).toBe(200);

    const verifyData = organizationEmailDomainVerifyResponseSchema.parse(
      await verifyResponse.json(),
    );
    expect(verifyData.dnsRecords.length).toBe(4);
  });

  it("removes custom domain cleanly and updates D1", async () => {
    const host = "emailtest1.localhost";
    const cookie = await signIn(host);

    // Configure
    await write(
      host,
      "/api/organization/email-settings",
      cookie,
      {
        customDomain: "mail.emailtest1.org",
        fromName: "Seattle Men's Chorus",
        replyToEmail: "info@emailtest1.org",
      },
      "PUT",
    );

    // Remove
    const removeResponse = await write(
      host,
      "/api/organization/email-settings",
      cookie,
      {
        customDomain: null,
      },
      "PUT",
    );
    expect(removeResponse.status).toBe(200);

    const data = organizationEmailSettingsResponseSchema.parse(await removeResponse.json());
    expect(data.settings.customDomain).toBeNull();
    expect(data.settings.customDomainStatus).toBe("none");

    // Verify removed from D1
    const d1Row = await database
      .prepare("SELECT * FROM organization_email_domains WHERE domain = ?")
      .bind("mail.emailtest1.org")
      .first();
    expect(d1Row).toBeNull();
  });
});
