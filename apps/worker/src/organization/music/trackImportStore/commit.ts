import {
  MUSIC_TRACK_IMPORT_COMMIT_CHUNK_SIZE,
  MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS,
  chunkMusicTrackImport,
} from "@choir/domain";
import {
  musicTrackImportCommitResponseSchema,
  musicTrackImportCommitResultSchema,
  type MusicTrackImportSessionState as SessionState,
} from "@choir/contracts";
import { enqueueAttachedLoudness } from "../../loudnessStore";
import {
  assertOrganization,
  assertUuid,
  MusicTrackImportStoreError,
  parseNow,
  readAttempts,
  readAttemptsForItem,
  readItems,
  readPieceSlots,
  readPrivateFileStatus,
  readSessionForActor,
  requireLiveSession,
  writeAudit,
  type ItemRow,
  type MusicTrackImportStoreStorage,
  type SessionRow,
} from "./shared";

export interface CommitResultEntry {
  readonly clientFileId: string;
  readonly durationUpdated: boolean;
  readonly fileId: string | null;
  readonly partKey: string;
  readonly pieceId: string;
  readonly reason?: string | undefined;
  readonly status: "attached" | "conflict" | "skipped" | "failed";
}

export interface CommitResult {
  readonly committedAt: string;
  readonly commitKey: string;
  readonly manifestRevision: number;
  readonly results: readonly CommitResultEntry[];
  readonly sessionId: string;
  readonly summary: {
    readonly attached: number;
    readonly conflict: number;
    readonly failed: number;
    readonly skipped: number;
  };
}

function canonicalAssignmentsHash(
  entries: readonly {
    readonly durationSeconds: number | null;
    readonly fileId: string;
    readonly partKey: string;
    readonly pieceId: string;
  }[],
  manifestRevision: number,
): string {
  const sorted = [...entries].sort((left, right) =>
    left.pieceId === right.pieceId
      ? left.partKey.localeCompare(right.partKey)
      : left.pieceId.localeCompare(right.pieceId),
  );
  return JSON.stringify({
    assignments: sorted.map((entry) => ({
      durationSeconds: entry.durationSeconds,
      fileId: entry.fileId,
      partKey: entry.partKey,
      pieceId: entry.pieceId,
    })),
    revision: manifestRevision,
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface CommitChunkInput {
  readonly actorUserId: string;
  readonly now: string;
  readonly requestId: string;
}

function markChunkItemFailed(
  storage: MusicTrackImportStoreStorage,
  item: ItemRow,
  now: string,
  errorCode: string,
  reason: string,
): CommitResultEntry {
  storage.sql.exec(
    `UPDATE music_track_import_items
     SET status = 'upload_failed', error_code = ?, updated_at = ?
     WHERE id = ?`,
    errorCode,
    now,
    item.id,
  );
  return {
    clientFileId: item.clientFileId,
    durationUpdated: false,
    fileId: item.currentFileId,
    partKey: item.partKey,
    pieceId: item.pieceId,
    reason,
    status: "failed",
  };
}

function commitChunkItem(
  storage: MusicTrackImportStoreStorage,
  session: SessionRow,
  item: ItemRow,
  input: CommitChunkInput,
): CommitResultEntry {
  const fail = (errorCode: string, reason: string): CommitResultEntry =>
    markChunkItemFailed(storage, item, input.now, errorCode, reason);
  const peer = readPieceSlots(storage, [item.pieceId]);
  const mapping = peer.slots.get(item.pieceId) ?? new Map<string, string>();
  const occupied = mapping.get(item.partKey);
  const attemptFile = item.currentFileId;
  const privateFile = attemptFile ? readPrivateFileStatus(storage, attemptFile) : undefined;
  if (!attemptFile || privateFile?.status !== "ready") {
    return fail("file_not_ready", "Uploaded file is no longer available.");
  }
  const attempt = readAttemptsForItem(storage, session.id, item.id).find(
    (candidate) => candidate.id === attemptFile,
  );
  if (
    attempt?.status !== "ready" ||
    attempt.storageKey !== privateFileKeyOf(storage, attemptFile)
  ) {
    return fail("file_origin_mismatch", "Uploaded file does not belong to this import.");
  }
  if (occupied && occupied !== attemptFile) {
    storage.sql.exec(
      `UPDATE music_track_import_items
       SET status = 'conflict', error_code = 'slot_occupied', updated_at = ? WHERE id = ?`,
      input.now,
      item.id,
    );
    return {
      clientFileId: item.clientFileId,
      durationUpdated: false,
      fileId: attemptFile,
      partKey: item.partKey,
      pieceId: item.pieceId,
      reason: "Slot already occupied by existing track",
      status: "conflict",
    };
  }
  const existingDuration = peer.durations.get(item.pieceId) ?? null;
  const durationUpdated =
    (existingDuration === null || existingDuration === 0) && item.durationSeconds !== null;
  const nextMapping = new Map(mapping);
  nextMapping.set(item.partKey, attemptFile);
  storage.sql.exec(
    `UPDATE music_pieces SET track_file_ids_json = ?, duration_seconds = ?, updated_at = ?
     WHERE id = ?`,
    JSON.stringify(Object.fromEntries(nextMapping)),
    durationUpdated ? item.durationSeconds : existingDuration,
    input.now,
    item.pieceId,
  );
  enqueueAttachedLoudness(storage, item.pieceId, [attemptFile]);
  storage.sql.exec(
    `UPDATE music_track_import_items
     SET status = 'attached', error_code = NULL, updated_at = ? WHERE id = ?`,
    input.now,
    item.id,
  );
  writeAudit(storage, {
    action: "music.track.attached",
    actorType: "organization_member",
    actorUserId: input.actorUserId,
    occurredAt: input.now,
    requestId: input.requestId,
    summary: {
      durationUpdated,
      fileId: attemptFile,
      importSessionId: session.id,
      partKey: item.partKey,
    },
    targetId: item.pieceId,
    targetType: "music_piece",
  });
  return {
    clientFileId: item.clientFileId,
    durationUpdated,
    fileId: attemptFile,
    partKey: item.partKey,
    pieceId: item.pieceId,
    status: "attached",
  };
}

export async function commitMusicTrackImportInStore(
  storage: MusicTrackImportStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly commitKey: string;
    readonly expectedRevision: number;
    readonly now: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly sessionId: string;
  },
): Promise<CommitResult> {
  assertOrganization(storage, input.organizationId);
  parseNow(input.now);
  assertUuid(input.sessionId, "session");
  assertUuid(input.commitKey, "commit key");
  if (!input.actorUserId) {
    throw new MusicTrackImportStoreError("validation_failed", "Actor is required.");
  }

  const session = readSessionForActor(storage, input.sessionId, input.actorUserId);
  const existing = storage.sql
    .exec<{
      readonly assignmentsHash: string;
      readonly committedAt: string;
      readonly manifestRevision: number;
      readonly resultsJson: string;
      readonly summaryJson: string;
    }>(
      `SELECT assignments_hash AS assignmentsHash, committed_at AS committedAt,
              manifest_revision AS manifestRevision,
              results_json AS resultsJson, summary_json AS summaryJson
       FROM music_track_import_commit_receipts WHERE session_id = ? AND commit_key = ?`,
      input.sessionId,
      input.commitKey,
    )
    .toArray()
    .at(0);
  if (existing) {
    // A replay resolves to the same key only when the assignments have not
    // changed since the original commit; a changed revision is a conflict.
    if (existing.manifestRevision !== session.manifestRevision) {
      throw new MusicTrackImportStoreError(
        "idempotency_conflict",
        "This commit key was already used with different assignments.",
      );
    }
    return {
      committedAt: existing.committedAt,
      commitKey: input.commitKey,
      manifestRevision: existing.manifestRevision,
      results: musicTrackImportCommitResultSchema.array().parse(JSON.parse(existing.resultsJson)),
      sessionId: input.sessionId,
      summary: musicTrackImportCommitResponseSchema.shape.summary.parse(
        JSON.parse(existing.summaryJson),
      ),
    };
  }

  requireLiveSession(session, input.now);
  if (session.manifestRevision !== input.expectedRevision) {
    throw new MusicTrackImportStoreError(
      "stale_revision",
      "Assignments changed since this revision was reviewed.",
    );
  }
  const items = readItems(storage, session.id);
  const candidates = items.filter((item) => item.status === "uploaded");
  const skipped: CommitResultEntry[] = items
    .filter((item) => item.status !== "uploaded")
    .map((item) => ({
      clientFileId: item.clientFileId,
      durationUpdated: false,
      fileId: item.currentFileId,
      partKey: item.partKey,
      pieceId: item.pieceId,
      reason:
        item.status === "attached"
          ? "Track is already attached."
          : item.status === "conflict"
            ? "Destination slot is occupied."
            : "Track was not uploaded.",
      status: "skipped" as const,
    }));

  const chunks = chunkMusicTrackImport(candidates, MUSIC_TRACK_IMPORT_COMMIT_CHUNK_SIZE);
  const results: CommitResultEntry[] = [...skipped];
  for (const chunk of chunks) {
    const chunkInput: CommitChunkInput = {
      actorUserId: input.actorUserId,
      now: input.now,
      requestId: input.requestId,
    };
    const chunkResults = storage.transactionSync(() =>
      chunk.map((item) => commitChunkItem(storage, session, item, chunkInput)),
    );
    results.push(...chunkResults);
  }

  const attachedEntries = results.filter((result) => result.status === "attached");
  const assignmentsHash = await sha256Hex(
    canonicalAssignmentsHash(
      attachedEntries.map((result) => ({
        durationSeconds:
          items.find((item) => item.clientFileId === result.clientFileId)?.durationSeconds ?? null,
        fileId: result.fileId ?? "",
        partKey: result.partKey,
        pieceId: result.pieceId,
      })),
      session.manifestRevision,
    ),
  );
  const summary = {
    attached: results.filter((result) => result.status === "attached").length,
    conflict: results.filter((result) => result.status === "conflict").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
  };

  return storage.transactionSync(() => {
    const receipt = storage.sql
      .exec<{ readonly commitKey: string }>(
        `SELECT commit_key AS commitKey FROM music_track_import_commit_receipts
         WHERE session_id = ? AND commit_key = ?`,
        session.id,
        input.commitKey,
      )
      .toArray()
      .at(0);
    if (receipt) {
      throw new MusicTrackImportStoreError(
        "idempotency_conflict",
        "This commit was already recorded with different assignments.",
      );
    }
    storage.sql.exec(
      `INSERT INTO music_track_import_commit_receipts
        (session_id, commit_key, manifest_revision, assignments_hash, results_json, summary_json, committed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      session.id,
      input.commitKey,
      session.manifestRevision,
      assignmentsHash,
      JSON.stringify(results),
      JSON.stringify(summary),
      input.now,
    );
    const nextItems = readItems(storage, session.id);
    const remaining = nextItems.filter((item) => item.status !== "attached");
    const attempts = readAttempts(storage, session.id);
    const unsettled = attempts.filter(
      (attempt) =>
        attempt.status !== "reclaimed" &&
        !(
          nextItems.find((item) => item.id === attempt.itemId)?.status === "attached" &&
          nextItems.find((item) => item.id === attempt.itemId)?.currentFileId === attempt.id
        ),
    );
    const nextState: SessionState = remaining.length === 0 ? "completed" : "partial";
    storage.sql.exec(
      `UPDATE music_track_import_sessions
       SET state = ?, last_user_action_at = ?, expires_at = ?,
           closed_at = CASE WHEN ? = 'completed' THEN ? ELSE closed_at END,
           next_cleanup_due_at = CASE WHEN ? THEN ? ELSE NULL END
       WHERE id = ?`,
      nextState,
      input.now,
      new Date(parseNow(input.now) + MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS * 1000).toISOString(),
      nextState,
      nextState === "completed" ? input.now : null,
      unsettled.length > 0,
      unsettled.length > 0 ? input.now : null,
      session.id,
    );
    writeAudit(storage, {
      action: "music.track_import.committed",
      actorType: "organization_member",
      actorUserId: input.actorUserId,
      occurredAt: input.now,
      requestId: input.requestId,
      summary: { commitKey: input.commitKey, ...summary },
      targetId: session.id,
      targetType: "music_track_import_session",
    });
    return {
      committedAt: input.now,
      commitKey: input.commitKey,
      manifestRevision: session.manifestRevision,
      results,
      sessionId: session.id,
      summary,
    };
  });
}

function privateFileKeyOf(storage: MusicTrackImportStoreStorage, fileId: string): string | null {
  return (
    storage.sql
      .exec<{ readonly storageKey: string }>(
        "SELECT storage_key AS storageKey FROM private_files WHERE id = ?",
        fileId,
      )
      .toArray()
      .at(0)?.storageKey ?? null
  );
}
