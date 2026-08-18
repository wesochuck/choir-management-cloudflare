import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import { issueSignedLink } from "../src/security/signedLinks";
import { migrateOrganization } from "../src/organization/migrations";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const ALPHA_PROFILE = "11111111-1111-4111-8111-111111111111";
const BRAVO_PROFILE = "22222222-2222-4222-8222-222222222222";
const ALPHA_POLL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRAVO_POLL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALPHA_OPTION_A = "a0000000-0000-4000-8000-000000000001";
const ALPHA_OPTION_B = "a0000000-0000-4000-8000-000000000002";
const BRAVO_OPTION_A = "b0000000-0000-4000-8000-000000000001";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

function safeParseStringArray(value: unknown): string[] {
  if (!value || !Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
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
  pollId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 25, ?, ?, ?)`,
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
    state.storage.sql.exec(
      `INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      profileId,
      `${slug} Singer`,
      now,
      now,
    );
    state.storage.sql.exec(
      `INSERT INTO polls (id, title, description, multiple_choice, expires_at, archived_at, created_by, created_at, updated_at)
       VALUES (?, 'Favorite color?', 'Pick your favorite', 0, ?, '', 'bootstrap', ?, ?)`,
      pollId,
      new Date(Date.parse(now) + 3 * 24 * 60 * 60 * 1_000).toISOString(),
      now,
      now,
    );
    state.storage.sql.exec(
      `INSERT INTO poll_options (id, poll_id, label, sort_order)
       VALUES (?, ?, 'Red', 0)`,
      ALPHA_OPTION_A,
      pollId,
    );
    state.storage.sql.exec(
      `INSERT INTO poll_options (id, poll_id, label, sort_order)
       VALUES (?, ?, 'Blue', 1)`,
      ALPHA_OPTION_B,
      pollId,
    );
    if (slug === "bravo") {
      state.storage.sql.exec(
        `INSERT INTO poll_options (id, poll_id, label, sort_order)
         VALUES (?, ?, 'Green', 0)`,
        BRAVO_OPTION_A,
        pollId,
      );
    }
    return null;
  });
}

async function issuePollToken(
  organizationId: string,
  pollId: string,
  profileId: string,
): Promise<string> {
  return issueSignedLink(signedLinkSecret, {
    algorithm: "HS256",
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    issuedAt: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
    organizationId,
    purpose: "poll",
    resourceId: pollId,
    subjectId: profileId,
    version: 1,
  });
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  await provision("organization-alpha", "alpha", ALPHA_PROFILE, ALPHA_POLL);
  await provision("organization-bravo", "bravo", BRAVO_PROFILE, BRAVO_POLL);
});

afterEach(async () => {
  await reset();
});

describe("public poll signed flow", () => {
  it("backfills legacy poll expirations from the creation time", async () => {
    const row = await runInDurableObject<
      OrganizationStore,
      { createdAt: string; expiresAt: string } | null
    >(stores.get(stores.idFromName("organization-alpha")), (_instance, state) => {
      state.storage.sql.exec("UPDATE polls SET expires_at = '' WHERE id = ?", ALPHA_POLL);
      state.storage.sql.exec("DELETE FROM organization_schema_migrations WHERE version = ?", 66);
      migrateOrganization(state.storage);
      return (
        state.storage.sql
          .exec<{ createdAt: string; expiresAt: string }>(
            "SELECT created_at AS createdAt, expires_at AS expiresAt FROM polls WHERE id = ?",
            ALPHA_POLL,
          )
          .toArray()
          .at(0) ?? null
      );
    });
    expect(row).not.toBeNull();
    expect(row?.expiresAt).toBe(
      new Date(Date.parse(row?.createdAt ?? "") + 3 * 24 * 60 * 60 * 1_000).toISOString(),
    );
  });

  it("resolves poll details for a valid token", async () => {
    const token = await issuePollToken("organization-alpha", ALPHA_POLL, ALPHA_PROFILE);
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/poll-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      canSubmit: true,
      title: "Favorite color?",
      profileId: ALPHA_PROFILE,
      profileName: "alpha Singer",
      responseOptionIds: [],
    });
  });

  it("rejects a token used on the wrong hostname", async () => {
    const token = await issuePollToken("organization-alpha", ALPHA_POLL, ALPHA_PROFILE);
    const response = await exports.default.fetch(
      api("bravo.localhost", "/api/public/poll-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a completely bogus token", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/poll-details", {
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
      purpose: "poll",
      resourceId: ALPHA_POLL,
      subjectId: ALPHA_PROFILE,
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/poll-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a token for a non-existent poll", async () => {
    const token = await issueSignedLink(signedLinkSecret, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      issuedAt: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
      organizationId: "organization-alpha",
      purpose: "poll",
      resourceId: "00000000-0000-0000-0000-000000000000",
      subjectId: ALPHA_PROFILE,
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/poll-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("submits a poll vote and persists it", async () => {
    const token = await issuePollToken("organization-alpha", ALPHA_POLL, ALPHA_PROFILE);
    const submitResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/public/poll-vote", {
        body: JSON.stringify({ optionIds: [ALPHA_OPTION_A], token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(submitResponse.status).toBe(200);

    const row = await runInDurableObject<OrganizationStore, string[] | null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        const result = state.storage.sql
          .exec<{ optionIds: string }>(
            `SELECT option_ids AS optionIds FROM poll_responses
             WHERE poll_id = ? AND profile_id = ?`,
            ALPHA_POLL,
            ALPHA_PROFILE,
          )
          .toArray()
          .at(0);
        return result ? safeParseStringArray(JSON.parse(result.optionIds)) : null;
      },
    );
    expect(row).toEqual([ALPHA_OPTION_A]);
  });

  it("rejects a poll vote containing an option from another poll", async () => {
    const token = await issuePollToken("organization-alpha", ALPHA_POLL, ALPHA_PROFILE);
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/poll-vote", {
        body: JSON.stringify({ optionIds: [BRAVO_OPTION_A], token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "poll_option_not_found" });
  });

  it("rejects a poll vote with an invalid token", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/poll-vote", {
        body: JSON.stringify({ optionIds: [ALPHA_OPTION_A], token: "bogus" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("isolates poll tokens between organizations", async () => {
    const alphaToken = await issuePollToken("organization-alpha", ALPHA_POLL, ALPHA_PROFILE);
    const bravoResponse = await exports.default.fetch(
      api("bravo.localhost", "/api/public/poll-vote", {
        body: JSON.stringify({ optionIds: [ALPHA_OPTION_A], token: alphaToken }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(bravoResponse.status).toBe(404);

    const alphaRow = await runInDurableObject<OrganizationStore, number>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        const result = state.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM poll_responses WHERE poll_id = ? AND profile_id = ?`,
            ALPHA_POLL,
            ALPHA_PROFILE,
          )
          .toArray()
          .at(0);
        return result?.count ?? 0;
      },
    );
    expect(alphaRow).toBe(0);
  });

  it("rejects a token used for the wrong purpose", async () => {
    const token = await issueSignedLink(signedLinkSecret, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      issuedAt: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
      organizationId: "organization-alpha",
      purpose: "rsvp",
      resourceId: ALPHA_POLL,
      subjectId: ALPHA_PROFILE,
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/poll-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("allows updating vote before expiry and reports previous response options", async () => {
    const token = await issuePollToken("organization-alpha", ALPHA_POLL, ALPHA_PROFILE);
    const first = await exports.default.fetch(
      api("alpha.localhost", "/api/public/poll-vote", {
        body: JSON.stringify({ optionIds: [ALPHA_OPTION_A], token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(first.status).toBe(200);

    const detailsResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/public/poll-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(detailsResponse.status).toBe(200);
    const details: unknown = await detailsResponse.json();
    expect(details).toMatchObject({
      canSubmit: true,
      responseOptionIds: [ALPHA_OPTION_A],
    });

    const updateResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/public/poll-vote", {
        body: JSON.stringify({ optionIds: [ALPHA_OPTION_B], token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(updateResponse.status).toBe(200);

    const updatedRow = await runInDurableObject<OrganizationStore, string[] | null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        const result = state.storage.sql
          .exec<{ optionIds: string }>(
            `SELECT option_ids AS optionIds FROM poll_responses
             WHERE poll_id = ? AND profile_id = ?`,
            ALPHA_POLL,
            ALPHA_PROFILE,
          )
          .toArray()
          .at(0);
        return result ? safeParseStringArray(JSON.parse(result.optionIds)) : null;
      },
    );
    expect(updatedRow).toEqual([ALPHA_OPTION_B]);
  });
});
