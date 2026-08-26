import { normalizeFolderNumber, normalizedFolderNumberKey } from "@choir/domain";
import type { PreliminaryUpdate, ReportActor } from "./types.js";
import {
  batchRequestSchema,
  identityMatches,
  isCandidate,
  returnStatusRequestSchema,
} from "./types.js";
import {
  currentFolderRows,
  detailRowFromMap,
  detailRowFromStorage,
  folderRowsForEvents,
  parseRequestBody,
  profileRow,
  profileRows,
  responseWithRequestId,
  resultRow,
  selectedPerformanceRows,
} from "./queries.js";
function insertAudit(
  storage: DurableObjectStorage,
  actor: ReportActor,
  action: string,
  targetId: string,
  summary: Readonly<Record<string, unknown>>,
  occurredAt: string,
): void {
  storage.sql.exec(
    "INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at) VALUES (?, 'organization_member', ?, ?, 'event_roster', ?, ?, ?, ?)",
    crypto.randomUUID(),
    actor.actorUserId,
    action,
    targetId,
    actor.requestId,
    JSON.stringify(summary),
    occurredAt,
  );
}
export function rowForMutation(storage: DurableObjectStorage, eventId: string, profileId: string) {
  const row = folderRowsForEvents(storage, [eventId]).find(
    (candidate) => candidate.profileId === profileId,
  );
  return row ? detailRowFromStorage(row) : null;
}
export async function updateMusicFolderNumbersInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = batchRequestSchema.safeParse(await parseRequestBody(request));
  if (!parsed.success)
    return Response.json({ code: "invalid_music_folder_number_batch" }, { status: 400 });
  if (!identityMatches(storage, parsed.data.organizationId))
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  const eventIds = [...new Set(parsed.data.updates.map((update) => update.eventId))];
  const profileIds = [...new Set(parsed.data.updates.map((update) => update.profileId))];
  const performanceRows = new Map(
    selectedPerformanceRows(storage, eventIds).map((row) => [row.eventId, row]),
  );
  const profiles = new Set(profileRows(storage, profileIds).map((profile) => profile.profileId));
  const currentRows = currentFolderRows(storage, eventIds);
  const currentByKey = new Map(currentRows.map((row) => [row.eventId + ":" + row.profileId, row]));
  const preliminary: readonly PreliminaryUpdate[] = parsed.data.updates.map(
    (update): PreliminaryUpdate => {
      const key = update.eventId + ":" + update.profileId;
      const performance = performanceRows.get(update.eventId);
      const current = currentByKey.get(key);
      if (!performance)
        return { current, kind: "invalid", reason: "performance_not_found", update };
      if (!profiles.has(update.profileId))
        return { current, kind: "invalid", reason: "profile_not_found", update };
      if (!current) return { current, kind: "invalid", reason: "not_applicable", update };
      if (current.updatedAt !== update.expectedUpdatedAt)
        return { current, kind: "stale", reason: "stale_folder_row", update };
      return { current, kind: "candidate", reason: null, update };
    },
  );
  const owners = new Map<string, string>();
  for (const row of currentRows) {
    const key = normalizedFolderNumberKey(row.folderNumber);
    if (key.length > 0) owners.set(row.eventId + ":" + key, row.eventId + ":" + row.profileId);
  }
  for (const item of preliminary)
    if (isCandidate(item))
      owners.delete(
        item.update.eventId + ":" + normalizedFolderNumberKey(item.current.folderNumber),
      );
  const candidateOwners = new Map<string, string[]>();
  for (const item of preliminary) {
    if (!isCandidate(item)) continue;
    const key = normalizedFolderNumberKey(item.update.folderNumber);
    if (key.length === 0) continue;
    const ownersForNumber = candidateOwners.get(item.update.eventId + ":" + key) ?? [];
    ownersForNumber.push(item.update.eventId + ":" + item.update.profileId);
    candidateOwners.set(item.update.eventId + ":" + key, ownersForNumber);
  }
  const conflictKeys = new Set<string>();
  for (const [key, candidateKeys] of candidateOwners)
    if (candidateKeys.length > 1 || owners.has(key)) conflictKeys.add(key);
  const applied = preliminary.filter(
    (item): item is Extract<PreliminaryUpdate, { kind: "candidate" }> =>
      isCandidate(item) &&
      !conflictKeys.has(
        item.update.eventId + ":" + normalizedFolderNumberKey(item.update.folderNumber),
      ),
  );
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    for (const item of applied) {
      const nextNumber = normalizeFolderNumber(item.update.folderNumber);
      const numberChanged =
        normalizedFolderNumberKey(item.current.folderNumber) !==
        normalizedFolderNumberKey(nextNumber);
      const returned = nextNumber.length > 0 && !numberChanged && item.current.folderReturned === 1;
      storage.sql.exec(
        "UPDATE event_rosters SET folder_number = ?, folder_returned = ?, folder_returned_at = ?, updated_at = ? WHERE event_id = ? AND profile_id = ?",
        nextNumber,
        returned ? 1 : 0,
        returned ? (item.current.returnedAt ?? now) : null,
        now,
        item.update.eventId,
        item.update.profileId,
      );
      insertAudit(
        storage,
        parsed.data,
        nextNumber.length === 0 ? "event.folder_number.cleared" : "event.folder_number.updated",
        item.update.eventId + ":" + item.update.profileId,
        {
          folderNumberChanged: numberChanged,
          previousHasFolderNumber: normalizedFolderNumberKey(item.current.folderNumber).length > 0,
          folderReturned: returned,
          hasFolderNumber: nextNumber.length > 0,
        },
        now,
      );
    }
  });
  const refreshedRows = new Map(
    folderRowsForEvents(storage, eventIds).map((row) => [row.eventId + ":" + row.profileId, row]),
  );
  const results = preliminary.map((item) => {
    if (item.kind === "invalid")
      return resultRow(
        item.update.eventId,
        item.update.profileId,
        "invalid",
        item.reason,
        item.reason === "not_applicable"
          ? "This Profile has no roster record for the selected Performance."
          : "The selected Profile or Performance no longer exists.",
        null,
      );
    if (item.kind === "stale")
      return resultRow(
        item.update.eventId,
        item.update.profileId,
        "stale",
        item.reason,
        "This folder row changed elsewhere. Refresh it before saving.",
        detailRowFromMap(refreshedRows, item.update.eventId, item.update.profileId),
      );
    const conflict = conflictKeys.has(
      item.update.eventId + ":" + normalizedFolderNumberKey(item.update.folderNumber),
    );
    if (conflict)
      return resultRow(
        item.update.eventId,
        item.update.profileId,
        "conflict",
        "folder_number_conflict",
        "That Folder Number is already used for this Performance.",
        detailRowFromMap(refreshedRows, item.update.eventId, item.update.profileId),
      );
    return resultRow(
      item.update.eventId,
      item.update.profileId,
      "applied",
      null,
      "Folder Number saved.",
      detailRowFromMap(refreshedRows, item.update.eventId, item.update.profileId),
    );
  });
  return responseWithRequestId({ results }, parsed.data.requestId);
}
export async function updateMusicFolderReturnStatusInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = returnStatusRequestSchema.safeParse(await parseRequestBody(request));
  if (!parsed.success)
    return Response.json({ code: "invalid_music_folder_return_status" }, { status: 400 });
  if (!identityMatches(storage, parsed.data.organizationId))
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  const performance = selectedPerformanceRows(storage, [parsed.data.eventId]).at(0);
  if (!performance) return Response.json({ code: "performance_not_found" }, { status: 404 });
  if (!profileRow(storage, parsed.data.profileId))
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  const current = currentFolderRows(storage, [parsed.data.eventId]).find(
    (row) => row.profileId === parsed.data.profileId,
  );
  if (!current) return Response.json({ code: "not_applicable" }, { status: 409 });
  if (current.updatedAt !== parsed.data.folder.expectedUpdatedAt)
    return Response.json({ code: "stale_folder_row" }, { status: 409 });
  if (parsed.data.folder.folderReturned && normalizeFolderNumber(current.folderNumber).length === 0)
    return Response.json({ code: "not_assigned" }, { status: 409 });
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE event_rosters SET folder_returned = ?, folder_returned_at = ?, updated_at = ? WHERE event_id = ? AND profile_id = ?",
      parsed.data.folder.folderReturned ? 1 : 0,
      parsed.data.folder.folderReturned ? occurredAt : null,
      occurredAt,
      parsed.data.eventId,
      parsed.data.profileId,
    );
    insertAudit(
      storage,
      parsed.data,
      parsed.data.folder.folderReturned
        ? "event.folder_return.marked_returned"
        : "event.folder_return.marked_outstanding",
      parsed.data.eventId + ":" + parsed.data.profileId,
      { folderReturned: parsed.data.folder.folderReturned },
      occurredAt,
    );
  });
  const row = rowForMutation(storage, parsed.data.eventId, parsed.data.profileId);
  return row
    ? responseWithRequestId({ row }, parsed.data.requestId)
    : Response.json({ code: "folder_row_not_found" }, { status: 404 });
}
