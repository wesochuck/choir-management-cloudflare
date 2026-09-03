import { adminSearchQueryResponseSchema, type AdminSearchQueryResponse } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const ALPHA_ADMIN_EMAIL = "admin.alpha@example.test";
const BRAVO_ADMIN_EMAIL = "admin.bravo@example.test";
const ALPHA_SINGER_EMAIL = "singer.alpha@example.test";
const BRAVO_SINGER_EMAIL = "singer.bravo@example.test";

const ALPHA_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const BRAVO_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const ALPHA_EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRAVO_EVENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const api = organizationRequest;

const signInAlpha = () =>
  signInWithOtp(exports.default, "alpha.localhost", ALPHA_ADMIN_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();

  // Seed users
  await seedAuthUser(database, "user-alpha-admin", ALPHA_ADMIN_EMAIL, "Alpha Admin");
  await seedAuthUser(database, "user-bravo-admin", BRAVO_ADMIN_EMAIL, "Bravo Admin");
  await seedAuthUser(database, "user-alpha-singer", ALPHA_SINGER_EMAIL, "Alpha Singer");
  await seedAuthUser(database, "user-bravo-singer", BRAVO_SINGER_EMAIL, "Bravo Singer");

  // Provision organizations
  await provisionOrganization(database, stores, {
    id: "organization-alpha",
    name: "Organization Alpha",
    slug: "alpha",
    userId: "user-alpha-admin",
  });
  await provisionOrganization(database, stores, {
    id: "organization-bravo",
    name: "Organization Bravo",
    slug: "bravo",
    userId: "user-bravo-admin",
  });

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Associate singer memberships in D1 with profileId
  await database
    .prepare(
      `INSERT INTO member (id, organizationId, userId, role, createdAt, profileId)
       VALUES (?, ?, ?, 'member', ?, ?)`,
    )
    .bind("member-alpha-singer", "organization-alpha", "user-alpha-singer", now, ALPHA_PROFILE_ID)
    .run();

  await database
    .prepare(
      `INSERT INTO member (id, organizationId, userId, role, createdAt, profileId)
       VALUES (?, ?, ?, 'member', ?, ?)`,
    )
    .bind("member-bravo-singer", "organization-bravo", "user-bravo-singer", now, BRAVO_PROFILE_ID)
    .run();

  // Seed Alpha DO
  const alphaStub = stores.get(stores.idFromName("organization-alpha"));
  await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO profiles (id, display_name, phone, voice_part, global_status, created_at, updated_at)
       VALUES (?, 'Alpha Singer', '555-0101', 'Soprano 1', 'Active', ?, ?)`,
      ALPHA_PROFILE_ID,
      nowIso,
      nowIso,
    );
    state.storage.sql.exec(
      `INSERT INTO events
         (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
          parent_performance_id, details, set_list_json, set_list_approved,
          is_archived, public_graphic_file_id, created_at, updated_at)
       VALUES (?, 'Alpha Gala Concert', 'Performance', ?, 90, '', 'Alpha Hall', NULL, NULL, '', '[]', 1, 0, NULL, ?, ?)`,
      ALPHA_EVENT_ID,
      new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString(),
      nowIso,
      nowIso,
    );
    return null;
  });

  // Seed Bravo DO
  const bravoStub = stores.get(stores.idFromName("organization-bravo"));
  await runInDurableObject<OrganizationStore, null>(bravoStub, (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO profiles (id, display_name, phone, voice_part, global_status, created_at, updated_at)
       VALUES (?, 'Bravo Singer', '555-0202', 'Bass 2', 'Active', ?, ?)`,
      BRAVO_PROFILE_ID,
      nowIso,
      nowIso,
    );
    state.storage.sql.exec(
      `INSERT INTO events
         (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
          parent_performance_id, details, set_list_json, set_list_approved,
          is_archived, public_graphic_file_id, created_at, updated_at)
       VALUES (?, 'Bravo Gala Concert', 'Performance', ?, 90, '', 'Bravo Hall', NULL, NULL, '', '[]', 1, 0, NULL, ?, ?)`,
      BRAVO_EVENT_ID,
      new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString(),
      nowIso,
      nowIso,
    );
    return null;
  });
});

afterEach(async () => {
  await reset();
});

describe("Organization search integration", () => {
  it("rejects unauthenticated search with 401", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/search?q=test"),
    );
    expect(response.status).toBe(401);
  });

  it("finds roster profile through D1 email bridge", async () => {
    const cookie = await signInAlpha();
    const response = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/search?q=${encodeURIComponent(ALPHA_SINGER_EMAIL)}`,
        cookie,
      ),
    );

    expect(response.status).toBe(200);
    const data: AdminSearchQueryResponse = adminSearchQueryResponseSchema.parse(
      await response.json(),
    );
    expect(data.results.length).toBeGreaterThanOrEqual(1);

    const match = data.results.find((r) => r.id === `roster-${ALPHA_PROFILE_ID}`);
    expect(match).toBeDefined();
    expect(match?.title).toBe("Alpha Singer");
    expect(match?.subtitle).toContain(ALPHA_SINGER_EMAIL);
  });

  it("searches events by keyword", async () => {
    const cookie = await signInAlpha();
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/search?q=Gala", cookie),
    );

    expect(response.status).toBe(200);
    const data: AdminSearchQueryResponse = adminSearchQueryResponseSchema.parse(
      await response.json(),
    );
    const eventMatch = data.results.find((r) => r.id === `event-${ALPHA_EVENT_ID}`);
    expect(eventMatch).toBeDefined();
    expect(eventMatch?.title).toBe("Alpha Gala Concert");
  });

  it("enforces strict multi-tenant isolation (Bravo data never leaks into Alpha search)", async () => {
    const cookie = await signInAlpha();

    // 1. Searching for Bravo by name on Alpha returns zero results
    const nameResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/search?q=Bravo", cookie),
    );
    expect(nameResponse.status).toBe(200);
    const nameData = adminSearchQueryResponseSchema.parse(await nameResponse.json());
    expect(nameData.results).toHaveLength(0);

    // 2. Searching by Bravo singer email on Alpha returns zero results
    const emailResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/search?q=${encodeURIComponent(BRAVO_SINGER_EMAIL)}`,
        cookie,
      ),
    );
    expect(emailResponse.status).toBe(200);
    const emailData = adminSearchQueryResponseSchema.parse(await emailResponse.json());
    expect(emailData.results).toHaveLength(0);

    // 3. Searching for a common keyword ("Gala") returns ONLY Alpha's event, never Bravo's event
    const galaResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/search?q=Gala", cookie),
    );
    expect(galaResponse.status).toBe(200);
    const galaData = adminSearchQueryResponseSchema.parse(await galaResponse.json());
    expect(galaData.results.some((r) => r.id === `event-${ALPHA_EVENT_ID}`)).toBe(true);
    expect(galaData.results.some((r) => r.id === `event-${BRAVO_EVENT_ID}`)).toBe(false);
  });
});
