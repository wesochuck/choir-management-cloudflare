import { calculateOnBreakInactiveAt } from "@choir/domain";
import { organizationRosterConfigurationRequestSchema } from "@choir/contracts";
import {
  recalculateProfileStatuses,
  recordProfileStatusChange,
  readRosterAutomationConfiguration,
} from "../statusAutomationStore";

import { privateFileIsReferenced } from "./files";

import {
  profileIdSchema,
  profileCreateSchema,
  profileUpdateSchema,
  profileDeleteSchema,
  profileImportSchema,
  memberProfileUpdateSchema,
  profilePhotoOperationSchema,
  type OrganizationProfileRow,
  profileResult,
  organizationIdentity,
} from "./storeShared";

export function getProfileIdentity(
  storage: DurableObjectStorage,
  encodedProfileId: string,
): Response {
  const profileId = profileIdSchema.safeParse(decodeURIComponent(encodedProfileId));
  if (!profileId.success) {
    return Response.json({ code: "invalid_profile_id" }, { status: 400 });
  }
  const profile = storage.sql
    .exec<Record<string, SqlStorageValue> & { id: string }>(
      "SELECT id FROM profiles WHERE id = ? LIMIT 1",
      profileId.data,
    )
    .toArray()
    .at(0);
  return profile
    ? Response.json({ exists: true, profileId: profile.id })
    : Response.json({ code: "profile_not_found" }, { status: 404 });
}

export function listProfiles(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId || organizationIdentity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const configuration = readRosterAutomationConfiguration(storage);
  const timezone = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
      "SELECT timezone FROM organization_metadata LIMIT 1",
    )
    .one().timezone;
  const profiles = storage.sql
    .exec<OrganizationProfileRow>(
      `SELECT id, display_name AS displayName, phone, voice_part AS voicePart,
         global_status AS globalStatus, notes, show_in_directory AS showInDirectory,
         do_not_email AS doNotEmail, receive_attendance_reports AS receiveAttendanceReports,
         receive_rsvp_decline_notices AS receiveRsvpDeclineNotices,
         receive_admin_notifications AS receiveAdminNotifications,
         receive_financial_alerts AS receiveFinancialAlerts,
         is_section_leader AS isSectionLeader, photo_file_id AS photoFileId,
         last_bounce_at AS lastBounceAt, bounce_reason AS bounceReason,
         status_is_manual AS statusIsManual, status_changed_at AS statusChangedAt,
         status_change_reason AS statusChangeReason,
         created_at AS createdAt, updated_at AS updatedAt
       FROM profiles ORDER BY display_name COLLATE NOCASE ASC, id ASC LIMIT 500`,
    )
    .toArray()
    .map((profile) => ({
      ...profileResult(
        profile,
        calculateOnBreakInactiveAt({
          enabled: configuration.onBreakTimeoutEnabled,
          isManual: profile.statusIsManual === 1,
          now: new Date(),
          status: profile.globalStatus,
          statusChangedAt: profile.statusChangedAt,
          timeoutDays: configuration.onBreakTimeoutDays,
          timezone,
        }),
      ),
    }));
  return Response.json({ profiles });
}

export function readProfile(storage: DurableObjectStorage, profileId: string) {
  const row = storage.sql
    .exec<OrganizationProfileRow>(
      `SELECT id, display_name AS displayName, phone, voice_part AS voicePart,
         global_status AS globalStatus, notes, show_in_directory AS showInDirectory,
         do_not_email AS doNotEmail, receive_attendance_reports AS receiveAttendanceReports,
         receive_rsvp_decline_notices AS receiveRsvpDeclineNotices,
         receive_admin_notifications AS receiveAdminNotifications,
         receive_financial_alerts AS receiveFinancialAlerts,
         is_section_leader AS isSectionLeader, photo_file_id AS photoFileId,
         last_bounce_at AS lastBounceAt, bounce_reason AS bounceReason,
         status_is_manual AS statusIsManual, status_changed_at AS statusChangedAt,
         status_change_reason AS statusChangeReason,
         created_at AS createdAt, updated_at AS updatedAt
       FROM profiles WHERE id = ? LIMIT 1`,
      profileId,
    )
    .toArray()
    .at(0);
  if (!row) return null;
  const configuration = readRosterAutomationConfiguration(storage);
  const timezone = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
      "SELECT timezone FROM organization_metadata LIMIT 1",
    )
    .one().timezone;
  return profileResult(
    row,
    calculateOnBreakInactiveAt({
      enabled: configuration.onBreakTimeoutEnabled,
      isManual: row.statusIsManual === 1,
      now: new Date(),
      status: row.globalStatus,
      statusChangedAt: row.statusChangedAt,
      timeoutDays: configuration.onBreakTimeoutDays,
      timezone,
    }),
  );
}

export function readMemberProfile(
  storage: DurableObjectStorage,
  organizationId: string | null,
  rawProfileId: string | null,
): Response {
  const profileId = profileIdSchema.safeParse(rawProfileId);
  if (!organizationId || organizationIdentity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  if (!profileId.success) {
    return Response.json({ code: "invalid_profile_id" }, { status: 400 });
  }
  const profile = readProfile(storage, profileId.data);
  return profile
    ? Response.json(profile)
    : Response.json({ code: "profile_not_found" }, { status: 404 });
}

export function listDirectoryProfiles(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId || organizationIdentity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const profiles = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly displayName: string;
      readonly id: string;
      readonly photoFileId: string | null;
      readonly phone: string;
      readonly voicePart: string;
    }>(
      `SELECT id, display_name AS displayName, phone, voice_part AS voicePart,
         photo_file_id AS photoFileId
       FROM profiles
       WHERE global_status != 'Inactive' AND show_in_directory = 1
       ORDER BY display_name COLLATE NOCASE ASC, id ASC LIMIT 500`,
    )
    .toArray();
  return Response.json({ profiles });
}

export function isConfiguredVoicePart(storage: DurableObjectStorage, voicePart: string): boolean {
  if (voicePart === "") return true;
  try {
    const raw = storage.sql
      .exec<{ readonly configuration: string }>(
        "SELECT roster_configuration_json AS configuration FROM organization_metadata LIMIT 1",
      )
      .one().configuration;
    const configuration: unknown = JSON.parse(raw);
    const parsed = organizationRosterConfigurationRequestSchema.safeParse(configuration);
    return parsed.success && parsed.data.voiceParts.some(({ label }) => label === voicePart);
  } catch {
    return false;
  }
}

export async function createProfile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = profileCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_profile" }, { status: 400 });
  }
  if (organizationIdentity(storage)?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  const profile = parsed.data.profile;
  if (!isConfiguredVoicePart(storage, profile.voicePart)) {
    return Response.json({ code: "voice_part_not_configured" }, { status: 400 });
  }
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO profiles
        (id, display_name, phone, voice_part, global_status, notes, show_in_directory,
         do_not_email, receive_attendance_reports, receive_rsvp_decline_notices,
         receive_admin_notifications, receive_financial_alerts, is_section_leader,
         status_is_manual, status_changed_at, status_change_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      parsed.data.profileId,
      profile.displayName,
      profile.phone,
      profile.voicePart,
      profile.globalStatus,
      profile.notes,
      profile.showInDirectory ? 1 : 0,
      profile.doNotEmail ? 1 : 0,
      profile.receiveAttendanceReports ? 1 : 0,
      profile.receiveRsvpDeclineNotices ? 1 : 0,
      profile.receiveAdminNotifications ? 1 : 0,
      profile.receiveFinancialAlerts ? 1 : 0,
      profile.isSectionLeader ? 1 : 0,
      profile.statusIsManual ? 1 : 0,
      occurredAt,
      "Initial status",
      occurredAt,
      occurredAt,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'profile.created', 'profile', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      parsed.data.actorUserId,
      parsed.data.profileId,
      parsed.data.requestId,
      JSON.stringify({ displayName: profile.displayName, globalStatus: profile.globalStatus }),
      occurredAt,
    );
  });
  recalculateProfileStatuses(
    storage,
    parsed.data.organizationId,
    new Date(occurredAt),
    parsed.data.requestId,
  );
  return Response.json(readProfile(storage, parsed.data.profileId));
}

export async function importProfiles(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = profileImportSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "invalid_profile_import" }, { status: 400 });
  if (organizationIdentity(storage)?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  if (
    parsed.data.profiles.some(({ profile }) => !isConfiguredVoicePart(storage, profile.voicePart))
  ) {
    return Response.json({ code: "voice_part_not_configured" }, { status: 400 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    for (const { profile, profileId } of parsed.data.profiles) {
      storage.sql.exec(
        `INSERT INTO profiles
          (id, display_name, phone, voice_part, global_status, notes, show_in_directory,
           do_not_email, receive_attendance_reports, receive_rsvp_decline_notices,
           receive_admin_notifications, receive_financial_alerts, is_section_leader,
           status_is_manual, status_changed_at, status_change_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        profileId,
        profile.displayName,
        profile.phone,
        profile.voicePart,
        profile.globalStatus,
        profile.notes,
        profile.showInDirectory ? 1 : 0,
        profile.doNotEmail ? 1 : 0,
        profile.receiveAttendanceReports ? 1 : 0,
        profile.receiveRsvpDeclineNotices ? 1 : 0,
        profile.receiveAdminNotifications ? 1 : 0,
        profile.receiveFinancialAlerts ? 1 : 0,
        profile.isSectionLeader ? 1 : 0,
        profile.statusIsManual ? 1 : 0,
        occurredAt,
        "Initial status",
        occurredAt,
        occurredAt,
      );
      storage.sql.exec(
        `INSERT INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'organization_member', ?, 'profile.imported', 'profile', ?, ?, ?, ?)`,
        crypto.randomUUID(),
        parsed.data.actorUserId,
        profileId,
        parsed.data.requestId,
        JSON.stringify({ displayName: profile.displayName, globalStatus: profile.globalStatus }),
        occurredAt,
      );
    }
  });
  return Response.json({ imported: parsed.data.profiles.length });
}

export async function updateProfile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = profileUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "invalid_profile" }, { status: 400 });
  if (organizationIdentity(storage)?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const exists = storage.sql
    .exec("SELECT 1 FROM profiles WHERE id = ? LIMIT 1", parsed.data.profileId)
    .toArray().length;
  if (exists === 0) return Response.json({ code: "profile_not_found" }, { status: 404 });
  const occurredAt = new Date().toISOString();
  const profile = parsed.data.profile;
  if (!isConfiguredVoicePart(storage, profile.voicePart)) {
    return Response.json({ code: "voice_part_not_configured" }, { status: 400 });
  }
  const existing = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly globalStatus: "Active" | "Idle" | "Inactive";
      readonly statusChangedAt: string;
      readonly statusIsManual: number;
    }>(
      "SELECT global_status AS globalStatus, status_is_manual AS statusIsManual, status_changed_at AS statusChangedAt FROM profiles WHERE id = ? LIMIT 1",
      parsed.data.profileId,
    )
    .toArray()
    .at(0);
  if (!existing) return Response.json({ code: "profile_not_found" }, { status: 404 });
  storage.transactionSync(() => {
    if (profile.globalStatus !== existing.globalStatus) {
      recordProfileStatusChange(storage, {
        actor: {
          actorId: parsed.data.actorUserId,
          actorType: "organization_member",
          requestId: parsed.data.requestId,
        },
        newStatus: profile.globalStatus,
        occurredAt,
        profileId: parsed.data.profileId,
        reason: profile.statusIsManual
          ? "Manual status update."
          : "Manual status selection; Profile Status Automation remains enabled.",
        triggerId: "",
        triggerType: "manual_status_selection",
      });
    }
    storage.sql.exec(
      `UPDATE profiles SET display_name = ?, phone = ?, voice_part = ?, global_status = ?, status_is_manual = ?,
         notes = ?, show_in_directory = ?, do_not_email = ?, receive_attendance_reports = ?,
         receive_rsvp_decline_notices = ?, receive_admin_notifications = ?,
         receive_financial_alerts = ?, is_section_leader = ?, updated_at = ? WHERE id = ?`,
      profile.displayName,
      profile.phone,
      profile.voicePart,
      profile.globalStatus,
      profile.statusIsManual ? 1 : 0,
      profile.notes,
      profile.showInDirectory ? 1 : 0,
      profile.doNotEmail ? 1 : 0,
      profile.receiveAttendanceReports ? 1 : 0,
      profile.receiveRsvpDeclineNotices ? 1 : 0,
      profile.receiveAdminNotifications ? 1 : 0,
      profile.receiveFinancialAlerts ? 1 : 0,
      profile.isSectionLeader ? 1 : 0,
      occurredAt,
      parsed.data.profileId,
    );
    if (
      profile.globalStatus === existing.globalStatus &&
      !profile.statusIsManual &&
      existing.statusIsManual === 1 &&
      profile.globalStatus === "Idle"
    ) {
      storage.sql.exec(
        "UPDATE profiles SET status_changed_at = ?, status_change_reason = ?, updated_at = ? WHERE id = ?",
        occurredAt,
        "Automatic management re-enabled; On Break timeout restarted.",
        occurredAt,
        parsed.data.profileId,
      );
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'profile.updated', 'profile', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      parsed.data.actorUserId,
      parsed.data.profileId,
      parsed.data.requestId,
      JSON.stringify({ displayName: profile.displayName, globalStatus: profile.globalStatus }),
      occurredAt,
    );
  });
  return Response.json(readProfile(storage, parsed.data.profileId));
}

export async function deleteProfile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = profileDeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "invalid_profile_delete" }, { status: 400 });
  if (organizationIdentity(storage)?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  const deleted = storage.transactionSync(() => {
    const existing = storage.sql
      .exec("SELECT id FROM profiles WHERE id = ? LIMIT 1", parsed.data.profileId)
      .toArray();
    if (existing.length === 0) return false;
    storage.sql.exec("DELETE FROM profiles WHERE id = ?", parsed.data.profileId);
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'profile.deleted', 'profile', ?, ?, '{}', ?)`,
      crypto.randomUUID(),
      parsed.data.actorUserId,
      parsed.data.profileId,
      parsed.data.requestId,
      occurredAt,
    );
    return true;
  });
  return deleted
    ? Response.json({ deleted: true, profileId: parsed.data.profileId })
    : Response.json({ code: "profile_not_found" }, { status: 404 });
}

export async function updateMemberProfile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = memberProfileUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "invalid_profile" }, { status: 400 });
  if (organizationIdentity(storage)?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  if (!readProfile(storage, parsed.data.profileId)) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE profiles
       SET display_name = ?, phone = ?, show_in_directory = ?, updated_at = ?
       WHERE id = ?`,
      parsed.data.profile.displayName,
      parsed.data.profile.phone,
      parsed.data.profile.showInDirectory ? 1 : 0,
      occurredAt,
      parsed.data.profileId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'profile.self_updated', 'profile', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      parsed.data.actorUserId,
      parsed.data.profileId,
      parsed.data.requestId,
      JSON.stringify({
        displayName: parsed.data.profile.displayName,
        showInDirectory: parsed.data.profile.showInDirectory,
      }),
      occurredAt,
    );
  });
  return Response.json(readProfile(storage, parsed.data.profileId));
}

export async function manageProfilePhoto(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = profilePhotoOperationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ code: "invalid_profile_photo_operation" }, { status: 400 });
  const operation = parsed.data;
  if (organizationIdentity(storage)?.organizationId !== operation.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const profile = readProfile(storage, operation.profileId);
  if (!profile) return Response.json({ code: "profile_not_found" }, { status: 404 });
  if (operation.action === "attach") {
    const file = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly contentType: string;
        readonly sizeBytes: number;
      }>(
        "SELECT content_type AS contentType, size_bytes AS sizeBytes FROM private_files WHERE id = ? AND status = 'ready' LIMIT 1",
        operation.fileId,
      )
      .toArray()
      .at(0);
    if (
      !file ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.contentType) ||
      file.sizeBytes > 5 * 1024 * 1024
    ) {
      return Response.json({ code: "invalid_profile_photo_file" }, { status: 409 });
    }
    if (
      profile.photoFileId !== operation.fileId &&
      privateFileIsReferenced(storage, operation.fileId)
    ) {
      return Response.json({ code: "profile_photo_file_in_use" }, { status: 409 });
    }
  }
  const nextFileId = operation.action === "attach" ? operation.fileId : null;
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE profiles SET photo_file_id = ?, updated_at = ? WHERE id = ?",
      nextFileId,
      occurredAt,
      operation.profileId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, ?, 'profile', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      operation.actorUserId,
      operation.action === "attach" ? "profile.photo_attached" : "profile.photo_removed",
      operation.profileId,
      operation.requestId,
      JSON.stringify({ nextFileId, previousFileId: profile.photoFileId }),
      occurredAt,
    );
  });
  return Response.json({
    previousFileId: profile.photoFileId,
    profile: readProfile(storage, operation.profileId),
  });
}
