import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import { issueSignedLink } from "../src/security/signedLinks";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const ALPHA_PROFILE = "11111111-1111-4111-8111-111111111111";
const BRAVO_PROFILE = "22222222-2222-4222-8222-222222222222";
const ALPHA_EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRAVO_EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const signedLinkSecret = requireBinding(env.SIGNED_LINK_SECRET, "SIGNED_LINK_SECRET");

function api(host: string, path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function provision(
  id: string,
  slug: string,
  profileId: string,
  eventId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 14, ?, ?, ?)`,
      )
      .bind(id, `Organization ${slug}`, slug, id, now, now, now),
    database
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, id, `${slug}.localhost`, now, now),
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
  await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
    const startsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1_000).toISOString();
    state.storage.sql.exec(
      `INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      profileId,
      `${slug} Singer`,
      now,
      now,
    );
    state.storage.sql.exec(
      `INSERT INTO events
        (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
         parent_performance_id, details, set_list_json, set_list_approved,
         is_archived, created_at, updated_at)
       VALUES (?, ?, 'Performance', ?, 150, '', '', NULL, NULL, '', '[]', 0, 0, ?, ?)`,
      eventId,
      `${slug} Performance`,
      startsAt,
      now,
      now,
    );
    state.storage.sql.exec(
      `INSERT INTO event_rosters (event_id, profile_id, rsvp, rsvp_note, created_at, updated_at)
       VALUES (?, ?, 'Pending', '', ?, ?)`,
      eventId,
      profileId,
      now,
      now,
    );
    return null;
  });
}

async function issueRsvpToken(
  organizationId: string,
  eventId: string,
  profileId: string,
): Promise<string> {
  return issueSignedLink(signedLinkSecret, {
    algorithm: "HS256",
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    issuedAt: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
    organizationId,
    purpose: "rsvp",
    resourceId: eventId,
    subjectId: profileId,
    version: 1,
  });
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  await provision("organization-alpha", "alpha", ALPHA_PROFILE, ALPHA_EVENT);
  await provision("organization-bravo", "bravo", BRAVO_PROFILE, BRAVO_EVENT);
});

afterEach(async () => {
  await reset();
});

describe("public RSVP signed flow", () => {
  it("resolves RSVP details for a valid token", async () => {
    const token = await issueRsvpToken("organization-alpha", ALPHA_EVENT, ALPHA_PROFILE);
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/rsvp-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      canSubmit: true,
      event: { id: ALPHA_EVENT, title: "alpha Performance" },
      profileId: ALPHA_PROFILE,
      profileName: "alpha Singer",
      rsvp: "Pending",
    });
  });

  it("rejects a token used on the wrong hostname", async () => {
    const token = await issueRsvpToken("organization-alpha", ALPHA_EVENT, ALPHA_PROFILE);
    const response = await exports.default.fetch(
      api("bravo.localhost", "/api/public/rsvp-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a completely bogus token", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/rsvp-details", {
        body: JSON.stringify({ token: "bogus-token-value" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects an expired token", async () => {
    const token = await issueSignedLink(signedLinkSecret, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1000) - 60,
      issuedAt: Math.floor(Date.now() / 1000) - 120,
      nonce: crypto.randomUUID(),
      organizationId: "organization-alpha",
      purpose: "rsvp",
      resourceId: ALPHA_EVENT,
      subjectId: ALPHA_PROFILE,
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/rsvp-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a token for a non-existent event", async () => {
    const token = await issueSignedLink(signedLinkSecret, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      issuedAt: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
      organizationId: "organization-alpha",
      purpose: "rsvp",
      resourceId: "00000000-0000-0000-0000-000000000000",
      subjectId: ALPHA_PROFILE,
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/rsvp-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("submits a quick RSVP and persists it", async () => {
    const token = await issueRsvpToken("organization-alpha", ALPHA_EVENT, ALPHA_PROFILE);
    const submitResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/public/quick-rsvp", {
        body: JSON.stringify({ rsvp: "No", rsvpNote: "Family event", token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(submitResponse.status).toBe(200);
    const submitBody: unknown = await submitResponse.json();
    expect(submitBody).toMatchObject({ rsvp: "No" });

    const row = await runInDurableObject<
      OrganizationStore,
      { rsvp: string; rsvpNote: string } | null
    >(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ rsvp: string; rsvpNote: string }>(
            `SELECT rsvp, rsvp_note AS rsvpNote FROM event_rosters
             WHERE event_id = ? AND profile_id = ?`,
            ALPHA_EVENT,
            ALPHA_PROFILE,
          )
          .toArray()
          .at(0) ?? null,
    );
    expect(row).toEqual({ rsvp: "No", rsvpNote: "Family event" });
  });

  it("rejects quick RSVP with an invalid token", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/quick-rsvp", {
        body: JSON.stringify({ rsvp: "Yes", rsvpNote: "", token: "bogus" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("isolates RSVP tokens between organizations", async () => {
    const alphaToken = await issueRsvpToken("organization-alpha", ALPHA_EVENT, ALPHA_PROFILE);
    const bravoResponse = await exports.default.fetch(
      api("bravo.localhost", "/api/public/quick-rsvp", {
        body: JSON.stringify({ rsvp: "Yes", rsvpNote: "", token: alphaToken }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(bravoResponse.status).toBe(404);

    const alphaRow = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ rsvp: string }>(
            `SELECT rsvp FROM event_rosters WHERE event_id = ? AND profile_id = ?`,
            ALPHA_EVENT,
            ALPHA_PROFILE,
          )
          .toArray()
          .at(0)?.rsvp ?? "missing",
    );
    expect(alphaRow).toBe("Pending");
  });

  it("rejects a token used for the wrong purpose", async () => {
    const token = await issueSignedLink(signedLinkSecret, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      issuedAt: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
      organizationId: "organization-alpha",
      purpose: "audition",
      resourceId: ALPHA_EVENT,
      subjectId: ALPHA_PROFILE,
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/rsvp-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });
});
