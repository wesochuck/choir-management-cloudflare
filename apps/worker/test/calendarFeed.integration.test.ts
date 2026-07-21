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
         VALUES (?, ?, ?, 'active', ?, 9, ?, ?, ?)`,
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

  it("renders Organization-local events with RSVP inheritance, venues, and call times", async () => {
    const eventStart = new Date(Date.now() + 10 * 24 * 60 * 60 * 1_000);
    eventStart.setUTCHours(23, 0, 0, 0);
    const rehearsalStart = new Date(eventStart.getTime() + 24 * 60 * 60 * 1_000);
    const localStartParts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      month: "2-digit",
      timeZone: "America/New_York",
      year: "numeric",
    }).formatToParts(eventStart);
    const localHour = Number(localStartParts.find((part) => part.type === "hour")?.value);
    const callTime = `${String(localHour - 1).padStart(2, "0")}:00`;
    const stub = organizationStore.get(organizationStore.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec("UPDATE organization_metadata SET timezone = 'America/New_York'");
      state.storage.sql.exec(
        `INSERT INTO venues (id, name, address, created_at, updated_at)
         VALUES ('venue-main', 'Main Sanctuary', '123 Main St', ?, ?)`,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO events
          (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
           parent_performance_id, details, set_list_json, set_list_approved,
           is_archived, created_at, updated_at)
         VALUES
          ('performance-main', 'Summer, Concert', 'Performance', ?, 150, ?, '', 'venue-main',
           NULL, 'Black folders',
           '[{"title":"Finale","composer":"Composer","isFeaturedNumber":true,"performerCredits":[{"displayName":"Soloist"}]}]',
           1, 0, ?, ?),
          ('rehearsal-child', 'Dress Rehearsal', 'Rehearsal', ?, NULL, '', 'Choir Room', NULL,
           'performance-main', '', '[]', 0, 0, ?, ?),
          ('event-declined', 'Declined Event', 'Performance', ?, 90, '', '', NULL,
           NULL, '', '[]', 0, 0, ?, ?)`,
        eventStart.toISOString(),
        callTime,
        now,
        now,
        rehearsalStart.toISOString(),
        now,
        now,
        new Date(rehearsalStart.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO event_rosters (event_id, profile_id, rsvp, created_at, updated_at)
         VALUES
          ('performance-main', ?, 'Yes', ?, ?),
          ('rehearsal-child', ?, 'Pending', ?, ?),
          ('event-declined', ?, 'No', ?, ?)`,
        ALPHA_PROFILE_ID,
        now,
        now,
        ALPHA_PROFILE_ID,
        now,
        now,
        ALPHA_PROFILE_ID,
        now,
        now,
      );
      return null;
    });

    const cookie = await signIn();
    const credentialResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/singer/calendar-feed-url", cookie),
    );
    const credential = calendarFeedUrlsResponseSchema.parse(await credentialResponse.json());
    const feedResponse = await exports.default.fetch(new Request(credential.httpsUrl));
    expect(feedResponse.status).toBe(200);
    const feed = await feedResponse.text();
    expect(feed).toContain("SUMMARY:Summer\\, Concert");
    expect(feed).toContain("SUMMARY:Call Time: Summer\\, Concert");
    expect(feed).toContain("LOCATION:Main Sanctuary\\, 123 Main St");
    expect(feed).toContain("SUMMARY:Dress Rehearsal");
    expect(feed).toContain("Your Status: Attending");
    expect(feed).toContain("Set List:\\n1. Finale (Composer)\\n   Solo — Soloist");
    expect(feed).not.toContain("Declined Event");
    expect(feed).toContain(
      `DTSTART:${new Date(eventStart.getTime() - 60 * 60 * 1_000)
        .toISOString()
        .replaceAll("-", "")
        .replaceAll(":", "")
        .replace(/\.\d{3}Z$/, "Z")}`,
    );
  });
});
