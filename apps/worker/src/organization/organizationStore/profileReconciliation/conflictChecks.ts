import type { SqlStorageValue } from "@cloudflare/workers-types";
import type {
  ProfileReconciliationConflictInventory,
  ProfileReconciliationPreviewResponse,
} from "@choir/contracts";

import {
  checkOrganizationId,
  computePreviewRevision,
  computeTransferCounts,
  mapProfileSummary,
  type EventRosterRow,
  type PreviewProfileReconciliationInput,
  type ProfileReconciliationStoreStorage,
  type RawProfileRow,
} from "./shared";

export function checkEventRosterBlocker(
  sRoster: EventRosterRow,
  tRoster: EventRosterRow,
  blockers: string[],
  conflicts: ProfileReconciliationConflictInventory["eventRosterConflicts"],
): boolean {
  const attendanceConflict =
    sRoster.attendance !== "Pending" &&
    tRoster.attendance !== "Pending" &&
    sRoster.attendance !== tRoster.attendance;

  const folderConflict =
    sRoster.folder_number !== "" &&
    tRoster.folder_number !== "" &&
    sRoster.folder_number.toLowerCase() !== tRoster.folder_number.toLowerCase();

  if (!attendanceConflict && !folderConflict) {
    return false;
  }

  const reasons: string[] = [];
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

export function checkEventRsvpYesWins(
  sRoster: EventRosterRow,
  tRoster: EventRosterRow,
  blockers: string[],
  warnings: string[],
  conflicts: ProfileReconciliationConflictInventory["eventRosterConflicts"],
): void {
  if (sRoster.rsvp === tRoster.rsvp || sRoster.rsvp === "Pending" || tRoster.rsvp === "Pending") {
    return;
  }
  const hasYes = sRoster.rsvp === "Yes" || tRoster.rsvp === "Yes";
  const reason = hasYes
    ? `RSVP Yes (${sRoster.rsvp} vs ${tRoster.rsvp}) will be preserved over the other response.`
    : `RSVP (${sRoster.rsvp} vs ${tRoster.rsvp}) differs with no Yes response; manual coordination required.`;
  if (hasYes) {
    warnings.push(`Event ${sRoster.event_id}: ${reason}`);
  } else {
    blockers.push(`Event ${sRoster.event_id}: ${reason}`);
  }
  conflicts.push({
    eventId: sRoster.event_id,
    reason,
    sourceAttendance: sRoster.attendance,
    sourceRsvp: sRoster.rsvp,
    targetAttendance: tRoster.attendance,
    targetRsvp: tRoster.rsvp,
  });
}

export function checkEventRosterWarnings(
  sRoster: EventRosterRow,
  tRoster: EventRosterRow,
  warnings: string[],
): void {
  if (sRoster.rsvp !== tRoster.rsvp && (sRoster.rsvp === "Pending" || tRoster.rsvp === "Pending")) {
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

export function evaluateEventRosterPair(
  sRoster: EventRosterRow,
  tRoster: EventRosterRow,
  blockers: string[],
  warnings: string[],
  conflicts: ProfileReconciliationConflictInventory["eventRosterConflicts"],
): void {
  const isBlocked = checkEventRosterBlocker(sRoster, tRoster, blockers, conflicts);
  checkEventRsvpYesWins(sRoster, tRoster, blockers, warnings, conflicts);
  if (!isBlocked) {
    checkEventRosterWarnings(sRoster, tRoster, warnings);
  }
}

export function findEventRosterConflicts(
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

export function findPollConflicts(
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

export function findDuesConflicts(
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

export function findContactConflicts(
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
}

export function findDeliveryConflicts(
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

export function validateProfilesForPreview(
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

export function checkNoteConflict(
  sourceNotes: string,
  targetNotes: string,
  warnings: string[],
): boolean {
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

export function gatherProfileMetadataWarnings(
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
