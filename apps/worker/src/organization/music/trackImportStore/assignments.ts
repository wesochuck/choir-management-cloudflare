import {
  MUSIC_TRACK_IMPORT_IDLE_EXPIRY_SECONDS,
  MUSIC_TRACK_IMPORT_MAX_ITEMS,
} from "@choir/domain";
import {
  assertOrganization,
  assertUuid,
  configuredTrackPartKeys,
  MusicTrackImportStoreError,
  parseNow,
  readAttempts,
  readItems,
  readPieceSlots,
  readSession,
  readSessionForActor,
  requireLiveSession,
  summarizeItems,
  toItemView,
  toSummaryView,
  writeAudit,
  type AttemptRow,
  type ItemRow,
  type MusicTrackImportStoreStorage,
  type SessionDetailView,
} from "./shared";

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
