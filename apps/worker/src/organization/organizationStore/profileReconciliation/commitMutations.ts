import type { SqlStorageValue } from "@cloudflare/workers-types";
import type { ProfileReconciliationFieldChoices } from "@choir/contracts";

import { previewProfileReconciliationInStore } from "./conflictChecks";
import {
  checkOrganizationId,
  parseFieldChoices,
  type CommitProfileReconciliationInput,
  type EventRosterRow,
  type PrepareProfileReconciliationInput,
  type ProfileReconciliationStoreStorage,
  type RawProfileRow,
} from "./shared";

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

export function combineEventRosters(
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
      const rsvp =
        tRoster.rsvp === "Yes" || sRoster.rsvp === "Yes"
          ? "Yes"
          : tRoster.rsvp !== "Pending"
            ? tRoster.rsvp
            : sRoster.rsvp;
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

export function updateSeatingCharts(
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

export function transferDeliveries(
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

export function applyProfileEmailFlagsAndSuppressions(
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

export function propagateCommunicationSuppressions(
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

export function applyFieldChoicesAndSuppressions(
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

export function validateCommitProfiles(
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

export function resolveCommitPreview(
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

export function executeReconciliationTransaction(
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
