import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { organizationProfileRequestSchema } from "@choir/contracts";

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
  listEventAttendanceFromStore,
  listMemberEventsFromStore,
  listOrganizationVenuesFromStore,
  manageOrganizationCalendarInStore,
  readOrganizationCalendarSettingsFromStore,
} from "./calendarManagementStore";
import { ensureOrganizationAlarm, runOrganizationAlarm } from "./scheduler";
import { currentOrganizationSchemaVersion } from "./schema";

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
const schemaPreparationRequestSchema = z.object({
  organizationId: z.string().min(1).max(128),
  targetVersion: z.number().int().positive(),
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
         is_section_leader AS isSectionLeader,
         created_at AS createdAt, updated_at AS updatedAt
       FROM profiles ORDER BY display_name COLLATE NOCASE ASC, id ASC LIMIT 500`,
    )
    .toArray()
    .map(profileResult);
  return Response.json({ profiles });
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
      `profile-created:${parsed.data.requestId}`,
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
      `profile-updated:${parsed.data.requestId}`,
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
      `organization-provisioned:${parsed.data.requestId}`,
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
      `calendar-feed-reset:${resetRequestId}`,
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
      `private-file-uploaded:${parsed.data.requestId}`,
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
  switch (pathname) {
    case "/internal/files/abort":
      return abortPrivateFile(storage, request);
    case "/internal/files/ready":
      return finalizePrivateFile(storage, request);
    case "/internal/files/reserve":
      return reservePrivateFile(storage, request);
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
    case "/internal/profiles":
      return createProfile(storage, request);
    case "/internal/profiles/update":
      return updateProfile(storage, request);
    case "/internal/provision":
      return provisionOrganizationStore(storage, request);
    case "/internal/schema/prepare":
      return prepareOrganizationSchema(storage, request);
    default:
      return null;
  }
}

function dispatchGetRequest(storage: DurableObjectStorage, url: URL): Response | null {
  const organizationId = url.searchParams.get("organizationId");
  switch (url.pathname) {
    case "/internal/health":
      return Response.json({ status: "ok" });
    case "/internal/profiles":
      return listProfiles(storage, organizationId);
    case "/internal/calendar/venues":
      return listOrganizationVenuesFromStore(storage, organizationId);
    case "/internal/calendar/events":
      return listOrganizationEventsFromStore(storage, organizationId);
    case "/internal/calendar/attendance":
      return listEventAttendanceFromStore(storage, {
        eventId: url.searchParams.get("eventId"),
        organizationId,
      });
    case "/internal/calendar/settings":
      return readOrganizationCalendarSettingsFromStore(storage, organizationId);
    case "/internal/calendar/member-events":
      return listMemberEventsFromStore(storage, {
        organizationId,
        profileId: url.searchParams.get("profileId"),
        readAt: url.searchParams.get("readAt"),
      });
  }
  const profileIdentityPrefix = "/internal/profiles/";
  if (url.pathname.startsWith(profileIdentityPrefix)) {
    return getProfileIdentity(storage, url.pathname.slice(profileIdentityPrefix.length));
  }
  const privateFilePrefix = "/internal/files/";
  if (url.pathname.startsWith(privateFilePrefix)) {
    return getPrivateFileMetadata(storage, url.pathname.slice(privateFilePrefix.length));
  }
  return null;
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
