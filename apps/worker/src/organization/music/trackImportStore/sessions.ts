import {
  MUSIC_TRACK_IMPORT_ABSOLUTE_EXPIRY_SECONDS,
  MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS,
  MUSIC_TRACK_IMPORT_MAX_ITEMS,
  chunkMusicTrackImport,
} from "@choir/domain";
import type { MusicTrackImportItemStatus, MusicTrackImportManifestItem } from "@choir/contracts";
import {
  assertOrganization,
  assertUuid,
  configuredTrackPartKeys,
  isExpired,
  MusicTrackImportStoreError,
  parseNow,
  readAttempts,
  readItems,
  readPieceSlots,
  readSession,
  readSessionForActor,
  SHA256_PATTERN,
  summarizeItems,
  TERMINAL_SESSION_STATES,
  toItemView,
  toSummaryView,
  writeAudit,
  type AttemptRow,
  type MusicTrackImportStoreStorage,
  type SessionDetailView,
  type SessionRow,
  type SessionSummaryView,
} from "./shared";

export interface CreateSessionResult extends SessionSummaryView {
  readonly items: readonly {
    readonly clientFileId: string;
    readonly status: MusicTrackImportItemStatus;
  }[];
}

export function createMusicTrackImportSessionInStore(
  storage: MusicTrackImportStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly clientBatchKey: string;
    readonly items: readonly MusicTrackImportManifestItem[];
    readonly manifestDigest: string;
    readonly now: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
): CreateSessionResult {
  assertUuid(input.clientBatchKey, "client batch key");
  if (!input.actorUserId) {
    throw new MusicTrackImportStoreError("validation_failed", "Actor is required.");
  }
  if (!SHA256_PATTERN.test(input.manifestDigest)) {
    throw new MusicTrackImportStoreError("validation_failed", "Invalid manifest digest.");
  }
  if (input.items.length === 0 || input.items.length > MUSIC_TRACK_IMPORT_MAX_ITEMS) {
    throw new MusicTrackImportStoreError("validation_failed", "Invalid manifest size.");
  }
  const nowMs = parseNow(input.now);
  assertOrganization(storage, input.organizationId);

  return storage.transactionSync(() => {
    const existing = storage.sql
      .exec<SessionRow>(
        `SELECT id, actor_user_id AS actorUserId, client_batch_key AS clientBatchKey,
                manifest_digest AS manifestDigest, state, manifest_revision AS manifestRevision,
                cleanup_round AS cleanupRound, created_at AS createdAt,
                last_user_action_at AS lastUserActionAt, expires_at AS expiresAt,
                absolute_expires_at AS absoluteExpiresAt, closed_at AS closedAt,
                next_cleanup_due_at AS nextCleanupDueAt, last_failure_code AS lastFailureCode
         FROM music_track_import_sessions
         WHERE actor_user_id = ? AND client_batch_key = ?`,
        input.actorUserId,
        input.clientBatchKey,
      )
      .toArray()
      .at(0);
    if (existing) {
      if (existing.manifestDigest !== input.manifestDigest) {
        throw new MusicTrackImportStoreError(
          "idempotency_conflict",
          "This import batch was already created with different files.",
        );
      }
      const sessionId = existing.id;
      const session = readSession(storage, sessionId);
      if (!session) {
        throw new MusicTrackImportStoreError("session_not_found", "Import session not found.");
      }
      if (TERMINAL_SESSION_STATES.includes(session.state) || isExpired(session, input.now)) {
        throw new MusicTrackImportStoreError(
          "idempotency_conflict",
          "This import batch was already used and cannot be reopened.",
        );
      }
      const items = readItems(storage, sessionId);
      const attempts = readAttempts(storage, sessionId);
      const attemptsByItem = new Map<string, AttemptRow[]>();
      for (const attempt of attempts) {
        const list = attemptsByItem.get(attempt.itemId) ?? [];
        list.push(attempt);
        attemptsByItem.set(attempt.itemId, list);
      }
      const counts = summarizeItems(items);
      return {
        ...toSummaryView(session, counts),
        items: items
          .map((item) => toItemView(item, attemptsByItem))
          .map((view) => ({
            clientFileId: view.clientFileId,
            status: view.status,
          })),
      };
    }

    const partKeys = configuredTrackPartKeys(storage);
    for (const item of input.items) {
      if (!partKeys.has(item.partKey)) {
        throw new MusicTrackImportStoreError(
          "validation_failed",
          `Part ${item.partKey} is not configured for this Organization.`,
        );
      }
    }
    const { slots } = readPieceSlots(
      storage,
      input.items.map((item) => item.pieceId),
    );

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(nowMs + MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS * 1000).toISOString();
    const absoluteExpiresAt = new Date(
      nowMs + MUSIC_TRACK_IMPORT_ABSOLUTE_EXPIRY_SECONDS * 1000,
    ).toISOString();
    storage.sql.exec(
      `INSERT INTO music_track_import_sessions
        (id, actor_user_id, client_batch_key, manifest_digest, state, manifest_revision,
         cleanup_round, created_at, last_user_action_at, expires_at, absolute_expires_at,
         closed_at, next_cleanup_due_at, last_failure_code)
       VALUES (?, ?, ?, ?, 'active', 1, 0, ?, ?, ?, ?, NULL, NULL, NULL)`,
      sessionId,
      input.actorUserId,
      input.clientBatchKey,
      input.manifestDigest,
      input.now,
      input.now,
      expiresAt,
      absoluteExpiresAt,
    );
    const perItemStatus: { clientFileId: string; status: MusicTrackImportItemStatus }[] = [];
    for (const item of input.items) {
      const occupied = slots.get(item.pieceId)?.get(item.partKey);
      const status: MusicTrackImportItemStatus = occupied ? "conflict" : "planned";
      storage.sql.exec(
        `INSERT INTO music_track_import_items
          (id, session_id, client_file_id, file_name, size_bytes, last_modified_ms, sha256_hex,
           content_type, piece_id, part_key, duration_seconds, status, current_attempt_id,
           current_file_id, error_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
        crypto.randomUUID(),
        sessionId,
        item.clientFileId,
        item.fileName,
        item.sizeBytes,
        item.lastModifiedMs,
        item.sha256Hex,
        item.contentType,
        item.pieceId,
        item.partKey,
        item.durationSeconds,
        status,
        occupied ? "slot_occupied" : null,
        input.now,
        input.now,
      );
      perItemStatus.push({ clientFileId: item.clientFileId, status });
    }
    writeAudit(storage, {
      action: "music.track_import.session.created",
      actorType: "organization_member",
      actorUserId: input.actorUserId,
      occurredAt: input.now,
      requestId: input.requestId,
      summary: { itemCount: input.items.length },
      targetId: sessionId,
      targetType: "music_track_import_session",
    });
    const created = readSession(storage, sessionId);
    if (!created) {
      throw new MusicTrackImportStoreError("session_not_found", "Import session not found.");
    }
    return {
      ...toSummaryView(created, summarizeItems(readItems(storage, sessionId))),
      items: perItemStatus,
    };
  });
}

export function listMusicTrackImportSessionsInStore(
  storage: MusicTrackImportStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly limit?: number | undefined;
    readonly now: string;
    readonly organizationId: string;
  },
): SessionSummaryView[] {
  assertOrganization(storage, input.organizationId);
  parseNow(input.now);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const rows = storage.sql
    .exec<SessionRow>(
      `SELECT id, actor_user_id AS actorUserId, client_batch_key AS clientBatchKey,
              manifest_digest AS manifestDigest, state, manifest_revision AS manifestRevision,
              cleanup_round AS cleanupRound, created_at AS createdAt,
              last_user_action_at AS lastUserActionAt, expires_at AS expiresAt,
              absolute_expires_at AS absoluteExpiresAt, closed_at AS closedAt,
              next_cleanup_due_at AS nextCleanupDueAt, last_failure_code AS lastFailureCode
       FROM music_track_import_sessions
       WHERE actor_user_id = ? AND state IN ('active', 'partial')
         AND expires_at > ? AND absolute_expires_at > ?
       ORDER BY last_user_action_at DESC LIMIT ?`,
      input.actorUserId,
      input.now,
      input.now,
      limit,
    )
    .toArray();
  if (rows.length === 0) return [];
  const groupedBySession = new Map<string, { readonly count: number; readonly status: string }[]>();
  for (const chunk of chunkMusicTrackImport(
    rows.map((row) => row.id),
    50,
  )) {
    const counts = storage.sql
      .exec<{ readonly sessionId: string; readonly status: string; readonly count: number }>(
        `SELECT session_id AS sessionId, status, COUNT(*) AS count
         FROM music_track_import_items WHERE session_id IN (${chunk.map(() => "?").join(",")})
         GROUP BY session_id, status`,
        ...chunk,
      )
      .toArray();
    for (const row of counts) {
      const list = groupedBySession.get(row.sessionId) ?? [];
      list.push(row);
      groupedBySession.set(row.sessionId, list);
    }
  }
  return rows.map((row) => toSummaryView(row, summarizeItems(groupedBySession.get(row.id) ?? [])));
}

export function getMusicTrackImportSessionInStore(
  storage: MusicTrackImportStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly sessionId: string;
  },
): SessionDetailView {
  assertOrganization(storage, input.organizationId);
  parseNow(input.now);
  const session = readSessionForActor(storage, input.sessionId, input.actorUserId);
  const items = readItems(storage, session.id);
  const attempts = readAttempts(storage, session.id);
  const attemptsByItem = new Map<string, AttemptRow[]>();
  for (const attempt of attempts) {
    const list = attemptsByItem.get(attempt.itemId) ?? [];
    list.push(attempt);
    attemptsByItem.set(attempt.itemId, list);
  }
  return {
    ...toSummaryView(session, summarizeItems(items)),
    items: items.map((item) => toItemView(item, attemptsByItem)),
  };
}
