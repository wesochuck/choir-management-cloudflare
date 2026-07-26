import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import {
  memberProfileUpdateRequestSchema,
  organizationAuditionCreateRequestSchema,
  organizationAuditionSettingsSchema,
  organizationAuditionUpdateRequestSchema,
  organizationProfileRequestSchema,
  organizationRosterConfigurationRequestSchema,
} from "@choir/contracts";

import type { Env } from "../env";
import { deliveryJobSchema } from "../jobs/contracts";
import {
  privateFileIdSchema,
  privateFileReservationSchema,
  privateFileTransitionSchema,
  privateOrganizationFileKey,
} from "../storage/privateFiles";
import { migrateOrganization } from "./migrations";
import {
  listOrganizationEventsFromStore,
  readOrganizationDashboardSummaryFromStore,
  readEventRsvpExportFromStore,
  listEventAttendanceFromStore,
  listMemberEventsFromStore,
  listOrganizationVenuesFromStore,
  manageOrganizationCalendarInStore,
  readOrganizationCalendarSettingsFromStore,
  readProfileEventRsvpFromStore,
  readRosterConfigurationFromStore,
} from "./calendarManagementStore";
import { ensureOrganizationAlarm, runOrganizationAlarm } from "./scheduler";
import { readPlayerDetailsFromStore } from "./playerStore";
import {
  createAuditionInStore,
  deleteAuditionInStore,
  readAuditionFromStore,
  readAuditionSettingsFromStore,
  listAuditionsFromStore,
  readAuditionNotificationJobFromStore,
  updateAuditionInStore,
  updateAuditionSettingsInStore,
  auditionSlotsAreConfigured,
  recordAuditionNotificationResult,
} from "./auditionStore";
import {
  completeOrganizationExportInStore,
  createOrganizationExportInStore,
  failOrganizationExportInStore,
  readOrganizationExportJobFromStore,
  readOrganizationExportSnapshot,
} from "./exportStore";
import {
  listPollsFromStore,
  listArchivedPollsFromStore,
  managePollInStore,
  readPollFromStore,
  readProfilePollFromStore,
} from "./pollStore";
import { listMusicPiecesFromStore, manageMusicInStore } from "./musicStore";
import { listResourcesFromStore, manageResourceInStore } from "./resourceStore";
import {
  listCommunicationMessagesFromStore,
  listCommunicationTemplatesFromStore,
  manageCommunicationInStore,
  readCommunicationJobFromStore,
  readCommunicationSummaryFromStore,
  resolveCommunicationAudienceFromStore,
  unsubscribeCommunicationProfileInStore,
} from "./communicationStore";
import {
  listSeatingChartsFromStore,
  manageSeatingInStore,
  readSeatingConfigurationFromStore,
  readSingerSeatingFromStore,
} from "./seatingStore";
import { currentOrganizationSchemaVersion } from "./schema";
import {
  managePublicWebsiteInStore,
  readPublicWebsiteSettingsFromStore,
} from "./publicWebsiteStore";
import {
  listTicketBundlesFromStore,
  listTicketOrdersFromStore,
  manageTicketingInStore,
  readTicketNotificationJobFromStore,
  readTicketPurchaseFromStore,
  readTicketWillCallFromStore,
} from "./ticketingStore";
import {
  listDonationsFromStore,
  listPatronsFromStore,
  manageDonationsInStore,
} from "./donationStore";
import { getSetupStateFromStore, getModuleStateFromStore, manageSetupInStore } from "./setupStore";
import { readAttendanceReportJobFromStore, readEventReminderJobFromStore } from "./schedulingStore";
import { listSeasonsFromStore, listDuesFromStore, manageSeasonsInStore } from "./seasonStore";

const completionSchema = z.object({
  attempt: z.number().int().min(1).max(10),
  completedAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(256),
  jobId: z.uuid(),
});

const failureSchema = z.object({
  attempt: z.number().int().min(1).max(10),
  failedAt: z.iso.datetime(),
  idempotencyKey: z.string().min(1).max(256),
  jobId: z.uuid(),
});

const organizationProvisioningSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  canonicalHostname: z.string().min(1).max(253),
  canonicalStatus: z.enum(["active", "pending"]),
  name: z.string().min(1).max(120),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
  slug: z.string().min(2).max(63),
});

const profileIdSchema = z.uuid();
const profileCreateSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  profile: organizationProfileRequestSchema,
  profileId: z.uuid(),
  requestId: z.uuid(),
});
const profileUpdateSchema = profileCreateSchema;
const profileImportSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  profiles: z
    .array(
      z.object({
        profile: organizationProfileRequestSchema,
        profileId: z.uuid(),
      }),
    )
    .min(1)
    .max(500),
  requestId: z.uuid(),
});
const memberProfileUpdateSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  profile: memberProfileUpdateRequestSchema,
  profileId: z.uuid(),
  requestId: z.uuid(),
});
const profilePhotoOperationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("attach"),
    actorUserId: z.string().min(1).max(128),
    fileId: z.uuid(),
    organizationId: z.string().min(1).max(128),
    profileId: z.uuid(),
    requestId: z.uuid(),
  }),
  z.object({
    action: z.literal("remove"),
    actorUserId: z.string().min(1).max(128),
    organizationId: z.string().min(1).max(128),
    profileId: z.uuid(),
    requestId: z.uuid(),
  }),
]);
const schemaPreparationRequestSchema = z.object({
  organizationId: z.string().min(1).max(128),
  targetVersion: z.number().int().positive(),
});
const privateFileReclaimResponseSchema = z.object({
  reclaimed: z.literal(true),
});
const calendarCredentialRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read"),
    organizationId: z.string().min(1).max(128),
    profileId: z.uuid(),
  }),
  z.object({
    action: z.literal("reset"),
    actorUserId: z.string().min(1).max(128),
    organizationId: z.string().min(1).max(128),
    profileId: z.uuid(),
    requestId: z.uuid(),
  }),
]);
const calendarFeedValidationSchema = z.object({
  organizationId: z.string().min(1).max(128),
  profileId: z.uuid(),
  readAt: z.iso.datetime(),
  revocationVersion: z.number().int().positive(),
});

interface OrganizationMetadataRow {
  readonly [column: string]: SqlStorageValue;
  readonly name: string;
  readonly organizationId: string;
  readonly slug: string;
}

interface OrganizationIdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

interface OrganizationSchemaVersionRow {
  readonly [column: string]: SqlStorageValue;
  readonly schemaVersion: number;
}

interface CalendarProfileRow {
  readonly [column: string]: SqlStorageValue;
  readonly calendarFeedVersion: number;
  readonly displayName: string;
}

interface OrganizationProfileRow {
  readonly [column: string]: SqlStorageValue;
  readonly createdAt: string;
  readonly displayName: string;
  readonly doNotEmail: number;
  readonly globalStatus: "Active" | "Idle" | "Inactive";
  readonly id: string;
  readonly isSectionLeader: number;
  readonly notes: string;
  readonly photoFileId: string | null;
  readonly phone: string;
  readonly receiveAdminNotifications: number;
  readonly receiveAttendanceReports: number;
  readonly receiveFinancialAlerts: number;
  readonly receiveRsvpDeclineNotices: number;
  readonly showInDirectory: number;
  readonly updatedAt: string;
  readonly voicePart: string;
}

function profileResult(row: OrganizationProfileRow) {
  return {
    createdAt: row.createdAt,
    displayName: row.displayName,
    doNotEmail: row.doNotEmail === 1,
    globalStatus: row.globalStatus,
    id: row.id,
    isSectionLeader: row.isSectionLeader === 1,
    notes: row.notes,
    photoFileId: row.photoFileId,
    phone: row.phone,
    receiveAdminNotifications: row.receiveAdminNotifications === 1,
    receiveAttendanceReports: row.receiveAttendanceReports === 1,
    receiveFinancialAlerts: row.receiveFinancialAlerts === 1,
    receiveRsvpDeclineNotices: row.receiveRsvpDeclineNotices === 1,
    showInDirectory: row.showInDirectory === 1,
    updatedAt: row.updatedAt,
    voicePart: row.voicePart,
  };
}

interface CalendarEventRow {
  readonly [column: string]: SqlStorageValue;
  readonly callTime: string;
  readonly details: string;
  readonly directRsvp: string | null;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly location: string;
  readonly parentRsvp: string | null;
  readonly setListApproved: number;
  readonly setListJson: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal";
  readonly venueAddress: string;
  readonly venueName: string;
}

interface JobLedgerRow {
  readonly [column: string]: SqlStorageValue;
  readonly attempt: number;
  readonly jobId: string;
  readonly status: string;
}

interface PrivateFileMetadataRow {
  readonly [column: string]: SqlStorageValue;
  readonly contentType: string;
  readonly fileName: string;
  readonly id: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly uploadedAt: string;
}

function getProfileIdentity(storage: DurableObjectStorage, encodedProfileId: string): Response {
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

function listProfiles(storage: DurableObjectStorage, organizationId: string | null): Response {
  if (!organizationId || organizationIdentity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const profiles = storage.sql
    .exec<OrganizationProfileRow>(
      `SELECT id, display_name AS displayName, phone, voice_part AS voicePart,
         global_status AS globalStatus, notes, show_in_directory AS showInDirectory,
         do_not_email AS doNotEmail, receive_attendance_reports AS receiveAttendanceReports,
         receive_rsvp_decline_notices AS receiveRsvpDeclineNotices,
         receive_admin_notifications AS receiveAdminNotifications,
         receive_financial_alerts AS receiveFinancialAlerts,
         is_section_leader AS isSectionLeader, photo_file_id AS photoFileId,
         created_at AS createdAt, updated_at AS updatedAt
       FROM profiles ORDER BY display_name COLLATE NOCASE ASC, id ASC LIMIT 500`,
    )
    .toArray()
    .map(profileResult);
  return Response.json({ profiles });
}

function readProfile(storage: DurableObjectStorage, profileId: string) {
  const row = storage.sql
    .exec<OrganizationProfileRow>(
      `SELECT id, display_name AS displayName, phone, voice_part AS voicePart,
         global_status AS globalStatus, notes, show_in_directory AS showInDirectory,
         do_not_email AS doNotEmail, receive_attendance_reports AS receiveAttendanceReports,
         receive_rsvp_decline_notices AS receiveRsvpDeclineNotices,
         receive_admin_notifications AS receiveAdminNotifications,
         receive_financial_alerts AS receiveFinancialAlerts,
         is_section_leader AS isSectionLeader, photo_file_id AS photoFileId,
         created_at AS createdAt, updated_at AS updatedAt
       FROM profiles WHERE id = ? LIMIT 1`,
      profileId,
    )
    .toArray()
    .at(0);
  return row ? profileResult(row) : null;
}

function readMemberProfile(
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

function listDirectoryProfiles(
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

function isConfiguredVoicePart(storage: DurableObjectStorage, voicePart: string): boolean {
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

async function createProfile(storage: DurableObjectStorage, request: Request): Promise<Response> {
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
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  return Response.json({
    createdAt: occurredAt,
    ...profile,
    id: parsed.data.profileId,
    updatedAt: occurredAt,
  });
}

async function importProfiles(storage: DurableObjectStorage, request: Request): Promise<Response> {
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
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

async function updateProfile(storage: DurableObjectStorage, request: Request): Promise<Response> {
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
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE profiles SET display_name = ?, phone = ?, voice_part = ?, global_status = ?,
         notes = ?, show_in_directory = ?, do_not_email = ?, receive_attendance_reports = ?,
         receive_rsvp_decline_notices = ?, receive_admin_notifications = ?,
         receive_financial_alerts = ?, is_section_leader = ?, updated_at = ? WHERE id = ?`,
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
      occurredAt,
      parsed.data.profileId,
    );
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
  const createdAt = storage.sql
    .exec<{ readonly createdAt: string }>(
      "SELECT created_at AS createdAt FROM profiles WHERE id = ?",
      parsed.data.profileId,
    )
    .one().createdAt;
  return Response.json({ ...profile, createdAt, id: parsed.data.profileId, updatedAt: occurredAt });
}

async function updateMemberProfile(
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

async function manageProfilePhoto(
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

async function provisionOrganizationStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = organizationProvisioningSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_provisioning_request" }, { status: 400 });
  }
  const existing = storage.sql
    .exec<OrganizationMetadataRow>(
      `SELECT organization_id AS organizationId, name, slug
       FROM organization_metadata
       LIMIT 1`,
    )
    .toArray()
    .at(0);
  if (
    existing &&
    (existing.organizationId !== parsed.data.organizationId ||
      existing.name !== parsed.data.name ||
      existing.slug !== parsed.data.slug)
  ) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }

  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO organization_metadata
        (organization_id, name, slug, lifecycle_state, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)
       ON CONFLICT(organization_id) DO UPDATE SET
         lifecycle_state = 'active', updated_at = excluded.updated_at`,
      parsed.data.organizationId,
      parsed.data.name,
      parsed.data.slug,
      occurredAt,
      occurredAt,
    );
    storage.sql.exec(
      `INSERT OR IGNORE INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'platform_administrator', ?, 'organization.provisioned',
         'organization', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      parsed.data.actorUserId,
      parsed.data.organizationId,
      parsed.data.requestId,
      JSON.stringify({
        canonicalHostname: parsed.data.canonicalHostname,
        canonicalStatus: parsed.data.canonicalStatus,
        name: parsed.data.name,
        slug: parsed.data.slug,
      }),
      occurredAt,
    );
  });
  await ensureOrganizationAlarm(storage);
  return Response.json({
    organizationId: parsed.data.organizationId,
    schemaVersion: currentOrganizationSchemaVersion,
    status: "active",
  });
}

async function claimJob(storage: DurableObjectStorage, request: Request): Promise<Response> {
  const parsed = deliveryJobSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_job" }, { status: 400 });
  }

  const existing = storage.sql
    .exec<JobLedgerRow>(
      `SELECT status, attempt, job_id AS jobId
       FROM job_ledger WHERE idempotency_key = ? LIMIT 1`,
      parsed.data.idempotencyKey,
    )
    .toArray()
    .at(0);
  if (!existing) {
    storage.sql.exec(
      `INSERT INTO job_ledger
        (idempotency_key, job_id, kind, status, attempt, claimed_at)
       VALUES (?, ?, ?, 'claimed', ?, ?)`,
      parsed.data.idempotencyKey,
      parsed.data.jobId,
      parsed.data.kind,
      parsed.data.attempt,
      new Date().toISOString(),
    );
    return Response.json({ claimed: true, status: "claimed" });
  }
  if (existing.jobId !== parsed.data.jobId) {
    return Response.json({ code: "idempotency_key_conflict" }, { status: 409 });
  }
  if (existing.status === "completed" || parsed.data.attempt <= existing.attempt) {
    return Response.json({ claimed: false, status: existing.status });
  }
  const reclaim = storage.sql.exec(
    `UPDATE job_ledger
     SET status = 'claimed', attempt = ?, claimed_at = ?, completed_at = NULL, failed_at = NULL
     WHERE idempotency_key = ? AND job_id = ? AND attempt < ?`,
    parsed.data.attempt,
    new Date().toISOString(),
    parsed.data.idempotencyKey,
    parsed.data.jobId,
    parsed.data.attempt,
  );
  return Response.json({ claimed: reclaim.rowsWritten === 1, status: "claimed" });
}

async function completeJob(storage: DurableObjectStorage, request: Request): Promise<Response> {
  const parsed = completionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_completion" }, { status: 400 });
  }
  const result = storage.sql.exec(
    `UPDATE job_ledger SET status = 'completed', completed_at = ?, failed_at = NULL
     WHERE idempotency_key = ? AND job_id = ? AND attempt = ? AND status = 'claimed'`,
    parsed.data.completedAt,
    parsed.data.idempotencyKey,
    parsed.data.jobId,
    parsed.data.attempt,
  );
  return Response.json({ completed: result.rowsWritten === 1 });
}

async function failJob(storage: DurableObjectStorage, request: Request): Promise<Response> {
  const parsed = failureSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_failure" }, { status: 400 });
  }
  const result = storage.sql.exec(
    `UPDATE job_ledger SET status = 'failed', completed_at = NULL, failed_at = ?
     WHERE idempotency_key = ? AND job_id = ? AND attempt = ? AND status = 'claimed'`,
    parsed.data.failedAt,
    parsed.data.idempotencyKey,
    parsed.data.jobId,
    parsed.data.attempt,
  );
  return Response.json({ failed: result.rowsWritten === 1 });
}

async function prepareOrganizationSchema(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = schemaPreparationRequestSchema.safeParse(await request.json());
  if (!parsed.success || parsed.data.targetVersion > currentOrganizationSchemaVersion) {
    return Response.json({ code: "invalid_schema_preparation" }, { status: 400 });
  }
  const organization = storage.sql
    .exec<OrganizationIdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (organization?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const version = storage.sql
    .exec<OrganizationSchemaVersionRow>(
      "SELECT MAX(version) AS schemaVersion FROM organization_schema_migrations",
    )
    .toArray()
    .at(0);
  if (!version || version.schemaVersion < parsed.data.targetVersion) {
    return Response.json({ code: "schema_preparation_incomplete" }, { status: 503 });
  }
  return Response.json({
    organizationId: organization.organizationId,
    schemaVersion: version.schemaVersion,
  });
}

function organizationIdentity(storage: DurableObjectStorage): OrganizationMetadataRow | undefined {
  return storage.sql
    .exec<OrganizationMetadataRow>(
      `SELECT organization_id AS organizationId, name, slug
       FROM organization_metadata LIMIT 1`,
    )
    .toArray()
    .at(0);
}

async function manageCalendarCredential(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = calendarCredentialRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_calendar_credential_request" }, { status: 400 });
  }
  if (organizationIdentity(storage)?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const profile = storage.sql
    .exec<CalendarProfileRow>(
      `SELECT display_name AS displayName, calendar_feed_version AS calendarFeedVersion
       FROM profiles WHERE id = ? LIMIT 1`,
      parsed.data.profileId,
    )
    .toArray()
    .at(0);
  if (!profile) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  if (parsed.data.action === "read") {
    return Response.json({
      calendarFeedVersion: profile.calendarFeedVersion,
      displayName: profile.displayName,
      profileId: parsed.data.profileId,
    });
  }

  const resetAt = new Date().toISOString();
  const nextVersion = profile.calendarFeedVersion + 1;
  const resetActorUserId: string = parsed.data.actorUserId;
  const resetRequestId: string = parsed.data.requestId;
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE profiles SET calendar_feed_version = ?, updated_at = ? WHERE id = ?`,
      nextVersion,
      resetAt,
      parsed.data.profileId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'profile.calendar_feed.reset',
         'profile', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      resetActorUserId,
      parsed.data.profileId,
      resetRequestId,
      JSON.stringify({ afterVersion: nextVersion, beforeVersion: profile.calendarFeedVersion }),
      resetAt,
    );
  });
  return Response.json({
    calendarFeedVersion: nextVersion,
    displayName: profile.displayName,
    profileId: parsed.data.profileId,
  });
}

async function validateCalendarFeed(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = calendarFeedValidationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_calendar_feed" }, { status: 400 });
  }
  const organization = organizationIdentity(storage);
  if (organization?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "calendar_feed_not_found" }, { status: 404 });
  }
  const profile = storage.sql
    .exec<CalendarProfileRow>(
      `SELECT display_name AS displayName, calendar_feed_version AS calendarFeedVersion
       FROM profiles WHERE id = ? LIMIT 1`,
      parsed.data.profileId,
    )
    .toArray()
    .at(0);
  if (profile?.calendarFeedVersion !== parsed.data.revocationVersion) {
    return Response.json({ code: "calendar_feed_not_found" }, { status: 404 });
  }
  const readAt = new Date(parsed.data.readAt);
  const earliest = new Date(readAt.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const latest = new Date(readAt.getTime() + 365 * 24 * 60 * 60 * 1_000).toISOString();
  const rows = storage.sql
    .exec<CalendarEventRow>(
      `SELECT e.id, e.title, e.type, e.starts_at AS startsAt,
         e.duration_minutes AS durationMinutes, e.call_time AS callTime,
         e.location, e.details, e.set_list_json AS setListJson,
         e.set_list_approved AS setListApproved,
         COALESCE(v.name, '') AS venueName, COALESCE(v.address, '') AS venueAddress,
         direct.rsvp AS directRsvp, parent.rsvp AS parentRsvp
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       LEFT JOIN event_rosters direct
         ON direct.event_id = e.id AND direct.profile_id = ?
       LEFT JOIN event_rosters parent
         ON parent.event_id = e.parent_performance_id AND parent.profile_id = ?
       WHERE e.is_archived = 0 AND e.starts_at >= ? AND e.starts_at <= ?
       ORDER BY e.starts_at ASC, e.id ASC
       LIMIT 500`,
      parsed.data.profileId,
      parsed.data.profileId,
      earliest,
      latest,
    )
    .toArray();
  const events = rows.flatMap((event) => {
    let resolvedRsvp = event.directRsvp ?? "Pending";
    if (
      event.type === "Rehearsal" &&
      resolvedRsvp === "Pending" &&
      event.parentRsvp !== null &&
      event.parentRsvp !== "Pending"
    ) {
      resolvedRsvp = event.parentRsvp;
    }
    if (resolvedRsvp !== "Yes" && resolvedRsvp !== "Pending") return [];
    return [
      {
        callTime: event.callTime,
        details: event.details,
        durationMinutes: event.durationMinutes,
        id: event.id,
        location: event.location,
        resolvedRsvp,
        setListApproved: event.setListApproved === 1,
        setListJson: event.setListJson,
        startsAt: event.startsAt,
        title: event.title,
        type: event.type,
        venueAddress: event.venueAddress,
        venueName: event.venueName,
      },
    ];
  });
  return Response.json({
    calendarFeedVersion: profile.calendarFeedVersion,
    events,
    organizationName: organization.name,
    profileId: parsed.data.profileId,
    profileName: profile.displayName,
    timezone:
      storage.sql
        .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
          "SELECT timezone FROM organization_metadata LIMIT 1",
        )
        .toArray()
        .at(0)?.timezone ?? "UTC",
  });
}

async function reservePrivateFile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileReservationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_private_file" }, { status: 400 });
  }
  const organization = storage.sql
    .exec<OrganizationIdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (organization?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const storageKey = privateOrganizationFileKey(parsed.data.organizationId, parsed.data.fileId);
  try {
    storage.sql.exec(
      `INSERT INTO private_files
        (id, storage_key, file_name, content_type, size_bytes, status,
         uploaded_by, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      parsed.data.fileId,
      storageKey,
      parsed.data.fileName,
      parsed.data.contentType,
      parsed.data.sizeBytes,
      parsed.data.actorUserId,
      parsed.data.requestId,
      new Date().toISOString(),
    );
    return Response.json({ reserved: true, storageKey });
  } catch {
    return Response.json({ code: "private_file_conflict" }, { status: 409 });
  }
}

async function finalizePrivateFile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileTransitionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_private_file_transition" }, { status: 400 });
  }
  const expectedKey = privateOrganizationFileKey(parsed.data.organizationId, parsed.data.fileId);
  if (parsed.data.storageKey !== expectedKey) {
    return Response.json({ code: "private_file_scope_conflict" }, { status: 409 });
  }
  const uploadedAt = new Date().toISOString();
  const ready = storage.transactionSync(() => {
    const result = storage.sql.exec(
      `UPDATE private_files SET status = 'ready', ready_at = ?
       WHERE id = ? AND storage_key = ? AND uploaded_by = ? AND request_id = ?
         AND status = 'pending'`,
      uploadedAt,
      parsed.data.fileId,
      expectedKey,
      parsed.data.actorUserId,
      parsed.data.requestId,
    );
    if (result.rowsWritten !== 1) {
      return false;
    }
    storage.sql.exec(
      `INSERT INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'organization_member', ?, 'organization.file.uploaded',
           'private_file', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      parsed.data.actorUserId,
      parsed.data.fileId,
      parsed.data.requestId,
      JSON.stringify({ fileId: parsed.data.fileId, storageKey: expectedKey }),
      uploadedAt,
    );
    return true;
  });
  return ready
    ? Response.json({ ready: true, uploadedAt })
    : Response.json({ code: "private_file_not_reserved" }, { status: 409 });
}

async function abortPrivateFile(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileTransitionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_private_file_transition" }, { status: 400 });
  }
  const expectedKey = privateOrganizationFileKey(parsed.data.organizationId, parsed.data.fileId);
  storage.sql.exec(
    `DELETE FROM private_files
     WHERE id = ? AND storage_key = ? AND uploaded_by = ? AND request_id = ?
       AND status = 'pending'`,
    parsed.data.fileId,
    expectedKey,
    parsed.data.actorUserId,
    parsed.data.requestId,
  );
  return Response.json({ aborted: true });
}

function privateFileIsReferenced(storage: DurableObjectStorage, fileId: string): boolean {
  const profileReference = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM profiles WHERE photo_file_id = ?",
      fileId,
    )
    .one().count;
  if (profileReference > 0) return true;
  const musicReference = storage.sql
    .exec<{ readonly trackFileIdsJson: string }>(
      "SELECT track_file_ids_json AS trackFileIdsJson FROM music_pieces",
    )
    .toArray()
    .some(({ trackFileIdsJson }) => {
      try {
        const value: unknown = JSON.parse(trackFileIdsJson);
        return (
          typeof value === "object" &&
          value !== null &&
          Object.values(value).some((candidate) => candidate === fileId)
        );
      } catch {
        return false;
      }
    });
  if (musicReference) return true;
  const publicWebsiteReference = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      `SELECT
        (SELECT COUNT(*) FROM public_website_settings
         WHERE hero_file_id = ? OR logo_file_id = ?) +
        (SELECT COUNT(*) FROM events WHERE public_graphic_file_id = ?) AS count`,
      fileId,
      fileId,
      fileId,
    )
    .one().count;
  if (publicWebsiteReference > 0) return true;
  return (
    storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
        "SELECT COUNT(*) AS count FROM organization_resources WHERE file_id = ?",
        fileId,
      )
      .one().count > 0
  );
}

async function claimPrivateFileReclamation(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileTransitionSchema.safeParse(await request.json());
  if (!parsed.success)
    return Response.json({ code: "invalid_private_file_transition" }, { status: 400 });
  const expectedKey = privateOrganizationFileKey(parsed.data.organizationId, parsed.data.fileId);
  const claimed = storage.transactionSync(() => {
    if (privateFileIsReferenced(storage, parsed.data.fileId)) return false;
    return (
      storage.sql.exec(
        `UPDATE private_files SET status = 'pending', uploaded_by = ?, request_id = ?
       WHERE id = ? AND storage_key = ? AND status = 'ready'`,
        parsed.data.actorUserId,
        parsed.data.requestId,
        parsed.data.fileId,
        expectedKey,
      ).rowsWritten === 1
    );
  });
  return claimed
    ? Response.json({ claimed: true, storageKey: expectedKey })
    : Response.json({ code: "private_file_in_use_or_missing" }, { status: 409 });
}

async function finishPrivateFileReclamation(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileTransitionSchema.safeParse(await request.json());
  if (!parsed.success)
    return Response.json({ code: "invalid_private_file_transition" }, { status: 400 });
  const expectedKey = privateOrganizationFileKey(parsed.data.organizationId, parsed.data.fileId);
  const reclaimed = storage.transactionSync(() => {
    const deleted =
      storage.sql.exec(
        `DELETE FROM private_files WHERE id = ? AND storage_key = ? AND uploaded_by = ?
       AND request_id = ? AND status = 'pending'`,
        parsed.data.fileId,
        expectedKey,
        parsed.data.actorUserId,
        parsed.data.requestId,
      ).rowsWritten === 1;
    if (!deleted) return false;
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'organization.file.reclaimed',
         'private_file', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      parsed.data.actorUserId,
      parsed.data.fileId,
      parsed.data.requestId,
      JSON.stringify({ fileId: parsed.data.fileId, storageKey: expectedKey }),
      new Date().toISOString(),
    );
    return true;
  });
  return reclaimed
    ? Response.json(privateFileReclaimResponseSchema.parse({ reclaimed: true }))
    : Response.json({ code: "private_file_reclaim_not_claimed" }, { status: 409 });
}

async function abortPrivateFileReclamation(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = privateFileTransitionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_private_file_transition" }, { status: 400 });
  }
  const expectedKey = privateOrganizationFileKey(parsed.data.organizationId, parsed.data.fileId);
  storage.sql.exec(
    `UPDATE private_files SET status = 'ready'
     WHERE id = ? AND storage_key = ? AND uploaded_by = ? AND request_id = ?
       AND status = 'pending'`,
    parsed.data.fileId,
    expectedKey,
    parsed.data.actorUserId,
    parsed.data.requestId,
  );
  return Response.json({ aborted: true });
}

function getPrivateFileMetadata(storage: DurableObjectStorage, encodedFileId: string): Response {
  const fileId = privateFileIdSchema.safeParse(decodeURIComponent(encodedFileId));
  if (!fileId.success) {
    return Response.json({ code: "private_file_not_found" }, { status: 404 });
  }
  const metadata = storage.sql
    .exec<PrivateFileMetadataRow>(
      `SELECT id, storage_key AS storageKey, file_name AS fileName,
        content_type AS contentType, size_bytes AS sizeBytes, ready_at AS uploadedAt
       FROM private_files WHERE id = ? AND status = 'ready' LIMIT 1`,
      fileId.data,
    )
    .toArray()
    .at(0);
  return metadata
    ? Response.json(metadata)
    : Response.json({ code: "private_file_not_found" }, { status: 404 });
}

async function dispatchPostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  const profileResponse = await dispatchProfilePostRequest(storage, pathname, request);
  if (profileResponse) return profileResponse;
  const fileResponse = await dispatchPrivateFilePostRequest(storage, pathname, request);
  if (fileResponse) return fileResponse;
  const communicationResponse = await dispatchCommunicationPostRequest(storage, pathname, request);
  if (communicationResponse) return communicationResponse;
  const websiteResponse = await dispatchWebsitePostRequest(storage, pathname, request);
  if (websiteResponse) return websiteResponse;
  if (pathname === "/internal/ticketing/manage") return manageTicketingInStore(storage, request);
  if (pathname === "/internal/donations/manage") return manageDonationsInStore(storage, request);
  if (pathname === "/internal/seasons/manage") return manageSeasonsInStore(storage, request);
  if (pathname === "/internal/setup/manage") return manageSetupInStore(storage, request);
  if (pathname === "/internal/polls/manage") return managePollInStore(storage, request);
  return dispatchOperationalPostRequest(storage, pathname, request);
}

async function auditionCreateHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = organizationAuditionCreateRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ code: "validation_failed" }, { status: 400 });
  }
  if (
    parsed.data.performanceId &&
    storage.sql
      .exec(
        "SELECT 1 FROM events WHERE id = ? AND type = 'Performance' AND is_archived = 0 LIMIT 1",
        parsed.data.performanceId,
      )
      .toArray().length === 0
  ) {
    return Response.json({ code: "performance_not_found" }, { status: 400 });
  }
  if (!auditionSlotsAreConfigured(storage, parsed.data.requestedSlots)) {
    return Response.json({ code: "invalid_audition_slot" }, { status: 400 });
  }
  const context = z.object({ actorUserId: z.string().min(1), requestId: z.uuid() }).safeParse(raw);
  const id = createAuditionInStore(
    storage,
    {
      availabilityNotes: parsed.data.availabilityNotes ?? "",
      email: parsed.data.email,
      experience: parsed.data.experience ?? "",
      name: parsed.data.name,
      performanceId: parsed.data.performanceId ?? null,
      phone: parsed.data.phone ?? "",
      requestedSlots: parsed.data.requestedSlots,
      scheduledTimeSlot: parsed.data.scheduledTimeSlot ?? null,
      status: parsed.data.status,
      voicePart: parsed.data.voicePart ?? "",
    },
    context.success ? context.data : undefined,
  );
  return readAuditionFromStore(storage, null, id);
}

interface AuditionUpdatePayload {
  readonly actor?: { readonly actorUserId: string; readonly requestId: string };
  readonly input: {
    readonly adminNotes?: string;
    readonly availabilityNotes?: string;
    readonly email?: string;
    readonly experience?: string;
    readonly name?: string;
    readonly performanceId?: string | null;
    readonly phone?: string;
    readonly requestedSlots?: readonly string[];
    readonly scheduledTimeSlot?: string | null;
    readonly status?: string;
    readonly voicePart?: string;
  };
}

function auditionInputFromParsed(
  data: z.infer<typeof organizationAuditionUpdateRequestSchema>,
): AuditionUpdatePayload["input"] {
  const input: {
    adminNotes?: string;
    availabilityNotes?: string;
    email?: string;
    experience?: string;
    name?: string;
    performanceId?: string | null;
    phone?: string;
    requestedSlots?: readonly string[];
    scheduledTimeSlot?: string | null;
    status?: string;
    voicePart?: string;
  } = {};
  if (data.adminNotes !== undefined) input.adminNotes = data.adminNotes;
  if (data.availabilityNotes !== undefined) input.availabilityNotes = data.availabilityNotes;
  if (data.email !== undefined) input.email = data.email;
  if (data.experience !== undefined) input.experience = data.experience;
  if (data.name !== undefined) input.name = data.name;
  if (data.performanceId !== undefined) input.performanceId = data.performanceId;
  if (data.phone !== undefined) input.phone = data.phone;
  if (data.requestedSlots !== undefined) input.requestedSlots = data.requestedSlots;
  if (data.scheduledTimeSlot !== undefined) input.scheduledTimeSlot = data.scheduledTimeSlot;
  if (data.status !== undefined) input.status = data.status;
  if (data.voicePart !== undefined) input.voicePart = data.voicePart;
  return input;
}

function parseAuditionUpdatePayload(raw: unknown, url: URL): AuditionUpdatePayload {
  const parsedBody = organizationAuditionUpdateRequestSchema.safeParse(raw);
  const actor = z.object({ actorUserId: z.string().min(1), requestId: z.uuid() }).safeParse(raw);
  if (parsedBody.success) {
    return {
      ...(actor.success ? { actor: actor.data } : {}),
      input: auditionInputFromParsed(parsedBody.data),
    };
  }
  const availabilityNotes = url.searchParams.get("availabilityNotes") ?? undefined;
  const voicePart = url.searchParams.get("voicePart") ?? undefined;
  if (availabilityNotes !== undefined || voicePart !== undefined) {
    return {
      input: {
        ...(availabilityNotes === undefined ? {} : { availabilityNotes }),
        ...(voicePart === undefined ? {} : { voicePart }),
      },
    };
  }
  const adminNotes = url.searchParams.get("adminNotes") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  return {
    input: {
      ...(adminNotes === undefined ? {} : { adminNotes }),
      ...(status === undefined ? {} : { status }),
    },
  };
}

async function auditionUpdateHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const auditionId = url.searchParams.get("auditionId") ?? "";
  const payload = parseAuditionUpdatePayload(await request.json().catch(() => null), url);
  return updateAuditionInStore(storage, auditionId, payload.input, payload.actor);
}

async function auditionSettingsUpdateHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = organizationAuditionSettingsSchema.safeParse(raw);
  const context = z
    .object({
      actorUserId: z.string().min(1),
      organizationId: z.string().min(1),
      requestId: z.uuid(),
    })
    .safeParse(raw);
  if (!parsed.success || !context.success)
    return Response.json({ code: "validation_failed" }, { status: 400 });
  return updateAuditionSettingsInStore(storage, context.data.organizationId, parsed.data, {
    actorUserId: context.data.actorUserId,
    requestId: context.data.requestId,
  });
}

async function auditionDeleteHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const body = z
    .object({
      actorUserId: z.string().min(1),
      auditionId: z.string().min(1),
      requestId: z.uuid(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ code: "validation_failed" }, { status: 400 });
  return deleteAuditionInStore(storage, body.data.auditionId, {
    actorUserId: body.data.actorUserId,
    requestId: body.data.requestId,
  });
}

async function auditionNotificationResultHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const body = z
    .object({
      failureDetail: z.string().max(2_000).default(""),
      jobId: z.uuid(),
      organizationId: z.string().min(1),
      providerMessageId: z.string().max(512).nullable(),
      status: z.enum(["failed", "sent", "suppressed"]),
    })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ code: "validation_failed" }, { status: 400 });
  return recordAuditionNotificationResult(storage, body.data.organizationId, body.data);
}

async function dispatchAuditionPostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  switch (pathname) {
    case "/internal/audition/update":
      return auditionUpdateHandler(storage, request);
    case "/internal/audition/create":
      return auditionCreateHandler(storage, request);
    case "/internal/audition/delete":
      return auditionDeleteHandler(storage, request);
    case "/internal/audition/settings":
      return auditionSettingsUpdateHandler(storage, request);
    case "/internal/audition/notification-result":
      return auditionNotificationResultHandler(storage, request);
    case "/internal/export/create":
      return createOrganizationExportInStore(storage, await request.json().catch(() => null));
    case "/internal/export/complete":
      return completeOrganizationExportInStore(storage, await request.json().catch(() => null));
    case "/internal/export/fail":
      return failOrganizationExportInStore(storage, await request.json().catch(() => null));
    case "/internal/auditions/list":
      return listAuditionsFromStore(storage);
    default:
      return null;
  }
}

async function dispatchOperationalPostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  const auditionResponse = await dispatchAuditionPostRequest(storage, pathname, request);
  if (auditionResponse) return auditionResponse;
  switch (pathname) {
    case "/internal/jobs/claim":
      return claimJob(storage, request);
    case "/internal/jobs/complete":
      return completeJob(storage, request);
    case "/internal/jobs/fail":
      return failJob(storage, request);
    case "/internal/calendar/credential":
      return manageCalendarCredential(storage, request);
    case "/internal/calendar/feed":
      return validateCalendarFeed(storage, request);
    case "/internal/calendar/manage":
      return manageOrganizationCalendarInStore(storage, request);
    case "/internal/seating/manage":
      return manageSeatingInStore(storage, request);
    case "/internal/music/manage":
      return manageMusicInStore(storage, request);
    case "/internal/resources/manage":
      return manageResourceInStore(storage, request);
    case "/internal/provision":
      return provisionOrganizationStore(storage, request);
    case "/internal/schema/prepare":
      return prepareOrganizationSchema(storage, request);
    default:
      return null;
  }
}

const contentGetHandlers: Record<
  string,
  (storage: DurableObjectStorage, url: URL, organizationId: string | null) => Response | null
> = {
  "/internal/resources": (storage, _url, organizationId) =>
    listResourcesFromStore(storage, organizationId),
  "/internal/communications": (storage, _url, organizationId) =>
    listCommunicationMessagesFromStore(storage, organizationId),
  "/internal/communications/templates": (storage, _url, organizationId) =>
    listCommunicationTemplatesFromStore(storage, organizationId),
  "/internal/communications/summary": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) =>
    readCommunicationSummaryFromStore(storage, organizationId, url.searchParams.get("messageId")),
  "/internal/communications/job": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readCommunicationJobFromStore(storage, organizationId, url.searchParams.get("jobId")),
  "/internal/export/snapshot": (storage, _url, organizationId) =>
    readExportSnapshot(storage, organizationId),
  "/internal/export/job": (storage, url, organizationId) =>
    readOrganizationExportJobFromStore(storage, organizationId, url.searchParams.get("exportId")),
  "/internal/website/settings": (storage, _url, organizationId) =>
    readPublicWebsiteSettingsFromStore(storage, organizationId),
  "/internal/polls": (storage, _url, organizationId) => listPollsFromStore(storage, organizationId),
  "/internal/polls/archived": (storage, _url, organizationId) =>
    listArchivedPollsFromStore(storage, organizationId),
  "/internal/polls/poll": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readPollFromStore(storage, organizationId, url.searchParams.get("pollId")),
  "/internal/polls/profile-poll": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) =>
    readProfilePollFromStore(storage, {
      organizationId,
      pollId: url.searchParams.get("pollId"),
      profileId: url.searchParams.get("profileId"),
    }),
  "/internal/ticketing/orders": (storage, _url, organizationId) =>
    listTicketOrdersFromStore(storage, organizationId),
  "/internal/ticketing/bundles": (storage, _url, organizationId) =>
    listTicketBundlesFromStore(storage, organizationId),
  "/internal/ticketing/purchase": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readTicketPurchaseFromStore(storage, organizationId, url.searchParams.get("purchaseId")),
  "/internal/ticketing/will-call": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readTicketWillCallFromStore(storage, organizationId, url.searchParams.get("eventId")),
  "/internal/ticketing/notification-job": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readTicketNotificationJobFromStore(storage, organizationId, url.searchParams.get("jobId")),
  "/internal/audition/notification-job": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readAuditionNotificationJobFromStore(storage, organizationId, url.searchParams.get("jobId")),
  "/internal/donations/list": (storage, _url, organizationId) =>
    listDonationsFromStore(storage, organizationId),
  "/internal/donations/patrons": (storage, _url, organizationId) =>
    listPatronsFromStore(storage, organizationId),
  "/internal/scheduling/event-reminder-job": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readEventReminderJobFromStore(storage, organizationId, url.searchParams.get("jobId")),
  "/internal/scheduling/attendance-report-job": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readAttendanceReportJobFromStore(storage, organizationId, url.searchParams.get("jobId")),
  "/internal/player/details": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) =>
    readPlayerDetailsFromStore(
      storage,
      organizationId,
      url.searchParams.get("eventId"),
      url.searchParams.get("profileId"),
    ),
  "/internal/audition/details": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readAuditionFromStore(storage, organizationId, url.searchParams.get("auditionId") ?? ""),
  "/internal/seasons/list": (storage, _url, organizationId) =>
    listSeasonsFromStore(storage, organizationId),
  "/internal/seasons/dues": (storage, _url, organizationId) =>
    listDuesFromStore(storage, organizationId),
};

function dispatchContentGetRequest(
  storage: DurableObjectStorage,
  url: URL,
  organizationId: string | null,
): Response | null {
  const handler = contentGetHandlers[url.pathname];
  return handler ? handler(storage, url, organizationId) : null;
}

async function dispatchWebsitePostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  return pathname === "/internal/website/manage"
    ? managePublicWebsiteInStore(storage, request)
    : null;
}

async function dispatchCommunicationPostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  if (pathname === "/internal/communications/audience") {
    return resolveCommunicationAudienceFromStore(storage, request);
  }
  if (pathname === "/internal/communications/manage") {
    return manageCommunicationInStore(storage, request);
  }
  if (pathname === "/internal/communications/unsubscribe") {
    return unsubscribeCommunicationProfileInStore(storage, request);
  }
  return null;
}

async function dispatchPrivateFilePostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  switch (pathname) {
    case "/internal/files/abort":
      return abortPrivateFile(storage, request);
    case "/internal/files/ready":
      return finalizePrivateFile(storage, request);
    case "/internal/files/reserve":
      return reservePrivateFile(storage, request);
    case "/internal/files/reclaim":
      return claimPrivateFileReclamation(storage, request);
    case "/internal/files/reclaim-abort":
      return abortPrivateFileReclamation(storage, request);
    case "/internal/files/reclaimed":
      return finishPrivateFileReclamation(storage, request);
    default:
      return null;
  }
}

async function dispatchProfilePostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  switch (pathname) {
    case "/internal/profiles":
      return createProfile(storage, request);
    case "/internal/profiles/member-update":
      return updateMemberProfile(storage, request);
    case "/internal/profiles/photo":
      return manageProfilePhoto(storage, request);
    case "/internal/profiles/import":
      return importProfiles(storage, request);
    case "/internal/profiles/update":
      return updateProfile(storage, request);
    default:
      return null;
  }
}

function dispatchProfileGetRequest(
  storage: DurableObjectStorage,
  url: URL,
  organizationId: string | null,
): Response | null {
  switch (url.pathname) {
    case "/internal/profiles":
      return listProfiles(storage, organizationId);
    case "/internal/profiles/directory":
      return listDirectoryProfiles(storage, organizationId);
    case "/internal/profiles/member":
      return readMemberProfile(storage, organizationId, url.searchParams.get("profileId"));
  }
  const profileIdentityPrefix = "/internal/profiles/";
  return url.pathname.startsWith(profileIdentityPrefix)
    ? getProfileIdentity(storage, url.pathname.slice(profileIdentityPrefix.length))
    : null;
}

function dispatchCalendarGetRequest(
  storage: DurableObjectStorage,
  url: URL,
  organizationId: string | null,
): Response | null {
  switch (url.pathname) {
    case "/internal/calendar/venues":
      return listOrganizationVenuesFromStore(storage, organizationId);
    case "/internal/calendar/events":
      return listOrganizationEventsFromStore(storage, organizationId);
    case "/internal/calendar/dashboard-summary":
      return readOrganizationDashboardSummaryFromStore(storage, organizationId);
    case "/internal/calendar/attendance":
      return listEventAttendanceFromStore(storage, {
        eventId: url.searchParams.get("eventId"),
        organizationId,
      });
    case "/internal/calendar/event-rsvp-export":
      return readEventRsvpExportFromStore(storage, {
        eventId: url.searchParams.get("eventId"),
        organizationId,
      });
    case "/internal/calendar/event-rsvp":
      return readProfileEventRsvpFromStore(storage, {
        eventId: url.searchParams.get("eventId"),
        organizationId,
        profileId: url.searchParams.get("profileId"),
      });
    case "/internal/calendar/settings":
      return readOrganizationCalendarSettingsFromStore(storage, organizationId);
    case "/internal/calendar/member-events":
      return listMemberEventsFromStore(storage, {
        organizationId,
        profileId: url.searchParams.get("profileId"),
        readAt: url.searchParams.get("readAt"),
      });
    default:
      return null;
  }
}

function dispatchGetRequest(storage: DurableObjectStorage, url: URL): Response | null {
  const organizationId = url.searchParams.get("organizationId");
  const profileResponse = dispatchProfileGetRequest(storage, url, organizationId);
  if (profileResponse) return profileResponse;
  const contentResponse = dispatchContentGetRequest(storage, url, organizationId);
  if (contentResponse) return contentResponse;
  const calendarResponse = dispatchCalendarGetRequest(storage, url, organizationId);
  if (calendarResponse) return calendarResponse;
  switch (url.pathname) {
    case "/internal/auditions/list":
      return listAuditionsFromStore(storage);
    case "/internal/audition/settings":
      return readAuditionSettingsFromStore(storage, organizationId);
    case "/internal/health":
      return Response.json({ status: "ok" });
    case "/internal/roster/configuration":
      return readRosterConfigurationFromStore(storage, organizationId);
    case "/internal/seating/configuration":
      return readSeatingConfigurationFromStore(storage, organizationId);
    case "/internal/music/pieces":
      return listMusicPiecesFromStore(storage, organizationId);
    case "/internal/seating/charts":
      return listSeatingChartsFromStore(storage, {
        eventId: url.searchParams.get("eventId"),
        organizationId,
      });
    case "/internal/seating/singer":
      return readSingerSeatingFromStore(storage, {
        chartId: url.searchParams.get("chartId"),
        eventId: url.searchParams.get("eventId"),
        organizationId,
        profileId: url.searchParams.get("profileId"),
      });
  }
  if (url.pathname === "/internal/setup/state") {
    return getSetupStateFromStore(storage, organizationId);
  }
  if (url.pathname === "/internal/setup/modules") {
    return getModuleStateFromStore(storage, organizationId);
  }
  const privateFilePrefix = "/internal/files/";
  if (url.pathname.startsWith(privateFilePrefix)) {
    return getPrivateFileMetadata(storage, url.pathname.slice(privateFilePrefix.length));
  }
  return null;
}

function readExportSnapshot(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  try {
    return Response.json(readOrganizationExportSnapshot(storage, organizationId));
  } catch {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
}

export class OrganizationStore extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    migrateOrganization(state.storage.sql);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST") {
      const response = await dispatchPostRequest(this.ctx.storage, url.pathname, request);
      if (response) {
        return response;
      }
    }
    if (request.method === "GET") {
      const response = dispatchGetRequest(this.ctx.storage, url);
      if (response) return response;
    }

    return Response.json({ code: "not_found" }, { status: 404 });
  }

  override async alarm(): Promise<void> {
    await runOrganizationAlarm(this.ctx.storage, this.env.JOBS_QUEUE);
  }
}
