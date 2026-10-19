import {
  publicPlayerDetailsResponseSchema,
  publicPlayerPlaylistResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { organizationRequest, provisionOrganization, seedAuthUser } from "@choir/testkit";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import { issueSignedLink } from "../src/security/signedLinks";
import { uploadPrivateOrganizationFile } from "../src/storage/privateFiles";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const ALPHA_PROFILE = "11111111-1111-4111-8111-111111111111";
const BRAVO_PROFILE = "22222222-2222-4222-8222-222222222222";
const ALPHA_EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRAVO_EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALPHA_PIECE = "e0000000-0000-4000-8000-000000000001";
const ALPHA_PIECE_FILE = "f0000000-0000-4000-8000-000000000001";
const ALPHA_ARTWORK_FILE = "f0000000-0000-4000-8000-000000000008";
const ALPHA_OUT_OF_SCOPE_FILE = "f0000000-0000-4000-8000-000000000003";
const BRAVO_PIECE = "e0000000-0000-4000-8000-000000000002";
const BRAVO_NULL_PIECE = "e0000000-0000-4000-8000-000000000009";
const MULTI_PARENT_PIECE = "e0000000-0000-4000-8000-000000000030";
const MULTI_MOV1_PIECE = "e0000000-0000-4000-8000-000000000031";
const MULTI_MOV2_PIECE = "e0000000-0000-4000-8000-000000000032";
const MULTI_MOV1_FILE = "f0000000-0000-4000-8000-000000000031";
const MULTI_MOV2_FILE = "f0000000-0000-4000-8000-000000000032";
const MULTI_EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa30";
const MULTI_SOLO_EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa31";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const organizationFiles = requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");
const signedLinkSecret = requireBinding(env.SIGNED_LINK_SECRET, "SIGNED_LINK_SECRET");

const api = (host: string, path: string, init?: RequestInit) =>
  organizationRequest(host, path, undefined, init);

const provision = async (
  id: string,
  slug: string,
  profileId: string,
  eventId: string,
  pieceId: string,
  fileId: string,
  profileSuffix: string,
  artworkFileId: string | null = null,
  nullPieceId?: string,
) => {
  await provisionOrganization(database, stores, {
    id,
    name: `Organization ${slug}`,
    slug,
    userId: "public-player",
  });
  const stub = stores.get(stores.idFromName(id));
  const now = new Date().toISOString();
  await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      profileId,
      `${slug} Singer ${profileSuffix}`,
      now,
      now,
    );
    const setListItems: {
      composer?: string | undefined;
      isFeaturedNumber: boolean;
      pieceId?: string;
      title: string;
    }[] = [
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
    ];
    if (nullPieceId) {
      setListItems.push({
        isFeaturedNumber: false,
        pieceId: nullPieceId,
        title: "Chant Kyrie",
      });
      state.storage.sql.exec(
        `INSERT INTO music_pieces
           (id, title, composer, arranger, duration_seconds, notes, section_buckets_json,
            genres_json, track_file_ids_json, created_at, updated_at)
          VALUES (?, 'Chant Kyrie', '', '', NULL, '', '[]', '[]', '{}', ?, ?)`,
        nullPieceId,
        now,
        now,
      );
    }
    const setListJson = JSON.stringify(setListItems);
    state.storage.sql.exec(
      `INSERT INTO events
         (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
          parent_performance_id, details, set_list_json, set_list_approved,
          is_archived, public_graphic_file_id, created_at, updated_at)
        VALUES (?, ?, 'Performance', ?, 90, '', '', NULL, NULL, '', ?, 1, 0, ?, ?, ?)`,
      eventId,
      `${slug} Concert`,
      new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000).toISOString(),
      setListJson,
      artworkFileId,
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
};

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
    subjectId: "public",
    version: 1,
  });
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  await seedAuthUser(database, "public-player", "public.player@example.test", "Public Player");
  await provision(
    "organization-alpha",
    "alpha",
    ALPHA_PROFILE,
    ALPHA_EVENT,
    ALPHA_PIECE,
    ALPHA_PIECE_FILE,
    "A",
    ALPHA_ARTWORK_FILE,
  );
  await provision(
    "organization-bravo",
    "bravo",
    BRAVO_PROFILE,
    BRAVO_EVENT,
    BRAVO_PIECE,
    "f0000000-0000-4000-8000-000000000002",
    "B",
    null,
    BRAVO_NULL_PIECE,
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
      eventArtworkFileId: ALPHA_ARTWORK_FILE,
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

  it("resolves player details with null and omitted fields without invalid_response", async () => {
    const token = await issuePlayerToken("organization-bravo", BRAVO_EVENT, BRAVO_PROFILE);
    const response = await exports.default.fetch(
      api("bravo.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    const parsed = publicPlayerDetailsResponseSchema.parse(body);
    expect(parsed.eventArtworkFileId).toBeNull();
    expect(parsed.organizationName).toBe("Organization bravo");
    expect(parsed.items.length).toBeGreaterThanOrEqual(3);
    const nullPiece = parsed.items.find((item) => item.title === "Chant Kyrie");
    expect(nullPiece).toBeDefined();
    expect(nullPiece?.composer).toBeUndefined();
    expect(nullPiece?.arranger).toBeUndefined();
    expect(nullPiece?.durationSeconds).toBeUndefined();
  });

  it("keeps the public playlist path signed and tenant-bound", async () => {
    const token = await issuePublicPlayerToken("organization-alpha", ALPHA_EVENT);
    const response = await exports.default.fetch(
      api("alpha.localhost", `/api/public/player/playlist?token=${encodeURIComponent(token)}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      event: { artworkFileId: ALPHA_ARTWORK_FILE, id: ALPHA_EVENT, title: "alpha Concert" },
      organizationName: "Organization alpha",
      setList: expect.arrayContaining([expect.objectContaining({ title: "Alleluia" })]),
    });
    const crossTenantResponse = await exports.default.fetch(
      api("bravo.localhost", `/api/public/player/playlist?token=${encodeURIComponent(token)}`),
    );
    expect(crossTenantResponse.status).toBe(404);
  });

  it("serves Organization branding and public logo independently of website publication", async () => {
    // 1. GET /api/public/player/playlist returns correct organizationName
    const alphaToken = await issuePublicPlayerToken("organization-alpha", ALPHA_EVENT);
    const playlistResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/public/player/playlist?token=${encodeURIComponent(alphaToken)}`),
    );
    expect(playlistResponse.status).toBe(200);
    const playlistBody = await playlistResponse.json();
    expect(playlistBody).toMatchObject({
      organizationName: "Organization alpha",
      trackLabels: expect.objectContaining({
        B1: "Bass 1",
        T1: "Tenor 1",
        tutti: "Choir Mix",
      }),
    });

    // 2. recipient-scoped /api/public/player-details returns correct Organization name and track labels
    const alphaMemberToken = await issuePlayerToken(
      "organization-alpha",
      ALPHA_EVENT,
      ALPHA_PROFILE,
    );
    const detailsResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token: alphaMemberToken }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(detailsResponse.status).toBe(200);
    const detailsBody = publicPlayerDetailsResponseSchema.parse(await detailsResponse.json());
    expect(detailsBody.organizationName).toBe("Organization alpha");
    expect(detailsBody.trackLabels).toMatchObject({
      B1: "Bass 1",
      T1: "Tenor 1",
      tutti: "Choir Mix",
    });

    // 3. Alpha player links on Alpha hostname return Alpha branding; Bravo returns Bravo branding
    const bravoMemberToken = await issuePlayerToken(
      "organization-bravo",
      BRAVO_EVENT,
      BRAVO_PROFILE,
    );
    const bravoDetailsResponse = await exports.default.fetch(
      api("bravo.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token: bravoMemberToken }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(bravoDetailsResponse.status).toBe(200);
    const bravoDetails = publicPlayerDetailsResponseSchema.parse(await bravoDetailsResponse.json());
    expect(bravoDetails.organizationName).toBe("Organization bravo");

    // 4. cross-tenant token/hostname use still returns 404
    const crossTenantResponse = await exports.default.fetch(
      api("bravo.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token: alphaMemberToken }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(crossTenantResponse.status).toBe(404);

    // 5. Organization name is available even when no hosted website has been published
    expect(playlistBody).toMatchObject({ organizationName: "Organization alpha" });

    // 6. /api/public/logo returns the correct Organization logo independently of website publication
    const logoFileId = "f0000000-0000-4000-8000-000000000099";
    const sampleBytes = [137, 80, 78, 71, 13, 10, 26, 10];
    const sampleBuffer = new Uint8Array(sampleBytes).buffer;
    const samplePng = new Uint8Array(sampleBuffer);
    await uploadPrivateOrganizationFile(
      { ORGANIZATION_FILES: organizationFiles, ORGANIZATION_STORE: stores },
      {
        actorUserId: "public-player",
        body: sampleBuffer,
        contentType: "image/png",
        fileId: logoFileId,
        fileName: "alpha-logo.png",
        organizationId: "organization-alpha",
        requestId: crypto.randomUUID(),
        sizeBytes: sampleBuffer.byteLength,
      },
    );
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE organization_metadata SET logo_file_id = ? WHERE organization_id = ?",
        logoFileId,
        "organization-alpha",
      );
      return null;
    });

    const logoResponse = await exports.default.fetch(api("alpha.localhost", "/api/public/logo"));
    expect(logoResponse.status).toBe(200);
    expect(logoResponse.headers.get("content-type")).toBe("image/png");
    const logoBytes = new Uint8Array(await logoResponse.arrayBuffer());
    expect(logoBytes).toEqual(samplePng);
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
    expect(allowedResponse.headers.get("accept-ranges")).toBe("bytes");
    expect(allowedResponse.headers.get("content-length")).toBe(String(body.byteLength));
    expect(new Uint8Array(await allowedResponse.arrayBuffer())).toEqual(
      new TextEncoder().encode("practice-track"),
    );

    const blockedResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/public/player/media/${ALPHA_OUT_OF_SCOPE_FILE}?token=${token}`),
    );
    expect(blockedResponse.status).toBe(404);
  });

  it("serves event artwork through the player media endpoint", async () => {
    const artworkBody = new TextEncoder().encode("artwork-image-data").buffer;
    await uploadPrivateOrganizationFile(
      { ORGANIZATION_FILES: organizationFiles, ORGANIZATION_STORE: stores },
      {
        actorUserId: "bootstrap",
        body: artworkBody,
        contentType: "image/jpeg",
        fileId: ALPHA_ARTWORK_FILE,
        fileName: "cover.jpg",
        organizationId: "organization-alpha",
        requestId: crypto.randomUUID(),
        sizeBytes: artworkBody.byteLength,
      },
    );

    const token = await issuePlayerToken("organization-alpha", ALPHA_EVENT, ALPHA_PROFILE);
    const response = await exports.default.fetch(
      api("alpha.localhost", `/api/public/player/media/${ALPHA_ARTWORK_FILE}?token=${token}`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new TextEncoder().encode("artwork-image-data"),
    );
  });

  it("handles HTTP byte range requests for player media", async () => {
    const body = new TextEncoder().encode("practice-track").buffer; // 14 bytes
    await uploadPrivateOrganizationFile(
      { ORGANIZATION_FILES: organizationFiles, ORGANIZATION_STORE: stores },
      {
        actorUserId: "bootstrap",
        body,
        contentType: "audio/mpeg",
        fileId: ALPHA_PIECE_FILE,
        fileName: "practice-track.mp3",
        organizationId: "organization-alpha",
        requestId: crypto.randomUUID(),
        sizeBytes: body.byteLength,
      },
    );

    const token = await issuePublicPlayerToken("organization-alpha", ALPHA_EVENT);

    // Partial range request
    const partialResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/public/player/media/${ALPHA_PIECE_FILE}?token=${token}`, {
        headers: { range: "bytes=0-7" },
      }),
    );
    expect(partialResponse.status).toBe(206);
    expect(partialResponse.headers.get("accept-ranges")).toBe("bytes");
    expect(partialResponse.headers.get("content-range")).toBe("bytes 0-7/14");
    expect(partialResponse.headers.get("content-length")).toBe("8");
    expect(new TextDecoder().decode(await partialResponse.arrayBuffer())).toBe("practice");

    // Unsatisfiable range request
    const unsatisfiableResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/public/player/media/${ALPHA_PIECE_FILE}?token=${token}`, {
        headers: { range: "bytes=999999-" },
      }),
    );
    expect(unsatisfiableResponse.status).toBe(416);
    expect(unsatisfiableResponse.headers.get("content-range")).toBe("bytes */14");
  });

  async function seedMultiMovementEvent(eventId: string, setList: unknown[]): Promise<void> {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const now = new Date().toISOString();
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO music_pieces
           (id, title, composer, arranger, duration_seconds, notes, section_buckets_json,
            genres_json, track_file_ids_json, movement_order_json, parent_id, created_at, updated_at)
         VALUES (?, 'Sunrise Mass', 'Ola Gjeilo', 'Gjeilo Arr', NULL, '', '[]', '[]', '{}', ?, NULL, ?, ?)`,
        MULTI_PARENT_PIECE,
        JSON.stringify([MULTI_MOV1_PIECE, MULTI_MOV2_PIECE]),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO music_pieces
           (id, title, composer, arranger, duration_seconds, notes, section_buckets_json,
            genres_json, track_file_ids_json, movement_order_json, parent_id, created_at, updated_at)
         VALUES (?, 'The Spheres', '', '', 240, '', '[]', '[]', ?, '[]', ?, ?, ?)`,
        MULTI_MOV1_PIECE,
        JSON.stringify({ soprano: MULTI_MOV1_FILE }),
        MULTI_PARENT_PIECE,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO music_pieces
           (id, title, composer, arranger, duration_seconds, notes, section_buckets_json,
            genres_json, track_file_ids_json, movement_order_json, parent_id, created_at, updated_at)
         VALUES (?, 'Sunrise', '', '', 300, '', '[]', '[]', ?, '[]', ?, ?, ?)`,
        MULTI_MOV2_PIECE,
        JSON.stringify({ alto: MULTI_MOV2_FILE }),
        MULTI_PARENT_PIECE,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO events
           (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
            parent_performance_id, details, set_list_json, set_list_approved,
            is_archived, public_graphic_file_id, created_at, updated_at)
         VALUES (?, 'Sunrise Concert', 'Performance', ?, 90, '', '', NULL, NULL, '', ?, 1, 0, NULL, ?, ?)`,
        eventId,
        new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000).toISOString(),
        JSON.stringify(setList),
        now,
        now,
      );
      return null;
    });
  }

  it("resolves multi-movement works on player-details and player/playlist without overwriting tracks on parent holder", async () => {
    await seedMultiMovementEvent(MULTI_EVENT, [
      {
        composer: "Ola Gjeilo",
        isFeaturedNumber: false,
        pieceId: MULTI_PARENT_PIECE,
        title: "Sunrise Mass",
      },
      {
        composer: "Ola Gjeilo",
        isFeaturedNumber: false,
        pieceId: MULTI_MOV1_PIECE,
        title: "The Spheres",
      },
      {
        composer: "Ola Gjeilo",
        isFeaturedNumber: false,
        pieceId: MULTI_MOV2_PIECE,
        title: "Sunrise",
      },
    ]);

    const playerToken = await issuePlayerToken("organization-alpha", MULTI_EVENT, ALPHA_PROFILE);
    const detailsResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token: playerToken }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(detailsResponse.status).toBe(200);
    const detailsBody: unknown = await detailsResponse.json();
    const parsedDetails = publicPlayerDetailsResponseSchema.parse(detailsBody);
    expect(parsedDetails.items).toHaveLength(2);
    expect(parsedDetails.items[0]).toMatchObject({
      pieceId: MULTI_MOV1_PIECE,
      title: "The Spheres",
      trackFileIds: { soprano: MULTI_MOV1_FILE },
    });
    expect(parsedDetails.items[1]).toMatchObject({
      pieceId: MULTI_MOV2_PIECE,
      title: "Sunrise",
      trackFileIds: { alto: MULTI_MOV2_FILE },
    });

    const publicToken = await issuePublicPlayerToken("organization-alpha", MULTI_EVENT);
    const playlistResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/public/player/playlist?token=${encodeURIComponent(publicToken)}`,
      ),
    );
    expect(playlistResponse.status).toBe(200);
    const playlistBody: unknown = await playlistResponse.json();
    const parsedPlaylist = publicPlayerPlaylistResponseSchema.parse(playlistBody);
    expect(parsedPlaylist.setList).toHaveLength(2);
    expect(parsedPlaylist.setList[0]).toMatchObject({
      pieceId: MULTI_MOV1_PIECE,
      title: "The Spheres",
      trackFileIds: { soprano: MULTI_MOV1_FILE },
    });
    expect(parsedPlaylist.setList[1]).toMatchObject({
      pieceId: MULTI_MOV2_PIECE,
      title: "Sunrise",
      trackFileIds: { alto: MULTI_MOV2_FILE },
    });
  });

  it("expands parent holder alone in set list into movements on player-details and player/playlist", async () => {
    await seedMultiMovementEvent(MULTI_SOLO_EVENT, [
      {
        composer: "Ola Gjeilo",
        isFeaturedNumber: true,
        notes: "Full mass performance",
        pieceId: MULTI_PARENT_PIECE,
        title: "Sunrise Mass",
      },
    ]);

    const soloPlayerToken = await issuePlayerToken(
      "organization-alpha",
      MULTI_SOLO_EVENT,
      ALPHA_PROFILE,
    );
    const soloDetailsResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/public/player-details", {
        body: JSON.stringify({ token: soloPlayerToken }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(soloDetailsResponse.status).toBe(200);
    const soloDetailsBody: unknown = await soloDetailsResponse.json();
    const parsedSoloDetails = publicPlayerDetailsResponseSchema.parse(soloDetailsBody);
    expect(parsedSoloDetails.items).toHaveLength(2);
    expect(parsedSoloDetails.items[0]).toMatchObject({
      arranger: "Gjeilo Arr",
      composer: "Ola Gjeilo",
      isFeaturedNumber: true,
      notes: "Full mass performance",
      pieceId: MULTI_MOV1_PIECE,
      title: "The Spheres",
      trackFileIds: { soprano: MULTI_MOV1_FILE },
    });
    expect(parsedSoloDetails.items[1]).toMatchObject({
      composer: "Ola Gjeilo",
      pieceId: MULTI_MOV2_PIECE,
      title: "Sunrise",
      trackFileIds: { alto: MULTI_MOV2_FILE },
    });

    const soloPublicToken = await issuePublicPlayerToken("organization-alpha", MULTI_SOLO_EVENT);
    const soloPlaylistResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/public/player/playlist?token=${encodeURIComponent(soloPublicToken)}`,
      ),
    );
    expect(soloPlaylistResponse.status).toBe(200);
    const soloPlaylistBody: unknown = await soloPlaylistResponse.json();
    const parsedSoloPlaylist = publicPlayerPlaylistResponseSchema.parse(soloPlaylistBody);
    expect(parsedSoloPlaylist.setList).toHaveLength(2);
    expect(parsedSoloPlaylist.setList[0]).toMatchObject({
      pieceId: MULTI_MOV1_PIECE,
      title: "The Spheres",
      trackFileIds: { soprano: MULTI_MOV1_FILE },
    });
    expect(parsedSoloPlaylist.setList[1]).toMatchObject({
      pieceId: MULTI_MOV2_PIECE,
      title: "Sunrise",
      trackFileIds: { alto: MULTI_MOV2_FILE },
    });
  });
});
