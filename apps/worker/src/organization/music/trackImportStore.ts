/**
 * Durable session-backed bulk practice-track import ledger.
 *
 * Each Organization Durable Object owns its import sessions in four tables
 * (see schema v121): sessions, items, file attempts, and commit receipts.
 * Every function below is synchronous SQLite work only — no network, R2, or
 * queue I/O — so it stays inside the DO runtime boundary. R2 bytes move in
 * the Worker route/queue layer between `claim*` and `finalize*` calls, and
 * the only file mutations used here are the same `private_files` transitions
 * as the direct-upload pipeline (pending reservation, ready finalization,
 * pending cleanup claims, terminal deletes).
 *
 * Attempt IDs are private file UUIDs, so the attempt row and the
 * `private_files` row can never disagree about which object belongs to which
 * session. Detached file UUIDs are never minted by clients.
 */

import {
  MUSIC_TRACK_IMPORT_ABSOLUTE_EXPIRY_SECONDS,
  MUSIC_TRACK_IMPORT_CLEANUP_BATCH_SIZE,
  MUSIC_TRACK_IMPORT_CLEANUP_SWEEP_LIMIT,
  MUSIC_TRACK_IMPORT_COMMIT_CHUNK_SIZE,
  MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS,
  MUSIC_TRACK_IMPORT_MAX_ITEMS,
  chunkMusicTrackImport,
  isRecoverableImportSessionState,
} from "@choir/domain";
import {
  musicTrackImportCommitResponseSchema,
  musicTrackImportCommitResultSchema,
  organizationRosterConfigurationRequestSchema,
  type MusicTrackImportItemStatus,
  type MusicTrackImportManifestItem,
  type MusicTrackImportSessionState as SessionState,
} from "@choir/contracts";
import type { SqlStorageValue } from "@cloudflare/workers-types";

import { privateOrganizationUploadKey } from "../../storage/privateFiles";
import { enqueueAttachedLoudness } from "../loudnessStore";

export type MusicTrackImportStoreErrorCode =
  | "validation_failed"
  | "organization_identity_conflict"
  | "forbidden"
  | "session_not_found"
  | "session_expired"
  | "session_closed"
  | "idempotency_conflict"
  | "stale_revision"
  | "upload_in_progress"
  | "slot_conflict";

export class MusicTrackImportStoreError extends Error {
  readonly code: MusicTrackImportStoreErrorCode;

  constructor(code: MusicTrackImportStoreErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = "MusicTrackImportStoreError";
    this.code = code;
  }
}

export interface MusicTrackImportStoreStorage {
  readonly sql: {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: readonly unknown[]
    ): {
      toArray(): T[];
    };
  };
  transactionSync<T>(fn: () => T): T;
}

interface SessionRow extends Record<string, SqlStorageValue> {
  readonly absoluteExpiresAt: string;
  readonly actorUserId: string;
  readonly cleanupRound: number;
  readonly clientBatchKey: string;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly lastFailureCode: string | null;
  readonly lastUserActionAt: string;
  readonly manifestDigest: string;
  readonly manifestRevision: number;
  readonly nextCleanupDueAt: string | null;
  readonly state: SessionState;
}

interface ItemRow extends Record<string, SqlStorageValue> {
  readonly clientFileId: string;
  readonly contentType: string;
  readonly currentAttemptId: string | null;
  readonly currentFileId: string | null;
  readonly durationSeconds: number | null;
  readonly errorCode: string | null;
  readonly fileName: string;
  readonly id: string;
  readonly lastModifiedMs: number;
  readonly partKey: string;
  readonly pieceId: string;
  readonly sessionId: string;
  readonly sha256Hex: string;
  readonly sizeBytes: number;
  readonly status: MusicTrackImportItemStatus;
}

interface AttemptRow extends Record<string, SqlStorageValue> {
  readonly attemptNumber: number;
  readonly cleanupStartedAt: string | null;
  readonly createdAt: string;
  readonly id: string;
  readonly itemId: string;
  readonly leaseExpiresAt: string | null;
  readonly readyAt: string | null;
  readonly reclaimedAt: string | null;
  readonly sessionId: string;
  readonly status: string;
  readonly storageKey: string;
}

const TERMINAL_SESSION_STATES: readonly SessionState[] = ["completed", "discarded", "expired"];
const CLEANUP_ELIGIBLE_STATES: readonly SessionState[] = [
  "cancel_requested",
  "cleanup_pending",
  "expired",
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new MusicTrackImportStoreError("validation_failed", `Invalid ${field}.`);
  }
}

function assertOrganization(storage: MusicTrackImportStoreStorage, organizationId: string): void {
  if (!organizationId) {
    throw new MusicTrackImportStoreError(
      "organization_identity_conflict",
      "Organization identity mismatch.",
    );
  }
  const stored = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (stored !== organizationId) {
    throw new MusicTrackImportStoreError(
      "organization_identity_conflict",
      "Organization identity mismatch.",
    );
  }
}

function parseNow(now: string): number {
  const parsed = Date.parse(now);
  if (!Number.isFinite(parsed)) {
    throw new MusicTrackImportStoreError("validation_failed", "Invalid timestamp.");
  }
  return parsed;
}

function writeAudit(
  storage: MusicTrackImportStoreStorage,
  params: {
    readonly action: string;
    readonly actorType: "organization_member" | "organization_system";
    readonly actorUserId: string;
    readonly occurredAt: string;
    readonly requestId: string;
    readonly summary: unknown;
    readonly targetId: string;
    readonly targetType: string;
  },
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    params.actorType,
    params.actorUserId,
    params.action,
    params.targetType,
    params.targetId,
    params.requestId,
    JSON.stringify(params.summary),
    params.occurredAt,
  );
}

function readSession(
  storage: MusicTrackImportStoreStorage,
  sessionId: string,
): SessionRow | undefined {
  return storage.sql
    .exec<SessionRow>(
      `SELECT id, actor_user_id AS actorUserId, client_batch_key AS clientBatchKey,
              manifest_digest AS manifestDigest, state, manifest_revision AS manifestRevision,
              cleanup_round AS cleanupRound, created_at AS createdAt,
              last_user_action_at AS lastUserActionAt, expires_at AS expiresAt,
              absolute_expires_at AS absoluteExpiresAt, closed_at AS closedAt,
              next_cleanup_due_at AS nextCleanupDueAt, last_failure_code AS lastFailureCode
       FROM music_track_import_sessions WHERE id = ?`,
      sessionId,
    )
    .toArray()
    .at(0);
}

function readSessionForActor(
  storage: MusicTrackImportStoreStorage,
  sessionId: string,
  actorUserId: string,
): SessionRow {
  const session = readSession(storage, sessionId);
  // Unknown and unowned sessions share one error so session IDs cannot be probed.
  if (session?.actorUserId !== actorUserId) {
    throw new MusicTrackImportStoreError("session_not_found", "Import session not found.");
  }
  return session;
}

function isExpired(
  session: Pick<SessionRow, "expiresAt" | "absoluteExpiresAt">,
  now: string,
): boolean {
  return session.expiresAt <= now || session.absoluteExpiresAt <= now;
}

function requireLiveSession(session: SessionRow, now: string): void {
  if (isExpired(session, now)) {
    throw new MusicTrackImportStoreError("session_expired", "Import session has expired.");
  }
  if (!isRecoverableImportSessionState(session.state)) {
    throw new MusicTrackImportStoreError("session_closed", "Import session is no longer active.");
  }
}

function readItems(storage: MusicTrackImportStoreStorage, sessionId: string): ItemRow[] {
  return storage.sql
    .exec<ItemRow>(
      `SELECT id, session_id AS sessionId, client_file_id AS clientFileId, file_name AS fileName,
              size_bytes AS sizeBytes, last_modified_ms AS lastModifiedMs, sha256_hex AS sha256Hex,
              content_type AS contentType, piece_id AS pieceId, part_key AS partKey,
              duration_seconds AS durationSeconds, status, current_attempt_id AS currentAttemptId,
              current_file_id AS currentFileId, error_code AS errorCode,
              created_at AS createdAt, updated_at AS updatedAt
       FROM music_track_import_items WHERE session_id = ? ORDER BY client_file_id`,
      sessionId,
    )
    .toArray();
}

function readAttempts(storage: MusicTrackImportStoreStorage, sessionId: string): AttemptRow[] {
  return storage.sql
    .exec<AttemptRow>(
      `SELECT id, session_id AS sessionId, item_id AS itemId, attempt_number AS attemptNumber,
              storage_key AS storageKey, status, lease_expires_at AS leaseExpiresAt,
              created_at AS createdAt, ready_at AS readyAt,
              cleanup_started_at AS cleanupStartedAt, reclaimed_at AS reclaimedAt
       FROM music_track_import_file_attempts WHERE session_id = ? ORDER BY attempt_number`,
      sessionId,
    )
    .toArray();
}

function configuredTrackPartKeys(storage: MusicTrackImportStoreStorage): Set<string> {
  const raw = storage.sql
    .exec<{ readonly configuration: string }>(
      "SELECT roster_configuration_json AS configuration FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.configuration;
  if (!raw) {
    throw new MusicTrackImportStoreError(
      "validation_failed",
      "Roster configuration is unavailable.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MusicTrackImportStoreError(
      "validation_failed",
      "Roster configuration is unavailable.",
    );
  }
  const result = organizationRosterConfigurationRequestSchema.safeParse(parsed);
  if (!result.success) {
    throw new MusicTrackImportStoreError(
      "validation_failed",
      "Roster configuration is unavailable.",
    );
  }
  return new Set([
    "tutti",
    "accompaniment",
    ...result.data.sections.map((section) => section.code),
    ...result.data.voiceParts.map((part) => part.label),
  ]);
}

interface PieceSlotMap {
  readonly durations: Map<string, number | null>;
  readonly slots: Map<string, Map<string, string>>;
}

function readPieceSlots(
  storage: MusicTrackImportStoreStorage,
  pieceIds: readonly string[],
): PieceSlotMap {
  const slots = new Map<string, Map<string, string>>();
  const durations = new Map<string, number | null>();
  for (const chunk of chunkMusicTrackImport([...new Set(pieceIds)], 50)) {
    if (chunk.length === 0) continue;
    const rows = storage.sql
      .exec<{
        readonly durationSeconds: number | null;
        readonly id: string;
        readonly trackFileIdsJson: string;
      }>(
        `SELECT id, track_file_ids_json AS trackFileIdsJson, duration_seconds AS durationSeconds
         FROM music_pieces WHERE id IN (${chunk.map(() => "?").join(",")})`,
        ...chunk,
      )
      .toArray();
    const found = new Set(rows.map((row) => row.id));
    for (const pieceId of chunk) {
      if (!found.has(pieceId)) {
        throw new MusicTrackImportStoreError("validation_failed", "Music piece not found.");
      }
    }
    for (const row of rows) {
      const slotMap = new Map<string, string>();
      try {
        const parsed = JSON.parse(row.trackFileIdsJson) as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          for (const [partKey, fileId] of Object.entries(parsed)) {
            if (typeof fileId === "string" && fileId.length > 0) slotMap.set(partKey, fileId);
          }
        }
      } catch {
        // Malformed JSON never references an import file.
      }
      slots.set(row.id, slotMap);
      durations.set(row.id, row.durationSeconds);
    }
  }
  return { durations, slots };
}

export interface SessionItemView {
  readonly attempts: readonly {
    readonly attemptNumber: number;
    readonly fileId: string;
    readonly leaseExpiresAt: string | null;
    readonly status: string;
  }[];
  readonly clientFileId: string;
  readonly contentType: string;
  readonly currentFileId: string | null;
  readonly durationSeconds: number | null;
  readonly errorCode: string | null;
  readonly fileName: string;
  readonly partKey: string;
  readonly pieceId: string;
  readonly sha256Hex: string;
  readonly sizeBytes: number;
  readonly status: MusicTrackImportItemStatus;
}

export interface SessionSummaryCounts {
  readonly attachFailed: number;
  readonly attached: number;
  readonly cleanupPending: number;
  readonly conflict: number;
  readonly planned: number;
  readonly reclaimed: number;
  readonly total: number;
  readonly uploadFailed: number;
  readonly uploaded: number;
  readonly uploading: number;
}

export interface SessionSummaryView {
  readonly absoluteExpiresAt: string;
  readonly clientBatchKey: string;
  readonly closedAt: string | null;
  readonly counts: SessionSummaryCounts;
  readonly expiresAt: string;
  readonly lastFailureCode: string | null;
  readonly manifestRevision: number;
  readonly sessionId: string;
  readonly state: SessionState;
}

function summarizeItems(items: readonly ItemRow[]): SessionSummaryCounts {
  let planned = 0;
  let uploading = 0;
  let uploaded = 0;
  let attached = 0;
  let uploadFailed = 0;
  let attachFailed = 0;
  let conflict = 0;
  let cleanupPending = 0;
  let reclaimed = 0;
  for (const item of items) {
    switch (item.status) {
      case "planned":
        planned += 1;
        break;
      case "uploading":
        uploading += 1;
        break;
      case "uploaded":
        uploaded += 1;
        break;
      case "attached":
        attached += 1;
        break;
      case "upload_failed":
        uploadFailed += 1;
        break;
      case "attach_failed":
        attachFailed += 1;
        break;
      case "conflict":
        conflict += 1;
        break;
      case "cleanup_pending":
        cleanupPending += 1;
        break;
      case "reclaimed":
        reclaimed += 1;
        break;
    }
  }
  return {
    attachFailed,
    attached,
    cleanupPending,
    conflict,
    planned,
    reclaimed,
    total: items.length,
    uploadFailed,
    uploaded,
    uploading,
  };
}

function toItemView(
  item: ItemRow,
  attemptsByItem: ReadonlyMap<string, AttemptRow[]>,
): SessionItemView {
  const attempts = (attemptsByItem.get(item.id) ?? []).map((attempt) => ({
    attemptNumber: attempt.attemptNumber,
    fileId: attempt.id,
    leaseExpiresAt: attempt.leaseExpiresAt,
    status: attempt.status,
  }));
  return {
    attempts,
    clientFileId: item.clientFileId,
    contentType: item.contentType,
    currentFileId: item.currentFileId,
    durationSeconds: item.durationSeconds,
    errorCode: item.errorCode,
    fileName: item.fileName,
    partKey: item.partKey,
    pieceId: item.pieceId,
    sha256Hex: item.sha256Hex,
    sizeBytes: item.sizeBytes,
    status: item.status,
  };
}

function toSummaryView(session: SessionRow, counts: SessionSummaryCounts): SessionSummaryView {
  return {
    absoluteExpiresAt: session.absoluteExpiresAt,
    clientBatchKey: session.clientBatchKey,
    closedAt: session.closedAt,
    counts,
    expiresAt: session.expiresAt,
    lastFailureCode: session.lastFailureCode,
    manifestRevision: session.manifestRevision,
    sessionId: session.id,
    state: session.state,
  };
}

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
  const countsBySession = new Map<string, SessionSummaryCounts>();
  const statusCountsBySession = new Map<
    string,
    {
      planned: number;
      uploading: number;
      uploaded: number;
      attached: number;
      uploadFailed: number;
      attachFailed: number;
      conflict: number;
      cleanupPending: number;
      reclaimed: number;
      total: number;
    }
  >();
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
      const entry = statusCountsBySession.get(row.sessionId) ?? {
        attachFailed: 0,
        attached: 0,
        cleanupPending: 0,
        conflict: 0,
        planned: 0,
        reclaimed: 0,
        total: 0,
        uploadFailed: 0,
        uploaded: 0,
        uploading: 0,
      };
      entry.total += row.count;
      switch (row.status) {
        case "planned":
          entry.planned += row.count;
          break;
        case "uploading":
          entry.uploading += row.count;
          break;
        case "uploaded":
          entry.uploaded += row.count;
          break;
        case "attached":
          entry.attached += row.count;
          break;
        case "upload_failed":
          entry.uploadFailed += row.count;
          break;
        case "attach_failed":
          entry.attachFailed += row.count;
          break;
        case "conflict":
          entry.conflict += row.count;
          break;
        case "cleanup_pending":
          entry.cleanupPending += row.count;
          break;
        case "reclaimed":
          entry.reclaimed += row.count;
          break;
        default:
          break;
      }
      statusCountsBySession.set(row.sessionId, entry);
      countsBySession.set(row.sessionId, { ...entry });
    }
  }
  return rows.map((row) =>
    toSummaryView(
      row,
      countsBySession.get(row.id) ?? {
        attachFailed: 0,
        attached: 0,
        cleanupPending: 0,
        conflict: 0,
        planned: 0,
        reclaimed: 0,
        total: 0,
        uploadFailed: 0,
        uploaded: 0,
        uploading: 0,
      },
    ),
  );
}

export interface SessionDetailView extends SessionSummaryView {
  readonly items: readonly SessionItemView[];
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

const UPLOADABLE_ITEM_STATUSES: readonly MusicTrackImportItemStatus[] = [
  "planned",
  "uploading",
  "upload_failed",
  "attach_failed",
];

function touchSession(
  storage: MusicTrackImportStoreStorage,
  sessionId: string,
  now: string,
  nowMs: number,
): void {
  storage.sql.exec(
    `UPDATE music_track_import_sessions
     SET last_user_action_at = ?, expires_at = ? WHERE id = ?`,
    now,
    new Date(nowMs + MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS * 1000).toISOString(),
    sessionId,
  );
}

function readItemByClientFileId(
  storage: MusicTrackImportStoreStorage,
  sessionId: string,
  clientFileId: string,
): ItemRow {
  const item = storage.sql
    .exec<ItemRow>(
      `SELECT id, session_id AS sessionId, client_file_id AS clientFileId, file_name AS fileName,
              size_bytes AS sizeBytes, last_modified_ms AS lastModifiedMs, sha256_hex AS sha256Hex,
              content_type AS contentType, piece_id AS pieceId, part_key AS partKey,
              duration_seconds AS durationSeconds, status, current_attempt_id AS currentAttemptId,
              current_file_id AS currentFileId, error_code AS errorCode,
              created_at AS createdAt, updated_at AS updatedAt
       FROM music_track_import_items WHERE session_id = ? AND client_file_id = ?`,
      sessionId,
      clientFileId,
    )
    .toArray()
    .at(0);
  if (!item) {
    throw new MusicTrackImportStoreError("validation_failed", "Manifest row not found.");
  }
  return item;
}

function readAttemptsForItem(
  storage: MusicTrackImportStoreStorage,
  sessionId: string,
  itemId: string,
): AttemptRow[] {
  return storage.sql
    .exec<AttemptRow>(
      `SELECT id, session_id AS sessionId, item_id AS itemId, attempt_number AS attemptNumber,
              storage_key AS storageKey, status, lease_expires_at AS leaseExpiresAt,
              created_at AS createdAt, ready_at AS readyAt,
              cleanup_started_at AS cleanupStartedAt, reclaimed_at AS reclaimedAt
       FROM music_track_import_file_attempts
       WHERE session_id = ? AND item_id = ? ORDER BY attempt_number`,
      sessionId,
      itemId,
    )
    .toArray();
}

function readPrivateFileRow(
  storage: MusicTrackImportStoreStorage,
  fileId: string,
):
  | {
      readonly requestId: string;
      readonly status: string;
      readonly storageKey: string;
      readonly uploadedBy: string;
    }
  | undefined {
  return storage.sql
    .exec<{
      readonly requestId: string;
      readonly status: string;
      readonly storageKey: string;
      readonly uploadedBy: string;
    }>(
      `SELECT status, storage_key AS storageKey, uploaded_by AS uploadedBy, request_id AS requestId
       FROM private_files WHERE id = ?`,
      fileId,
    )
    .toArray()
    .at(0);
}

function readPrivateFileStatus(
  storage: MusicTrackImportStoreStorage,
  fileId: string,
): { readonly status: string; readonly storageKey: string } | undefined {
  const row = readPrivateFileRow(storage, fileId);
  return row ? { status: row.status, storageKey: row.storageKey } : undefined;
}

export interface UploadClaimResult {
  readonly alreadyUploaded: boolean;
  readonly fileId: string;
  readonly leaseExpiresAt: string;
  readonly storageKey: string;
  readonly superseded: { readonly fileId: string; readonly storageKey: string } | null;
}

interface ClaimInput {
  readonly actorUserId: string;
  readonly clientFileId: string;
  readonly contentType: string;
  readonly expectedSizeBytes: number;
  readonly fileName: string;
  readonly now: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly sessionId: string;
}

function loadUploadableItem(
  storage: MusicTrackImportStoreStorage,
  session: SessionRow,
  input: ClaimInput,
): ItemRow {
  const item = readItemByClientFileId(storage, session.id, input.clientFileId);
  if (item.status === "attached") {
    throw new MusicTrackImportStoreError("validation_failed", "Track is already attached.");
  }
  if (item.status === "conflict") {
    throw new MusicTrackImportStoreError("slot_conflict", "Destination slot is occupied.");
  }
  if (item.status !== "uploaded" && !UPLOADABLE_ITEM_STATUSES.includes(item.status)) {
    throw new MusicTrackImportStoreError("session_closed", "Manifest row is closed.");
  }
  if (input.expectedSizeBytes !== item.sizeBytes) {
    throw new MusicTrackImportStoreError(
      "validation_failed",
      "Upload size does not match the reviewed manifest row.",
    );
  }
  if (input.fileName !== item.fileName) {
    throw new MusicTrackImportStoreError(
      "validation_failed",
      "Upload file name does not match the reviewed manifest row.",
    );
  }
  return item;
}

/** Marks the row conflict when another track occupies the slot. Returns true when marked. */
function markUploadSlotConflict(
  storage: MusicTrackImportStoreStorage,
  item: ItemRow,
  now: string,
): boolean {
  const { slots } = readPieceSlots(storage, [item.pieceId]);
  const occupied = slots.get(item.pieceId)?.get(item.partKey);
  if (!occupied || occupied === item.currentFileId) return false;
  storage.sql.exec(
    `UPDATE music_track_import_items
     SET status = 'conflict', error_code = 'slot_occupied', updated_at = ?
     WHERE id = ?`,
    now,
    item.id,
  );
  // Committed by the surrounding transaction; the caller converts this
  // marker into a 409 after the transaction commits so the conflict
  // marking is not rolled back by the throw.
  return true;
}

function markItemUploaded(
  storage: MusicTrackImportStoreStorage,
  item: ItemRow,
  attempt: AttemptRow,
  now: string,
): void {
  storage.sql.exec(
    `UPDATE music_track_import_items
     SET status = 'uploaded', current_attempt_id = ?, current_file_id = ?, error_code = NULL, updated_at = ?
     WHERE id = ?`,
    attempt.id,
    attempt.id,
    now,
    item.id,
  );
}

function findReplayableAttempt(
  storage: MusicTrackImportStoreStorage,
  attempts: readonly AttemptRow[],
): AttemptRow | null {
  for (const attempt of attempts) {
    if (
      attempt.status !== "ready" &&
      attempt.status !== "reserved" &&
      attempt.status !== "uploading"
    ) {
      continue;
    }
    if (readPrivateFileStatus(storage, attempt.id)?.status === "ready") {
      return attempt;
    }
  }
  return null;
}

function requireNoLiveAttempt(attempts: readonly AttemptRow[], now: string): void {
  const live = attempts.find(
    (attempt) =>
      (attempt.status === "reserved" || attempt.status === "uploading") &&
      attempt.leaseExpiresAt !== null &&
      attempt.leaseExpiresAt > now,
  );
  if (live) {
    throw new MusicTrackImportStoreError(
      "upload_in_progress",
      "An upload attempt is already in progress for this file.",
    );
  }
}

function recycleStaleAttempts(
  storage: MusicTrackImportStoreStorage,
  attempts: readonly AttemptRow[],
): { readonly fileId: string; readonly storageKey: string } | null {
  let superseded: { readonly fileId: string; readonly storageKey: string } | null = null;
  for (const attempt of attempts) {
    if (attempt.status !== "reserved" && attempt.status !== "uploading") continue;
    if (readPrivateFileStatus(storage, attempt.id)) {
      storage.sql.exec("DELETE FROM private_files WHERE id = ? AND status = 'pending'", attempt.id);
      superseded = { fileId: attempt.id, storageKey: attempt.storageKey };
    }
    storage.sql.exec(
      `UPDATE music_track_import_file_attempts SET status = 'failed' WHERE id = ?`,
      attempt.id,
    );
  }
  return superseded;
}

function recordReadyAttempt(
  storage: MusicTrackImportStoreStorage,
  attempt: AttemptRow,
  now: string,
): void {
  storage.sql.exec(
    `UPDATE music_track_import_file_attempts SET status = 'ready', ready_at = COALESCE(ready_at, ?)
     WHERE id = ?`,
    now,
    attempt.id,
  );
}

function allocateUploadAttempt(
  storage: MusicTrackImportStoreStorage,
  session: SessionRow,
  item: ItemRow,
  input: ClaimInput,
  nowMs: number,
  superseded: { readonly fileId: string; readonly storageKey: string } | null,
): UploadClaimResult {
  const attempts = readAttemptsForItem(storage, session.id, item.id);
  const fileId = crypto.randomUUID();
  const storageKey = privateOrganizationUploadKey(
    input.organizationId,
    fileId,
    item.fileName,
    "audio/mpeg",
  );
  const leaseExpiresAt = new Date(nowMs + 15 * 60 * 1000).toISOString();
  const attemptNumber =
    attempts.reduce((max, attempt) => Math.max(max, attempt.attemptNumber), 0) + 1;
  storage.sql.exec(
    `INSERT INTO private_files
      (id, storage_key, file_name, content_type, size_bytes, status,
       uploaded_by, request_id, created_at)
     VALUES (?, ?, ?, 'audio/mpeg', ?, 'pending', ?, ?, ?)`,
    fileId,
    storageKey,
    item.fileName,
    item.sizeBytes,
    input.actorUserId,
    input.requestId,
    input.now,
  );
  storage.sql.exec(
    `INSERT INTO music_track_import_file_attempts
      (id, session_id, item_id, attempt_number, storage_key, status, lease_expires_at,
       created_at, ready_at, cleanup_started_at, reclaimed_at)
     VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?, NULL, NULL, NULL)`,
    fileId,
    session.id,
    item.id,
    attemptNumber,
    storageKey,
    leaseExpiresAt,
    input.now,
  );
  storage.sql.exec(
    `UPDATE music_track_import_items
     SET status = 'uploading', current_attempt_id = ?, current_file_id = ?, error_code = NULL, updated_at = ?
     WHERE id = ?`,
    fileId,
    fileId,
    input.now,
    item.id,
  );
  touchSession(storage, session.id, input.now, nowMs);
  return { alreadyUploaded: false, fileId, leaseExpiresAt, storageKey, superseded };
}

export function claimMusicTrackImportUploadInStore(
  storage: MusicTrackImportStoreStorage,
  input: ClaimInput,
): UploadClaimResult {
  assertOrganization(storage, input.organizationId);
  const nowMs = parseNow(input.now);
  assertUuid(input.sessionId, "session");
  if (!input.actorUserId) {
    throw new MusicTrackImportStoreError("validation_failed", "Actor is required.");
  }
  if (input.contentType !== "audio/mpeg") {
    throw new MusicTrackImportStoreError("validation_failed", "Only MP3 uploads are accepted.");
  }

  const claimed = storage.transactionSync(() => {
    const session = readSessionForActor(storage, input.sessionId, input.actorUserId);
    requireLiveSession(session, input.now);
    const item = loadUploadableItem(storage, session, input);
    if (markUploadSlotConflict(storage, item, input.now)) {
      return { conflicted: true as const };
    }

    const attempts = readAttemptsForItem(storage, session.id, item.id);
    const replayable = findReplayableAttempt(storage, attempts);
    if (replayable) {
      if (replayable.status !== "ready") {
        recordReadyAttempt(storage, replayable, input.now);
      }
      markItemUploaded(storage, item, replayable, input.now);
      touchSession(storage, session.id, input.now, nowMs);
      return {
        alreadyUploaded: true as const,
        fileId: replayable.id,
        leaseExpiresAt: replayable.leaseExpiresAt ?? input.now,
        storageKey: replayable.storageKey,
      };
    }
    requireNoLiveAttempt(attempts, input.now);
    const superseded = recycleStaleAttempts(storage, attempts);
    return allocateUploadAttempt(storage, session, item, input, nowMs, superseded);
  });
  if ("conflicted" in claimed) {
    throw new MusicTrackImportStoreError("slot_conflict", "Destination slot is occupied.");
  }
  if (claimed.alreadyUploaded) {
    return { ...claimed, superseded: null };
  }
  return claimed;
}

export function finalizeMusicTrackImportUploadInStore(
  storage: MusicTrackImportStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly clientFileId: string;
    readonly fileId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly receivedSizeBytes: number;
    readonly r2Version?: string | null | undefined;
    readonly requestId: string;
    readonly sessionId: string;
  },
): { readonly fileId: string; readonly status: "uploaded" } {
  assertOrganization(storage, input.organizationId);
  const nowMs = parseNow(input.now);
  assertUuid(input.sessionId, "session");
  assertUuid(input.fileId, "file");

  return storage.transactionSync(() => {
    const session = readSessionForActor(storage, input.sessionId, input.actorUserId);
    requireLiveSession(session, input.now);
    const item = readItemByClientFileId(storage, session.id, input.clientFileId);
    if (item.currentFileId !== input.fileId) {
      throw new MusicTrackImportStoreError(
        "validation_failed",
        "Upload does not match the active attempt.",
      );
    }
    if (input.receivedSizeBytes !== item.sizeBytes) {
      throw new MusicTrackImportStoreError(
        "validation_failed",
        "Uploaded bytes do not match the reviewed manifest row.",
      );
    }
    const attempt = readAttemptsForItem(storage, session.id, item.id).find(
      (candidate) => candidate.id === input.fileId,
    );
    if (!attempt || (attempt.status !== "reserved" && attempt.status !== "uploading")) {
      throw new MusicTrackImportStoreError(
        "validation_failed",
        "Upload attempt is no longer active.",
      );
    }
    if (attempt.leaseExpiresAt !== null && attempt.leaseExpiresAt <= input.now) {
      throw new MusicTrackImportStoreError(
        "validation_failed",
        "Upload lease expired before the upload finished.",
      );
    }
    const updated = storage.sql.exec(
      `UPDATE private_files SET status = 'ready', ready_at = ?, r2_version = ?
       WHERE id = ? AND status = 'pending'`,
      input.now,
      input.r2Version ?? null,
      input.fileId,
    );
    void updated;
    const privateFile = readPrivateFileStatus(storage, input.fileId);
    if (privateFile?.status !== "ready") {
      throw new MusicTrackImportStoreError(
        "validation_failed",
        "Upload attempt is no longer active.",
      );
    }
    writeAudit(storage, {
      action: "organization.file.uploaded",
      actorType: "organization_member",
      actorUserId: input.actorUserId,
      occurredAt: input.now,
      requestId: input.requestId,
      summary: { fileId: input.fileId, importSessionId: session.id },
      targetId: input.fileId,
      targetType: "private_file",
    });
    storage.sql.exec(
      `UPDATE music_track_import_file_attempts SET status = 'ready', ready_at = ? WHERE id = ?`,
      input.now,
      input.fileId,
    );
    storage.sql.exec(
      `UPDATE music_track_import_items
       SET status = 'uploaded', error_code = NULL, updated_at = ? WHERE id = ?`,
      input.now,
      item.id,
    );
    touchSession(storage, session.id, input.now, nowMs);
    return { fileId: input.fileId, status: "uploaded" as const };
  });
}

export function failMusicTrackImportUploadInStore(
  storage: MusicTrackImportStoreStorage,
  input: {
    readonly actorUserId: string;
    readonly clientFileId: string;
    readonly errorCode: string;
    readonly fileId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly sessionId: string;
  },
): { readonly superseded: { readonly fileId: string; readonly storageKey: string } | null } {
  assertOrganization(storage, input.organizationId);
  const nowMs = parseNow(input.now);

  return storage.transactionSync(() => {
    const session = readSessionForActor(storage, input.sessionId, input.actorUserId);
    const item = readItemByClientFileId(storage, session.id, input.clientFileId);
    const attempt = readAttemptsForItem(storage, session.id, item.id).find(
      (candidate) => candidate.id === input.fileId,
    );
    if (!attempt) {
      throw new MusicTrackImportStoreError("validation_failed", "Upload attempt not found.");
    }
    let superseded: { readonly fileId: string; readonly storageKey: string } | null = null;
    if (attempt.status === "reserved" || attempt.status === "uploading") {
      const privateFile = readPrivateFileStatus(storage, attempt.id);
      if (privateFile && privateFile.status !== "ready") {
        storage.sql.exec(
          "DELETE FROM private_files WHERE id = ? AND status = 'pending'",
          attempt.id,
        );
        superseded = { fileId: attempt.id, storageKey: attempt.storageKey };
      }
      storage.sql.exec(
        `UPDATE music_track_import_file_attempts SET status = 'failed' WHERE id = ?`,
        attempt.id,
      );
    }
    if (item.currentAttemptId === attempt.id) {
      storage.sql.exec(
        `UPDATE music_track_import_items
         SET status = 'upload_failed', error_code = ?, updated_at = ? WHERE id = ?`,
        input.errorCode,
        input.now,
        item.id,
      );
    }
    writeAudit(storage, {
      action: "music.track_import.item.upload_failed",
      actorType: "organization_member",
      actorUserId: input.actorUserId,
      occurredAt: input.now,
      requestId: input.requestId,
      summary: { clientFileId: item.clientFileId, errorCode: input.errorCode, fileId: attempt.id },
      targetId: session.id,
      targetType: "music_track_import_session",
    });
    touchSession(storage, session.id, input.now, nowMs);
    return { superseded };
  });
}

export interface AssignmentPatch {
  readonly clientFileId: string;
  readonly durationSeconds: number | null;
  readonly partKey: string;
  readonly pieceId: string;
}

interface AssignmentPatchInput {
  readonly actorUserId: string;
  readonly assignments: readonly AssignmentPatch[];
  readonly expectedRevision: number;
  readonly now: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly sessionId: string;
}

function validateAssignmentPatch(
  storage: MusicTrackImportStoreStorage,
  items: readonly ItemRow[],
  input: AssignmentPatchInput,
): {
  readonly itemsByClientId: Map<string, ItemRow>;
  readonly slots: Map<string, Map<string, string>>;
} {
  const itemsByClientId = new Map(items.map((item) => [item.clientFileId, item]));
  for (const assignment of input.assignments) {
    const item = itemsByClientId.get(assignment.clientFileId);
    if (!item) {
      throw new MusicTrackImportStoreError("validation_failed", "Manifest row not found.");
    }
    if (item.status === "attached") {
      throw new MusicTrackImportStoreError(
        "validation_failed",
        "Attached tracks cannot be remapped.",
      );
    }
    if (item.status === "cleanup_pending" || item.status === "reclaimed") {
      throw new MusicTrackImportStoreError("session_closed", "Manifest row is closed.");
    }
    assertUuid(assignment.pieceId, "piece");
  }
  const partKeys = configuredTrackPartKeys(storage);
  for (const assignment of input.assignments) {
    if (!partKeys.has(assignment.partKey)) {
      throw new MusicTrackImportStoreError(
        "validation_failed",
        `Part ${assignment.partKey} is not configured for this Organization.`,
      );
    }
  }
  const { slots } = readPieceSlots(
    storage,
    input.assignments.map((assignment) => assignment.pieceId),
  );

  const patched = new Map<string, { partKey: string; pieceId: string }>();
  for (const assignment of input.assignments) {
    patched.set(assignment.clientFileId, {
      partKey: assignment.partKey,
      pieceId: assignment.pieceId,
    });
  }
  const targets = new Set<string>();
  for (const item of items) {
    if (item.status === "attached") continue;
    const target = patched.get(item.clientFileId) ?? {
      partKey: item.partKey,
      pieceId: item.pieceId,
    };
    const key = `${target.pieceId}::${target.partKey}`;
    if (targets.has(key)) {
      throw new MusicTrackImportStoreError(
        "validation_failed",
        "Each manifest row must target a distinct piece slot.",
      );
    }
    targets.add(key);
  }
  return { itemsByClientId, slots };
}

function applyAssignmentPatch(
  storage: MusicTrackImportStoreStorage,
  itemsByClientId: ReadonlyMap<string, ItemRow>,
  slots: ReadonlyMap<string, ReadonlyMap<string, string>>,
  input: AssignmentPatchInput,
): void {
  for (const assignment of input.assignments) {
    const item = itemsByClientId.get(assignment.clientFileId);
    if (!item) continue;
    const occupied = slots.get(assignment.pieceId)?.get(assignment.partKey);
    if (occupied && occupied !== item.currentFileId) {
      storage.sql.exec(
        `UPDATE music_track_import_items
         SET piece_id = ?, part_key = ?, duration_seconds = ?, status = 'conflict',
             error_code = 'slot_occupied', updated_at = ? WHERE id = ?`,
        assignment.pieceId,
        assignment.partKey,
        assignment.durationSeconds,
        input.now,
        item.id,
      );
      continue;
    }
    const nextStatus =
      item.status === "upload_failed" ||
      item.status === "attach_failed" ||
      item.status === "conflict"
        ? "planned"
        : item.status;
    storage.sql.exec(
      `UPDATE music_track_import_items
       SET piece_id = ?, part_key = ?, duration_seconds = ?, status = ?,
           error_code = NULL, updated_at = ? WHERE id = ?`,
      assignment.pieceId,
      assignment.partKey,
      assignment.durationSeconds,
      nextStatus,
      input.now,
      item.id,
    );
  }
}

export function updateMusicTrackImportAssignmentsInStore(
  storage: MusicTrackImportStoreStorage,
  input: AssignmentPatchInput,
): SessionDetailView {
  assertOrganization(storage, input.organizationId);
  const nowMs = parseNow(input.now);
  assertUuid(input.sessionId, "session");
  if (input.assignments.length === 0 || input.assignments.length > MUSIC_TRACK_IMPORT_MAX_ITEMS) {
    throw new MusicTrackImportStoreError("validation_failed", "Invalid assignments.");
  }

  return storage.transactionSync(() => {
    const session = readSessionForActor(storage, input.sessionId, input.actorUserId);
    requireLiveSession(session, input.now);
    if (session.manifestRevision !== input.expectedRevision) {
      throw new MusicTrackImportStoreError(
        "stale_revision",
        "Assignments changed since this revision was reviewed.",
      );
    }
    const items = readItems(storage, session.id);
    const { itemsByClientId, slots } = validateAssignmentPatch(storage, items, input);
    applyAssignmentPatch(storage, itemsByClientId, slots, input);
    storage.sql.exec(
      `UPDATE music_track_import_sessions
       SET manifest_revision = manifest_revision + 1, last_user_action_at = ?, expires_at = ?
       WHERE id = ?`,
      input.now,
      new Date(nowMs + MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS * 1000).toISOString(),
      session.id,
    );
    writeAudit(storage, {
      action: "music.track_import.assignments.updated",
      actorType: "organization_member",
      actorUserId: input.actorUserId,
      occurredAt: input.now,
      requestId: input.requestId,
      summary: { assignmentCount: input.assignments.length },
      targetId: session.id,
      targetType: "music_track_import_session",
    });
    const updated = readSession(storage, session.id);
    if (!updated) {
      throw new MusicTrackImportStoreError("session_not_found", "Import session not found.");
    }
    const nextItems = readItems(storage, session.id);
    const attempts = readAttempts(storage, session.id);
    const attemptsByItem = new Map<string, AttemptRow[]>();
    for (const attempt of attempts) {
      const list = attemptsByItem.get(attempt.itemId) ?? [];
      list.push(attempt);
      attemptsByItem.set(attempt.itemId, list);
    }
    return {
      ...toSummaryView(updated, summarizeItems(nextItems)),
      items: nextItems.map((item) => toItemView(item, attemptsByItem)),
    };
  });
}

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
