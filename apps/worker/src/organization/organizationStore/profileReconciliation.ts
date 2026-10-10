import type { SqlStorageValue } from "@cloudflare/workers-types";
import type {
  ProfileReconciliationCandidate,
  ProfileReconciliationConflictInventory,
  ProfileReconciliationCounts,
  ProfileReconciliationFieldChoices,
  ProfileReconciliationPreviewResponse,
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

interface RawProfileRow {
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

interface EventRosterRow {
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

interface OrgMetadataRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

function checkOrganizationId(
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

function queryTableStats(
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

function queryRowCount(
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

function computePreviewRevision(
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

function countAssignedSeats(storage: ProfileReconciliationStoreStorage, profileId: string): number {
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

function computeTransferCounts(
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

function mapProfileSummary(
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

function checkEventRosterBlocker(
  sRoster: EventRosterRow,
  tRoster: EventRosterRow,
  blockers: string[],
  conflicts: ProfileReconciliationConflictInventory["eventRosterConflicts"],
): boolean {
  const rsvpConflict =
    sRoster.rsvp !== "Pending" && tRoster.rsvp !== "Pending" && sRoster.rsvp !== tRoster.rsvp;

  const attendanceConflict =
    sRoster.attendance !== "Pending" &&
    tRoster.attendance !== "Pending" &&
    sRoster.attendance !== tRoster.attendance;

  const folderConflict =
    sRoster.folder_number !== "" &&
    tRoster.folder_number !== "" &&
    sRoster.folder_number.toLowerCase() !== tRoster.folder_number.toLowerCase();

  if (!rsvpConflict && !attendanceConflict && !folderConflict) {
    return false;
  }

  const reasons: string[] = [];
  if (rsvpConflict) reasons.push(`RSVP (${sRoster.rsvp} vs ${tRoster.rsvp})`);
  if (attendanceConflict) {
    reasons.push(`Attendance (${sRoster.attendance} vs ${tRoster.attendance})`);
  }
  if (folderConflict) {
    reasons.push(`Folder (${sRoster.folder_number} vs ${tRoster.folder_number})`);
  }
  const reason = `Conflicting event records: ${reasons.join(", ")}`;
  blockers.push(`Event ${sRoster.event_id}: ${reason}`);
  conflicts.push({
    eventId: sRoster.event_id,
    reason,
    sourceAttendance: sRoster.attendance,
    sourceRsvp: sRoster.rsvp,
    targetAttendance: tRoster.attendance,
    targetRsvp: tRoster.rsvp,
  });
  return true;
}

function checkEventRosterWarnings(
  sRoster: EventRosterRow,
  tRoster: EventRosterRow,
  warnings: string[],
): void {
  if (sRoster.rsvp !== tRoster.rsvp) {
    const chosen = sRoster.rsvp !== "Pending" ? sRoster.rsvp : tRoster.rsvp;
    warnings.push(
      `Event ${sRoster.event_id}: Non-pending RSVP '${chosen}' will be selected over Pending.`,
    );
  }
  if (sRoster.attendance !== tRoster.attendance) {
    const chosen = sRoster.attendance !== "Pending" ? sRoster.attendance : tRoster.attendance;
    warnings.push(
      `Event ${sRoster.event_id}: Non-pending attendance '${chosen}' will be selected over Pending.`,
    );
  }
}

function evaluateEventRosterPair(
  sRoster: EventRosterRow,
  tRoster: EventRosterRow,
  blockers: string[],
  warnings: string[],
  conflicts: ProfileReconciliationConflictInventory["eventRosterConflicts"],
): void {
  const isBlocked = checkEventRosterBlocker(sRoster, tRoster, blockers, conflicts);
  if (!isBlocked) {
    checkEventRosterWarnings(sRoster, tRoster, warnings);
  }
}

function findEventRosterConflicts(
  storage: ProfileReconciliationStoreStorage,
  sourceProfileId: string,
  targetProfileId: string,
  blockers: string[],
  warnings: string[],
  conflicts: ProfileReconciliationConflictInventory["eventRosterConflicts"],
): void {
  const sourceEventRosters = storage.sql
    .exec<EventRosterRow>("SELECT * FROM event_rosters WHERE profile_id = ?", sourceProfileId)
    .toArray();
  const targetEventRosters = storage.sql
    .exec<EventRosterRow>("SELECT * FROM event_rosters WHERE profile_id = ?", targetProfileId)
    .toArray();

  const targetEventMap = new Map(targetEventRosters.map((r) => [r.event_id, r]));

  for (const sRoster of sourceEventRosters) {
    const tRoster = targetEventMap.get(sRoster.event_id);
    if (tRoster) {
      evaluateEventRosterPair(sRoster, tRoster, blockers, warnings, conflicts);
    }
  }
}

function findPollConflicts(
  storage: ProfileReconciliationStoreStorage,
  sourceProfileId: string,
  targetProfileId: string,
  blockers: string[],
  conflicts: ProfileReconciliationConflictInventory["pollConflicts"],
): void {
  const duplicatePolls = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly poll_id: string }>(
      `SELECT p1.poll_id FROM poll_responses p1
       JOIN poll_responses p2 ON p1.poll_id = p2.poll_id
       WHERE p1.profile_id = ? AND p2.profile_id = ?`,
      sourceProfileId,
      targetProfileId,
    )
    .toArray();

  for (const dup of duplicatePolls) {
    const reason = "Both profiles have cast votes on this poll.";
    blockers.push(`Poll ${dup.poll_id}: ${reason}`);
    conflicts.push({
      pollId: dup.poll_id,
      reason,
    });
  }
}

function findDuesConflicts(
  storage: ProfileReconciliationStoreStorage,
  sourceProfileId: string,
  targetProfileId: string,
  blockers: string[],
  conflicts: ProfileReconciliationConflictInventory["duesConflicts"],
): void {
  const duplicateDues = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly s1: string;
      readonly s2: string;
      readonly season_id: string;
    }>(
      `SELECT d1.season_id, d1.status AS s1, d2.status AS s2
       FROM dues d1
       JOIN dues d2 ON d1.season_id = d2.season_id
       WHERE d1.profile_id = ? AND d2.profile_id = ?`,
      sourceProfileId,
      targetProfileId,
    )
    .toArray();

  for (const dup of duplicateDues) {
    const reason = `Both profiles have dues records for season ${dup.season_id} (${dup.s1} vs ${dup.s2}).`;
    blockers.push(`Dues: ${reason}`);
    conflicts.push({
      reason,
      seasonId: dup.season_id,
      sourceStatus: dup.s1,
      targetStatus: dup.s2,
    });
  }

  const settledSourceDues = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly id: string;
      readonly provider_session_id: string;
      readonly season_id: string;
      readonly status: string;
    }>(
      `SELECT id, season_id, status, provider_session_id FROM dues
       WHERE profile_id = ? AND (status IN ('paid', 'refunded') OR provider_session_id <> '')`,
      sourceProfileId,
    )
    .toArray();

  for (const settled of settledSourceDues) {
    const reason = `Source profile has settled dues or payment session (${settled.status}) for season ${settled.season_id}.`;
    blockers.push(`Financial history: ${reason}`);
    conflicts.push({
      reason,
      seasonId: settled.season_id,
      sourceStatus: settled.status,
    });
  }
}

function findContactConflicts(
  storage: ProfileReconciliationStoreStorage,
  sourceProfileId: string,
  targetProfileId: string,
  blockers: string[],
  conflicts: ProfileReconciliationConflictInventory["contactConflicts"],
): void {
  const sourceContacts = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM contacts WHERE profile_id = ?",
      sourceProfileId,
    )
    .toArray();
  const targetContacts = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM contacts WHERE profile_id = ?",
      targetProfileId,
    )
    .toArray();

  const sourceContactId = sourceContacts[0]?.id ?? "";
  const targetContactId = targetContacts[0]?.id ?? "";
  if (sourceContactId && targetContactId && sourceContactId !== targetContactId) {
    const reason = `Source profile is linked to contact ${sourceContactId} while target is linked to contact ${targetContactId}.`;
    blockers.push(`Contacts: ${reason}`);
    conflicts.push({
      contactId: sourceContactId,
      reason,
    });
  }
  // Note: contacts.normalized_email carries a global UNIQUE WHERE NOT NULL index, so moving
  // source contacts to an empty target cannot create an email duplicate: profile_id is not part
  // of that constraint and the source rows already satisfy uniqueness in place.
}

function findDeliveryConflicts(
  storage: ProfileReconciliationStoreStorage,
  sourceProfileId: string,
  targetProfileId: string,
  blockers: string[],
  conflicts: ProfileReconciliationConflictInventory["deliveryConflicts"],
): void {
  const collisions = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly channel: string;
      readonly message_id: string;
    }>(
      `SELECT s.message_id, s.channel FROM communication_deliveries s
        JOIN communication_deliveries t
          ON t.message_id = s.message_id AND t.channel = s.channel
        WHERE s.profile_id = ? AND t.profile_id = ?`,
      sourceProfileId,
      targetProfileId,
    )
    .toArray();
  for (const row of collisions) {
    const reason =
      "Both profiles have delivery records for the same message and channel. Merging would discard one immutable delivery history.";
    blockers.push(`Delivery ${row.message_id} (${row.channel}): ${reason}`);
    conflicts.push({ channel: row.channel, messageId: row.message_id, reason });
  }
}

function validateProfilesForPreview(
  storage: ProfileReconciliationStoreStorage,
  input: PreviewProfileReconciliationInput,
):
  | { readonly error: { readonly code: string; readonly message: string }; readonly ok: false }
  | { readonly ok: true; readonly source: RawProfileRow; readonly target: RawProfileRow } {
  if (!checkOrganizationId(storage, input.organizationId)) {
    return {
      error: { code: "organization_mismatch", message: "Organization mismatch." },
      ok: false,
    };
  }

  if (input.sourceProfileId === input.targetProfileId) {
    return {
      error: {
        code: "identical_profiles",
        message: "Cannot reconcile a profile with itself.",
      },
      ok: false,
    };
  }

  const sourceRows = storage.sql
    .exec<RawProfileRow>("SELECT * FROM profiles WHERE id = ? LIMIT 1", input.sourceProfileId)
    .toArray();
  const source = sourceRows[0];
  if (!source) {
    return {
      error: { code: "source_not_found", message: "Source profile not found." },
      ok: false,
    };
  }

  const targetRows = storage.sql
    .exec<RawProfileRow>("SELECT * FROM profiles WHERE id = ? LIMIT 1", input.targetProfileId)
    .toArray();
  const target = targetRows[0];
  if (!target) {
    return {
      error: { code: "target_not_found", message: "Target profile not found." },
      ok: false,
    };
  }

  return { ok: true, source, target };
}

function checkNoteConflict(sourceNotes: string, targetNotes: string, warnings: string[]): boolean {
  const hasConflict = Boolean(
    sourceNotes && targetNotes && sourceNotes.trim() !== targetNotes.trim(),
  );
  if (hasConflict) {
    warnings.push(
      "Both profiles contain notes; choose whether to keep target, overwrite, or append.",
    );
  }
  return hasConflict;
}

function gatherProfileMetadataWarnings(
  source: RawProfileRow,
  target: RawProfileRow,
  warnings: string[],
): boolean {
  if (source.voice_part && target.voice_part && source.voice_part !== target.voice_part) {
    warnings.push(
      `Voice part differs (source: '${source.voice_part}', target: '${target.voice_part}'). Target will be preserved.`,
    );
  }
  if (source.is_section_leader !== target.is_section_leader) {
    warnings.push(
      `Section leader flag differs (source: ${source.is_section_leader === 1 ? "true" : "false"}, target: ${target.is_section_leader === 1 ? "true" : "false"}). Target will be preserved.`,
    );
  }
  if (source.show_in_directory !== target.show_in_directory) {
    warnings.push(
      `Directory visibility differs (source: ${source.show_in_directory === 1 ? "true" : "false"}, target: ${target.show_in_directory === 1 ? "true" : "false"}). Target will be preserved.`,
    );
  }
  if (source.phone && target.phone && source.phone !== target.phone) {
    warnings.push(
      `Target phone '${target.phone}' will be kept unless overwritten with '${source.phone}'.`,
    );
  }

  return checkNoteConflict(source.notes, target.notes, warnings);
}

export function previewProfileReconciliationInStore(
  storage: ProfileReconciliationStoreStorage,
  input: PreviewProfileReconciliationInput,
): {
  readonly error?: { readonly code: string; readonly message: string };
  readonly ok: boolean;
  readonly preview?: ProfileReconciliationPreviewResponse;
} {
  const validated = validateProfilesForPreview(storage, input);
  if (!validated.ok) {
    return validated;
  }
  const { source, target } = validated;

  if (source.merged_into_profile_id === input.targetProfileId) {
    return {
      ok: true,
      preview: {
        canReconcile: true,
        conflictInventory: {
          blockers: [],
          contactConflicts: [],
          deliveryConflicts: [],
          duesConflicts: [],
          eventRosterConflicts: [],
          noteConflict: null,
          pollConflicts: [],
          transferCounts: {
            duesMoved: 0,
            eventRostersCombined: 0,
            eventRostersMoved: 0,
            historyRowsRetained: 0,
            pollResponsesMoved: 0,
            seatingAssignmentsUpdated: 0,
            suppressionsMoved: 0,
          },
          warnings: ["Source profile is already consolidated into target profile."],
        },
        memberEmail: input.membershipEmail,
        membershipId: input.membershipId,
        memberName: input.memberName,
        memberRole: input.memberRole,
        previewRevision: computePreviewRevision(storage, source, target),
        requestId: input.requestId,
        sourceProfile: mapProfileSummary(source, input.membershipEmail),
        status: "already_consolidated",
        targetProfile: mapProfileSummary(target),
      },
    };
  }

  const blockers: string[] = [];
  const warnings: string[] = [];
  const eventRosterConflicts: ProfileReconciliationConflictInventory["eventRosterConflicts"] = [];
  const pollConflicts: ProfileReconciliationConflictInventory["pollConflicts"] = [];
  const duesConflicts: ProfileReconciliationConflictInventory["duesConflicts"] = [];
  const contactConflicts: ProfileReconciliationConflictInventory["contactConflicts"] = [];
  const deliveryConflicts: ProfileReconciliationConflictInventory["deliveryConflicts"] = [];

  if (source.merged_into_profile_id) {
    blockers.push("Source profile has already been retired and merged into another profile.");
  }
  if (target.merged_into_profile_id) {
    blockers.push("Target profile has already been retired and merged into another profile.");
  }

  findEventRosterConflicts(
    storage,
    input.sourceProfileId,
    input.targetProfileId,
    blockers,
    warnings,
    eventRosterConflicts,
  );
  findPollConflicts(storage, input.sourceProfileId, input.targetProfileId, blockers, pollConflicts);
  findDuesConflicts(storage, input.sourceProfileId, input.targetProfileId, blockers, duesConflicts);
  findContactConflicts(
    storage,
    input.sourceProfileId,
    input.targetProfileId,
    blockers,
    contactConflicts,
  );
  findDeliveryConflicts(
    storage,
    input.sourceProfileId,
    input.targetProfileId,
    blockers,
    deliveryConflicts,
  );

  const hasNoteConflict = gatherProfileMetadataWarnings(source, target, warnings);

  const previewRevision = computePreviewRevision(storage, source, target);
  const transferCounts = computeTransferCounts(storage, source.id, target.id);
  const status =
    blockers.length > 0 ? "blocked" : warnings.length > 0 ? "needs_conflict_resolution" : "ready";

  return {
    ok: true,
    preview: {
      canReconcile: blockers.length === 0,
      conflictInventory: {
        blockers,
        contactConflicts,
        deliveryConflicts,
        duesConflicts,
        eventRosterConflicts,
        noteConflict: hasNoteConflict
          ? { sourceNotes: source.notes, targetNotes: target.notes }
          : null,
        pollConflicts,
        transferCounts,
        warnings,
      },
      memberEmail: input.membershipEmail,
      membershipId: input.membershipId,
      memberName: input.memberName,
      memberRole: input.memberRole,
      previewRevision,
      requestId: input.requestId,
      sourceProfile: mapProfileSummary(source, input.membershipEmail),
      status,
      targetProfile: mapProfileSummary(target),
    },
  };
}

export function prepareProfileReconciliationInStore(
  storage: ProfileReconciliationStoreStorage,
  input: PrepareProfileReconciliationInput,
): {
  readonly error?: { readonly code: string; readonly message: string };
  readonly ok: boolean;
} {
  const previewResult = previewProfileReconciliationInStore(storage, {
    membershipEmail: "",
    membershipId: input.membershipId,
    memberName: "",
    memberRole: "",
    organizationId: input.organizationId,
    requestId: input.requestId,
    sourceProfileId: input.expectedSourceProfileId,
    targetProfileId: input.targetProfileId,
  });

  if (!previewResult.ok || !previewResult.preview) {
    return {
      error: previewResult.error ?? {
        code: "preview_failed",
        message: "Failed to generate reconciliation preview.",
      },
      ok: false,
    };
  }

  const preview = previewResult.preview;
  if (!preview.canReconcile) {
    return {
      error: {
        code: "unresolved_conflicts",
        message: `Profile reconciliation blocked: ${preview.conflictInventory.blockers.join("; ")}`,
      },
      ok: false,
    };
  }

  if (preview.previewRevision !== input.previewRevision) {
    return {
      error: {
        code: "stale_preview",
        message:
          "Profile data was modified after the reconciliation preview was generated. Please refresh.",
      },
      ok: false,
    };
  }

  storage.sql.exec(
    `INSERT INTO profile_reconciliations
      (id, source_profile_id, target_profile_id, membership_id, actor_user_id,
       state, preview_revision, field_choices_json, conflict_summary_json, created_at)
     VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       state = excluded.state,
       preview_revision = excluded.preview_revision,
       field_choices_json = excluded.field_choices_json`,
    input.reconciliationId,
    input.expectedSourceProfileId,
    input.targetProfileId,
    input.membershipId,
    input.actorUserId,
    input.previewRevision,
    JSON.stringify(input.fieldChoices),
    JSON.stringify(preview.conflictInventory),
    new Date().toISOString(),
  );

  return { ok: true };
}

function combineEventRosters(
  storage: ProfileReconciliationStoreStorage,
  sourceId: string,
  targetId: string,
  now: string,
): void {
  const sourceEventRosters = storage.sql
    .exec<EventRosterRow>("SELECT * FROM event_rosters WHERE profile_id = ?", sourceId)
    .toArray();

  for (const sRoster of sourceEventRosters) {
    const tRoster = storage.sql
      .exec<EventRosterRow>(
        "SELECT * FROM event_rosters WHERE event_id = ? AND profile_id = ? LIMIT 1",
        sRoster.event_id,
        targetId,
      )
      .toArray()
      .at(0);

    if (tRoster) {
      const rsvp = tRoster.rsvp !== "Pending" ? tRoster.rsvp : sRoster.rsvp;
      const attendance = tRoster.attendance !== "Pending" ? tRoster.attendance : sRoster.attendance;
      const folderNumber =
        tRoster.folder_number !== "" ? tRoster.folder_number : sRoster.folder_number;
      const folderReturned =
        tRoster.folder_number !== "" ? tRoster.folder_returned : sRoster.folder_returned;
      const folderReturnedAt =
        tRoster.folder_number !== "" ? tRoster.folder_returned_at : sRoster.folder_returned_at;
      let rsvpNote = tRoster.rsvp_note;
      if (!rsvpNote) {
        rsvpNote = sRoster.rsvp_note;
      } else if (sRoster.rsvp_note && sRoster.rsvp_note !== tRoster.rsvp_note) {
        rsvpNote = `${tRoster.rsvp_note} | [Duplicate Profile Note]: ${sRoster.rsvp_note}`;
      }

      storage.sql.exec(
        `UPDATE event_rosters
         SET rsvp = ?, attendance = ?, folder_number = ?, folder_returned = ?,
             folder_returned_at = ?, rsvp_note = ?, updated_at = ?
         WHERE event_id = ? AND profile_id = ?`,
        rsvp,
        attendance,
        folderNumber,
        folderReturned,
        folderReturnedAt,
        rsvpNote,
        now,
        sRoster.event_id,
        targetId,
      );

      storage.sql.exec(
        "DELETE FROM event_rosters WHERE event_id = ? AND profile_id = ?",
        sRoster.event_id,
        sourceId,
      );
    } else {
      storage.sql.exec(
        "UPDATE event_rosters SET profile_id = ?, updated_at = ? WHERE event_id = ? AND profile_id = ?",
        targetId,
        now,
        sRoster.event_id,
        sourceId,
      );
    }
  }
}

function updateSeatingCharts(
  storage: ProfileReconciliationStoreStorage,
  sourceProfileId: string,
  targetProfileId: string,
  now: string,
): void {
  const charts = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly assignments_json: string;
      readonly id: string;
    }>(
      "SELECT id, assignments_json FROM seating_charts WHERE assignments_json LIKE '%\"' || ? || '\"%'",
      sourceProfileId,
    )
    .toArray();

  for (const chart of charts) {
    try {
      const parsed: unknown = JSON.parse(chart.assignments_json);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        let changed = false;
        const record: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(parsed)) {
          if (val === sourceProfileId) {
            record[key] = targetProfileId;
            changed = true;
          } else {
            record[key] = val;
          }
        }
        if (changed) {
          storage.sql.exec(
            "UPDATE seating_charts SET assignments_json = ?, updated_at = ? WHERE id = ?",
            JSON.stringify(record),
            now,
            chart.id,
          );
        }
      }
    } catch {
      // Ignore malformed JSON safely
    }
  }
}

function transferDeliveries(
  storage: ProfileReconciliationStoreStorage,
  sourceId: string,
  targetId: string,
): void {
  const collision = storage.sql
    .exec(
      `SELECT 1 FROM communication_deliveries s
        JOIN communication_deliveries t
          ON t.message_id = s.message_id AND t.channel = s.channel
        WHERE s.profile_id = ? AND t.profile_id = ? LIMIT 1`,
      sourceId,
      targetId,
    )
    .toArray().length;
  if (collision > 0) {
    throw new Error("Delivery collision detected; reconciliation blocked to preserve history.");
  }
  storage.sql.exec(
    "UPDATE communication_deliveries SET profile_id = ? WHERE profile_id = ?",
    targetId,
    sourceId,
  );
}

function applyProfileEmailFlagsAndSuppressions(
  storage: ProfileReconciliationStoreStorage,
  target: RawProfileRow,
  source: RawProfileRow,
  now: string,
): void {
  if (source.do_not_email === 1 && target.do_not_email === 0) {
    storage.sql.exec(
      "UPDATE profiles SET do_not_email = 1, updated_at = ? WHERE id = ?",
      now,
      target.id,
    );
  }

  if (source.provider_email_suppressed === 1 && target.provider_email_suppressed !== 1) {
    storage.sql.exec(
      `UPDATE profiles SET
         provider_email_suppressed = 1,
         provider_email_suppressed_at = ?,
         provider_email_suppressed_reason = ?,
         updated_at = ?
       WHERE id = ?`,
      source.provider_email_suppressed_at ?? now,
      source.provider_email_suppressed_reason ?? "Suppressed on duplicate profile",
      now,
      target.id,
    );
  }

  if (
    source.last_bounce_at &&
    (!target.last_bounce_at || source.last_bounce_at > target.last_bounce_at)
  ) {
    storage.sql.exec(
      `UPDATE profiles SET
         last_bounce_at = ?,
         bounce_reason = ?,
         updated_at = ?
       WHERE id = ?`,
      source.last_bounce_at,
      source.bounce_reason ?? "Bounced on duplicate profile",
      now,
      target.id,
    );
  }

  if (!target.photo_file_id && source.photo_file_id) {
    storage.sql.exec(
      "UPDATE profiles SET photo_file_id = ?, updated_at = ? WHERE id = ?",
      source.photo_file_id,
      now,
      target.id,
    );
  }
}

function propagateCommunicationSuppressions(
  storage: ProfileReconciliationStoreStorage,
  targetId: string,
  sourceId: string,
  now: string,
): void {
  const sourceSuppressions = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly active: number;
      readonly channel: string;
      readonly reason: string;
      readonly source_message_id: string;
    }>("SELECT * FROM communication_suppressions WHERE profile_id = ? AND active = 1", sourceId)
    .toArray();

  for (const sup of sourceSuppressions) {
    storage.sql.exec(
      `INSERT INTO communication_suppressions
         (id, profile_id, channel, reason, source_message_id, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(profile_id, channel) DO UPDATE SET active = 1, updated_at = excluded.updated_at`,
      crypto.randomUUID(),
      targetId,
      sup.channel,
      sup.reason,
      sup.source_message_id,
      now,
      now,
    );
  }
}

function applyFieldChoicesAndSuppressions(
  storage: ProfileReconciliationStoreStorage,
  target: RawProfileRow,
  source: RawProfileRow,
  fieldChoices: ProfileReconciliationFieldChoices,
  now: string,
): void {
  if (fieldChoices.phone === "overwrite_with_source" && source.phone) {
    storage.sql.exec(
      "UPDATE profiles SET phone = ?, updated_at = ? WHERE id = ?",
      source.phone,
      now,
      target.id,
    );
  }
  if (fieldChoices.notes === "overwrite_with_source" && source.notes) {
    storage.sql.exec(
      "UPDATE profiles SET notes = ?, updated_at = ? WHERE id = ?",
      source.notes,
      now,
      target.id,
    );
  } else if (fieldChoices.notes === "append_source" && source.notes) {
    const combined = target.notes ? `${target.notes}\n\n${source.notes}` : source.notes;
    storage.sql.exec(
      "UPDATE profiles SET notes = ?, updated_at = ? WHERE id = ?",
      combined,
      now,
      target.id,
    );
  }

  applyProfileEmailFlagsAndSuppressions(storage, target, source, now);
  propagateCommunicationSuppressions(storage, target.id, source.id, now);
}

function validateCommitProfiles(
  storage: ProfileReconciliationStoreStorage,
  input: CommitProfileReconciliationInput,
): {
  readonly error?: { readonly code: string; readonly message: string };
  readonly ok: boolean;
  readonly source?: RawProfileRow;
  readonly target?: RawProfileRow;
} {
  const target = storage.sql
    .exec<RawProfileRow>("SELECT * FROM profiles WHERE id = ? LIMIT 1", input.targetProfileId)
    .toArray()
    .at(0);
  const source = storage.sql
    .exec<RawProfileRow>(
      "SELECT * FROM profiles WHERE id = ? LIMIT 1",
      input.expectedSourceProfileId,
    )
    .toArray()
    .at(0);

  if (!target) {
    return {
      error: { code: "target_not_found", message: "Target profile not found." },
      ok: false,
    };
  }
  if (!source) {
    return {
      error: { code: "source_not_found", message: "Source profile not found." },
      ok: false,
    };
  }

  return { ok: true, source, target };
}

function resolveCommitPreview(
  storage: ProfileReconciliationStoreStorage,
  input: CommitProfileReconciliationInput,
): {
  readonly error?: { readonly code: string; readonly message: string };
  readonly ok: boolean;
} {
  const previewResult = previewProfileReconciliationInStore(storage, {
    membershipEmail: "",
    membershipId: input.membershipId,
    memberName: "",
    memberRole: "",
    organizationId: input.organizationId,
    requestId: input.requestId,
    sourceProfileId: input.expectedSourceProfileId,
    targetProfileId: input.targetProfileId,
  });

  if (!previewResult.ok || !previewResult.preview) {
    return {
      error: previewResult.error ?? {
        code: "preview_failed",
        message: "Failed to evaluate profile preview.",
      },
      ok: false,
    };
  }
  if (!previewResult.preview.canReconcile) {
    return {
      error: {
        code: "unresolved_conflicts",
        message: `Profile reconciliation blocked: ${previewResult.preview.conflictInventory.blockers.join("; ")}`,
      },
      ok: false,
    };
  }
  if (previewResult.preview.previewRevision !== input.previewRevision) {
    return {
      error: {
        code: "stale_preview",
        message: "Profile data has changed since preview was generated. Please refresh preview.",
      },
      ok: false,
    };
  }

  return { ok: true };
}

export function commitProfileReconciliationInStore(
  storage: ProfileReconciliationStoreStorage,
  input: CommitProfileReconciliationInput,
  now = new Date().toISOString(),
): {
  readonly canonicalProfileId: string;
  readonly error?: { readonly code: string; readonly message: string } | undefined;
  readonly ok: boolean;
} {
  if (!checkOrganizationId(storage, input.organizationId)) {
    return {
      canonicalProfileId: input.targetProfileId,
      error: { code: "invalid_organization", message: "Organization mismatch." },
      ok: false,
    };
  }

  const existingRec = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly field_choices_json?: string;
      readonly state: string;
    }>(
      "SELECT state, field_choices_json FROM profile_reconciliations WHERE id = ? LIMIT 1",
      input.reconciliationId,
    )
    .toArray()
    .at(0);

  if (existingRec?.state === "completed") {
    return {
      canonicalProfileId: input.targetProfileId,
      ok: true,
    };
  }

  const effectiveFieldChoices = parseFieldChoices(
    existingRec?.field_choices_json,
    input.fieldChoices,
  );

  const profilesCheck = validateCommitProfiles(storage, input);
  if (!profilesCheck.ok || !profilesCheck.source || !profilesCheck.target) {
    return {
      canonicalProfileId: input.targetProfileId,
      error: profilesCheck.error,
      ok: false,
    };
  }
  const { source, target } = profilesCheck;

  const previewCheck = resolveCommitPreview(storage, input);
  if (!previewCheck.ok) {
    return {
      canonicalProfileId: input.targetProfileId,
      error: previewCheck.error,
      ok: false,
    };
  }

  const txResult = executeReconciliationTransaction(
    storage,
    input,
    source,
    target,
    effectiveFieldChoices,
    now,
  );
  if (!txResult.ok) {
    return {
      canonicalProfileId: input.targetProfileId,
      error: txResult.error,
      ok: false,
    };
  }

  return {
    canonicalProfileId: target.id,
    ok: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFieldChoices(
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

function executeReconciliationTransaction(
  storage: ProfileReconciliationStoreStorage,
  input: CommitProfileReconciliationInput,
  source: RawProfileRow,
  target: RawProfileRow,
  effectiveFieldChoices: ProfileReconciliationFieldChoices,
  now: string,
): {
  readonly error?: { readonly code: string; readonly message: string } | undefined;
  readonly ok: boolean;
} {
  const execute = () => {
    applyFieldChoicesAndSuppressions(storage, target, source, effectiveFieldChoices, now);
    combineEventRosters(storage, source.id, target.id, now);
    updateSeatingCharts(storage, source.id, target.id, now);

    storage.sql.exec(
      `UPDATE poll_responses SET profile_id = ?
       WHERE profile_id = ? AND poll_id NOT IN (
         SELECT poll_id FROM poll_responses WHERE profile_id = ?
       )`,
      target.id,
      source.id,
      target.id,
    );
    storage.sql.exec("DELETE FROM poll_responses WHERE profile_id = ?", source.id);

    storage.sql.exec(
      `UPDATE dues SET profile_id = ?
       WHERE profile_id = ? AND season_id NOT IN (
         SELECT season_id FROM dues WHERE profile_id = ?
       )`,
      target.id,
      source.id,
      target.id,
    );
    storage.sql.exec("DELETE FROM dues WHERE profile_id = ?", source.id);

    transferDeliveries(storage, source.id, target.id);
    storage.sql.exec(
      "UPDATE contacts SET profile_id = ?, updated_at = ? WHERE profile_id = ?",
      target.id,
      now,
      source.id,
    );

    storage.sql.exec(
      "UPDATE profiles SET merged_into_profile_id = ?, hidden = 1, updated_at = ? WHERE id = ?",
      target.id,
      now,
      source.id,
    );

    storage.sql.exec(
      `INSERT INTO profile_reconciliations
        (id, source_profile_id, target_profile_id, membership_id, actor_user_id,
         state, preview_revision, field_choices_json, conflict_summary_json, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, '{}', ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = 'completed', completed_at = excluded.completed_at`,
      input.reconciliationId,
      source.id,
      target.id,
      input.membershipId,
      input.actorUserId,
      input.previewRevision,
      JSON.stringify(effectiveFieldChoices),
      now,
      now,
    );

    const existingAudit = storage.sql
      .exec(
        "SELECT 1 FROM audit_events WHERE action = 'organization.profile.reconciled' AND change_summary LIKE '%\"reconciliationId\":\"' || ? || '\"%' LIMIT 1",
        input.reconciliationId,
      )
      .toArray();

    if (existingAudit.length === 0) {
      storage.sql.exec(
        `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
         VALUES (?, 'organization_member', ?, 'organization.profile.reconciled', 'profile', ?, ?, ?, ?)`,
        crypto.randomUUID(),
        input.actorUserId,
        target.id,
        input.requestId,
        JSON.stringify({
          fieldChoices: input.fieldChoices,
          mergedIntoProfileId: target.id,
          reconciliationId: input.reconciliationId,
          retiredSourceProfileId: source.id,
        }),
        now,
      );
    }
  };

  try {
    if (storage.transactionSync) {
      storage.transactionSync(execute);
    } else {
      execute();
    }
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: { code: "commit_failed", message: `Durable Object transaction failed: ${message}` },
      ok: false,
    };
  }
}

function computeCandidateMatchReasons(
  candidate: RawProfileRow,
  sourceNameNormalized: string,
  sourcePartNormalized: string,
  sourcePhoneNormalized: string,
  queryNormalized: string,
): readonly string[] {
  const candidateName = candidate.display_name.trim().toLowerCase();
  const candidatePart = candidate.voice_part.trim().toLowerCase();
  const candidatePhone = candidate.phone.replace(/\D/g, "");

  const matchReasons: string[] = [];
  if (candidateName === sourceNameNormalized) {
    matchReasons.push("Exact name match");
  } else if (
    candidateName.includes(sourceNameNormalized) ||
    sourceNameNormalized.includes(candidateName)
  ) {
    matchReasons.push("Similar name");
  }

  if (sourcePartNormalized && candidatePart === sourcePartNormalized) {
    matchReasons.push("Matching voice part");
  }

  if (sourcePhoneNormalized && candidatePhone && candidatePhone === sourcePhoneNormalized) {
    matchReasons.push("Matching phone");
  }

  if (queryNormalized && candidateName.includes(queryNormalized)) {
    matchReasons.push("Search match");
  }

  return matchReasons;
}

export function findReconciliationCandidatesInStore(
  storage: ProfileReconciliationStoreStorage,
  input: {
    readonly query?: string | undefined;
    readonly sourceProfileId: string;
  },
): readonly ProfileReconciliationCandidate[] {
  const sourceRows = storage.sql
    .exec<RawProfileRow>("SELECT * FROM profiles WHERE id = ? LIMIT 1", input.sourceProfileId)
    .toArray();
  const source = sourceRows[0];
  if (!source) return [];

  const candidates = storage.sql
    .exec<RawProfileRow>(
      `SELECT * FROM profiles
       WHERE id <> ? AND merged_into_profile_id IS NULL AND hidden = 0
       ORDER BY display_name COLLATE NOCASE ASC LIMIT 100`,
      source.id,
    )
    .toArray();

  const sourceNameNormalized = source.display_name.trim().toLowerCase();
  const sourcePartNormalized = source.voice_part.trim().toLowerCase();
  const sourcePhoneNormalized = source.phone.replace(/\D/g, "");
  const queryNormalized = input.query?.trim().toLowerCase() ?? "";

  const results: ProfileReconciliationCandidate[] = [];

  for (const candidate of candidates) {
    const matchReasons = computeCandidateMatchReasons(
      candidate,
      sourceNameNormalized,
      sourcePartNormalized,
      sourcePhoneNormalized,
      queryNormalized,
    );

    if (matchReasons.length > 0) {
      results.push({
        displayName: candidate.display_name,
        globalStatus: candidate.global_status,
        id: candidate.id,
        matchReasons: [...matchReasons],
        phone: candidate.phone,
        voicePart: candidate.voice_part,
      });
    }
  }

  return results;
}

export function resolveCanonicalProfileId(
  storage: ProfileReconciliationStoreStorage,
  profileId: string,
): string {
  let currentId = profileId;
  const visited = new Set<string>();

  for (let hop = 0; hop < 10; hop++) {
    if (visited.has(currentId)) {
      break;
    }
    visited.add(currentId);

    const row = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly merged_into_profile_id: string | null;
      }>("SELECT merged_into_profile_id FROM profiles WHERE id = ? LIMIT 1", currentId)
      .toArray()
      .at(0);

    if (row?.merged_into_profile_id) {
      currentId = row.merged_into_profile_id;
    } else {
      break;
    }
  }

  return currentId;
}

export function getProfileReconciliationStatusInStore(
  storage: ProfileReconciliationStoreStorage,
  reconciliationId: string,
): { readonly ok: boolean; readonly state?: string } {
  const row = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly state: string;
    }>("SELECT state FROM profile_reconciliations WHERE id = ? LIMIT 1", reconciliationId)
    .toArray()
    .at(0);

  if (!row) {
    return { ok: false };
  }
  return { ok: true, state: row.state };
}
