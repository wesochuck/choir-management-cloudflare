import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import { issueSignedLink } from "../src/security/signedLinks";
import { uploadPrivateOrganizationFile } from "../src/storage/privateFiles";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const ALPHA_PROFILE = "11111111-1111-4111-8111-111111111111";
const BRAVO_PROFILE = "22222222-2222-4222-8222-222222222222";
const ALPHA_EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRAVO_EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALPHA_PIECE = "p0000000-0000-4000-8000-000000000001";
const ALPHA_PIECE_FILE = "f0000000-0000-4000-8000-000000000001";
const ALPHA_OUT_OF_SCOPE_FILE = "f0000000-0000-4000-8000-000000000003";
const BRAVO_PIECE = "p0000000-0000-4000-8000-000000000002";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const organizationFiles = requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");
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
  pieceId: string,
  fileId: string,
  profileSuffix: string,
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
      `${slug} Singer ${profileSuffix}`,
      now,
      now,
    );
    const setListJson = JSON.stringify([
      {
        composer: "Mozart",
        isFeaturedNumber: true,
        pieceId,
        title: "Alleluia",
      },
      {
        composer: "Bach",
        isFeaturedNumber: false,
        title: "Jesu, Joy",
      },
    ]);
    state.storage.sql.exec(
      `INSERT INTO events
         (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
          parent_performance_id, details, set_list_json, set_list_approved,
          is_archived, created_at, updated_at)
        VALUES (?, ?, 'Performance', ?, 90, '', '', NULL, NULL, '', ?, 1, 0, ?, ?)`,
      eventId,
      `${slug} Concert`,
      new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000).toISOString(),
      setListJson,
      now,
      now,
    );
    state.storage.sql.exec(
      `INSERT INTO music_pieces
         (id, title, composer, arranger, duration_seconds, notes, section_buckets_json,
          genres_json, track_file_ids_json, created_at, updated_at)
        VALUES (?, 'Alleluia', 'Mozart', '', 240, 'Soprano solo', '[]', '[]', ?, ?, ?)`,
      pieceId,
      JSON.stringify({ soprano: fileId }),
      now,
      now,
    );
    return null;
  });
}

async function issuePlayerToken(
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
    purpose: "player",
    resourceId: eventId,
    subjectId: profileId,
    version: 1,
  });
}

async function issuePublicPlayerToken(organizationId: string, eventId: string): Promise<string> {
  return issueSignedLink(signedLinkSecret, {
    algorithm: "HS256",
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    issuedAt: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
    organizationId,
    purpose: "player_public",
    resourceId: eventId,
    version: 1,
  });
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  await provision(
    "organization-alpha",
    "alpha",
    ALPHA_PROFILE,
    ALPHA_EVENT,
    ALPHA_PIECE,
    ALPHA_PIECE_FILE,
    "A",
  );
  await provision(
    "organization-bravo",
    "bravo",
    BRAVO_PROFILE,
    BRAVO_EVENT,
    BRAVO_PIECE,
    "f0000000-0000-4000-8000-000000000002",
    "B",
  );
});

afterEach(async () => {
  await reset();
});

describe("public player signed flow", () => {
  it("resolves player details for a valid token", async () => {
    const token = await issuePlayerToken("organization-alpha", ALPHA_EVENT, ALPHA_PROFILE);
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      eventId: ALPHA_EVENT,
      eventTitle: "alpha Concert",
      profileId: ALPHA_PROFILE,
      profileName: "alpha Singer A",
    });
  });

  it("returns playlist items with resolved music piece data", async () => {
    const token = await issuePlayerToken("organization-alpha", ALPHA_EVENT, ALPHA_PROFILE);
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    const responseJson: unknown = await response.json();
    expect(responseJson).toMatchObject({
      items: [
        {
          title: "Alleluia",
          composer: "Mozart",
          isFeaturedNumber: true,
          durationSeconds: 240,
          trackFileIds: { soprano: ALPHA_PIECE_FILE },
        },
        {
          title: "Jesu, Joy",
          composer: "Bach",
          isFeaturedNumber: false,
          trackFileIds: {},
        },
      ],
    });
  });

  it("keeps the legacy public playlist path signed and tenant-bound", async () => {
    const token = await issuePublicPlayerToken("organization-alpha", ALPHA_EVENT);
    const response = await exports.default.fetch(
      api("alpha.localhost", `/api/player-playlist?token=${encodeURIComponent(token)}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      event: { id: ALPHA_EVENT, title: "alpha Concert" },
      setList: expect.arrayContaining([expect.objectContaining({ title: "Alleluia" })]),
    });
    const crossTenantResponse = await exports.default.fetch(
      api("bravo.localhost", `/api/player-playlist?token=${encodeURIComponent(token)}`),
    );
    expect(crossTenantResponse.status).toBe(404);
  });

  it("rejects a token used on the wrong hostname", async () => {
    const token = await issuePlayerToken("organization-alpha", ALPHA_EVENT, ALPHA_PROFILE);
    const response = await exports.default.fetch(
      api("bravo.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a completely bogus token", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/player-details", {
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
      purpose: "player",
      resourceId: ALPHA_EVENT,
      subjectId: ALPHA_PROFILE,
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/player-details", {
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
      purpose: "player",
      resourceId: "00000000-0000-0000-0000-000000000000",
      subjectId: ALPHA_PROFILE,
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a token for a non-existent profile", async () => {
    const token = await issueSignedLink(signedLinkSecret, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      issuedAt: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
      organizationId: "organization-alpha",
      purpose: "player",
      resourceId: ALPHA_EVENT,
      subjectId: "00000000-0000-0000-0000-000000000000",
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("isolates player tokens between organizations", async () => {
    const alphaToken = await issuePlayerToken("organization-alpha", ALPHA_EVENT, ALPHA_PROFILE);
    const response = await exports.default.fetch(
      api("bravo.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token: alphaToken }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a token used for the wrong purpose", async () => {
    const token = await issueSignedLink(signedLinkSecret, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      issuedAt: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
      organizationId: "organization-alpha",
      purpose: "rsvp",
      resourceId: ALPHA_EVENT,
      subjectId: ALPHA_PROFILE,
      version: 1,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });

  it("requires a token query parameter for media endpoint", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", `/api/public/player/media/${ALPHA_PIECE_FILE}`),
    );
    expect(response.status).toBe(400);
  });

  it("rejects media request with an invalid token", async () => {
    const response = await exports.default.fetch(
      api("alpha.localhost", `/api/public/player/media/${ALPHA_PIECE_FILE}?token=bogus`),
    );
    expect(response.status).toBe(404);
  });

  it("rejects media request for a non-existent file", async () => {
    const token = await issuePlayerToken("organization-alpha", ALPHA_EVENT, ALPHA_PROFILE);
    const response = await exports.default.fetch(
      api(
        "alpha.localhost",
        "/api/public/player/media/00000000-0000-0000-0000-000000000000?token=" + token,
      ),
    );
    expect(response.status).toBe(404);
  });

  it("limits media access to files in the signed event playlist", async () => {
    const body = new TextEncoder().encode("practice-track").buffer;
    const fileInput = {
      actorUserId: "bootstrap",
      contentType: "audio/mpeg",
      fileName: "practice-track.mp3",
      organizationId: "organization-alpha",
      requestId: crypto.randomUUID(),
      sizeBytes: body.byteLength,
    } as const;
    await uploadPrivateOrganizationFile(
      { ORGANIZATION_FILES: organizationFiles, ORGANIZATION_STORE: stores },
      { ...fileInput, body, fileId: ALPHA_PIECE_FILE },
    );
    await uploadPrivateOrganizationFile(
      { ORGANIZATION_FILES: organizationFiles, ORGANIZATION_STORE: stores },
      { ...fileInput, body, fileId: ALPHA_OUT_OF_SCOPE_FILE, requestId: crypto.randomUUID() },
    );

    const token = await issuePublicPlayerToken("organization-alpha", ALPHA_EVENT);
    const allowedResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/public/player/media/${ALPHA_PIECE_FILE}?token=${token}`),
    );
    expect(allowedResponse.status).toBe(200);
    expect(new Uint8Array(await allowedResponse.arrayBuffer())).toEqual(
      new TextEncoder().encode("practice-track"),
    );

    const blockedResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/public/player/media/${ALPHA_OUT_OF_SCOPE_FILE}?token=${token}`),
    );
    expect(blockedResponse.status).toBe(404);
  });
});
