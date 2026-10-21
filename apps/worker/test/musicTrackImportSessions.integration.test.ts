import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  musicTrackImportCommitResponseSchema,
  musicTrackImportCreateSessionResponseSchema,
  musicTrackImportDiscardResponseSchema,
  musicTrackImportSessionDetailResponseSchema,
  organizationMusicPieceResponseSchema,
} from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "import-session-manager@example.test";

const database = getBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = getBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

function getBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const write = (host: string, path: string, cookie: string, body: unknown, method = "POST") =>
  writeJson(exports.default, host, path, cookie, body, method);
const api = organizationRequest;

const provision = (id: string, slug: string) =>
  provisionOrganization(database, stores, { id, slug, userId: "music-manager" });

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

async function seedRoster(): Promise<void> {
  const store = stores.get(stores.idFromName("organization-alpha"));
  await runInDurableObject(store, (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE organization_metadata SET roster_configuration_json = ?",
      JSON.stringify({
        sections: [
          { code: "S", color: "#000000", name: "Soprano" },
          { code: "A", color: "#111111", name: "Alto" },
        ],
        voiceParts: [
          { fullName: "Soprano 1", label: "S1", sectionCode: "S" },
          { fullName: "Alto 1", label: "A1", sectionCode: "A" },
        ],
      }),
    );
    return undefined;
  });
}

async function createPiece(cookie: string, title: string, durationSeconds: number | null = null) {
  const response = await write("alpha.localhost", "/api/organization/music", cookie, {
    composer: "Traditional",
    durationSeconds,
    title,
  });
  expect(response.status).toBe(201);
  return organizationMusicPieceResponseSchema.parse(await response.json());
}

function manifestItem(pieceId: string, clientFileId: string, partKey: string) {
  return {
    clientFileId,
    contentType: "audio/mpeg",
    durationSeconds: 215,
    fileName: `${clientFileId}.mp3`,
    lastModifiedMs: 1_700_000_000_000,
    partKey,
    pieceId,
    sha256Hex: "a".repeat(64),
    sizeBytes: 17,
  };
}

async function uploadSessionFile(
  cookie: string,
  sessionId: string,
  clientFileId: string,
  fileName: string,
  bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode("dummy-audio-bytes"),
) {
  return exports.default.fetch(
    api(
      "alpha.localhost",
      `/api/organization/music/track-import/sessions/${sessionId}/files/${encodeURIComponent(clientFileId)}`,
      cookie,
      {
        body: bytes,
        headers: {
          "content-length": String(bytes.byteLength),
          "content-type": "audio/mpeg",
          "x-file-name": encodeURIComponent(fileName),
        },
        method: "PUT",
      },
    ),
  );
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "music-manager", USER_EMAIL, "Music Manager");
  await provision("organization-alpha", "alpha");
  await seedRoster();
});

afterEach(async () => {
  await reset();
});

describe("Organization music track import sessions", () => {
  it("requires authorized Organization access", async () => {
    const path = "/api/organization/music/track-import/sessions";
    expect(
      (
        await write("alpha.localhost", path, "", {
          clientBatchKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          items: [],
        })
      ).status,
    ).toBe(401);
    const cookie = await signIn();
    await seedAuthUser(database, "other-manager", "other.manager@example.test", "Other Manager");
    await provisionOrganization(database, stores, {
      id: "organization-beta",
      slug: "beta",
      userId: "other-manager",
    });
    expect((await write("beta.localhost", path, cookie, {})).status).toBe(403);
  });

  it("creates, uploads, commits, and replays a session idempotently", async () => {
    const cookie = await signIn();
    const piece = await createPiece(cookie, "O Shenandoah");
    const batchKey = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    const createResponse = await write(
      "alpha.localhost",
      "/api/organization/music/track-import/sessions",
      cookie,
      { clientBatchKey: batchKey, items: [manifestItem(piece.id, "file-1", "S1")] },
    );
    expect(createResponse.status).toBe(201);
    const created = musicTrackImportCreateSessionResponseSchema.parse(await createResponse.json());
    expect(created.items).toEqual([{ clientFileId: "file-1", status: "planned" }]);

    const uploadResponse = await uploadSessionFile(
      cookie,
      created.sessionId,
      "file-1",
      "file-1.mp3",
    );
    expect(uploadResponse.status).toBe(200);

    const replayUpload = await uploadSessionFile(cookie, created.sessionId, "file-1", "file-1.mp3");
    expect(replayUpload.status).toBe(200);
    const replayBody: unknown = await replayUpload.json();
    expect(
      typeof replayBody === "object" && replayBody !== null && "status" in replayBody
        ? replayBody.status
        : undefined,
    ).toBe("already_uploaded");

    const commitKey = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const commitResponse = await write(
      "alpha.localhost",
      `/api/organization/music/track-import/sessions/${created.sessionId}/commit`,
      cookie,
      { commitKey, expectedRevision: 1 },
    );
    expect(commitResponse.status).toBe(200);
    const committed = musicTrackImportCommitResponseSchema.parse(await commitResponse.json());
    expect(committed.summary).toEqual({ attached: 1, conflict: 0, failed: 0, skipped: 0 });

    const replayCommit = await write(
      "alpha.localhost",
      `/api/organization/music/track-import/sessions/${created.sessionId}/commit`,
      cookie,
      { commitKey, expectedRevision: 1 },
    );
    expect(replayCommit.status).toBe(200);
    const replayed = musicTrackImportCommitResponseSchema.parse(await replayCommit.json());
    expect(replayed.summary).toEqual(committed.summary);

    const detailResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/music/track-import/sessions/${created.sessionId}`,
        cookie,
        { method: "GET" },
      ),
    );
    expect(detailResponse.status).toBe(200);
    const detail = musicTrackImportSessionDetailResponseSchema.parse(await detailResponse.json());
    expect(detail.session.state).toBe("completed");
  });

  it("marks occupied slots as conflicts and rejects stale revisions", async () => {
    const cookie = await signIn();
    const piece = await createPiece(cookie, "Occupied Piece");
    const store = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, null>(store, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE music_pieces SET track_file_ids_json = ? WHERE id = ?",
        JSON.stringify({ S1: "existing-file" }),
        piece.id,
      );
      return null;
    });

    const created = musicTrackImportCreateSessionResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/music/track-import/sessions", cookie, {
          clientBatchKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          items: [manifestItem(piece.id, "file-1", "S1")],
        })
      ).json(),
    );
    expect(created.items).toEqual([{ clientFileId: "file-1", status: "conflict" }]);

    const stalePatch = await write(
      "alpha.localhost",
      `/api/organization/music/track-import/sessions/${created.sessionId}/assignments`,
      cookie,
      {
        assignments: [
          {
            clientFileId: "file-1",
            durationSeconds: 100,
            partKey: "A1",
            pieceId: piece.id,
          },
        ],
        expectedRevision: 99,
      },
      "PATCH",
    );
    expect(stalePatch.status).toBe(409);

    const remap = await write(
      "alpha.localhost",
      `/api/organization/music/track-import/sessions/${created.sessionId}/assignments`,
      cookie,
      {
        assignments: [
          {
            clientFileId: "file-1",
            durationSeconds: 100,
            partKey: "A1",
            pieceId: piece.id,
          },
        ],
        expectedRevision: 1,
      },
      "PATCH",
    );
    expect(remap.status).toBe(200);
    const updated = musicTrackImportSessionDetailResponseSchema.parse(await remap.json());
    expect(updated.session.manifestRevision).toBe(2);
  });

  it("rejects oversized and non-MP3 uploads", async () => {
    const cookie = await signIn();
    const piece = await createPiece(cookie, "Upload Guards");
    const created = musicTrackImportCreateSessionResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/music/track-import/sessions", cookie, {
          clientBatchKey: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          items: [manifestItem(piece.id, "file-1", "S1")],
        })
      ).json(),
    );
    const big = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/music/track-import/sessions/${created.sessionId}/files/file-1`,
        cookie,
        {
          body: new Uint8Array([1, 2, 3]),
          headers: {
            "content-length": String(21 * 1024 * 1024),
            "content-type": "audio/mpeg",
            "x-file-name": encodeURIComponent("file-1.mp3"),
          },
          method: "PUT",
        },
      ),
    );
    expect(big.status).toBe(413);

    const wrongType = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/music/track-import/sessions/${created.sessionId}/files/file-1`,
        cookie,
        {
          body: new TextEncoder().encode("dummy-audio-bytes"),
          headers: {
            "content-length": "18",
            "content-type": "audio/wav",
            "x-file-name": encodeURIComponent("file-1.mp3"),
          },
          method: "PUT",
        },
      ),
    );
    expect(wrongType.status).toBe(400);
  });

  it("discards a session and blocks further uploads", async () => {
    const cookie = await signIn();
    const piece = await createPiece(cookie, "Discard Me");
    const created = musicTrackImportCreateSessionResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/music/track-import/sessions", cookie, {
          clientBatchKey: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          items: [manifestItem(piece.id, "file-1", "S1")],
        })
      ).json(),
    );
    const discardResponse = await write(
      "alpha.localhost",
      `/api/organization/music/track-import/sessions/${created.sessionId}/discard`,
      cookie,
      {},
    );
    expect(discardResponse.status).toBe(202);
    const discarded = musicTrackImportDiscardResponseSchema.parse(await discardResponse.json());
    expect(discarded.state).toBe("cleanup_pending");

    const uploadAfterDiscard = await uploadSessionFile(
      cookie,
      created.sessionId,
      "file-1",
      "file-1.mp3",
    );
    expect(uploadAfterDiscard.status).toBe(409);

    const discardReplay = await write(
      "alpha.localhost",
      `/api/organization/music/track-import/sessions/${created.sessionId}/discard`,
      cookie,
      {},
    );
    expect(discardReplay.status).toBe(202);
  });
});
