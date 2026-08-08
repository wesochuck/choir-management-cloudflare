import {
  MUSIC_FOLDER_REPORT_MAX_EXPORT_BYTES,
  MUSIC_FOLDER_REPORT_MAX_EXPORT_ROWS,
  MUSIC_FOLDER_REPORT_MAX_PERFORMANCES,
  musicFolderNumberBatchRequestSchema,
  musicFolderReportDetailRowSchema,
  musicFolderReportSelectionSchema,
  musicFolderReturnStatusRequestSchema,
  type MusicFolderReportStatus,
} from "@choir/contracts";
import {
  calculateMusicFolderCounts,
  deriveMusicFolderStatus,
  normalizeFolderNumber,
  normalizedFolderNumberKey,
  renderMusicFolderReportCsv,
  sortMusicFolderProfiles,
} from "@choir/domain";
import { z } from "zod";

const actorSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

const queryRequestSchema = actorSchema.and(musicFolderReportSelectionSchema);
const profileDetailRequestSchema = queryRequestSchema.and(z.object({ profileId: z.uuid() }));
const batchRequestSchema = actorSchema.and(musicFolderNumberBatchRequestSchema);
const returnStatusRequestSchema = actorSchema.and(
  z.object({
    eventId: z.uuid(),
    folder: musicFolderReturnStatusRequestSchema,
    profileId: z.uuid(),
  }),
);

interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

interface PerformanceOptionRow {
  readonly [column: string]: SqlStorageValue;
  readonly assignedFolderCount: number;
  readonly id: string;
  readonly isArchived: number;
  readonly isCanceled: number;
  readonly startsAt: string;
  readonly title: string;
}

interface PerformanceRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly isArchived: number;
  readonly isCanceled: number;
  readonly startsAt: string;
}

interface ProfileRow {
  readonly [column: string]: SqlStorageValue;
  readonly displayName: string;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly profileId: string;
}

interface FolderStorageRow extends PerformanceRow {
  readonly displayName: string;
  readonly folderNumber: string;
  readonly folderReturned: number;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly profileId: string;
  readonly returnedAt: string | null;
  readonly updatedAt: string | null;
}

interface CurrentFolderRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly folderNumber: string;
  readonly folderReturned: number;
  readonly profileId: string;
  readonly returnedAt: string | null;
  readonly updatedAt: string;
}

interface ReportActor {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

interface GroupedProfile {
  readonly displayName: string;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly profileId: string;
  readonly rows: { readonly status: MusicFolderReportStatus }[];
}

type MusicFolderNumberUpdate = z.infer<
  typeof musicFolderNumberBatchRequestSchema
>["updates"][number];

type PreliminaryUpdate =
  | {
      readonly current: CurrentFolderRow | undefined;
      readonly kind: "invalid";
      readonly reason: string;
      readonly update: MusicFolderNumberUpdate;
    }
  | {
      readonly current: CurrentFolderRow;
      readonly kind: "candidate";
      readonly reason: null;
      readonly update: MusicFolderNumberUpdate;
    }
  | {
      readonly current: CurrentFolderRow;
      readonly kind: "stale";
      readonly reason: "stale_folder_row";
      readonly update: MusicFolderNumberUpdate;
    };

function isCandidate(
  item: PreliminaryUpdate,
): item is Extract<PreliminaryUpdate, { kind: "candidate" }> {
  return item.kind === "candidate";
}

function identityMatches(storage: DurableObjectStorage, organizationId: string): boolean {
  const identity = storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  return identity?.organizationId === organizationId;
}

function placeholders(values: readonly string[]): string {
  return values.map(() => "?").join(", ");
}

function selectedPerformanceRows(
  storage: DurableObjectStorage,
  eventIds: readonly string[],
): readonly PerformanceRow[] {
  if (eventIds.length === 0) return [];
  return storage.sql
    .exec<PerformanceRow>(
      "SELECT id AS eventId, title AS eventTitle, starts_at AS startsAt, " +
        "is_canceled AS isCanceled, is_archived AS isArchived " +
        "FROM events WHERE type = 'Performance' AND id IN (" +
        placeholders(eventIds) +
        ") ORDER BY starts_at DESC, id DESC",
      ...eventIds,
    )
    .toArray();
}

function selectedPerformanceOptions(
  storage: DurableObjectStorage,
): readonly PerformanceOptionRow[] {
  return storage.sql
    .exec<PerformanceOptionRow>(
      "SELECT e.id, e.title, e.starts_at AS startsAt, " +
        "e.is_canceled AS isCanceled, e.is_archived AS isArchived, " +
        "COALESCE(folder_counts.assignedFolderCount, 0) AS assignedFolderCount " +
        "FROM events e LEFT JOIN (" +
        "SELECT event_id, COUNT(*) AS assignedFolderCount FROM event_rosters " +
        "WHERE trim(folder_number) <> '' GROUP BY event_id" +
        ") folder_counts ON folder_counts.event_id = e.id " +
        "WHERE e.type = 'Performance' " +
        "ORDER BY e.starts_at DESC, e.id DESC LIMIT " +
        String(MUSIC_FOLDER_REPORT_MAX_PERFORMANCES),
    )
    .toArray();
}

function folderRowsForEvents(
  storage: DurableObjectStorage,
  eventIds: readonly string[],
): readonly FolderStorageRow[] {
  if (eventIds.length === 0) return [];
  return storage.sql
    .exec<FolderStorageRow>(
      "SELECT e.id AS eventId, e.title AS eventTitle, e.starts_at AS startsAt, " +
        "e.is_canceled AS isCanceled, e.is_archived AS isArchived, " +
        "p.id AS profileId, p.display_name AS displayName, p.global_status AS globalStatus, " +
        "COALESCE(r.folder_number, '') AS folderNumber, " +
        "COALESCE(r.folder_returned, 0) AS folderReturned, " +
        "CASE WHEN COALESCE(r.folder_returned, 0) = 1 " +
        "THEN COALESCE(r.folder_returned_at, r.updated_at) ELSE NULL END AS returnedAt, " +
        "r.updated_at AS updatedAt FROM event_rosters r " +
        "JOIN events e ON e.id = r.event_id AND e.type = 'Performance' " +
        "JOIN profiles p ON p.id = r.profile_id " +
        "WHERE e.id IN (" +
        placeholders(eventIds) +
        ")",
      ...eventIds,
    )
    .toArray();
}

function profileRow(storage: DurableObjectStorage, profileId: string): ProfileRow | undefined {
  return storage.sql
    .exec<ProfileRow>(
      "SELECT id AS profileId, display_name AS displayName, global_status AS globalStatus " +
        "FROM profiles WHERE id = ? LIMIT 1",
      profileId,
    )
    .toArray()
    .at(0);
}

function profileRows(
  storage: DurableObjectStorage,
  profileIds: readonly string[],
): readonly ProfileRow[] {
  if (profileIds.length === 0) return [];
  return storage.sql
    .exec<ProfileRow>(
      "SELECT id AS profileId, display_name AS displayName, global_status AS globalStatus " +
        "FROM profiles WHERE id IN (" +
        placeholders(profileIds) +
        ")",
      ...profileIds,
    )
    .toArray();
}

function validateSelectedPerformances(
  storage: DurableObjectStorage,
  eventIds: readonly string[],
): Response | null {
  const rows = selectedPerformanceRows(storage, eventIds);
  return rows.length === eventIds.length
    ? null
    : Response.json({ code: "performance_not_found" }, { status: 404 });
}

function detailRow(
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

function detailRowFromStorage(row: FolderStorageRow) {
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

function responseWithRequestId(
  value: Readonly<Record<string, unknown>>,
  requestId: string,
): Response {
  return Response.json({ ...value, requestId });
}

async function parseRequestBody(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

function insertAudit(
  storage: DurableObjectStorage,
  actor: ReportActor,
  action: string,
  targetId: string,
  summary: Readonly<Record<string, unknown>>,
  occurredAt: string,
): void {
  storage.sql.exec(
    "INSERT INTO audit_events " +
      "(id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at) " +
      "VALUES (?, 'organization_member', ?, ?, 'event_roster', ?, ?, ?, ?)",
    crypto.randomUUID(),
    actor.actorUserId,
    action,
    targetId,
    actor.requestId,
    JSON.stringify(summary),
    occurredAt,
  );
}

function currentFolderRows(
  storage: DurableObjectStorage,
  eventIds: readonly string[],
): readonly CurrentFolderRow[] {
  if (eventIds.length === 0) return [];
  return storage.sql
    .exec<CurrentFolderRow>(
      "SELECT event_id AS eventId, profile_id AS profileId, " +
        "COALESCE(folder_number, '') AS folderNumber, " +
        "COALESCE(folder_returned, 0) AS folderReturned, " +
        "CASE WHEN COALESCE(folder_returned, 0) = 1 " +
        "THEN COALESCE(folder_returned_at, updated_at) ELSE NULL END AS returnedAt, " +
        "updated_at AS updatedAt FROM event_rosters WHERE event_id IN (" +
        placeholders(eventIds) +
        ")",
      ...eventIds,
    )
    .toArray();
}

function rowForMutation(storage: DurableObjectStorage, eventId: string, profileId: string) {
  const row = folderRowsForEvents(storage, [eventId]).find(
    (candidate) => candidate.profileId === profileId,
  );
  return row ? detailRowFromStorage(row) : null;
}

function detailRowFromMap(
  rows: ReadonlyMap<string, FolderStorageRow>,
  eventId: string,
  profileId: string,
) {
  const row = rows.get(eventId + ":" + profileId);
  return row ? detailRowFromStorage(row) : null;
}

function resultRow(
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
  if (!parsed.success) {
    return Response.json({ code: "invalid_music_folder_report_query" }, { status: 400 });
  }
  if (!identityMatches(storage, parsed.data.organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
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
    {
      performanceOptions,
      selectedEventIds: parsed.data.eventIds,
      summaries,
      totals,
    },
    parsed.data.requestId,
  );
}

export async function readMusicFolderProfileDetailFromStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = profileDetailRequestSchema.safeParse(await parseRequestBody(request));
  if (!parsed.success) {
    return Response.json({ code: "invalid_music_folder_profile_detail" }, { status: 400 });
  }
  if (!identityMatches(storage, parsed.data.organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
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

export async function updateMusicFolderNumbersInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = batchRequestSchema.safeParse(await parseRequestBody(request));
  if (!parsed.success) {
    return Response.json({ code: "invalid_music_folder_number_batch" }, { status: 400 });
  }
  if (!identityMatches(storage, parsed.data.organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
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
      if (!performance) {
        return { current, kind: "invalid", reason: "performance_not_found", update };
      }
      if (!profiles.has(update.profileId)) {
        return { current, kind: "invalid", reason: "profile_not_found", update };
      }
      if (!current) {
        return { current, kind: "invalid", reason: "not_applicable", update };
      }
      if (current.updatedAt !== update.expectedUpdatedAt) {
        return { current, kind: "stale", reason: "stale_folder_row", update };
      }
      return { current, kind: "candidate", reason: null, update };
    },
  );
  const owners = new Map<string, string>();
  for (const row of currentRows) {
    const key = normalizedFolderNumberKey(row.folderNumber);
    if (key.length > 0) owners.set(row.eventId + ":" + key, row.eventId + ":" + row.profileId);
  }
  for (const item of preliminary) {
    if (isCandidate(item)) {
      owners.delete(
        item.update.eventId + ":" + normalizedFolderNumberKey(item.current.folderNumber),
      );
    }
  }
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
  for (const [key, candidateKeys] of candidateOwners) {
    if (candidateKeys.length > 1 || owners.has(key)) conflictKeys.add(key);
  }
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
        "UPDATE event_rosters SET folder_number = ?, folder_returned = ?, " +
          "folder_returned_at = ?, updated_at = ? WHERE event_id = ? AND profile_id = ?",
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
    if (item.kind === "invalid") {
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
    }
    if (item.kind === "stale") {
      return resultRow(
        item.update.eventId,
        item.update.profileId,
        "stale",
        item.reason,
        "This folder row changed elsewhere. Refresh it before saving.",
        detailRowFromMap(refreshedRows, item.update.eventId, item.update.profileId),
      );
    }
    const conflict = conflictKeys.has(
      item.update.eventId + ":" + normalizedFolderNumberKey(item.update.folderNumber),
    );
    if (conflict) {
      return resultRow(
        item.update.eventId,
        item.update.profileId,
        "conflict",
        "folder_number_conflict",
        "That Folder Number is already used for this Performance.",
        detailRowFromMap(refreshedRows, item.update.eventId, item.update.profileId),
      );
    }
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
  if (!parsed.success) {
    return Response.json({ code: "invalid_music_folder_return_status" }, { status: 400 });
  }
  if (!identityMatches(storage, parsed.data.organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const performance = selectedPerformanceRows(storage, [parsed.data.eventId]).at(0);
  if (!performance) return Response.json({ code: "performance_not_found" }, { status: 404 });
  if (!profileRow(storage, parsed.data.profileId)) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  const current = currentFolderRows(storage, [parsed.data.eventId]).find(
    (row) => row.profileId === parsed.data.profileId,
  );
  if (!current) return Response.json({ code: "not_applicable" }, { status: 409 });
  if (current.updatedAt !== parsed.data.folder.expectedUpdatedAt) {
    return Response.json({ code: "stale_folder_row" }, { status: 409 });
  }
  if (
    parsed.data.folder.folderReturned &&
    normalizeFolderNumber(current.folderNumber).length === 0
  ) {
    return Response.json({ code: "not_assigned" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE event_rosters SET folder_returned = ?, folder_returned_at = ?, updated_at = ? " +
        "WHERE event_id = ? AND profile_id = ?",
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

export async function exportMusicFolderReportFromStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = queryRequestSchema.safeParse(await parseRequestBody(request));
  if (!parsed.success) {
    return Response.json({ code: "invalid_music_folder_report_export" }, { status: 400 });
  }
  if (!identityMatches(storage, parsed.data.organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const invalid = validateSelectedPerformances(storage, parsed.data.eventIds);
  if (invalid) return invalid;
  const rows = folderRowsForEvents(storage, parsed.data.eventIds);
  const assignedProfiles = new Set(
    rows
      .filter((row) => normalizeFolderNumber(row.folderNumber).length > 0)
      .map((row) => row.profileId),
  );
  const exportRows = rows
    .filter((row) => assignedProfiles.has(row.profileId))
    .map((row) => ({
      eventTitle: row.eventTitle,
      folderNumber: normalizeFolderNumber(row.folderNumber),
      isArchived: row.isArchived === 1,
      isCanceled: row.isCanceled === 1,
      profileName: row.displayName,
      returnedAt: row.returnedAt,
      startsAt: row.startsAt,
      status: deriveMusicFolderStatus(row.folderNumber, row.folderReturned === 1),
    }))
    .filter(
      (
        row,
      ): row is typeof row & {
        status: Exclude<MusicFolderReportStatus, "not_applicable">;
      } => row.status !== "not_applicable",
    );
  if (exportRows.length > MUSIC_FOLDER_REPORT_MAX_EXPORT_ROWS) {
    return Response.json({ code: "music_folder_report_export_too_large" }, { status: 413 });
  }
  const csv = renderMusicFolderReportCsv(exportRows);
  if (new TextEncoder().encode(csv).byteLength > MUSIC_FOLDER_REPORT_MAX_EXPORT_BYTES) {
    return Response.json({ code: "music_folder_report_export_too_large" }, { status: 413 });
  }
  return new Response(csv, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": 'attachment; filename="music_folder_report.csv"',
      "content-type": "text/csv; charset=utf-8",
    },
  });
}
