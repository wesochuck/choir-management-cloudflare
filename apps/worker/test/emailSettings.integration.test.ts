import {
  organizationEmailDomainVerifyResponseSchema,
  organizationEmailSettingsResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
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

const write = (host: string, path: string, cookie: string, body: unknown, method = "POST") =>
  writeJson(exports.default, host, path, cookie, body, method);
const api = organizationRequest;

const provision = (id: string, slug: string) =>
  provisionOrganization(database, stores, { id, slug, userId: "email-settings-admin" });

const signIn = (host = "emailtest1.localhost", email = adminEmail) =>
  signInWithOtp(exports.default, host, email, (to) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), to),
  );

describe("Organization Email Settings & Custom Sending Domain", () => {
  beforeEach(async () => {
    clearCapturedPlatformEmailsForTest();
    await applyD1Migrations(database, [...inject("controlMigrations")]);
    await seedAuthUser(database, "email-settings-admin", adminEmail, "Email Settings Admin");
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

  it("replaces stale D1 rows when the custom domain changes", async () => {
    const host = "emailtest1.localhost";
    const cookie = await signIn(host);

    await write(
      host,
      "/api/organization/email-settings",
      cookie,
      { customDomain: "old.emailtest1.org" },
      "PUT",
    );
    await write(
      host,
      "/api/organization/email-settings",
      cookie,
      { customDomain: "new.emailtest1.org" },
      "PUT",
    );

    const stale = await database
      .prepare("SELECT * FROM organization_email_domains WHERE domain = ?")
      .bind("old.emailtest1.org")
      .first();
    expect(stale).toBeNull();
    const current = await database
      .prepare("SELECT * FROM organization_email_domains WHERE domain = ?")
      .bind("new.emailtest1.org")
      .first<{ domain: string; organization_id: string; status: string }>();
    expect(current?.organization_id).toBe("org-email-test-1");
    expect(current?.status).toBe("pending");
  });

  it("refuses to reassign a domain owned by another organization", async () => {
    await provision("org-email-test-2", "emailtest2");
    const hostOne = "emailtest1.localhost";
    const hostTwo = "emailtest2.localhost";
    const cookieOne = await signIn(hostOne);
    // The session cookie is organization-independent; the same member
    // administers both test organizations, so reuse it for the second host.
    const cookieTwo = cookieOne;

    const first = await write(
      hostOne,
      "/api/organization/email-settings",
      cookieOne,
      { customDomain: "shared.emailtest.org" },
      "PUT",
    );
    expect(first.status).toBe(200);

    const second = await write(
      hostTwo,
      "/api/organization/email-settings",
      cookieTwo,
      { customDomain: "shared.emailtest.org" },
      "PUT",
    );
    expect(second.status).toBe(409);
    const body: unknown = await second.json();
    const code =
      typeof body === "object" && body !== null && "code" in body
        ? Object.getOwnPropertyDescriptor(body, "code")?.value
        : undefined;
    expect(code).toBe("custom_domain_in_use");

    const owner = await database
      .prepare("SELECT organization_id FROM organization_email_domains WHERE domain = ?")
      .bind("shared.emailtest.org")
      .first<{ readonly organization_id: string }>();
    expect(owner?.organization_id).toBe("org-email-test-1");
  });

  it("verifies conclusively without changing D1 on resolver success and keeps schema contract", async () => {
    const host = "emailtest1.localhost";
    const cookie = await signIn(host);
    await write(
      host,
      "/api/organization/email-settings",
      cookie,
      { customDomain: "mail.emailtest1.org" },
      "PUT",
    );
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
    expect(verifyData.status).toBe("pending");
    const d1Row = await database
      .prepare("SELECT status FROM organization_email_domains WHERE domain = ?")
      .bind("mail.emailtest1.org")
      .first<{ readonly status: string }>();
    expect(d1Row?.status).toBe("pending");
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
