import { organizationRosterConfigurationRequestSchema } from "@choir/contracts";
import { organizationIdentity } from "./organizationStore/storeShared";
import { resolveCanonicalProfileId } from "./organizationStore/profileReconciliation";
import { normalizeEmailForStorage } from "./contactStore/shared";
import { primaryRosterContactSql } from "./organizationStore/rosterContact";

export interface PrepareRosterInviteEnrollmentInput {
  readonly actorUserId: string;
  readonly displayName: string;
  readonly enrollmentId: string;
  readonly organizationId: string;
  readonly phone: string;
  readonly profileId: string;
  readonly profileMode?: "new" | "existing";
  readonly verifiedEmail?: string;
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
  readonly verifiedEmail?: string;
}

export interface PreparedEnrollmentRow {
  readonly [column: string]: SqlStorageValue;
  readonly created_at: string;
  readonly display_name: string;
  readonly enrollment_id: string;
  readonly phone: string | null;
  readonly profile_id: string;
  readonly profile_mode: "new" | "existing";
  readonly verified_email: string | null;
  readonly show_in_directory: number;
  readonly status: "prepared" | "committed" | "canceled";
  readonly updated_at: string;
  readonly user_id: string;
  readonly voice_part: string;
}

export interface RosterInviteProfileMatch {
  readonly displayName?: string;
  readonly profileId?: string;
  readonly status: "match" | "no_match" | "review_required";
  readonly voicePart?: string;
}

export function resolveRosterInviteProfileMatchInStore(
  storage: DurableObjectStorage,
  input: { readonly email: string; readonly organizationId: string; readonly userId?: string },
): RosterInviteProfileMatch {
  if (organizationIdentity(storage)?.organizationId !== input.organizationId) {
    return { status: "review_required" };
  }
  const normalizedEmail = normalizeEmailForStorage(input.email);
  if (!normalizedEmail) return { status: "no_match" };

  // idx_contacts_normalized_email is unique within this Organization, so an exact normalized
  // lookup is bounded to one primary roster Contact. Read all matching rows so uniqueness never
  // depends on a truncated roster listing if that invariant is damaged by an old database.
  const rows = storage.sql
    .exec<{
      readonly display_name: string;
      readonly global_status: string;
      readonly hidden: number;
      readonly id: string;
      readonly merged_into_profile_id: string | null;
      readonly voice_part: string;
    }>(
      `SELECT p.id, p.display_name, p.voice_part, p.global_status, p.hidden,
              p.merged_into_profile_id
       FROM contacts c JOIN profiles p ON p.id = c.profile_id
       WHERE c.id = ${primaryRosterContactSql}
         AND c.normalized_email = ?`,
      normalizedEmail,
    )
    .toArray();
  if (rows.length === 0) return { status: "no_match" };
  const canonicalProfileIds = new Set(
    rows.map((row) => resolveCanonicalProfileId(storage, row.id)),
  );
  if (canonicalProfileIds.size !== 1) return { status: "review_required" };
  const canonicalProfileId = canonicalProfileIds.values().next().value;
  if (!canonicalProfileId) return { status: "review_required" };

  const profile = storage.sql
    .exec<{
      readonly display_name: string;
      readonly global_status: string;
      readonly hidden: number;
      readonly id: string;
      readonly merged_into_profile_id: string | null;
      readonly voice_part: string;
    }>(
      `SELECT id, display_name, voice_part, global_status, hidden, merged_into_profile_id
       FROM profiles WHERE id = ? LIMIT 1`,
      canonicalProfileId,
    )
    .toArray()
    .at(0);
  if (
    !profile?.id ||
    profile.merged_into_profile_id !== null ||
    (profile.global_status === "Inactive" && profile.hidden === 1)
  ) {
    return { status: "review_required" };
  }

  const reservedForAnotherUser =
    storage.sql
      .exec(
        `SELECT 1 FROM prepared_roster_invite_enrollments
       WHERE profile_id = ? AND user_id <> ? AND status != 'canceled'
       LIMIT 1`,
        canonicalProfileId,
        input.userId ?? "",
      )
      .toArray().length > 0;
  if (reservedForAnotherUser) return { status: "review_required" };

  return {
    displayName: profile.display_name,
    profileId: canonicalProfileId,
    status: "match",
    voicePart: profile.voice_part,
  };
}

export function protectRosterInviteProfileForLinkInStore(
  storage: DurableObjectStorage,
  input: {
    readonly email: string;
    readonly organizationId: string;
    readonly profileId: string;
    readonly userId: string;
  },
): { readonly code?: string; readonly ok: boolean } {
  if (organizationIdentity(storage)?.organizationId !== input.organizationId) {
    return { code: "organization_not_found", ok: false };
  }
  return storage.transactionSync(() => {
    const match = resolveRosterInviteProfileMatchInStore(storage, {
      email: input.email,
      organizationId: input.organizationId,
      userId: input.userId,
    });
    if (match.status !== "match" || match.profileId !== input.profileId) {
      return { code: "profile_match_changed", ok: false };
    }
    storage.sql.exec(
      `INSERT INTO roster_invite_profile_link_guards (profile_id, created_at)
       VALUES (?, ?) ON CONFLICT(profile_id) DO NOTHING`,
      input.profileId,
      new Date().toISOString(),
    );
    return { ok: true };
  });
}

function readOrganizationRosterConfig(storage: DurableObjectStorage): {
  readonly rosterStructure: "sections_only" | "sections_with_parts";
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
        rosterStructure: parsed.data.rosterStructure ?? "sections_with_parts",
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
    rosterStructure: "sections_with_parts",
    performerLabel: "Performer",
    sections: [],
    voiceParts: [],
  };
}

export function getRosterInviteOptionsInStore(
  storage: DurableObjectStorage,
  input: {
    readonly email?: string | null;
    readonly organizationId: string;
    readonly userId?: string | null;
  },
): {
  readonly alreadyEnrolled: boolean;
  readonly existingProfile: { readonly displayName: string; readonly voicePart: string } | null;
  readonly matchingProfile: RosterInviteProfileMatch;
  readonly organizationName: string;
  readonly rosterStructure: "sections_only" | "sections_with_parts";
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
  let matchingProfile: RosterInviteProfileMatch = { status: "no_match" };

  if (input.email) {
    matchingProfile = resolveRosterInviteProfileMatchInStore(storage, {
      email: input.email,
      organizationId: input.organizationId,
      ...(input.userId ? { userId: input.userId } : {}),
    });
  }

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
      const canonicalProfileId = resolveCanonicalProfileId(storage, committedRow.profile_id);
      const profileRow = storage.sql
        .exec<{ readonly display_name: string; readonly voice_part: string }>(
          `SELECT display_name, voice_part FROM profiles WHERE id = ? LIMIT 1`,
          canonicalProfileId,
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
    matchingProfile,
    organizationName: identity.name,
    rosterStructure: config.rosterStructure,
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
  if (!eligiblePart && input.profileMode !== "existing") {
    return { code: "voice_part_not_configured", ok: false, profileId: input.profileId };
  }

  // eslint-disable-next-line complexity -- validates and prepares both new and existing Profile enrollment modes atomically
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
      const canonicalProfileId = resolveCanonicalProfileId(storage, existing.profile_id);
      if (existing.status === "committed") {
        if (existing.profile_mode !== (input.profileMode ?? "new")) {
          return { code: "enrollment_mode_conflict", ok: false, profileId: canonicalProfileId };
        }
        return { ok: true, profileId: canonicalProfileId };
      }
      if (existing.status === "prepared") {
        if (existing.profile_mode !== (input.profileMode ?? "new")) {
          return { code: "enrollment_mode_conflict", ok: false, profileId: canonicalProfileId };
        }
        // Return existing prepared profile ID
        return { ok: true, profileId: canonicalProfileId };
      }
      return { code: "enrollment_canceled", ok: false, profileId: canonicalProfileId };
    }

    const profileMode = input.profileMode ?? "new";
    if (profileMode === "existing") {
      const match = input.verifiedEmail
        ? resolveRosterInviteProfileMatchInStore(storage, {
            email: input.verifiedEmail,
            organizationId: input.organizationId,
            userId: input.userId,
          })
        : { status: "review_required" as const };
      if (match.status !== "match" || match.profileId !== input.profileId) {
        return { code: "profile_match_changed", ok: false, profileId: input.profileId };
      }
      storage.sql.exec(
        `INSERT INTO roster_invite_profile_link_guards (profile_id, created_at)
         VALUES (?, ?) ON CONFLICT(profile_id) DO NOTHING`,
        input.profileId,
        now,
      );
    } else if (!eligiblePart) {
      return { code: "voice_part_not_configured", ok: false, profileId: input.profileId };
    }

    storage.sql.exec(
      `INSERT INTO prepared_roster_invite_enrollments
        (enrollment_id, profile_id, user_id, display_name, voice_part, phone, show_in_directory,
         profile_mode, verified_email, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)`,
      input.enrollmentId,
      input.profileId,
      input.userId,
      input.displayName,
      profileMode === "existing" ? input.voicePart.trim() || "" : (eligiblePart?.label ?? ""),
      profileMode === "existing" ? null : input.phone || null,
      profileMode === "existing" ? 0 : input.showInDirectory ? 1 : 0,
      profileMode,
      profileMode === "existing" ? normalizeEmailForStorage(input.verifiedEmail) : null,
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
      const canonicalProfileId = resolveCanonicalProfileId(storage, prepared.profile_id);
      return { ok: true, profileId: canonicalProfileId };
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
    if (prepared.profile_mode === "new" && !isConfigured) {
      return { code: "voice_part_not_configured", ok: false };
    }

    if (prepared.profile_mode === "existing") {
      const normalizedVerifiedEmail = normalizeEmailForStorage(input.verifiedEmail);
      const match =
        normalizedVerifiedEmail && normalizedVerifiedEmail === prepared.verified_email
          ? resolveRosterInviteProfileMatchInStore(storage, {
              email: input.verifiedEmail ?? "",
              organizationId: input.organizationId,
              userId: prepared.user_id,
            })
          : { status: "review_required" as const };
      if (match.status !== "match" || match.profileId !== prepared.profile_id) {
        return { code: "profile_match_changed", ok: false };
      }
      storage.sql.exec(
        `UPDATE prepared_roster_invite_enrollments
         SET status = 'committed', updated_at = ? WHERE enrollment_id = ?`,
        now,
        input.enrollmentId,
      );
      return { ok: true, profileId: prepared.profile_id };
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

  const canonicalProfileId = resolveCanonicalProfileId(storage, row.profile_id);
  return {
    exists: true,
    profileId: canonicalProfileId,
    status: row.status,
  };
}
