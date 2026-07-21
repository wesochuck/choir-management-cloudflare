import { singerEventsResponseSchema } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "self-rsvp@example.test";
const ALPHA_PROFILE = "11111111-1111-4111-8111-111111111111";
const BRAVO_PROFILE = "22222222-2222-4222-8222-222222222222";
const PERFORMANCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REHEARSAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

function api(host: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function provision(id: string, name: string, slug: string, profileId: string): Promise<void> {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 7, ?, ?, ?)`,
      )
      .bind(id, name, slug, id, now, now, now),
    database
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, id, `${slug}.localhost`, now, now),
    database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt, profileId)
         VALUES (?, ?, 'self-rsvp-user', 'member', ?, ?)`,
      )
      .bind(`member-${slug}`, id, Date.now(), profileId),
  ]);
  const stub = stores.get(stores.idFromName(id));
  const response = await stub.fetch("https://organization.internal/internal/provision", {
    body: JSON.stringify({
      actorUserId: "bootstrap",
      canonicalHostname: `${slug}.localhost`,
      canonicalStatus: "active",
      name,
      organizationId: id,
      requestId: crypto.randomUUID(),
      slug,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
  await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
    const createdAt = new Date().toISOString();
    const startsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1_000).toISOString();
    state.storage.sql.exec(
      `INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      profileId,
      `${name} Singer`,
      createdAt,
      createdAt,
    );
    state.storage.sql.exec(
      `INSERT INTO events
        (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
         parent_performance_id, details, set_list_json, set_list_approved,
         is_archived, created_at, updated_at)
       VALUES (?, ?, 'Performance', ?, 150, '', '', NULL, NULL, '', '[]', 0, 0, ?, ?)`,
      id === "organization-alpha" ? PERFORMANCE_ID : crypto.randomUUID(),
      `${name} Performance`,
      startsAt,
      createdAt,
      createdAt,
    );
    if (id === "organization-alpha") {
      state.storage.sql.exec(
        `INSERT INTO events
          (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
           parent_performance_id, details, set_list_json, set_list_approved,
           is_archived, created_at, updated_at)
         VALUES (?, 'Alpha Rehearsal', 'Rehearsal', ?, 120, '', '', NULL, ?, '', '[]', 0, 0, ?, ?)`,
        REHEARSAL_ID,
        new Date(new Date(startsAt).getTime() + 24 * 60 * 60 * 1_000).toISOString(),
        PERFORMANCE_ID,
        createdAt,
        createdAt,
      );
      state.storage.sql.exec(
        `INSERT INTO event_rosters (event_id, profile_id, rsvp, created_at, updated_at)
         VALUES (?, ?, 'Yes', ?, ?), (?, ?, 'Pending', ?, ?)`,
        PERFORMANCE_ID,
        profileId,
        createdAt,
        createdAt,
        REHEARSAL_ID,
        profileId,
        createdAt,
        createdAt,
      );
    }
    return null;
  });
}

async function signIn(): Promise<string> {
  await exports.default.fetch(
    api("alpha.localhost", "/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const otp = readCapturedPlatformEmailsForTest()
    .find((message) => message.kind === "email-one-time-code" && message.recipient === USER_EMAIL)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  const response = await exports.default.fetch(
    api("alpha.localhost", "/api/auth/sign-in/email-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, otp }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES ('self-rsvp-user', 'Self RSVP', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "Organization Alpha", "alpha", ALPHA_PROFILE);
  await provision("organization-bravo", "Organization Bravo", "bravo", BRAVO_PROFILE);
});

afterEach(async () => {
  await reset();
});

describe("linked-Profile self-service RSVP", () => {
  it("shows inherited status and updates only the caller's hostname-linked Profile", async () => {
    expect(await exports.default.fetch(api("alpha.localhost", "/api/singer/events"))).toMatchObject(
      { status: 401 },
    );
    const cookie = await signIn();
    const alpha = singerEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/events", cookie))
      ).json(),
    );
    expect(alpha.profileId).toBe(ALPHA_PROFILE);
    expect(alpha.events.map((event) => event.title)).toEqual([
      "Organization Alpha Performance",
      "Alpha Rehearsal",
    ]);
    expect(alpha.events[1]).toMatchObject({
      directRsvp: "Pending",
      inheritedFromParent: true,
      resolvedRsvp: "Yes",
    });

    const response = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${REHEARSAL_ID}/rsvp`, cookie, {
        body: JSON.stringify({ profileId: BRAVO_PROFILE, rsvp: "No" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(response.status).toBe(200);
    const updated = singerEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/events", cookie))
      ).json(),
    );
    expect(updated.events[1]).toMatchObject({
      directRsvp: "No",
      inheritedFromParent: false,
      resolvedRsvp: "No",
    });
    const bravo = singerEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("bravo.localhost", "/api/singer/events", cookie))
      ).json(),
    );
    expect(bravo.profileId).toBe(BRAVO_PROFILE);
    expect(bravo.events.map((event) => event.title)).toEqual(["Organization Bravo Performance"]);

    const alphaRsvp = await runInDurableObject<OrganizationStore, string | null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ rsvp: string }>(
            "SELECT rsvp FROM event_rosters WHERE event_id = ? AND profile_id = ?",
            REHEARSAL_ID,
            ALPHA_PROFILE,
          )
          .toArray()
          .at(0)?.rsvp ?? null,
    );
    expect(alphaRsvp).toBe("No");
  });
});
