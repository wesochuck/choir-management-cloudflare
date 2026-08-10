import { normalizeFolderNumber, normalizedFolderNumberKey } from "@choir/domain";
import { z } from "zod";

import { type ManagementRequest, type ProfileFolderNumberRow } from "./contracts";
import { insertAudit, identityMatches, recordExists } from "./shared";

function profileFolderNumberFromRow(row: ProfileFolderNumberRow) {
  return { ...row, folderReturned: row.folderReturned === 1 };
}

export function listProfileFolderNumbersFromStore(
  storage: DurableObjectStorage,
  input: { readonly organizationId: string | null; readonly profileId: string | null },
): Response {
  const profileId = z.uuid().safeParse(input.profileId);
  if (!identityMatches(storage, input.organizationId) || !profileId.success) {
    return Response.json({ code: "profile_folder_numbers_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "profiles", profileId.data)) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  const folderNumbers = storage.sql
    .exec<ProfileFolderNumberRow>(
      `SELECT e.id AS eventId, e.title AS eventTitle, e.type AS eventType,
         e.starts_at AS startsAt, p.id AS profileId,
         COALESCE(r.folder_number, '') AS folderNumber,
         COALESCE(r.folder_returned, 0) AS folderReturned,
         CASE WHEN COALESCE(r.folder_returned, 0) = 1
           THEN COALESCE(r.folder_returned_at, r.updated_at)
           ELSE NULL END AS returnedAt,
         r.updated_at AS updatedAt
       FROM events e
       JOIN profiles p ON p.id = ?
       LEFT JOIN event_rosters r ON r.event_id = e.id AND r.profile_id = p.id
       WHERE e.type = 'Performance' AND e.is_canceled = 0
       ORDER BY e.starts_at DESC, e.id DESC LIMIT 500`,
      profileId.data,
    )
    .toArray()
    .map(profileFolderNumberFromRow);
  return Response.json({ folderNumbers, profileId: profileId.data });
}

export function updateProfileFolderNumber(
  storage: DurableObjectStorage,
  operation: Extract<ManagementRequest, { readonly action: "update_profile_folder_number" }>,
  occurredAt: string,
): Response {
  if (!recordExists(storage, "events", operation.eventId)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const eventType = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly type: string }>(
      "SELECT type FROM events WHERE id = ?",
      operation.eventId,
    )
    .one().type;
  if (eventType !== "Performance") {
    return Response.json({ code: "folder_number_requires_performance" }, { status: 409 });
  }
  if (!recordExists(storage, "profiles", operation.profileId)) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  const folderNumber = normalizeFolderNumber(operation.folder.folderNumber);
  const current = storage.sql
    .exec<{
      readonly folderNumber: string;
      readonly folderReturned: number;
    }>(
      `SELECT COALESCE(folder_number, '') AS folderNumber,
         COALESCE(folder_returned, 0) AS folderReturned
       FROM event_rosters WHERE event_id = ? AND profile_id = ? LIMIT 1`,
      operation.eventId,
      operation.profileId,
    )
    .toArray()
    .at(0);
  const normalizedNumber = normalizedFolderNumberKey(folderNumber);
  if (normalizedNumber.length > 0) {
    const conflict = storage.sql
      .exec<{ readonly profileId: string }>(
        `SELECT profile_id AS profileId FROM event_rosters
         WHERE event_id = ? AND profile_id != ? AND lower(trim(folder_number)) = ? LIMIT 1`,
        operation.eventId,
        operation.profileId,
        normalizedNumber,
      )
      .toArray()
      .at(0);
    if (conflict) return Response.json({ code: "folder_number_conflict" }, { status: 409 });
  }
  const numberChanged =
    current !== undefined && normalizedFolderNumberKey(current.folderNumber) !== normalizedNumber;
  const folderReturned =
    folderNumber.length > 0 && (numberChanged ? false : operation.folder.folderReturned);
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO event_rosters
        (event_id, profile_id, rsvp, attendance, folder_number, folder_returned,
         folder_returned_at, created_at, updated_at)
       VALUES (?, ?, 'Pending', 'Pending', ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, profile_id) DO UPDATE SET
         folder_number = excluded.folder_number,
         folder_returned = excluded.folder_returned,
         folder_returned_at = excluded.folder_returned_at,
         updated_at = excluded.updated_at`,
      operation.eventId,
      operation.profileId,
      folderNumber,
      folderReturned ? 1 : 0,
      folderReturned ? occurredAt : null,
      occurredAt,
      occurredAt,
    );
    insertAudit(
      storage,
      operation,
      folderNumber.length === 0 ? "event.folder_number.cleared" : "event.folder_number.updated",
      "event_roster",
      `${operation.eventId}:${operation.profileId}`,
      {
        previousHasFolderNumber:
          current !== undefined && normalizedFolderNumberKey(current.folderNumber).length > 0,
        folderReturned,
        hasFolderNumber: folderNumber.length > 0,
      },
      occurredAt,
    );
  });
  const row = storage.sql
    .exec<ProfileFolderNumberRow>(
      `SELECT e.id AS eventId, e.title AS eventTitle, e.type AS eventType,
         e.starts_at AS startsAt, p.id AS profileId,
         COALESCE(r.folder_number, '') AS folderNumber,
         COALESCE(r.folder_returned, 0) AS folderReturned,
         CASE WHEN COALESCE(r.folder_returned, 0) = 1
           THEN COALESCE(r.folder_returned_at, r.updated_at)
           ELSE NULL END AS returnedAt,
         r.updated_at AS updatedAt
       FROM events e
       JOIN profiles p ON p.id = ?
       LEFT JOIN event_rosters r ON r.event_id = e.id AND r.profile_id = p.id
       WHERE e.id = ? AND e.type = 'Performance'`,
      operation.profileId,
      operation.eventId,
    )
    .toArray()[0];
  return row
    ? Response.json(profileFolderNumberFromRow(row))
    : Response.json({ code: "folder_number_not_found" }, { status: 404 });
}
