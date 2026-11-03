import {
  MUSIC_TRACK_IMPORT_CLEANUP_BATCH_SIZE,
  MUSIC_TRACK_IMPORT_CLEANUP_SWEEP_LIMIT,
  MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS,
  chunkMusicTrackImport,
} from "@choir/domain";
import type {
  MusicTrackImportItemStatus,
  MusicTrackImportSessionState as SessionState,
} from "@choir/contracts";
import type { SqlStorageValue } from "@cloudflare/workers-types";
import {
  assertOrganization,
  assertUuid,
  CLEANUP_ELIGIBLE_STATES,
  MusicTrackImportStoreError,
  parseNow,
  readItems,
  readPrivateFileRow,
  readSession,
  readSessionForActor,
  TERMINAL_SESSION_STATES,
  writeAudit,
  type AttemptRow,
  type MusicTrackImportStoreStorage,
} from "./shared";

export interface DiscardResult {
  readonly sessionId: string;
  readonly state: SessionState;
  readonly statuses: readonly {
    readonly clientFileId: string;
    readonly status: MusicTrackImportItemStatus;
  }[];
}

export function discardMusicTrackImportSessionInStore(
  storage: MusicTrackImportStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly sessionId: string;
  },
): DiscardResult {
  assertOrganization(storage, input.organizationId);
  const nowMs = parseNow(input.now);
  assertUuid(input.sessionId, "session");
  if (!input.actorUserId) {
    throw new MusicTrackImportStoreError("validation_failed", "Actor is required.");
  }

  return storage.transactionSync(() => {
    const session = readSessionForActor(storage, input.sessionId, input.actorUserId);
    const items = readItems(storage, session.id);
    const statuses = items.map((item) => ({
      clientFileId: item.clientFileId,
      status: item.status,
    }));
    if (TERMINAL_SESSION_STATES.includes(session.state)) {
      return { sessionId: session.id, state: session.state, statuses };
    }
    for (const item of items) {
      if (item.status === "attached" || item.status === "planned" || item.status === "reclaimed") {
        continue;
      }
      storage.sql.exec(
        `UPDATE music_track_import_items
         SET status = 'cleanup_pending', updated_at = ? WHERE id = ?`,
        input.now,
        item.id,
      );
    }
    const nextDueAt = input.now;
    storage.sql.exec(
      `UPDATE music_track_import_sessions
       SET state = 'cleanup_pending', last_user_action_at = ?, expires_at = ?,
           closed_at = ?, next_cleanup_due_at = ?, cleanup_round = cleanup_round + 1
       WHERE id = ?`,
      input.now,
      new Date(nowMs + MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS * 1000).toISOString(),
      input.now,
      nextDueAt,
      session.id,
    );
    storage.sql.exec(
      `INSERT OR IGNORE INTO scheduled_job_outbox
        (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'music_track_import_cleanup', ?, ?, ?)`,
      crypto.randomUUID(),
      `music-track-import-cleanup:${input.organizationId}:${session.id}:round:${String(session.cleanupRound + 1)}`,
      nextDueAt,
      input.now,
    );
    writeAudit(storage, {
      action: "music.track_import.session.discarded",
      actorType: "organization_member",
      actorUserId: input.actorUserId,
      occurredAt: input.now,
      requestId: input.requestId,
      summary: { itemCount: items.length },
      targetId: session.id,
      targetType: "music_track_import_session",
    });
    const nextItems = readItems(storage, session.id);
    return {
      sessionId: session.id,
      state: "cleanup_pending",
      statuses: nextItems.map((item) => ({ clientFileId: item.clientFileId, status: item.status })),
    };
  });
}

export interface CleanupSweepResult {
  readonly enqueued: readonly {
    readonly idempotencyKey: string;
    readonly jobId: string;
    readonly sessionId: string;
  }[];
  readonly expired: number;
}

export function prepareMusicTrackImportCleanupSweepInStore(
  storage: MusicTrackImportStoreStorage,
  input: {
    readonly limit?: number | undefined;
    readonly now: string;
    readonly organizationId: string;
  },
): CleanupSweepResult {
  assertOrganization(storage, input.organizationId);
  parseNow(input.now);
  const limit = Math.min(
    Math.max(input.limit ?? MUSIC_TRACK_IMPORT_CLEANUP_SWEEP_LIMIT, 1),
    MUSIC_TRACK_IMPORT_CLEANUP_SWEEP_LIMIT,
  );

  return storage.transactionSync(() => {
    const expiring = storage.sql
      .exec<{ readonly id: string }>(
        `SELECT id FROM music_track_import_sessions
         WHERE state IN ('active', 'partial')
           AND (expires_at <= ? OR absolute_expires_at <= ?)
         ORDER BY expires_at LIMIT ?`,
        input.now,
        input.now,
        limit,
      )
      .toArray();
    let expired = 0;
    for (const row of expiring) {
      storage.sql.exec(
        `UPDATE music_track_import_sessions
         SET state = 'expired', closed_at = ?, next_cleanup_due_at = ?
         WHERE id = ? AND state IN ('active', 'partial')`,
        input.now,
        input.now,
        row.id,
      );
      writeAudit(storage, {
        action: "music.track_import.session.expired",
        actorType: "organization_system",
        actorUserId: "system:scheduler",
        occurredAt: input.now,
        requestId: `scheduler:${row.id}`,
        summary: {},
        targetId: row.id,
        targetType: "music_track_import_session",
      });
      expired += 1;
    }

    const due = storage.sql
      .exec<{ readonly cleanupRound: number; readonly id: string }>(
        `SELECT id, cleanup_round AS cleanupRound FROM music_track_import_sessions
         WHERE state IN ('cancel_requested', 'cleanup_pending', 'expired')
           AND next_cleanup_due_at IS NOT NULL AND next_cleanup_due_at <= ?
         ORDER BY next_cleanup_due_at LIMIT ?`,
        input.now,
        limit,
      )
      .toArray();
    const enqueued: { idempotencyKey: string; jobId: string; sessionId: string }[] = [];
    const backoffUntil = new Date(parseNow(input.now) + 60 * 60 * 1000).toISOString();
    for (const row of due) {
      // A session with an unenqueued cleanup row from its current round is
      // already scheduled; enqueueing another round would only duplicate work.
      const pendingKey = `music-track-import-cleanup:${input.organizationId}:${row.id}:round:${String(row.cleanupRound)}`;
      const alreadyScheduled =
        storage.sql
          .exec<{ readonly count: number }>(
            `SELECT COUNT(*) AS count FROM scheduled_job_outbox
           WHERE idempotency_key = ? AND enqueued_at IS NULL`,
            pendingKey,
          )
          .toArray()
          .at(0)?.count === 1;
      if (alreadyScheduled) continue;
      const round = row.cleanupRound + 1;
      const jobId = crypto.randomUUID();
      const idempotencyKey = `music-track-import-cleanup:${input.organizationId}:${row.id}:round:${String(round)}`;
      storage.sql.exec(
        `INSERT OR IGNORE INTO scheduled_job_outbox
          (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, 'music_track_import_cleanup', ?, ?, ?)`,
        jobId,
        idempotencyKey,
        input.now,
        input.now,
      );
      storage.sql.exec(
        `UPDATE music_track_import_sessions
         SET cleanup_round = ?, next_cleanup_due_at = ? WHERE id = ?`,
        round,
        backoffUntil,
        row.id,
      );
      enqueued.push({ idempotencyKey, jobId, sessionId: row.id });
    }
    return { enqueued, expired };
  });
}

export interface CleanupClaimResult {
  readonly attempts: readonly {
    readonly fileId: string;
    readonly privateFileStatus: "pending" | "ready" | null;
    readonly storageKey: string;
    readonly uploadRequestId: string | null;
    readonly uploadedBy: string | null;
  }[];
  readonly sessionId: string;
  readonly skippedReferenced: number;
  readonly state: SessionState;
}

/**
 * Marks up to 25 eligible attempts as cleanup-pending in one transaction and
 * returns the exact recorded storage keys for the queue worker to delete.
 * Referenced files are never claimed; they are reported for manual review.
 */
export function claimMusicTrackImportCleanupBatchInStore(
  storage: MusicTrackImportStoreStorage,
  input: {
    readonly limit?: number | undefined;
    readonly now: string;
    readonly organizationId: string;
    readonly sessionId: string;
  },
): CleanupClaimResult {
  assertOrganization(storage, input.organizationId);
  parseNow(input.now);
  assertUuid(input.sessionId, "session");
  const limit = Math.min(
    Math.max(input.limit ?? MUSIC_TRACK_IMPORT_CLEANUP_BATCH_SIZE, 1),
    MUSIC_TRACK_IMPORT_CLEANUP_BATCH_SIZE,
  );

  return storage.transactionSync(() => {
    const session = readSession(storage, input.sessionId);
    if (!session) {
      throw new MusicTrackImportStoreError("session_not_found", "Import session not found.");
    }
    if (!CLEANUP_ELIGIBLE_STATES.includes(session.state)) {
      return { attempts: [], sessionId: session.id, skippedReferenced: 0, state: session.state };
    }
    if (session.state === "cancel_requested") {
      storage.sql.exec(
        `UPDATE music_track_import_sessions SET state = 'cleanup_pending' WHERE id = ?`,
        session.id,
      );
    }

    // Stuck `cleanup_pending` attempts belong to crashed executions; a stale
    // claim is re-picked so retries are self-healing. The 24h orphan alert
    // still fires for attempts that never settle.
    const staleClaimBefore = new Date(parseNow(input.now) - 60 * 60 * 1000).toISOString();
    const candidates = storage.sql
      .exec<AttemptRow & Record<string, SqlStorageValue> & { readonly itemStatus: string }>(
        `SELECT a.id, a.session_id AS sessionId, a.item_id AS itemId,
                a.attempt_number AS attemptNumber, a.storage_key AS storageKey, a.status,
                a.lease_expires_at AS leaseExpiresAt, a.created_at AS createdAt,
                a.ready_at AS readyAt, a.cleanup_started_at AS cleanupStartedAt,
                a.reclaimed_at AS reclaimedAt, i.status AS itemStatus,
                i.current_file_id AS itemCurrentFileId
         FROM music_track_import_file_attempts a
         JOIN music_track_import_items i ON i.id = a.item_id
         WHERE a.session_id = ?
           AND (a.status IN ('ready', 'failed')
             OR ((a.status = 'reserved' OR a.status = 'uploading') AND a.lease_expires_at <= ?)
             OR (a.status = 'cleanup_pending' AND a.cleanup_started_at <= ?))
           AND NOT (i.status = 'attached' AND i.current_file_id = a.id)
         ORDER BY a.attempt_number LIMIT ?`,
        session.id,
        input.now,
        staleClaimBefore,
        limit,
      )
      .toArray() as (AttemptRow & { readonly itemStatus: string })[];
    if (candidates.length === 0) {
      return { attempts: [], sessionId: session.id, skippedReferenced: 0, state: session.state };
    }

    const referenced = findReferencedImportFiles(
      storage,
      candidates.map((candidate) => candidate.id),
    );
    let skippedReferenced = 0;
    const claimed: {
      fileId: string;
      privateFileStatus: "pending" | "ready" | null;
      storageKey: string;
      uploadRequestId: string | null;
      uploadedBy: string | null;
    }[] = [];
    for (const candidate of candidates) {
      if (referenced.has(candidate.id)) {
        skippedReferenced += 1;
        continue;
      }
      const privateFile = readPrivateFileRow(storage, candidate.id);
      if (!privateFile) {
        storage.sql.exec(
          `UPDATE music_track_import_file_attempts
           SET status = 'reclaimed', reclaimed_at = ? WHERE id = ?`,
          input.now,
          candidate.id,
        );
        continue;
      }
      storage.sql.exec(
        `UPDATE music_track_import_file_attempts
         SET status = 'cleanup_pending', cleanup_started_at = ? WHERE id = ?`,
        input.now,
        candidate.id,
      );
      claimed.push({
        fileId: candidate.id,
        privateFileStatus: privateFile.status === "ready" ? "ready" : "pending",
        storageKey: candidate.storageKey,
        uploadRequestId: privateFile.status === "ready" ? null : privateFile.requestId,
        uploadedBy: privateFile.status === "ready" ? null : privateFile.uploadedBy,
      });
    }
    if (skippedReferenced > 0) {
      storage.sql.exec(
        `UPDATE music_track_import_sessions SET last_failure_code = 'cleanup_referenced_file'
         WHERE id = ?`,
        session.id,
      );
      writeAudit(storage, {
        action: "music.track_import.cleanup.referenced_skipped",
        actorType: "organization_system",
        actorUserId: "system:scheduler",
        occurredAt: input.now,
        requestId: `cleanup:${session.id}`,
        summary: { skippedReferenced },
        targetId: session.id,
        targetType: "music_track_import_session",
      });
    }
    return {
      attempts: claimed,
      sessionId: session.id,
      skippedReferenced,
      state: session.state === "cancel_requested" ? "cleanup_pending" : session.state,
    };
  });
}

function findReferencedImportFiles(
  storage: MusicTrackImportStoreStorage,
  fileIds: readonly string[],
): Set<string> {
  const referenced = new Set<string>();
  if (fileIds.length === 0) return referenced;
  const placeholders = fileIds.map(() => "?").join(",");
  for (const row of storage.sql
    .exec<{ readonly photoFileId: string }>(
      `SELECT photo_file_id AS photoFileId FROM profiles WHERE photo_file_id IN (${placeholders})`,
      ...fileIds,
    )
    .toArray()) {
    referenced.add(row.photoFileId);
  }
  const trackRows = storage.sql
    .exec<{ readonly trackFileIdsJson: string }>(
      "SELECT track_file_ids_json AS trackFileIdsJson FROM music_pieces",
    )
    .toArray();
  const wanted = new Set(fileIds);
  const collectJsonValues = (json: string): void => {
    try {
      const parsed: unknown = JSON.parse(json);
      if (parsed && typeof parsed === "object") {
        for (const value of Object.values(parsed)) {
          if (typeof value === "string" && wanted.has(value)) referenced.add(value);
        }
      }
    } catch {
      // Malformed JSON never references an import file.
    }
  };
  for (const row of trackRows) collectJsonValues(row.trackFileIdsJson);
  for (const row of storage.sql
    .exec<{ readonly scoreFileIdsJson: string }>(
      "SELECT score_file_ids_json AS scoreFileIdsJson FROM music_pieces",
    )
    .toArray()) {
    collectJsonValues(row.scoreFileIdsJson);
  }
  for (const row of storage.sql
    .exec<{ readonly fileId: string }>(
      `SELECT hero_file_id AS fileId FROM public_website_settings WHERE hero_file_id IN (${placeholders})
       UNION SELECT logo_file_id FROM public_website_settings WHERE logo_file_id IN (${placeholders})
       UNION SELECT public_graphic_file_id FROM events WHERE public_graphic_file_id IN (${placeholders})
       UNION SELECT public_graphic_file_id FROM ticket_bundles WHERE public_graphic_file_id IN (${placeholders})
       UNION SELECT file_id AS fileId FROM organization_resources WHERE file_id IN (${placeholders})`,
      ...fileIds,
      ...fileIds,
      ...fileIds,
      ...fileIds,
      ...fileIds,
    )
    .toArray()) {
    referenced.add(row.fileId);
  }
  return referenced;
}

export interface CleanupCompleteResult {
  readonly orphanAlert: boolean;
  readonly remaining: number;
  readonly sessionId: string;
  readonly state: SessionState;
}

export function completeMusicTrackImportCleanupInStore(
  storage: MusicTrackImportStoreStorage,
  input: {
    readonly errorCode?: string | undefined;
    readonly fileIds: readonly string[];
    readonly now: string;
    readonly organizationId: string;
    readonly sessionId: string;
  },
): CleanupCompleteResult {
  assertOrganization(storage, input.organizationId);
  const nowMs = parseNow(input.now);
  void nowMs;
  assertUuid(input.sessionId, "session");

  return storage.transactionSync(() => {
    const session = readSession(storage, input.sessionId);
    if (!session) {
      throw new MusicTrackImportStoreError("session_not_found", "Import session not found.");
    }
    for (const chunk of chunkMusicTrackImport([...input.fileIds], 50)) {
      if (chunk.length === 0) continue;
      storage.sql.exec(
        `UPDATE music_track_import_file_attempts
         SET status = 'reclaimed', reclaimed_at = ?
         WHERE session_id = ? AND status = 'cleanup_pending'
           AND id IN (${chunk.map(() => "?").join(",")})`,
        input.now,
        session.id,
        ...chunk,
      );
    }
    if (input.errorCode) {
      storage.sql.exec(
        `UPDATE music_track_import_sessions SET last_failure_code = ? WHERE id = ?`,
        input.errorCode,
        session.id,
      );
    }
    const remaining =
      storage.sql
        .exec<{ readonly count: number }>(
          `SELECT COUNT(*) AS count FROM music_track_import_file_attempts a
           JOIN music_track_import_items i ON i.id = a.item_id
           WHERE a.session_id = ? AND a.status != 'reclaimed'
             AND NOT (i.status = 'attached' AND i.current_file_id = a.id)`,
          session.id,
        )
        .toArray()
        .at(0)?.count ?? 0;
    const orphanAlert =
      (storage.sql
        .exec<{ readonly count: number }>(
          `SELECT COUNT(*) AS count FROM music_track_import_file_attempts
           WHERE session_id = ? AND status = 'cleanup_pending'
             AND cleanup_started_at <= ?`,
          session.id,
          new Date(parseNow(input.now) - 24 * 60 * 60 * 1000).toISOString(),
        )
        .toArray()
        .at(0)?.count ?? 0) > 0;
    if (orphanAlert) {
      writeAudit(storage, {
        action: "music.track_import.cleanup.orphan",
        actorType: "organization_system",
        actorUserId: "system:scheduler",
        occurredAt: input.now,
        requestId: `cleanup:${session.id}`,
        summary: { remaining },
        targetId: session.id,
        targetType: "music_track_import_session",
      });
    }
    let nextState = session.state;
    if (remaining === 0 && CLEANUP_ELIGIBLE_STATES.includes(session.state)) {
      nextState = session.state === "expired" ? "expired" : "discarded";
      storage.sql.exec(
        `UPDATE music_track_import_sessions
         SET state = ?, closed_at = ?, next_cleanup_due_at = NULL WHERE id = ?`,
        nextState,
        input.now,
        session.id,
      );
      if (session.state !== "expired") {
        writeAudit(storage, {
          action: "music.track_import.session.discarded",
          actorType: "organization_system",
          actorUserId: "system:scheduler",
          occurredAt: input.now,
          requestId: `cleanup:${session.id}`,
          summary: { closed: true },
          targetId: session.id,
          targetType: "music_track_import_session",
        });
      }
    }
    return { orphanAlert, remaining, sessionId: session.id, state: nextState };
  });
}

export function scheduleMusicTrackImportCleanupContinuationInStore(
  storage: MusicTrackImportStoreStorage,
  input: {
    readonly now: string;
    readonly organizationId: string;
    readonly sessionId: string;
  },
): { readonly idempotencyKey: string; readonly jobId: string; readonly sessionId: string } {
  assertOrganization(storage, input.organizationId);
  parseNow(input.now);
  assertUuid(input.sessionId, "session");

  return storage.transactionSync(() => {
    const session = readSession(storage, input.sessionId);
    if (!session) {
      throw new MusicTrackImportStoreError("session_not_found", "Import session not found.");
    }
    const round = session.cleanupRound + 1;
    const jobId = crypto.randomUUID();
    const idempotencyKey = `music-track-import-cleanup:${input.organizationId}:${session.id}:round:${String(round)}`;
    storage.sql.exec(
      `INSERT OR IGNORE INTO scheduled_job_outbox
        (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'music_track_import_cleanup', ?, ?, ?)`,
      jobId,
      idempotencyKey,
      input.now,
      input.now,
    );
    storage.sql.exec(
      `UPDATE music_track_import_sessions
       SET cleanup_round = ?, next_cleanup_due_at = ? WHERE id = ?`,
      round,
      input.now,
      session.id,
    );
    return { idempotencyKey, jobId, sessionId: session.id };
  });
}
