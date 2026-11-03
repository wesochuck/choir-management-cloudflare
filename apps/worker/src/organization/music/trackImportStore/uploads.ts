import type { MusicTrackImportItemStatus } from "@choir/contracts";
import { privateOrganizationUploadKey } from "../../../storage/privateFiles";
import {
  assertOrganization,
  assertUuid,
  MusicTrackImportStoreError,
  parseNow,
  readAttemptsForItem,
  readItemByClientFileId,
  readPieceSlots,
  readPrivateFileStatus,
  readSessionForActor,
  requireLiveSession,
  touchSession,
  writeAudit,
  type AttemptRow,
  type ItemRow,
  type MusicTrackImportStoreStorage,
  type SessionRow,
} from "./shared";

const UPLOADABLE_ITEM_STATUSES: readonly MusicTrackImportItemStatus[] = [
  "planned",
  "uploading",
  "upload_failed",
  "attach_failed",
];

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
