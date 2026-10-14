import type { SqlStorageValue } from "@cloudflare/workers-types";
import type {
  ProfileReconciliationCounts,
  ProfileReconciliationFieldChoices,
  ProfileReconciliationProfileSummary,
} from "@choir/contracts";

export interface ProfileReconciliationStoreStorage {
  readonly sql: {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: readonly unknown[]
    ): {
      readonly [Symbol.iterator]: () => Iterator<T>;
      readonly one: () => T;
      readonly toArray: () => T[];
    };
  };
  readonly transactionSync?: <T>(fn: () => T) => T;
}

export interface PreviewProfileReconciliationInput {
  readonly membershipEmail: string;
  readonly membershipId: string;
  readonly memberName: string;
  readonly memberRole: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly sourceProfileId: string;
  readonly targetProfileId: string;
}

export interface PrepareProfileReconciliationInput {
  readonly actorUserId: string;
  readonly expectedSourceProfileId: string;
  readonly fieldChoices: ProfileReconciliationFieldChoices;
  readonly idempotencyKey: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly previewRevision: string;
  readonly reconciliationId: string;
  readonly requestId: string;
  readonly targetProfileId: string;
}

export interface CommitProfileReconciliationInput {
  readonly actorUserId: string;
  readonly expectedSourceProfileId: string;
  readonly fieldChoices: ProfileReconciliationFieldChoices;
  readonly idempotencyKey: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly previewRevision: string;
  readonly reconciliationId: string;
  readonly requestId: string;
  readonly targetProfileId: string;
}

export interface RawProfileRow {
  readonly [column: string]: SqlStorageValue;
  readonly bounce_reason?: string;
  readonly created_at: string;
  readonly display_name: string;
  readonly do_not_email: number;
  readonly global_status: string;
  readonly hidden: number;
  readonly id: string;
  readonly is_section_leader: number;
  readonly last_bounce_at?: string | null;
  readonly merged_into_profile_id: string | null;
  readonly notes: string;
  readonly phone: string;
  readonly photo_file_id?: string | null;
  readonly provider_email_suppressed?: number;
  readonly provider_email_suppressed_at?: string;
  readonly provider_email_suppressed_reason?: string;
  readonly receive_volunteer_emails?: number;
  readonly receive_weekly_reminders?: number;
  readonly show_in_directory: number;
  readonly status_is_manual?: number;
  readonly updated_at: string;
  readonly voice_part: string;
}

export interface EventRosterRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendance: string;
  readonly created_at: string;
  readonly event_id: string;
  readonly folder_number: string;
  readonly folder_returned: number;
  readonly folder_returned_at: string | null;
  readonly profile_id: string;
  readonly rsvp: string;
  readonly rsvp_note: string;
  readonly updated_at: string;
}

export interface OrgMetadataRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

export function checkOrganizationId(
  storage: ProfileReconciliationStoreStorage,
  expectedOrgId: string,
): boolean {
  if (!expectedOrgId) {
    return false;
  }
  const row = storage.sql
    .exec<OrgMetadataRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  return row?.organizationId === expectedOrgId;
}

export function queryTableStats(
  storage: ProfileReconciliationStoreStorage,
  table: string,
  tsColumn: string,
  sourceId: string,
  targetId: string,
): string {
  const row = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly count: number;
      readonly max_ts: string | null;
    }>(
      `SELECT COUNT(*) AS count, MAX(${tsColumn}) AS max_ts FROM ${table} WHERE profile_id IN (?, ?)`,
      sourceId,
      targetId,
    )
    .toArray()
    .at(0);
  const countStr = String(row?.count ?? 0);
  const maxTsStr = row?.max_ts ?? "";
  return `${countStr}:${maxTsStr}`;
}

export function queryRowCount(
  storage: ProfileReconciliationStoreStorage,
  query: string,
  ...params: readonly unknown[]
): number {
  const row = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(query, ...params)
    .toArray()
    .at(0);
  return row ? row.count : 0;
}

export function computePreviewRevision(
  storage: ProfileReconciliationStoreStorage,
  source: RawProfileRow,
  target: RawProfileRow,
): string {
  const payload = [
    source.id,
    source.updated_at,
    target.id,
    target.updated_at,
    queryTableStats(storage, "event_rosters", "updated_at", source.id, target.id),
    queryTableStats(storage, "poll_responses", "responded_at", source.id, target.id),
    queryTableStats(storage, "dues", "updated_at", source.id, target.id),
    queryTableStats(storage, "contacts", "updated_at", source.id, target.id),
    queryTableStats(storage, "communication_deliveries", "updated_at", source.id, target.id),
    queryTableStats(storage, "communication_suppressions", "updated_at", source.id, target.id),
  ].join(":");

  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash << 5) - hash + payload.charCodeAt(i);
    hash |= 0;
  }
  return `rev-${Math.abs(hash).toString(16)}-${source.updated_at.slice(0, 10)}`;
}

export function countAssignedSeats(
  storage: ProfileReconciliationStoreStorage,
  profileId: string,
): number {
  const charts = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly assignments_json: string }>(
      "SELECT assignments_json FROM seating_charts WHERE assignments_json LIKE '%\"' || ? || '\"%'",
      profileId,
    )
    .toArray();

  let seatCount = 0;
  for (const chart of charts) {
    try {
      const parsed: unknown = JSON.parse(chart.assignments_json);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        for (const val of Object.values(parsed)) {
          if (val === profileId) {
            seatCount++;
          }
        }
      }
    } catch {
      // Ignore count error
    }
  }
  return seatCount;
}

export function computeTransferCounts(
  storage: ProfileReconciliationStoreStorage,
  sourceId: string,
  targetId: string,
): ProfileReconciliationCounts {
  const eventMoved = queryRowCount(
    storage,
    `SELECT COUNT(*) AS count FROM event_rosters s
     WHERE s.profile_id = ? AND NOT EXISTS (
       SELECT 1 FROM event_rosters t WHERE t.profile_id = ? AND t.event_id = s.event_id
     )`,
    sourceId,
    targetId,
  );

  const eventCombined = queryRowCount(
    storage,
    `SELECT COUNT(*) AS count FROM event_rosters s
     WHERE s.profile_id = ? AND EXISTS (
       SELECT 1 FROM event_rosters t WHERE t.profile_id = ? AND t.event_id = s.event_id
     )`,
    sourceId,
    targetId,
  );

  const pollCount = queryRowCount(
    storage,
    "SELECT COUNT(*) AS count FROM poll_responses WHERE profile_id = ?",
    sourceId,
  );

  const duesCount = queryRowCount(
    storage,
    "SELECT COUNT(*) AS count FROM dues WHERE profile_id = ?",
    sourceId,
  );

  const suppressionCount = queryRowCount(
    storage,
    "SELECT COUNT(*) AS count FROM communication_suppressions WHERE profile_id = ?",
    sourceId,
  );

  const rsvpHistCount = queryRowCount(
    storage,
    "SELECT COUNT(*) AS count FROM event_rsvp_history WHERE profile_id = ?",
    sourceId,
  );

  const statusHistCount = queryRowCount(
    storage,
    "SELECT COUNT(*) AS count FROM profile_status_history WHERE profile_id = ?",
    sourceId,
  );

  const seatingCount = countAssignedSeats(storage, sourceId);

  return {
    duesMoved: duesCount,
    eventRostersCombined: eventCombined,
    eventRostersMoved: eventMoved,
    historyRowsRetained: rsvpHistCount + statusHistCount,
    pollResponsesMoved: pollCount,
    seatingAssignmentsUpdated: seatingCount,
    suppressionsMoved: suppressionCount,
  };
}

export function mapProfileSummary(
  row: RawProfileRow,
  membershipEmail?: string | null,
): ProfileReconciliationProfileSummary {
  return {
    createdAt: row.created_at,
    displayName: row.display_name,
    doNotEmail: row.do_not_email === 1,
    globalStatus: row.global_status,
    hidden: row.hidden === 1,
    id: row.id,
    isSectionLeader: row.is_section_leader === 1,
    lastBounceAt: row.last_bounce_at ?? null,
    membershipEmail: membershipEmail ?? null,
    notes: row.notes,
    phone: row.phone,
    photoFileId: row.photo_file_id ?? null,
    providerEmailSuppressed: row.provider_email_suppressed === 1,
    receiveVolunteerEmails: row.receive_volunteer_emails === 1,
    receiveWeeklyReminders: row.receive_weekly_reminders === 1,
    showInDirectory: row.show_in_directory === 1,
    statusIsManual: row.status_is_manual === 1,
    updatedAt: row.updated_at,
    voicePart: row.voice_part,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFieldChoices(
  rawJson: string | undefined,
  fallback: ProfileReconciliationFieldChoices,
): ProfileReconciliationFieldChoices {
  if (!rawJson) return fallback;
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (!isRecord(parsed)) return fallback;
    const notes =
      parsed.notes === "overwrite_with_source" ||
      parsed.notes === "append_source" ||
      parsed.notes === "keep_target"
        ? parsed.notes
        : fallback.notes;
    const phone =
      parsed.phone === "overwrite_with_source" || parsed.phone === "keep_target"
        ? parsed.phone
        : fallback.phone;
    return { notes, phone };
  } catch {
    return fallback;
  }
}
