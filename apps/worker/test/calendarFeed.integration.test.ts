import { calendarFeedUrlsResponseSchema } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "calendar.member@example.test";
const ALPHA_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const BRAVO_PROFILE_ID = "22222222-2222-4222-8222-222222222222";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

function apiRequest(hostname: string, path: string, cookie?: string, method = "GET"): Request {
  const headers = new Headers({ origin: `http://${hostname}` });
  if (cookie) {
    headers.set("cookie", cookie);
  }
  return new Request(`http://${hostname}${path}`, { headers, method });
}

async function seedOrganization(
  organizationId: string,
  name: string,
  slug: string,
  profileId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await controlDatabase.batch([
    controlDatabase
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key,
           operational_schema_version, created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 6, ?, ?, ?)`,
      )
      .bind(organizationId, name, slug, organizationId, now, now, now),
    controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, organizationId, `${slug}.localhost`, now, now),
    controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt, profileId)
         VALUES (?, ?, 'calendar-user', 'member', ?, ?)`,
      )
      .bind(`member-${slug}`, organizationId, Date.now(), profileId),
  ]);
  const stub = organizationStore.get(organizationStore.idFromName(organizationId));
  const provisioned = await stub.fetch("https://organization.internal/internal/provision", {
    body: JSON.stringify({
      actorUserId: "bootstrap",
      canonicalHostname: `${slug}.localhost`,
      canonicalStatus: "active",
      name,
      organizationId,
      requestId: crypto.randomUUID(),
      slug,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(provisioned.status).toBe(200);
  await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
    const timestamp = new Date().toISOString();
    state.storage.sql.exec(
      `INSERT INTO profiles (id, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      profileId,
      `${name} Singer`,
      timestamp,
      timestamp,
    );
    return null;
  });
}

async function signIn(): Promise<string> {
  const send = await exports.default.fetch(
    new Request("http://alpha.localhost/api/auth/email-otp/send-verification-otp", {
      body: JSON.stringify({ email: USER_EMAIL, type: "sign-in" }),
      headers: { "content-type": "application/json", origin: "http://alpha.localhost" },
      method: "POST",
    }),
  );
  expect(send.status).toBe(200);
  const code = readCapturedPlatformEmailsForTest()
    .find((message) => message.kind === "email-one-time-code" && message.recipient === USER_EMAIL)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  const response = await exports.default.fetch(
    new Request("http://alpha.localhost/api/auth/sign-in/email-otp", {
      body: JSON.stringify({ email: USER_EMAIL, otp: code }),
      headers: { "content-type": "application/json", origin: "http://alpha.localhost" },
      method: "POST",
    }),
  );
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toContain("choir-management.session_token=");
  return cookie ?? "";
}

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const nowMs = Date.now();
  await controlDatabase
    .prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES ('calendar-user', 'Calendar Member', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, nowMs, nowMs)
    .run();
  await seedOrganization("organization-alpha", "Organization Alpha", "alpha", ALPHA_PROFILE_ID);
  await seedOrganization("organization-bravo", "Organization Bravo", "bravo", BRAVO_PROFILE_ID);
  const now = new Date().toISOString();
  await controlDatabase
    .prepare(
      `INSERT INTO organization_domains
        (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
       VALUES ('domain-alpha-public', 'organization-alpha', 'calendar.example.test',
         'custom_public', 'active', 1, ?, ?)`,
    )
    .bind(now, now)
    .run();
});

afterEach(async () => {
  await reset();
});

describe("calendar feed credentials", () => {
  it("issues on the canonical host and invalidates the old feed immediately after reset", async () => {
    const cookie = await signIn();
    const credentialResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/singer/calendar-feed-url", cookie),
    );
    expect(credentialResponse.status).toBe(200);
    const credential = calendarFeedUrlsResponseSchema.parse(await credentialResponse.json());
    expect(credential.httpsUrl).toContain("http://alpha.localhost/api/calendar/feed?token=");
    expect(credential.webcalUrl).toContain("webcal://alpha.localhost/api/calendar/feed?token=");

    const feedResponse = await exports.default.fetch(new Request(credential.httpsUrl));
    expect(feedResponse.status).toBe(200);
    expect(feedResponse.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    await expect(feedResponse.text()).resolves.toContain("X-WR-CALNAME:Organization Alpha");

    const crossOrganizationUrl = new URL(credential.httpsUrl);
    crossOrganizationUrl.hostname = "bravo.localhost";
    expect(await exports.default.fetch(new Request(crossOrganizationUrl))).toMatchObject({
      status: 404,
    });
    const customPublicUrl = new URL(credential.httpsUrl);
    customPublicUrl.hostname = "calendar.example.test";
    expect(await exports.default.fetch(new Request(customPublicUrl))).toMatchObject({
      status: 404,
    });

    const resetResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/singer/calendar-feed-url/reset", cookie, "POST"),
    );
    expect(resetResponse.status).toBe(200);
    const resetCredential = calendarFeedUrlsResponseSchema.parse(await resetResponse.json());
    expect(resetCredential.httpsUrl).not.toBe(credential.httpsUrl);
    expect(await exports.default.fetch(new Request(credential.httpsUrl))).toMatchObject({
      status: 404,
    });
    expect(await exports.default.fetch(new Request(resetCredential.httpsUrl))).toMatchObject({
      status: 200,
    });

    const audit = await runInDurableObject<OrganizationStore, { action: string } | null>(
      organizationStore.get(organizationStore.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ action: string }>(
            "SELECT action FROM audit_events WHERE action = 'profile.calendar_feed.reset'",
          )
          .toArray()
          .at(0) ?? null,
    );
    expect(audit).toEqual({ action: "profile.calendar_feed.reset" });
  });

  it("fails closed for anonymous credential access, malformed tokens, and missing profile links", async () => {
    expect(
      await exports.default.fetch(apiRequest("alpha.localhost", "/api/singer/calendar-feed-url")),
    ).toMatchObject({ status: 401 });
    expect(
      await exports.default.fetch(apiRequest("alpha.localhost", "/api/calendar/feed?token=bad")),
    ).toMatchObject({ status: 404 });
    await controlDatabase
      .prepare("UPDATE member SET profileId = NULL WHERE organizationId = 'organization-alpha'")
      .run();
    const cookie = await signIn();
    expect(
      await exports.default.fetch(
        apiRequest("alpha.localhost", "/api/singer/calendar-feed-url", cookie),
      ),
    ).toMatchObject({ status: 404 });
  });
});
