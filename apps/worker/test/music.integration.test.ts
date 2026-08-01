import {
  organizationEventSchema,
  organizationMusicImportResponseSchema,
  organizationMusicLibrarySettingsResponseSchema,
  organizationMusicPieceResponseSchema,
  organizationMusicPiecesResponseSchema,
  privateFileResponseSchema,
  singerLearningTrackPiecesResponseSchema,
  type OrganizationMusicPiece,
  type OrganizationMusicPieceRequest,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "music.manager@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const organizationFiles = requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");

function api(host: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function write(
  host: string,
  path: string,
  cookie: string,
  body: unknown,
  method = "POST",
): Promise<Response> {
  return exports.default.fetch(
    api(host, path, cookie, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
    }),
  );
}

async function provision(id: string, slug: string): Promise<void> {
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
    database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, 'music-manager', 'admin', ?)`,
      )
      .bind(`member-${slug}`, id, Date.now()),
  ]);
  const response = await stores
    .get(stores.idFromName(id))
    .fetch("https://organization.internal/internal/provision", {
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

function requestFrom(piece: OrganizationMusicPiece): OrganizationMusicPieceRequest {
  return {
    arranger: piece.arranger,
    catalogId: piece.catalogId,
    composer: piece.composer,
    copies: piece.copies,
    durationSeconds: piece.durationSeconds,
    genres: piece.genres,
    notes: piece.notes,
    parentId: piece.parentId,
    purchaseDate: piece.purchaseDate,
    sectionBuckets: piece.sectionBuckets,
    title: piece.title,
    trackFileIds: piece.trackFileIds,
  };
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES ('music-manager', 'Music Manager', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "alpha");
  await provision("organization-bravo", "bravo");
});

afterEach(async () => {
  await reset();
});

describe("Organization music catalog", () => {
  it("stores publisher search templates per Organization and enforces HTTPS placeholders", async () => {
    const cookie = await signIn();
    const initial = organizationMusicLibrarySettingsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/music-library-settings", cookie),
        )
      ).json(),
    );
    expect(initial.publisherSearchTemplate).toBe("");

    const saved = organizationMusicLibrarySettingsResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          "/api/organization/music-library-settings",
          cookie,
          { publisherSearchTemplate: "https://publisher.example/catalog/{catalogId}" },
          "PUT",
        )
      ).json(),
    );
    expect(saved.publisherSearchTemplate).toBe("https://publisher.example/catalog/{catalogId}");

    const bravo = organizationMusicLibrarySettingsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("bravo.localhost", "/api/organization/music-library-settings", cookie),
        )
      ).json(),
    );
    expect(bravo.publisherSearchTemplate).toBe("");
    expect(
      await write(
        "alpha.localhost",
        "/api/organization/music-library-settings",
        cookie,
        { publisherSearchTemplate: "http://publisher.example/catalog/{catalogId}" },
        "PUT",
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await exports.default.fetch(
        api("localhost", "/api/organization/music-library-settings", cookie),
      ),
    ).toMatchObject({ status: 404 });

    const auditActions = await runInDurableObject<OrganizationStore, readonly string[]>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly action: string }>(
            "SELECT action FROM audit_events WHERE action = 'music.library_settings_updated'",
          )
          .toArray()
          .map(({ action }) => action),
    );
    expect(auditActions).toEqual(["music.library_settings_updated"]);
  });

  it("uploads, attaches, plays, downloads, and removes a private learning track", async () => {
    const cookie = await signIn();
    const piece = organizationMusicPieceResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/music", cookie, {
          title: "Track Work",
        })
      ).json(),
    );
    const bytes = new TextEncoder().encode("audio-test-data");
    const fileId = "44444444-4444-4444-8444-444444444444";
    const storageKey = `organizations/organization-alpha/private/track-work-full-mix-${fileId}.mp3`;
    const uploadResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
        body: bytes,
        headers: {
          "content-length": String(bytes.byteLength),
          "content-type": "audio/mpeg",
          "x-file-name": encodeURIComponent("Track Work - Full mix.mp3"),
        },
        method: "PUT",
      }),
    );
    expect(uploadResponse.status).toBe(201);
    expect(privateFileResponseSchema.parse(await uploadResponse.json())).toMatchObject({
      contentType: "audio/mpeg",
      fileName: "Track Work - Full mix.mp3",
      id: fileId,
    });
    expect(
      await runInDurableObject<OrganizationStore, string | null>(
        stores.get(stores.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly storageKey: string }>(
              "SELECT storage_key AS storageKey FROM private_files WHERE id = ?",
              fileId,
            )
            .toArray()
            .at(0)?.storageKey ?? null,
      ),
    ).toBe(storageKey);
    await expect(organizationFiles.head(storageKey)).resolves.not.toBeNull();

    const attached = organizationMusicPieceResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/music/${piece.id}`,
          cookie,
          { ...requestFrom(piece), trackFileIds: { tutti: fileId } },
          "PUT",
        )
      ).json(),
    );
    expect(attached.trackFileIds).toEqual({ tutti: fileId });
    expect(
      await exports.default.fetch(
        api("alpha.localhost", `/api/organization/files/${fileId}`, cookie, { method: "DELETE" }),
      ),
    ).toMatchObject({ status: 409 });

    const playback = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/files/${fileId}`, cookie),
    );
    expect(playback.status).toBe(200);
    expect(playback.headers.get("content-type")).toBe("audio/mpeg");
    expect(new TextDecoder().decode(await playback.arrayBuffer())).toBe("audio-test-data");

    const rangePlayback = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
        headers: { range: "bytes=0-4" },
      }),
    );
    expect(rangePlayback.status).toBe(206);
    expect(rangePlayback.headers.get("accept-ranges")).toBe("bytes");
    expect(rangePlayback.headers.get("content-range")).toBe("bytes 0-4/15");
    expect(new TextDecoder().decode(await rangePlayback.arrayBuffer())).toBe("audio");
    const invalidRange = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
        headers: { range: "bytes=99-100" },
      }),
    );
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.headers.get("content-range")).toBe("bytes */15");

    const removed = organizationMusicPieceResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/music/${piece.id}`,
          cookie,
          { ...requestFrom(attached), trackFileIds: {} },
          "PUT",
        )
      ).json(),
    );
    expect(removed.trackFileIds).toEqual({});
    const reclaimed = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/files/${fileId}`, cookie, { method: "DELETE" }),
    );
    expect(reclaimed.status).toBe(200);
    expect(await organizationFiles.head(storageKey)).toBeNull();
    expect(
      await exports.default.fetch(
        api("alpha.localhost", `/api/organization/files/${fileId}`, cookie),
      ),
    ).toMatchObject({ status: 404 });
    const reclamationAudit = await runInDurableObject<OrganizationStore, number>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'organization.file.reclaimed' AND target_id = ?",
            fileId,
          )
          .one().count,
    );
    expect(reclamationAudit).toBe(1);
  });

  it("imports a bounded CSV atomically and exports the baseline-compatible contract", async () => {
    const cookie = await signIn();
    const csv = [
      "Title,Composer,Arranger,Copies,Catalog ID,Duration,Voicing,Applies To,Genres,Purchase Date,Notes",
      '"=Safe title","Handel","Doe, Jane","24","CAT-1","4:05","SATB","S;A","Classical;Sacred","2026-05-01","Owned ""copies"""',
      '"Second work","","","","","","","All","","",""',
    ].join("\n");
    const importedResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/music/import", cookie, {
        body: csv,
        headers: { "content-type": "text/csv" },
        method: "POST",
      }),
    );
    expect(importedResponse.status).toBe(201);
    expect(
      organizationMusicImportResponseSchema.parse(await importedResponse.json()).imported,
    ).toBe(2);

    const exportResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/music/export", cookie),
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("cache-control")).toBe("no-store");
    expect(exportResponse.headers.get("content-disposition")).toBe(
      'attachment; filename="music_library.csv"',
    );
    expect(await exportResponse.text()).toContain(
      '"\'=Safe title","Handel","Doe, Jane","24","CAT-1","4:05","","S;A","Classical;Sacred","2026-05-01","Owned ""copies"""',
    );

    const invalid = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/music/import", cookie, {
        body: "Title,Applies To\nValid,S\nInvalid,Unknown",
        headers: { "content-type": "text/csv" },
        method: "POST",
      }),
    );
    expect(invalid.status).toBe(400);
    const pieces = organizationMusicPiecesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/music", cookie))
      ).json(),
    ).pieces;
    expect(pieces.map(({ title }) => title)).toEqual(["=Safe title", "Second work"]);

    await database
      .prepare(
        `UPDATE member SET role = 'member'
         WHERE userId = 'music-manager' AND organizationId = 'organization-alpha'`,
      )
      .run();
    expect(
      await exports.default.fetch(api("alpha.localhost", "/api/organization/music/export", cookie)),
    ).toMatchObject({ status: 403 });
    expect(
      await exports.default.fetch(
        api("localhost", "/api/organization/music/import", cookie, {
          body: csv,
          headers: { "content-type": "text/csv" },
          method: "POST",
        }),
      ),
    ).toMatchObject({ status: 404 });
  });

  it("preserves catalog relationships, private tracks, references, and tenant authorization", async () => {
    const cookie = await signIn();
    const initial = organizationMusicPiecesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/music", cookie))
      ).json(),
    );
    expect(initial.pieces).toEqual([]);

    const parent = organizationMusicPieceResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/music", cookie, {
          arranger: "Elaine Hagenberg",
          catalogId: "CAT-100",
          composer: "Traditional",
          copies: 80,
          durationSeconds: 245,
          genres: ["Sacred", "Contemporary"],
          notes: "Owned octavos",
          purchaseDate: "2026-07-01",
          sectionBuckets: ["S", "A"],
          title: "Catalog Work",
        })
      ).json(),
    );
    const movement = organizationMusicPieceResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/music", cookie, {
          durationSeconds: 95,
          parentId: parent.id,
          title: "Movement One",
        })
      ).json(),
    );
    expect(movement.parentId).toBe(parent.id);

    expect(
      await write("alpha.localhost", "/api/organization/music", cookie, {
        parentId: movement.id,
        title: "Nested Movement",
      }),
    ).toMatchObject({ status: 409 });
    expect(
      await write(
        "alpha.localhost",
        `/api/organization/music/${parent.id}`,
        cookie,
        { ...requestFrom(parent), parentId: movement.id },
        "PUT",
      ),
    ).toMatchObject({ status: 409 });
    expect(
      await write("alpha.localhost", "/api/organization/music", cookie, {
        sectionBuckets: ["Unconfigured"],
        title: "Bad Section",
      }),
    ).toMatchObject({ status: 400 });
    expect(
      await write(
        "alpha.localhost",
        `/api/organization/music/${parent.id}`,
        cookie,
        { ...requestFrom(parent), trackFileIds: { tutti: crypto.randomUUID() } },
        "PUT",
      ),
    ).toMatchObject({ status: 409 });

    const audioFileId = crypto.randomUUID();
    const documentFileId = crypto.randomUUID();
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        const now = new Date().toISOString();
        const files: readonly (readonly [string, string])[] = [
          [audioFileId, "audio/mpeg"],
          [documentFileId, "application/pdf"],
        ];
        for (const [id, contentType] of files) {
          state.storage.sql.exec(
            `INSERT INTO private_files
              (id, storage_key, file_name, content_type, size_bytes, status, uploaded_by,
               request_id, created_at, ready_at)
             VALUES (?, ?, ?, ?, 10, 'ready', 'music-manager', ?, ?, ?)`,
            id,
            `organizations/organization-alpha/files/${id}`,
            `${id}.bin`,
            contentType,
            crypto.randomUUID(),
            now,
            now,
          );
        }
        return null;
      },
    );
    expect(
      await write(
        "alpha.localhost",
        `/api/organization/music/${parent.id}`,
        cookie,
        { ...requestFrom(parent), trackFileIds: { tutti: documentFileId } },
        "PUT",
      ),
    ).toMatchObject({ status: 409 });
    const withTrack = organizationMusicPieceResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/music/${parent.id}`,
          cookie,
          { ...requestFrom(parent), trackFileIds: { tutti: audioFileId } },
          "PUT",
        )
      ).json(),
    );
    expect(withTrack.trackFileIds).toEqual({ tutti: audioFileId });

    expect(
      await exports.default.fetch(
        api("alpha.localhost", `/api/organization/music/${parent.id}`, cookie, {
          method: "DELETE",
        }),
      ),
    ).toMatchObject({ status: 409 });
    expect(
      await exports.default.fetch(
        api("alpha.localhost", `/api/organization/music/${parent.id}?unlinkChildren=true`, cookie, {
          method: "DELETE",
        }),
      ),
    ).toMatchObject({ status: 200 });
    const afterUnlink = organizationMusicPiecesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/music", cookie))
      ).json(),
    );
    expect(afterUnlink.pieces).toEqual([
      expect.objectContaining({ id: movement.id, parentId: null }),
    ]);

    const referenced = organizationMusicPieceResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/music", cookie, {
          title: "Referenced Work",
        })
      ).json(),
    );
    const bravoPiece = organizationMusicPieceResponseSchema.parse(
      await (
        await write("bravo.localhost", "/api/organization/music", cookie, {
          title: "Another Organization's Work",
        })
      ).json(),
    );
    const crossOrganizationReference = await write(
      "alpha.localhost",
      "/api/organization/events",
      cookie,
      {
        setList: [{ pieceId: bravoPiece.id, title: bravoPiece.title }],
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        title: "Invalid Cross-Organization Set List",
        type: "Performance",
      },
    );
    expect(crossOrganizationReference.status).toBe(409);
    await expect(crossOrganizationReference.json()).resolves.toMatchObject({
      code: "music_piece_not_found",
    });
    const missingProfileReference = await write(
      "alpha.localhost",
      "/api/organization/events",
      cookie,
      {
        setList: [
          {
            performerCredits: [
              {
                displayName: "Unavailable Singer",
                kind: "profile",
                profileId: crypto.randomUUID(),
              },
            ],
            pieceId: referenced.id,
            title: referenced.title,
          },
        ],
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        title: "Invalid Profile Credit",
        type: "Performance",
      },
    );
    expect(missingProfileReference.status).toBe(409);
    await expect(missingProfileReference.json()).resolves.toMatchObject({
      code: "performer_profile_not_found",
    });
    const event = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          setList: [{ id: "set-item-1", pieceId: referenced.id, title: referenced.title }],
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          title: "Music Concert",
          type: "Performance",
        })
      ).json(),
    );
    expect(event.setList[0]?.pieceId).toBe(referenced.id);
    const history = organizationMusicPiecesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/music", cookie))
      ).json(),
    );
    expect(history.pieces.find(({ id }) => id === referenced.id)).toMatchObject({
      lastPerformedAt: event.startsAt,
      performanceCount: 1,
    });
    expect(
      await exports.default.fetch(
        api("alpha.localhost", `/api/organization/music/${referenced.id}`, cookie, {
          method: "DELETE",
        }),
      ),
    ).toMatchObject({ status: 409 });

    expect(
      await write(
        "bravo.localhost",
        `/api/organization/music/${referenced.id}`,
        cookie,
        requestFrom(referenced),
        "PUT",
      ),
    ).toMatchObject({ status: 404 });
    const practicePiece = organizationMusicPieceResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/music/${referenced.id}`,
          cookie,
          { ...requestFrom(referenced), trackFileIds: { tutti: audioFileId } },
          "PUT",
        )
      ).json(),
    );
    await database
      .prepare(
        `UPDATE member SET role = 'member'
         WHERE userId = 'music-manager' AND organizationId = 'organization-alpha'`,
      )
      .run();
    expect(
      await exports.default.fetch(api("alpha.localhost", "/api/organization/music", cookie)),
    ).toMatchObject({ status: 403 });
    const practiceLibrary = singerLearningTrackPiecesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/music", cookie))
      ).json(),
    );
    expect(practiceLibrary.pieces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: practicePiece.id, trackFileIds: { tutti: audioFileId } }),
      ]),
    );
    expect(practiceLibrary.pieces.some((piece) => "notes" in piece || "copies" in piece)).toBe(
      false,
    );
    const bravoPracticeLibrary = singerLearningTrackPiecesResponseSchema.parse(
      await (
        await exports.default.fetch(api("bravo.localhost", "/api/singer/music", cookie))
      ).json(),
    );
    expect(bravoPracticeLibrary.pieces.some(({ id }) => id === practicePiece.id)).toBe(false);
    expect(
      await exports.default.fetch(api("localhost", "/api/organization/music", cookie)),
    ).toMatchObject({ status: 404 });

    const auditActions = await runInDurableObject<OrganizationStore, readonly string[]>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly action: string }>(
            "SELECT action FROM audit_events WHERE action LIKE 'music.%' ORDER BY occurred_at, action",
          )
          .toArray()
          .map(({ action }) => action),
    );
    expect(auditActions).toEqual([
      "music.piece.created",
      "music.piece.created",
      "music.piece.updated",
      "music.piece.deleted",
      "music.piece.created",
      "music.piece.updated",
    ]);
  });
});
