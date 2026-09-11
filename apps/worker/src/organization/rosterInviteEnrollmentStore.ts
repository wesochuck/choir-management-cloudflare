import { organizationRosterConfigurationRequestSchema } from "@choir/contracts";
import { organizationIdentity } from "./organizationStore/storeShared";

export interface PrepareRosterInviteEnrollmentInput {
  readonly actorUserId: string;
  readonly displayName: string;
  readonly enrollmentId: string;
  readonly organizationId: string;
  readonly phone: string;
  readonly profileId: string;
  readonly requestId: string;
  readonly showInDirectory: boolean;
  readonly userId: string;
  readonly voicePart: string;
}

export interface CommitRosterInviteEnrollmentInput {
  readonly actorUserId: string;
  readonly enrollmentId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export interface PreparedEnrollmentRow {
  readonly [column: string]: SqlStorageValue;
  readonly created_at: string;
  readonly display_name: string;
  readonly enrollment_id: string;
  readonly phone: string | null;
  readonly profile_id: string;
  readonly show_in_directory: number;
  readonly status: "prepared" | "committed" | "canceled";
  readonly updated_at: string;
  readonly user_id: string;
  readonly voice_part: string;
}

function readOrganizationRosterConfig(storage: DurableObjectStorage): {
  readonly performerLabel: string;
  readonly sections: readonly {
    readonly code: string;
    readonly color: string;
    readonly name: string;
    readonly trackOnly: boolean;
  }[];
  readonly voiceParts: readonly {
    readonly fullName: string;
    readonly label: string;
    readonly sectionCode: string;
  }[];
} {
  try {
    const raw = storage.sql
      .exec<{ readonly configuration: string }>(
        "SELECT roster_configuration_json AS configuration FROM organization_metadata LIMIT 1",
      )
      .one().configuration;
    const parsed = organizationRosterConfigurationRequestSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return {
        performerLabel: parsed.data.performerLabel,
        sections: parsed.data.sections.map((s) => ({
          code: s.code,
          color: s.color,
          name: s.name,
          trackOnly: s.trackOnly,
        })),
        voiceParts: parsed.data.voiceParts.map((v) => ({
          fullName: v.fullName,
          label: v.label,
          sectionCode: v.sectionCode,
        })),
      };
    }
  } catch {
    // Fall back to empty defaults if not yet configured
  }
  return {
    performerLabel: "Performer",
    sections: [],
    voiceParts: [],
  };
}

export function getRosterInviteOptionsInStore(
  storage: DurableObjectStorage,
  input: { readonly organizationId: string; readonly userId?: string | null },
): {
  readonly alreadyEnrolled: boolean;
  readonly existingProfile: { readonly displayName: string; readonly voicePart: string } | null;
  readonly organizationName: string;
  readonly performerLabel: string;
  readonly sections: readonly {
    readonly code: string;
    readonly color: string;
    readonly name: string;
    readonly trackOnly: boolean;
  }[];
  readonly voiceParts: readonly {
    readonly fullName: string;
    readonly label: string;
    readonly sectionCode: string;
  }[];
} | null {
  const identity = organizationIdentity(storage);
  if (identity?.organizationId !== input.organizationId) {
    return null;
  }
  const config = readOrganizationRosterConfig(storage);
  const trackOnlyCodes = new Set(
    config.sections.filter((section) => section.trackOnly).map((section) => section.code),
  );
  const eligibleVoiceParts = config.voiceParts.filter(
    (part) => !trackOnlyCodes.has(part.sectionCode),
  );
  const eligibleSections = config.sections.filter((section) => !section.trackOnly);

  let existingProfile: { readonly displayName: string; readonly voicePart: string } | null = null;
  let alreadyEnrolled = false;

  if (input.userId) {
    // Check if there is already a committed enrollment for this user in this store
    const committedRow = storage.sql
      .exec<PreparedEnrollmentRow>(
        `SELECT * FROM prepared_roster_invite_enrollments
         WHERE user_id = ? AND status = 'committed'
         LIMIT 1`,
        input.userId,
      )
      .toArray()
      .at(0);
    if (committedRow) {
      const profileRow = storage.sql
        .exec<{ readonly display_name: string; readonly voice_part: string }>(
          `SELECT display_name, voice_part FROM profiles WHERE id = ? LIMIT 1`,
          committedRow.profile_id,
        )
        .toArray()
        .at(0);
      if (profileRow) {
        existingProfile = {
          displayName: profileRow.display_name,
          voicePart: profileRow.voice_part,
        };
        alreadyEnrolled = true;
      }
    }
  }

  return {
    alreadyEnrolled,
    existingProfile,
    organizationName: identity.name,
    performerLabel: config.performerLabel,
    sections: eligibleSections,
    voiceParts: eligibleVoiceParts,
  };
}

export function prepareRosterInviteEnrollmentInStore(
  storage: DurableObjectStorage,
  input: PrepareRosterInviteEnrollmentInput,
): {
  readonly code?: string;
  readonly ok: boolean;
  readonly profileId: string;
} {
  const identity = organizationIdentity(storage);
  if (identity?.organizationId !== input.organizationId) {
    return { code: "organization_not_found", ok: false, profileId: input.profileId };
  }

  const config = readOrganizationRosterConfig(storage);
  const trackOnlyCodes = new Set(
    config.sections.filter((section) => section.trackOnly).map((section) => section.code),
  );
  const eligiblePart = config.voiceParts.find(
    (p) =>
      (p.label.toLowerCase() === input.voicePart.trim().toLowerCase() ||
        p.fullName.toLowerCase() === input.voicePart.trim().toLowerCase()) &&
      !trackOnlyCodes.has(p.sectionCode),
  );
  if (!eligiblePart) {
    return { code: "voice_part_not_configured", ok: false, profileId: input.profileId };
  }

  return storage.transactionSync(() => {
    const existing = storage.sql
      .exec<PreparedEnrollmentRow>(
        `SELECT * FROM prepared_roster_invite_enrollments WHERE enrollment_id = ? LIMIT 1`,
        input.enrollmentId,
      )
      .toArray()
      .at(0);

    const now = new Date().toISOString();
    if (existing) {
      if (existing.status === "committed") {
        return { ok: true, profileId: existing.profile_id };
      }
      if (existing.status === "prepared") {
        // Return existing prepared profile ID
        return { ok: true, profileId: existing.profile_id };
      }
      return { code: "enrollment_canceled", ok: false, profileId: existing.profile_id };
    }

    storage.sql.exec(
      `INSERT INTO prepared_roster_invite_enrollments
        (enrollment_id, profile_id, user_id, display_name, voice_part, phone, show_in_directory,
         status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)`,
      input.enrollmentId,
      input.profileId,
      input.userId,
      input.displayName,
      eligiblePart.label,
      input.phone || null,
      input.showInDirectory ? 1 : 0,
      now,
      now,
    );

    return { ok: true, profileId: input.profileId };
  });
}

export function commitRosterInviteEnrollmentInStore(
  storage: DurableObjectStorage,
  input: CommitRosterInviteEnrollmentInput,
): {
  readonly code?: string;
  readonly ok: boolean;
  readonly profileId?: string;
} {
  const identity = organizationIdentity(storage);
  if (identity?.organizationId !== input.organizationId) {
    return { code: "organization_not_found", ok: false };
  }

  return storage.transactionSync(() => {
    const prepared = storage.sql
      .exec<PreparedEnrollmentRow>(
        `SELECT * FROM prepared_roster_invite_enrollments WHERE enrollment_id = ? LIMIT 1`,
        input.enrollmentId,
      )
      .toArray()
      .at(0);

    if (!prepared) {
      return { code: "enrollment_not_found", ok: false };
    }

    if (prepared.status === "committed") {
      return { ok: true, profileId: prepared.profile_id };
    }

    if (prepared.status === "canceled") {
      return { code: "enrollment_canceled", ok: false };
    }

    const now = new Date().toISOString();

    // Verify voice part is still configured
    const config = readOrganizationRosterConfig(storage);
    const trackOnlyCodes = new Set(
      config.sections.filter((section) => section.trackOnly).map((section) => section.code),
    );
    const isConfigured = config.voiceParts.some(
      (p) => p.label === prepared.voice_part && !trackOnlyCodes.has(p.sectionCode),
    );
    if (!isConfigured) {
      return { code: "voice_part_not_configured", ok: false };
    }

    // Insert profile with safe member defaults
    storage.sql.exec(
      `INSERT OR REPLACE INTO profiles
        (id, display_name, phone, voice_part, global_status, notes, show_in_directory,
         do_not_email, receive_attendance_reports, receive_rsvp_decline_notices,
         receive_admin_notifications, receive_financial_alerts, is_section_leader,
         status_is_manual, status_changed_at, status_change_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Active', '', ?, 0, 0, 0, 0, 0, 0, 0, ?, 'Joined through roster invite', ?, ?)`,
      prepared.profile_id,
      prepared.display_name,
      prepared.phone,
      prepared.voice_part,
      prepared.show_in_directory,
      now,
      now,
      now,
    );

    // Record initial status history
    storage.sql.exec(
      `INSERT INTO profile_status_history
        (id, profile_id, previous_status, new_status, trigger_type, trigger_id, reason,
         actor_type, actor_id, occurred_at)
       VALUES (?, ?, 'Active', 'Active', 'roster_invite', ?, 'Joined through roster invite',
        'organization_member', ?, ?)`,
      crypto.randomUUID(),
      prepared.profile_id,
      input.enrollmentId,
      input.actorUserId,
      now,
    );

    // Insert audit event
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'profile.created', 'profile', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      input.actorUserId,
      prepared.profile_id,
      input.requestId,
      JSON.stringify({
        displayName: prepared.display_name,
        globalStatus: "Active",
        source: "roster_invite",
        voicePart: prepared.voice_part,
      }),
      now,
    );

    // Mark prepared row as committed
    storage.sql.exec(
      `UPDATE prepared_roster_invite_enrollments
       SET status = 'committed', updated_at = ?
       WHERE enrollment_id = ?`,
      now,
      input.enrollmentId,
    );

    return { ok: true, profileId: prepared.profile_id };
  });
}

export function cancelPreparedRosterInviteEnrollmentInStore(
  storage: DurableObjectStorage,
  input: { readonly enrollmentId: string; readonly organizationId: string },
): { readonly ok: boolean } {
  const identity = organizationIdentity(storage);
  if (identity?.organizationId !== input.organizationId) {
    return { ok: false };
  }

  const now = new Date().toISOString();
  storage.sql.exec(
    `UPDATE prepared_roster_invite_enrollments
     SET status = 'canceled', updated_at = ?
     WHERE enrollment_id = ? AND status = 'prepared'`,
    now,
    input.enrollmentId,
  );
  return { ok: true };
}

export function getRosterInviteEnrollmentResultInStore(
  storage: DurableObjectStorage,
  input: { readonly enrollmentId: string; readonly organizationId: string },
): {
  readonly exists: boolean;
  readonly profileId?: string;
  readonly status?: "prepared" | "committed" | "canceled";
} {
  const identity = organizationIdentity(storage);
  if (identity?.organizationId !== input.organizationId) {
    return { exists: false };
  }

  const row = storage.sql
    .exec<PreparedEnrollmentRow>(
      `SELECT * FROM prepared_roster_invite_enrollments WHERE enrollment_id = ? LIMIT 1`,
      input.enrollmentId,
    )
    .toArray()
    .at(0);

  if (!row) {
    return { exists: false };
  }

  return {
    exists: true,
    profileId: row.profile_id,
    status: row.status,
  };
}
