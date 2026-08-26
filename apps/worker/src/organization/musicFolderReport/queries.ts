import { MUSIC_FOLDER_REPORT_MAX_PERFORMANCES } from "@choir/contracts";
import {
  calculateMusicFolderCounts,
  deriveMusicFolderStatus,
  sortMusicFolderProfiles,
} from "@choir/domain";
import {
  identityMatches,
  musicFolderReportDetailRowSchema,
  placeholders,
  profileDetailRequestSchema,
  queryRequestSchema,
} from "./types.js";
import type {
  CurrentFolderRow,
  FolderStorageRow,
  GroupedProfile,
  PerformanceOptionRow,
  PerformanceRow,
  ProfileRow,
} from "./types.js";
export function selectedPerformanceRows(
  storage: DurableObjectStorage,
  eventIds: readonly string[],
): readonly PerformanceRow[] {
  if (eventIds.length === 0) return [];
  return storage.sql
    .exec<PerformanceRow>(
      "SELECT id AS eventId, title AS eventTitle, starts_at AS startsAt, is_canceled AS isCanceled, is_archived AS isArchived FROM events WHERE type = 'Performance' AND id IN (" +
        placeholders(eventIds) +
        ") ORDER BY starts_at DESC, id DESC",
      ...eventIds,
    )
    .toArray();
}
export function selectedPerformanceOptions(
  storage: DurableObjectStorage,
): readonly PerformanceOptionRow[] {
  return storage.sql
    .exec<PerformanceOptionRow>(
      "SELECT e.id, e.title, e.starts_at AS startsAt, e.is_canceled AS isCanceled, e.is_archived AS isArchived, COALESCE(folder_counts.assignedFolderCount, 0) AS assignedFolderCount FROM events e LEFT JOIN (SELECT event_id, COUNT(*) AS assignedFolderCount FROM event_rosters WHERE trim(folder_number) <> '' GROUP BY event_id) folder_counts ON folder_counts.event_id = e.id WHERE e.type = 'Performance' ORDER BY e.starts_at DESC, e.id DESC LIMIT " +
        String(MUSIC_FOLDER_REPORT_MAX_PERFORMANCES),
    )
    .toArray();
}
export function folderRowsForEvents(
  storage: DurableObjectStorage,
  eventIds: readonly string[],
): readonly FolderStorageRow[] {
  if (eventIds.length === 0) return [];
  return storage.sql
    .exec<FolderStorageRow>(
      "SELECT e.id AS eventId, e.title AS eventTitle, e.starts_at AS startsAt, e.is_canceled AS isCanceled, e.is_archived AS isArchived, p.id AS profileId, p.display_name AS displayName, p.global_status AS globalStatus, COALESCE(r.folder_number, '') AS folderNumber, COALESCE(r.folder_returned, 0) AS folderReturned, CASE WHEN COALESCE(r.folder_returned, 0) = 1 THEN COALESCE(r.folder_returned_at, r.updated_at) ELSE NULL END AS returnedAt, r.updated_at AS updatedAt FROM event_rosters r JOIN events e ON e.id = r.event_id AND e.type = 'Performance' JOIN profiles p ON p.id = r.profile_id WHERE e.id IN (" +
        placeholders(eventIds) +
        ")",
      ...eventIds,
    )
    .toArray();
}
export function profileRow(
  storage: DurableObjectStorage,
  profileId: string,
): ProfileRow | undefined {
  return storage.sql
    .exec<ProfileRow>(
      "SELECT id AS profileId, display_name AS displayName, global_status AS globalStatus FROM profiles WHERE id = ? LIMIT 1",
      profileId,
    )
    .toArray()
    .at(0);
}
export function profileRows(
  storage: DurableObjectStorage,
  profileIds: readonly string[],
): readonly ProfileRow[] {
  if (profileIds.length === 0) return [];
  return storage.sql
    .exec<ProfileRow>(
      "SELECT id AS profileId, display_name AS displayName, global_status AS globalStatus FROM profiles WHERE id IN (" +
        placeholders(profileIds) +
        ")",
      ...profileIds,
    )
    .toArray();
}
export function validateSelectedPerformances(
  storage: DurableObjectStorage,
  eventIds: readonly string[],
): Response | null {
  const rows = selectedPerformanceRows(storage, eventIds);
  return rows.length === eventIds.length
    ? null
    : Response.json({ code: "performance_not_found" }, { status: 404 });
}
export function detailRow(
  performance: PerformanceRow,
  profileId: string,
  folderNumber: string,
  folderReturned: boolean,
  returnedAt: string | null,
  updatedAt: string | null,
  applicable: boolean,
) {
  return musicFolderReportDetailRowSchema.parse({
    eventId: performance.eventId,
    eventTitle: performance.eventTitle,
    folderNumber,
    folderReturned,
    isArchived: performance.isArchived === 1,
    isCanceled: performance.isCanceled === 1,
    profileId,
    returnedAt,
    startsAt: performance.startsAt,
    status: deriveMusicFolderStatus(folderNumber, folderReturned, applicable),
    updatedAt,
  });
}
export function detailRowFromStorage(row: FolderStorageRow) {
  return detailRow(
    row,
    row.profileId,
    row.folderNumber,
    row.folderReturned === 1,
    row.returnedAt,
    row.updatedAt,
    true,
  );
}
export function responseWithRequestId(
  value: Readonly<Record<string, unknown>>,
  requestId: string,
): Response {
  return Response.json({ ...value, requestId });
}
export async function parseRequestBody(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
export function currentFolderRows(
  storage: DurableObjectStorage,
  eventIds: readonly string[],
): readonly CurrentFolderRow[] {
  if (eventIds.length === 0) return [];
  return storage.sql
    .exec<CurrentFolderRow>(
      "SELECT event_id AS eventId, profile_id AS profileId, COALESCE(folder_number, '') AS folderNumber, COALESCE(folder_returned, 0) AS folderReturned, CASE WHEN COALESCE(folder_returned, 0) = 1 THEN COALESCE(folder_returned_at, updated_at) ELSE NULL END AS returnedAt, updated_at AS updatedAt FROM event_rosters WHERE event_id IN (" +
        placeholders(eventIds) +
        ")",
      ...eventIds,
    )
    .toArray();
}
export function detailRowFromMap(
  rows: ReadonlyMap<string, FolderStorageRow>,
  eventId: string,
  profileId: string,
) {
  const row = rows.get(eventId + ":" + profileId);
  return row ? detailRowFromStorage(row) : null;
}
export function resultRow(
  eventId: string,
  profileId: string,
  result: "applied" | "conflict" | "invalid" | "stale",
  code: string | null,
  message: string,
  row: ReturnType<typeof detailRowFromStorage> | null,
) {
  return { code, eventId, message, profileId, result, row };
}
export async function readMusicFolderReportFromStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = queryRequestSchema.safeParse(await parseRequestBody(request));
  if (!parsed.success)
    return Response.json({ code: "invalid_music_folder_report_query" }, { status: 400 });
  if (!identityMatches(storage, parsed.data.organizationId))
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  const invalid = validateSelectedPerformances(storage, parsed.data.eventIds);
  if (invalid) return invalid;
  const rows = folderRowsForEvents(storage, parsed.data.eventIds);
  const grouped = new Map<string, GroupedProfile>();
  for (const row of rows) {
    const status = deriveMusicFolderStatus(row.folderNumber, row.folderReturned === 1);
    const existing = grouped.get(row.profileId) ?? {
      displayName: row.displayName,
      globalStatus: row.globalStatus,
      profileId: row.profileId,
      rows: [],
    };
    existing.rows.push({ status });
    grouped.set(row.profileId, existing);
  }
  const summaries = sortMusicFolderProfiles(
    [...grouped.values()]
      .map((profile) => ({
        ...calculateMusicFolderCounts(profile.rows),
        displayName: profile.displayName,
        globalStatus: profile.globalStatus,
        profileId: profile.profileId,
      }))
      .filter((profile) => profile.assigned > 0),
  );
  const includedProfileIds = new Set(summaries.map((profile) => profile.profileId));
  const totals = calculateMusicFolderCounts(
    rows
      .filter((row) => includedProfileIds.has(row.profileId))
      .map((row) => ({
        status: deriveMusicFolderStatus(row.folderNumber, row.folderReturned === 1),
      })),
  );
  const performanceOptions = selectedPerformanceOptions(storage).map((option) => ({
    assignedFolderCount: option.assignedFolderCount,
    id: option.id,
    isArchived: option.isArchived === 1,
    isCanceled: option.isCanceled === 1,
    startsAt: option.startsAt,
    title: option.title,
  }));
  return responseWithRequestId(
    { performanceOptions, selectedEventIds: parsed.data.eventIds, summaries, totals },
    parsed.data.requestId,
  );
}
export async function readMusicFolderProfileDetailFromStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = profileDetailRequestSchema.safeParse(await parseRequestBody(request));
  if (!parsed.success)
    return Response.json({ code: "invalid_music_folder_profile_detail" }, { status: 400 });
  if (!identityMatches(storage, parsed.data.organizationId))
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  const invalid = validateSelectedPerformances(storage, parsed.data.eventIds);
  if (invalid) return invalid;
  const profile = profileRow(storage, parsed.data.profileId);
  if (!profile) return Response.json({ code: "profile_not_found" }, { status: 404 });
  const performances = selectedPerformanceRows(storage, parsed.data.eventIds);
  const rows = folderRowsForEvents(storage, parsed.data.eventIds).filter(
    (row) => row.profileId === parsed.data.profileId,
  );
  const byEvent = new Map(rows.map((row) => [row.eventId, row]));
  const detailRows = performances.map((performance) => {
    const row = byEvent.get(performance.eventId);
    return row
      ? detailRowFromStorage(row)
      : detailRow(performance, parsed.data.profileId, "", false, null, null, false);
  });
  return responseWithRequestId(
    {
      displayName: profile.displayName,
      globalStatus: profile.globalStatus,
      profileId: profile.profileId,
      rows: detailRows,
      selectedEventIds: parsed.data.eventIds,
    },
    parsed.data.requestId,
  );
}
