import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  claimMusicTrackImportCleanupBatchInStore,
  claimMusicTrackImportUploadInStore,
  commitMusicTrackImportInStore,
  completeMusicTrackImportCleanupInStore,
  createMusicTrackImportSessionInStore,
  discardMusicTrackImportSessionInStore,
  failMusicTrackImportUploadInStore,
  finalizeMusicTrackImportUploadInStore,
  getMusicTrackImportSessionInStore,
  listMusicTrackImportSessionsInStore,
  MusicTrackImportStoreError,
  prepareMusicTrackImportCleanupSweepInStore,
  updateMusicTrackImportAssignmentsInStore,
  type MusicTrackImportStoreStorage,
} from "./trackImportStore";
import {
  createContactTestAdapter,
  countFor,
  dbAllUnknown,
  descriptorValue,
  runMigrations,
  seedOrganization,
  uuidFor,
} from "../contactTestkit";

const ORG_ID = "org-track-import-test";
const ACTOR_ID = "user-track-import-actor";
const OTHER_ACTOR_ID = "user-track-import-other";
const NOW = "2026-10-21T00:00:00.000Z";

const ROSTER_JSON = JSON.stringify({
  sections: [
    { code: "S", color: "#000000", name: "Soprano" },
    { code: "A", color: "#111111", name: "Alto" },
  ],
  voiceParts: [
    { fullName: "Soprano 1", label: "S1", sectionCode: "S" },
    { fullName: "Alto 1", label: "A1", sectionCode: "A" },
  ],
});

function manifestDigest(items: readonly { readonly clientFileId: string }[]): string {
  return createHash("sha256")
    .update(JSON.stringify(items.map((item) => item.clientFileId)))
    .digest("hex");
}

interface Fixture {
  readonly db: DatabaseSync;
  readonly storage: MusicTrackImportStoreStorage;
}

function freshFixture(): Fixture {
  const db = new DatabaseSync(":memory:");
  const context = createContactTestAdapter(db);
  runMigrations(db);
  seedOrganization(db, ORG_ID);
  db.prepare("UPDATE organization_metadata SET roster_configuration_json = ?").run(ROSTER_JSON);
  return { db, storage: context.storage };
}

function seedPiece(
  db: DatabaseSync,
  input: {
    readonly durationSeconds?: number | null;
    readonly id: string;
    readonly tracks?: Record<string, string>;
  },
): void {
  db.prepare(
    `INSERT INTO music_pieces
      (id, title, composer, arranger, purchase_date, copies, catalog_id, duration_seconds,
       notes, section_buckets_json, genres_json, parent_id, track_file_ids_json, created_at, updated_at)
     VALUES (?, 'Test Piece', '', '', NULL, NULL, '', ?, '', '[]', '[]', NULL, ?, ?, ?)`,
  ).run(input.id, input.durationSeconds ?? null, JSON.stringify(input.tracks ?? {}), NOW, NOW);
}

function manifestItem(overrides: {
  readonly clientFileId?: string;
  readonly partKey?: string;
  readonly pieceId?: string;
}) {
  return {
    clientFileId: overrides.clientFileId ?? "file-1",
    contentType: "audio/mpeg" as const,
    durationSeconds: 215,
    fileName: `${overrides.clientFileId ?? "file-1"}.mp3`,
    lastModifiedMs: 1_700_000_000_000,
    partKey: overrides.partKey ?? "S1",
    pieceId: overrides.pieceId ?? uuidFor(10),
    sha256Hex: "a".repeat(64),
    sizeBytes: 1024,
  };
}

function createSession(
  overrides: {
    readonly actorUserId?: string;
    readonly clientBatchKey?: string;
    readonly items?: ReturnType<typeof manifestItem>[];
    readonly now?: string;
  } = {},
) {
  const items = overrides.items ?? [manifestItem({})];
  return createMusicTrackImportSessionInStore(fixture.storage, {
    actorUserId: overrides.actorUserId ?? ACTOR_ID,
    clientBatchKey: overrides.clientBatchKey ?? uuidFor(1),
    items,
    manifestDigest: manifestDigest(items),
    now: overrides.now ?? NOW,
    organizationId: ORG_ID,
    requestId: uuidFor(2),
  });
}

function expectStoreError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(MusicTrackImportStoreError);
    if (error instanceof MusicTrackImportStoreError) {
      expect(error.code).toBe(code);
      return;
    }
    throw new Error(`Expected store error ${code}.`, { cause: error });
  }
  throw new Error(`Expected store error ${code}.`);
}

let fixture: Fixture;

beforeEach(() => {
  fixture = freshFixture();
});

describe("track import session lifecycle", () => {
  it("creates a session with planned items", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const created = createSession({
      items: [manifestItem({ pieceId })],
    });
    expect(created.manifestRevision).toBe(1);
    expect(created.counts.total).toBe(1);
    expect(created.counts.planned).toBe(1);
    expect(created.items).toEqual([{ clientFileId: "file-1", status: "planned" }]);
  });

  it("marks items targeting occupied slots as conflict at creation", () => {
    const pieceId = uuidFor(10);
    const existingFile = uuidFor(20);
    seedPiece(fixture.db, { id: pieceId, tracks: { S1: existingFile } });
    const created = createSession({ items: [manifestItem({ pieceId })] });
    expect(created.items).toEqual([{ clientFileId: "file-1", status: "conflict" }]);
    expect(created.counts.conflict).toBe(1);
  });

  it("replays the same batch key with the same manifest", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const batchKey = uuidFor(1);
    const first = createSession({
      clientBatchKey: batchKey,
      items: [manifestItem({ pieceId })],
    });
    const second = createSession({
      clientBatchKey: batchKey,
      items: [manifestItem({ pieceId })],
    });
    expect(second.sessionId).toBe(first.sessionId);
    expect(countFor(fixture.db, "SELECT COUNT(*) AS count FROM music_track_import_sessions")).toBe(
      1,
    );
  });

  it("rejects the same batch key with a different manifest", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const batchKey = uuidFor(1);
    createSession({ clientBatchKey: batchKey, items: [manifestItem({ pieceId })] });
    expectStoreError(
      () =>
        createMusicTrackImportSessionInStore(fixture.storage, {
          actorUserId: ACTOR_ID,
          clientBatchKey: batchKey,
          items: [manifestItem({ clientFileId: "file-2", pieceId })],
          manifestDigest: "b".repeat(64),
          now: NOW,
          organizationId: ORG_ID,
          requestId: uuidFor(3),
        }),
      "idempotency_conflict",
    );
  });

  it("rejects unknown pieces, unconfigured parts, and oversized manifests", () => {
    expectStoreError(
      () =>
        createSession({
          items: [manifestItem({ pieceId: uuidFor(99) })],
        }),
      "validation_failed",
    );
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    expectStoreError(
      () =>
        createSession({
          items: [{ ...manifestItem({ pieceId }), partKey: "Nope" }],
        }),
      "validation_failed",
    );
    expectStoreError(
      () =>
        createSession({
          items: Array.from({ length: 101 }, (_, index) =>
            manifestItem({
              clientFileId: `file-${String(index)}`,
              partKey: `P${String(index)}`,
              pieceId,
            }),
          ),
        }),
      "validation_failed",
    );
  });

  it("hides sessions from other actors and lists only the actor's live sessions", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const created = createSession({ items: [manifestItem({ pieceId })] });
    expectStoreError(
      () =>
        getMusicTrackImportSessionInStore(fixture.storage, {
          actorUserId: OTHER_ACTOR_ID,
          now: NOW,
          organizationId: ORG_ID,
          sessionId: created.sessionId,
        }),
      "session_not_found",
    );
    expect(
      listMusicTrackImportSessionsInStore(fixture.storage, {
        actorUserId: OTHER_ACTOR_ID,
        now: NOW,
        organizationId: ORG_ID,
      }),
    ).toEqual([]);
    expect(
      listMusicTrackImportSessionsInStore(fixture.storage, {
        actorUserId: ACTOR_ID,
        now: NOW,
        organizationId: ORG_ID,
      }),
    ).toHaveLength(1);
  });
});

describe("track import uploads", () => {
  it("claims, finalizes, and replays an upload without a second reservation", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const created = createSession({ items: [manifestItem({ pieceId })] });
    const claim = claimMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId: "file-1",
      contentType: "audio/mpeg",
      expectedSizeBytes: 1024,
      fileName: "file-1.mp3",
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(4),
      sessionId: created.sessionId,
    });
    expect(claim.alreadyUploaded).toBe(false);
    expect(claim.fileId).toMatch(/^[0-9a-f-]{36}$/);
    expect(claim.storageKey).toContain(claim.fileId);

    const finalized = finalizeMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId: "file-1",
      fileId: claim.fileId,
      now: NOW,
      organizationId: ORG_ID,
      receivedSizeBytes: 1024,
      requestId: uuidFor(5),
      sessionId: created.sessionId,
    });
    expect(finalized.status).toBe("uploaded");

    const replay = claimMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId: "file-1",
      contentType: "audio/mpeg",
      expectedSizeBytes: 1024,
      fileName: "file-1.mp3",
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(6),
      sessionId: created.sessionId,
    });
    expect(replay.alreadyUploaded).toBe(true);
    expect(replay.fileId).toBe(claim.fileId);
    expect(countFor(fixture.db, "SELECT COUNT(*) AS count FROM private_files")).toBe(1);
  });

  it("rejects a second claim while a lease is live", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const created = createSession({ items: [manifestItem({ pieceId })] });
    claimMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId: "file-1",
      contentType: "audio/mpeg",
      expectedSizeBytes: 1024,
      fileName: "file-1.mp3",
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(4),
      sessionId: created.sessionId,
    });
    expectStoreError(
      () =>
        claimMusicTrackImportUploadInStore(fixture.storage, {
          actorUserId: ACTOR_ID,
          clientFileId: "file-1",
          contentType: "audio/mpeg",
          expectedSizeBytes: 1024,
          fileName: "file-1.mp3",
          now: NOW,
          organizationId: ORG_ID,
          requestId: uuidFor(5),
          sessionId: created.sessionId,
        }),
      "upload_in_progress",
    );
  });

  it("recycles an expired lease and reports the superseded key", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const created = createSession({ items: [manifestItem({ pieceId })] });
    const first = claimMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId: "file-1",
      contentType: "audio/mpeg",
      expectedSizeBytes: 1024,
      fileName: "file-1.mp3",
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(4),
      sessionId: created.sessionId,
    });
    const later = "2026-10-21T01:00:00.000Z";
    const second = claimMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId: "file-1",
      contentType: "audio/mpeg",
      expectedSizeBytes: 1024,
      fileName: "file-1.mp3",
      now: later,
      organizationId: ORG_ID,
      requestId: uuidFor(5),
      sessionId: created.sessionId,
    });
    expect(second.fileId).not.toBe(first.fileId);
    expect(second.superseded).toEqual({ fileId: first.fileId, storageKey: first.storageKey });
  });

  it("marks occupied slots as conflict at claim time", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const existingFile = uuidFor(20);
    const created = createSession({ items: [manifestItem({ pieceId })] });
    fixture.db
      .prepare("UPDATE music_pieces SET track_file_ids_json = ? WHERE id = ?")
      .run(JSON.stringify({ S1: existingFile }), pieceId);
    expectStoreError(
      () =>
        claimMusicTrackImportUploadInStore(fixture.storage, {
          actorUserId: ACTOR_ID,
          clientFileId: "file-1",
          contentType: "audio/mpeg",
          expectedSizeBytes: 1024,
          fileName: "file-1.mp3",
          now: NOW,
          organizationId: ORG_ID,
          requestId: uuidFor(4),
          sessionId: created.sessionId,
        }),
      "slot_conflict",
    );
    const detail = getMusicTrackImportSessionInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      now: NOW,
      organizationId: ORG_ID,
      sessionId: created.sessionId,
    });
    expect(detail.items[0]?.status).toBe("conflict");
  });

  it("records upload failures and reuses failed rows on retry", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const created = createSession({ items: [manifestItem({ pieceId })] });
    const claim = claimMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId: "file-1",
      contentType: "audio/mpeg",
      expectedSizeBytes: 1024,
      fileName: "file-1.mp3",
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(4),
      sessionId: created.sessionId,
    });
    const failure = failMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId: "file-1",
      errorCode: "r2_error",
      fileId: claim.fileId,
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(5),
      sessionId: created.sessionId,
    });
    expect(failure.superseded).toEqual({ fileId: claim.fileId, storageKey: claim.storageKey });
    const retry = claimMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId: "file-1",
      contentType: "audio/mpeg",
      expectedSizeBytes: 1024,
      fileName: "file-1.mp3",
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(6),
      sessionId: created.sessionId,
    });
    expect(retry.alreadyUploaded).toBe(false);
    expect(retry.superseded).toBeNull();
  });
});

describe("track import assignments and commits", () => {
  function uploadItem(sessionId: string, clientFileId: string, fileName: string): string {
    const claim = claimMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId,
      contentType: "audio/mpeg",
      expectedSizeBytes: 1024,
      fileName,
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(30),
      sessionId,
    });
    finalizeMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId,
      fileId: claim.fileId,
      now: NOW,
      organizationId: ORG_ID,
      receivedSizeBytes: 1024,
      requestId: uuidFor(31),
      sessionId,
    });
    return claim.fileId;
  }

  it("commits uploaded tracks and fills an empty piece duration", async () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const created = createSession({ items: [manifestItem({ pieceId })] });
    const fileId = uploadItem(created.sessionId, "file-1", "file-1.mp3");
    const commit = await commitMusicTrackImportInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      commitKey: uuidFor(40),
      expectedRevision: 1,
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(41),
      sessionId: created.sessionId,
    });
    expect(commit.summary).toEqual({ attached: 1, conflict: 0, failed: 0, skipped: 0 });
    expect(commit.manifestRevision).toBe(1);
    const [pieceRow] = dbAllUnknown(
      fixture.db,
      "SELECT duration_seconds AS durationSeconds, track_file_ids_json AS tracks FROM music_pieces WHERE id = ?",
      pieceId,
    );
    if (typeof pieceRow !== "object" || pieceRow === null) {
      throw new Error("Expected the updated music piece.");
    }
    expect(descriptorValue(pieceRow, "durationSeconds")).toBe(215);
    expect(JSON.parse(String(descriptorValue(pieceRow, "tracks")))).toEqual({ S1: fileId });
    const detail = getMusicTrackImportSessionInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      now: NOW,
      organizationId: ORG_ID,
      sessionId: created.sessionId,
    });
    expect(detail.state).toBe("completed");
  });

  it("replays a commit key with identical assignments and rejects changed ones", async () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const created = createSession({ items: [manifestItem({ pieceId })] });
    uploadItem(created.sessionId, "file-1", "file-1.mp3");
    const commitKey = uuidFor(40);
    const first = await commitMusicTrackImportInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      commitKey,
      expectedRevision: 1,
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(41),
      sessionId: created.sessionId,
    });
    const replay = await commitMusicTrackImportInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      commitKey,
      expectedRevision: 1,
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(42),
      sessionId: created.sessionId,
    });
    expect(replay.summary).toEqual(first.summary);
    expect(replay.manifestRevision).toBe(first.manifestRevision);
    expect(
      countFor(fixture.db, "SELECT COUNT(*) AS count FROM music_track_import_commit_receipts"),
    ).toBe(1);
  });

  it("rejects stale revisions and remaps conflicted rows", () => {
    const firstPiece = uuidFor(10);
    const secondPiece = uuidFor(11);
    seedPiece(fixture.db, { id: firstPiece, tracks: { S1: uuidFor(20) } });
    seedPiece(fixture.db, { id: secondPiece });
    const created = createSession({
      items: [manifestItem({ clientFileId: "file-1", pieceId: firstPiece })],
    });
    expect(created.items[0]?.status).toBe("conflict");
    expectStoreError(
      () =>
        updateMusicTrackImportAssignmentsInStore(fixture.storage, {
          actorUserId: ACTOR_ID,
          assignments: [
            { clientFileId: "file-1", durationSeconds: 100, partKey: "A1", pieceId: secondPiece },
          ],
          expectedRevision: 99,
          now: NOW,
          organizationId: ORG_ID,
          requestId: uuidFor(50),
          sessionId: created.sessionId,
        }),
      "stale_revision",
    );
    const updated = updateMusicTrackImportAssignmentsInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      assignments: [
        { clientFileId: "file-1", durationSeconds: 100, partKey: "A1", pieceId: secondPiece },
      ],
      expectedRevision: 1,
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(50),
      sessionId: created.sessionId,
    });
    expect(updated.manifestRevision).toBe(2);
    expect(updated.items[0]?.status).toBe("planned");
    expect(updated.items[0]?.durationSeconds).toBe(100);
  });
});

describe("track import discard and cleanup", () => {
  it("discards a session and replays the discard idempotently", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const created = createSession({ items: [manifestItem({ pieceId })] });
    const discarded = discardMusicTrackImportSessionInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(60),
      sessionId: created.sessionId,
    });
    expect(discarded.state).toBe("cleanup_pending");
    const replay = discardMusicTrackImportSessionInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      now: "2026-10-21T01:00:00.000Z",
      organizationId: ORG_ID,
      requestId: uuidFor(61),
      sessionId: created.sessionId,
    });
    expect(replay.state).toBe("cleanup_pending");
  });

  it("expires idle sessions and enqueues cleanup through the sweep", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const created = createSession({
      items: [manifestItem({ pieceId })],
      now: "2026-10-19T00:00:00.000Z",
    });
    const sweep = prepareMusicTrackImportCleanupSweepInStore(fixture.storage, {
      now: "2026-10-21T00:00:01.000Z",
      organizationId: ORG_ID,
    });
    expect(sweep.expired).toBe(1);
    expect(sweep.enqueued).toHaveLength(1);
    expect(sweep.enqueued[0]?.sessionId).toBe(created.sessionId);
    const [outboxRow] = dbAllUnknown(
      fixture.db,
      "SELECT kind, idempotency_key AS idempotencyKey FROM scheduled_job_outbox",
    );
    if (typeof outboxRow !== "object" || outboxRow === null) {
      throw new Error("Expected the cleanup outbox row.");
    }
    expect(descriptorValue(outboxRow, "kind")).toBe("music_track_import_cleanup");
    expect(String(descriptorValue(outboxRow, "idempotencyKey"))).toContain(created.sessionId);
  });

  it("claims eligible attempts and closes the session once reclaimed", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const created = createSession({ items: [manifestItem({ pieceId })] });
    const claim = claimMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId: "file-1",
      contentType: "audio/mpeg",
      expectedSizeBytes: 1024,
      fileName: "file-1.mp3",
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(70),
      sessionId: created.sessionId,
    });
    discardMusicTrackImportSessionInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(71),
      sessionId: created.sessionId,
    });
    const batch = claimMusicTrackImportCleanupBatchInStore(fixture.storage, {
      now: "2026-10-21T01:00:00.000Z",
      organizationId: ORG_ID,
      sessionId: created.sessionId,
    });
    expect(batch.attempts).toHaveLength(1);
    expect(batch.attempts[0]?.fileId).toBe(claim.fileId);
    expect(batch.attempts[0]?.privateFileStatus).toBe("pending");
    const completed = completeMusicTrackImportCleanupInStore(fixture.storage, {
      fileIds: [claim.fileId],
      now: "2026-10-21T01:00:00.000Z",
      organizationId: ORG_ID,
      sessionId: created.sessionId,
    });
    expect(completed.remaining).toBe(0);
    expect(completed.state).toBe("discarded");
  });

  it("never claims live leases or referenced files", () => {
    const pieceId = uuidFor(10);
    seedPiece(fixture.db, { id: pieceId });
    const created = createSession({ items: [manifestItem({ pieceId })] });
    claimMusicTrackImportUploadInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      clientFileId: "file-1",
      contentType: "audio/mpeg",
      expectedSizeBytes: 1024,
      fileName: "file-1.mp3",
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(80),
      sessionId: created.sessionId,
    });
    discardMusicTrackImportSessionInStore(fixture.storage, {
      actorUserId: ACTOR_ID,
      now: NOW,
      organizationId: ORG_ID,
      requestId: uuidFor(81),
      sessionId: created.sessionId,
    });
    const live = claimMusicTrackImportCleanupBatchInStore(fixture.storage, {
      now: NOW,
      organizationId: ORG_ID,
      sessionId: created.sessionId,
    });
    expect(live.attempts).toHaveLength(0);
  });
});
