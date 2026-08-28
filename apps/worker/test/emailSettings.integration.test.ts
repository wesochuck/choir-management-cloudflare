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
