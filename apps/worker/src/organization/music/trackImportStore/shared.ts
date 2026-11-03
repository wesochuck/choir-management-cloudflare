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
  MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS,
  chunkMusicTrackImport,
  isRecoverableImportSessionState,
} from "@choir/domain";
import {
  organizationRosterConfigurationRequestSchema,
  type MusicTrackImportItemStatus,
  type MusicTrackImportSessionState as SessionState,
} from "@choir/contracts";
import type { SqlStorageValue } from "@cloudflare/workers-types";

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

export interface SessionRow extends Record<string, SqlStorageValue> {
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

export interface ItemRow extends Record<string, SqlStorageValue> {
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

export interface AttemptRow extends Record<string, SqlStorageValue> {
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

export const TERMINAL_SESSION_STATES: readonly SessionState[] = [
  "completed",
  "discarded",
  "expired",
];
export const CLEANUP_ELIGIBLE_STATES: readonly SessionState[] = [
  "cancel_requested",
  "cleanup_pending",
  "expired",
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new MusicTrackImportStoreError("validation_failed", `Invalid ${field}.`);
  }
}

export function assertOrganization(
  storage: MusicTrackImportStoreStorage,
  organizationId: string,
): void {
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

export function parseNow(now: string): number {
  const parsed = Date.parse(now);
  if (!Number.isFinite(parsed)) {
    throw new MusicTrackImportStoreError("validation_failed", "Invalid timestamp.");
  }
  return parsed;
}

export function writeAudit(
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

export function readSession(
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

export function readSessionForActor(
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

export function isExpired(
  session: Pick<SessionRow, "expiresAt" | "absoluteExpiresAt">,
  now: string,
): boolean {
  return session.expiresAt <= now || session.absoluteExpiresAt <= now;
}

export function requireLiveSession(session: SessionRow, now: string): void {
  if (isExpired(session, now)) {
    throw new MusicTrackImportStoreError("session_expired", "Import session has expired.");
  }
  if (!isRecoverableImportSessionState(session.state)) {
    throw new MusicTrackImportStoreError("session_closed", "Import session is no longer active.");
  }
}

export function readItems(storage: MusicTrackImportStoreStorage, sessionId: string): ItemRow[] {
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

export function readAttempts(
  storage: MusicTrackImportStoreStorage,
  sessionId: string,
): AttemptRow[] {
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

export function readItemByClientFileId(
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

export function readAttemptsForItem(
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

export function readPrivateFileRow(
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

export function readPrivateFileStatus(
  storage: MusicTrackImportStoreStorage,
  fileId: string,
): { readonly status: string; readonly storageKey: string } | undefined {
  const row = readPrivateFileRow(storage, fileId);
  return row ? { status: row.status, storageKey: row.storageKey } : undefined;
}

export function touchSession(
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

export function configuredTrackPartKeys(storage: MusicTrackImportStoreStorage): Set<string> {
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

export interface PieceSlotMap {
  readonly durations: Map<string, number | null>;
  readonly slots: Map<string, Map<string, string>>;
}

export function readPieceSlots(
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

export interface SessionDetailView extends SessionSummaryView {
  readonly items: readonly SessionItemView[];
}

export function summarizeItems(
  items: readonly { readonly count?: number | undefined; readonly status: string }[],
): SessionSummaryCounts {
  let planned = 0;
  let uploading = 0;
  let uploaded = 0;
  let attached = 0;
  let uploadFailed = 0;
  let attachFailed = 0;
  let conflict = 0;
  let cleanupPending = 0;
  let reclaimed = 0;
  let total = 0;
  for (const item of items) {
    const count = item.count ?? 1;
    total += count;
    switch (item.status) {
      case "planned":
        planned += count;
        break;
      case "uploading":
        uploading += count;
        break;
      case "uploaded":
        uploaded += count;
        break;
      case "attached":
        attached += count;
        break;
      case "upload_failed":
        uploadFailed += count;
        break;
      case "attach_failed":
        attachFailed += count;
        break;
      case "conflict":
        conflict += count;
        break;
      case "cleanup_pending":
        cleanupPending += count;
        break;
      case "reclaimed":
        reclaimed += count;
        break;
      default:
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
    total,
    uploadFailed,
    uploaded,
    uploading,
  };
}

export function toItemView(
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

export function toSummaryView(
  session: SessionRow,
  counts: SessionSummaryCounts,
): SessionSummaryView {
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
