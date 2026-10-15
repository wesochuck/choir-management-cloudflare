import {
  musicTrackImportAttachResponseSchema,
  musicTrackImportMatchResponseSchema,
  organizationMusicPieceResponseSchema,
  privateFileResponseSchema,
} from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "music.manager@example.test";

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

function requireBinding<T>(binding: T | undefined, name: string): T {
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

async function uploadAudioFile(
  cookie: string,
  fileId: string,
  fileName: string,
  contentType = "audio/mpeg",
): Promise<void> {
  const bytes = new TextEncoder().encode("dummy-audio-bytes");
  const response = await exports.default.fetch(
    api("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
      body: bytes,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": contentType,
        "x-file-name": encodeURIComponent(fileName),
      },
      method: "PUT",
    }),
  );
  expect(response.status).toBe(201);
  expect(privateFileResponseSchema.parse(await response.json()).id).toBe(fileId);
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "music-manager", USER_EMAIL, "Music Manager");
  await provision("organization-alpha", "alpha");
});

afterEach(async () => {
  await reset();
});

describe("Organization music track import", () => {
  it("requires authorized Organization access and keeps local AI requests offline", async () => {
    const path = "/api/organization/music/track-import/match";
    const body = {
      candidates: [{ pieceId: "11111111-1111-4111-8111-111111111111", title: "Shenandoah" }],
      groups: [{ groupId: "one", fileNames: ["Shenandoah.mp3"] }],
      useAi: true,
    };
    expect((await write("alpha.localhost", path, "", body)).status).toBe(401);
    const cookie = await signIn();
    expect((await write("alpha.localhost", path, cookie, { ...body, useAi: "yes" })).status).toBe(
      400,
    );
    const offline = await write("alpha.localhost", path, cookie, body);
    expect(offline.status).toBe(503);
    await expect(offline.json()).resolves.toMatchObject({ code: "service_unavailable" });
    await seedAuthUser(database, "other-manager", "other.manager@example.test", "Other Manager");
    await provisionOrganization(database, stores, {
      id: "organization-beta",
      slug: "beta",
      userId: "other-manager",
    });
    expect((await write("beta.localhost", path, cookie, body)).status).toBe(403);
  });
  it("attaches practice tracks transactionally, fills piece duration, and protects occupied slots", async () => {
    const cookie = await signIn();

    // 1. Create a music piece with no tracks and null duration
    const piece = organizationMusicPieceResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/music", cookie, {
          composer: "Traditional",
          durationSeconds: null,
          title: "O Shenandoah",
        })
      ).json(),
    );
    expect(piece.durationSeconds).toBeNull();
    expect(piece.trackFileIds).toEqual({});

    // 2. Upload two audio files
    const fileIdS1 = "11111111-1111-4111-8111-111111111111";
    const fileIdTenor = "22222222-2222-4222-8222-222222222222";
    await uploadAudioFile(cookie, fileIdS1, "Shenandoah_Soprano1.mp3");
    await uploadAudioFile(cookie, fileIdTenor, "Shenandoah_Tenor1.mp3");

    // 3. Attach tracks
    const attachResponse = await write(
      "alpha.localhost",
      "/api/organization/music/track-import/attach",
      cookie,
      {
        assignments: [
          {
            durationSeconds: 215,
            fileId: fileIdS1,
            partKey: "soprano1",
            pieceId: piece.id,
          },
          {
            durationSeconds: 215,
            fileId: fileIdTenor,
            partKey: "tenor1",
            pieceId: piece.id,
          },
        ],
        idempotencyKey: "test-attach-key-1",
      },
    );
    expect(attachResponse.status).toBe(200);
    const attachResult = musicTrackImportAttachResponseSchema.parse(await attachResponse.json());
    expect(attachResult.summary.attached).toBe(2);
    expect(attachResult.results).toEqual([
      {
        durationUpdated: true,
        fileId: fileIdS1,
        partKey: "soprano1",
        pieceId: piece.id,
        status: "attached",
      },
      {
        durationUpdated: false,
        fileId: fileIdTenor,
        partKey: "tenor1",
        pieceId: piece.id,
        status: "attached",
      },
    ]);

    // 4. Verify piece in store now has updated duration and trackFileIds
    const store = stores.get(stores.idFromName("organization-alpha"));
    const updatedPieceRow = await runInDurableObject<
      OrganizationStore,
      { durationSeconds: number | null; trackFileIdsJson: string } | null
    >(store, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ durationSeconds: number | null; trackFileIdsJson: string }>(
          "SELECT duration_seconds AS durationSeconds, track_file_ids_json AS trackFileIdsJson FROM music_pieces WHERE id = ?",
          piece.id,
        )
        .toArray()
        .at(0);
      return row ?? null;
    });
    expect(updatedPieceRow?.durationSeconds).toBe(215);
    expect(JSON.parse(updatedPieceRow?.trackFileIdsJson ?? "{}")).toEqual({
      soprano1: fileIdS1,
      tenor1: fileIdTenor,
    });

    // 5. Re-attaching the same file is idempotent
    const reattachResponse = await write(
      "alpha.localhost",
      "/api/organization/music/track-import/attach",
      cookie,
      {
        assignments: [
          {
            durationSeconds: 215,
            fileId: fileIdS1,
            partKey: "soprano1",
            pieceId: piece.id,
          },
        ],
        idempotencyKey: "test-attach-key-2",
      },
    );
    const reattachResult = musicTrackImportAttachResponseSchema.parse(
      await reattachResponse.json(),
    );
    expect(reattachResult.results[0]?.status).toBe("attached");

    // 6. Attempting to overwrite an existing slot with a DIFFERENT file produces conflict and NEVER overwrites!
    const fileIdNewS1 = "33333333-3333-4333-8333-333333333333";
    await uploadAudioFile(cookie, fileIdNewS1, "Different_Soprano1.mp3");

    const conflictResponse = await write(
      "alpha.localhost",
      "/api/organization/music/track-import/attach",
      cookie,
      {
        assignments: [
          {
            durationSeconds: 220,
            fileId: fileIdNewS1,
            partKey: "soprano1",
            pieceId: piece.id,
          },
        ],
        idempotencyKey: "test-attach-key-3",
      },
    );
    const conflictResult = musicTrackImportAttachResponseSchema.parse(
      await conflictResponse.json(),
    );
    expect(conflictResult.summary.conflict).toBe(1);
    expect(conflictResult.results[0]).toEqual({
      durationUpdated: false,
      fileId: fileIdNewS1,
      partKey: "soprano1",
      pieceId: piece.id,
      reason: "Slot already occupied by existing track",
      status: "conflict",
    });

    // Verify slot was NOT overwritten
    const checkPieceRow = await runInDurableObject<OrganizationStore, string>(
      store,
      (_instance, state) =>
        state.storage.sql
          .exec<{ trackFileIdsJson: string }>(
            "SELECT track_file_ids_json AS trackFileIdsJson FROM music_pieces WHERE id = ?",
            piece.id,
          )
          .one().trackFileIdsJson,
    );
    expect(JSON.parse(checkPieceRow).soprano1).toBe(fileIdS1);

    // 7. Test invalid file (non-audio or non-ready)
    const fileIdText = "55555555-5555-4555-8555-555555555555";
    await uploadAudioFile(cookie, fileIdText, "score.pdf", "application/pdf");
    const invalidFileResponse = await write(
      "alpha.localhost",
      "/api/organization/music/track-import/attach",
      cookie,
      {
        assignments: [
          {
            durationSeconds: null,
            fileId: fileIdText,
            partKey: "alto1",
            pieceId: piece.id,
          },
        ],
        idempotencyKey: "test-attach-key-4",
      },
    );
    const invalidFileResult = musicTrackImportAttachResponseSchema.parse(
      await invalidFileResponse.json(),
    );
    expect(invalidFileResult.results[0]?.status).toBe("failed");
    expect(invalidFileResult.results[0]?.reason).toBe("Invalid or unready audio file");

    // 8. Test piece not found
    const missingPieceResponse = await write(
      "alpha.localhost",
      "/api/organization/music/track-import/attach",
      cookie,
      {
        assignments: [
          {
            durationSeconds: null,
            fileId: fileIdS1,
            partKey: "alto1",
            pieceId: "99999999-9999-4999-8999-999999999999",
          },
        ],
        idempotencyKey: "test-attach-key-5",
      },
    );
    const missingPieceResult = musicTrackImportAttachResponseSchema.parse(
      await missingPieceResponse.json(),
    );
    expect(missingPieceResult.results[0]?.status).toBe("failed");
    expect(missingPieceResult.results[0]?.reason).toBe("Music piece not found");
  });

  it("returns match suggestions for candidate groups", async () => {
    const cookie = await signIn();

    const response = await write(
      "alpha.localhost",
      "/api/organization/music/track-import/match",
      cookie,
      {
        candidates: [
          {
            durationSeconds: 222,
            occupiedPartKeys: [],
            pieceId: "11111111-1111-4111-8111-111111111111",
            title: "O Shenandoah",
          },
        ],
        groups: [
          {
            detectedParts: ["tenor1", "bass"],
            durationSeconds: 222,
            fileNames: ["Shenandoah_Tenor1.mp3", "Shenandoah_Bass.mp3"],
            groupId: "group-1",
            inferredTitle: "O Shenandoah",
            sequenceNumber: "01",
          },
        ],
      },
    );
    expect(response.status).toBe(200);
    const result = musicTrackImportMatchResponseSchema.parse(await response.json());
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.groupId).toBe("group-1");
    expect(result.suggestions[0]?.suggestedPieceId).toBe("11111111-1111-4111-8111-111111111111");
    expect(result.suggestions[0]?.confidence).toBe("high");
  });
});
