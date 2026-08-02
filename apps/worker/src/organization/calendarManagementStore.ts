import {
  organizationAttendanceBulkRequestSchema,
  organizationEventRequestSchema,
  organizationEventRsvpHistoryResponseSchema,
  organizationCalendarSettingsRequestSchema,
  organizationProfileFolderNumberUpdateSchema,
  organizationRsvpRequestSchema,
  organizationRosterConfigurationRequestSchema,
  organizationSetListItemSchema,
  organizationVenueRequestSchema,
  type OrganizationRosterConfiguration,
} from "@choir/contracts";
import { defaultRosterConfiguration, isValidTimeZone } from "@choir/domain";
import { z } from "zod";

import {
  decorateEventWithRsvpDeadline,
  recalculateProfileStatuses,
  reconcilePresentAttendance,
  recordEventRsvpChange,
  readRosterAutomationConfiguration,
  runRosterAutomations,
} from "./statusAutomationStore";

const actorSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

const managementRequestSchema = z.discriminatedUnion("action", [
  actorSchema.extend({
    action: z.literal("bulk_attendance"),
    attendance: organizationAttendanceBulkRequestSchema,
    eventId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("update_profile_folder_number"),
    eventId: z.uuid(),
    folder: organizationProfileFolderNumberUpdateSchema,
    profileId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("create_event"),
    event: organizationEventRequestSchema.extend({ id: z.uuid() }),
  }),
  actorSchema.extend({
    action: z.literal("update_event"),
    event: organizationEventRequestSchema.extend({ id: z.uuid() }),
  }),
  actorSchema.extend({
    action: z.literal("archive_event"),
    eventId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("cancel_event"),
    eventId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("create_venue"),
    venue: organizationVenueRequestSchema.extend({ id: z.uuid() }),
  }),
  actorSchema.extend({
    action: z.literal("update_venue"),
    venue: organizationVenueRequestSchema.extend({ id: z.uuid() }),
  }),
  actorSchema.extend({
    action: z.literal("delete_venue"),
    venueId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("set_rsvp"),
    eventId: z.uuid(),
    rsvp: organizationRsvpRequestSchema,
    selfService: z.boolean().default(false),
  }),
  actorSchema.extend({
    action: z.literal("update_timezone"),
    settings: organizationCalendarSettingsRequestSchema,
  }),
  actorSchema.extend({
    action: z.literal("update_roster_configuration"),
    configuration: organizationRosterConfigurationRequestSchema,
  }),
]);

type ManagementRequest = z.infer<typeof managementRequestSchema>;
type EventOperation = Extract<ManagementRequest, { readonly event: unknown }>;
type VenueOperation = Extract<
  ManagementRequest,
  { readonly action: "create_venue" | "delete_venue" | "update_venue" }
>;

interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

interface VenueRow {
  readonly [column: string]: SqlStorageValue;
  readonly address: string;
  readonly createdAt: string;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

interface EventRow {
  readonly [column: string]: SqlStorageValue;
  readonly advancePriceCents: number;
  readonly callTime: string;
  readonly createdAt: string;
  readonly details: string;
  readonly dayOfPriceCents: number;
  readonly doorsOpenTime: string;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly isCanceled: number;
  readonly isTicketingEnabled: number;
  readonly location: string;
  readonly parentPerformanceId: string | null;
  readonly publicDetails: string;
  readonly publicGraphicFileId: string | null;
  readonly publishOnWebsite: number;
  readonly rsvpFollowUpLeadHours: number | null;
  readonly rsvpFollowUpMode: "disabled" | "enabled" | "inherit";
  readonly setListApproved: number;
  readonly setListJson: string;
  readonly startsAt: string;
  readonly ticketCapacity: number | null;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal";
  readonly updatedAt: string;
  readonly venueId: string | null;
}

interface DashboardEventRow {
  readonly [column: string]: SqlStorageValue;
  readonly id: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal";
}

interface MemberEventRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendanceMissed: number;
  readonly attendanceTotal: number;
  readonly callTime: string;
  readonly details: string;
  readonly directRsvp: "No" | "Pending" | "Yes" | null;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly isCanceled: number;
  readonly location: string;
  readonly parentRsvp: "No" | "Pending" | "Yes" | null;
  readonly parentSetListJson: string | null;
  readonly practiceEventId: string | null;
  readonly practiceTrackCount: number;
  readonly rsvpNote: string;
  readonly seatingChartExists: number;
  readonly seatingAssigned: number;
  readonly setListApproved: number;
  readonly setListJson: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal";
  readonly venueAddress: string;
  readonly venueName: string;
}

interface ProfilePerformanceRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendance: "Absent" | "Pending" | "Present";
  readonly id: string;
  readonly location: string;
  readonly rsvp: "No" | "Pending" | "Yes";
  readonly startsAt: string;
  readonly title: string;
  readonly venueName: string;
}

interface AttendanceRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendance: "Absent" | "Pending" | "Present";
  readonly displayName: string;
  readonly profileId: string;
  readonly rsvp: "No" | "Pending" | "Yes";
  readonly updatedAt: string | null;
  readonly voicePart: string;
}

interface EventRsvpHistoryRow {
  readonly [column: string]: SqlStorageValue;
  readonly actorType: string;
  readonly automatic: number;
  readonly displayName: string;
  readonly eventId: string;
  readonly newRsvp: "No" | "Pending" | "Yes";
  readonly occurredAt: string;
  readonly previousRsvp: "No" | "Pending" | "Yes";
  readonly profileId: string;
  readonly reason: string;
}

interface ProfileFolderNumberRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventType: "Performance";
  readonly folderNumber: string;
  readonly folderReturned: number;
  readonly profileId: string;
  readonly startsAt: string;
  readonly updatedAt: string | null;
}

function identityMatches(storage: DurableObjectStorage, organizationId: string | null): boolean {
  if (!organizationId) return false;
  const row = storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  return row?.organizationId === organizationId;
}

function recordExists(
  storage: DurableObjectStorage,
  table: "events" | "profiles" | "venues",
  id: string,
): boolean {
  return storage.sql.exec(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`, id).toArray().length === 1;
}

function existingRecordIds(
  storage: DurableObjectStorage,
  table: "music_pieces" | "profiles",
  ids: ReadonlySet<string>,
): ReadonlySet<string> {
  const existing = new Set<string>();
  const pending = [...ids];
  for (let offset = 0; offset < pending.length; offset += 100) {
    const chunk = pending.slice(offset, offset + 100);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        `SELECT id FROM ${table} WHERE id IN (${placeholders})`,
        ...chunk,
      )
      .toArray();
    for (const { id } of rows) existing.add(id);
  }
  return existing;
}

function insertAudit(
  storage: DurableObjectStorage,
  actor: { readonly actorUserId: string; readonly requestId: string },
  action: string,
  targetType: string,
  targetId: string,
  summary: Readonly<Record<string, unknown>>,
  occurredAt: string,
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, ?, ?, ?, ?, ?, ?)`,
    `${action}:${actor.requestId}`,
    actor.actorUserId,
    action,
    targetType,
    targetId,
    actor.requestId,
    JSON.stringify(summary),
    occurredAt,
  );
}

function parseSetList(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function featuredAssignmentsForProfile(
  value: string,
  profileId: string,
): {
  readonly pieceId: string | null;
  readonly title: string;
}[] {
  return parseSetList(value)
    .map((item) => organizationSetListItemSchema.safeParse(item))
    .filter((result) => result.success && result.data.isFeaturedNumber === true)
    .filter((result) =>
      result.success
        ? result.data.performerCredits?.some(
            (credit) => credit.kind === "profile" && credit.profileId === profileId,
          )
        : false,
    )
    .map((result) =>
      result.success ? { pieceId: result.data.pieceId ?? null, title: result.data.title } : null,
    )
    .filter(
      (item): item is { readonly pieceId: string | null; readonly title: string } => item !== null,
    );
}

export function listOrganizationVenuesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const venues = storage.sql
    .exec<VenueRow>(
      `SELECT id, name, address, created_at AS createdAt, updated_at AS updatedAt
       FROM venues ORDER BY name COLLATE NOCASE ASC, id ASC LIMIT 500`,
    )
    .toArray();
  return Response.json({ venues });
}

export function listOrganizationEventsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const configuration = readRosterAutomationConfiguration(storage);
  const timezone = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
      "SELECT timezone FROM organization_metadata LIMIT 1",
    )
    .one().timezone;
  const now = new Date();
  const events = storage.sql
    .exec<EventRow>(
      `SELECT id, title, type, starts_at AS startsAt, duration_minutes AS durationMinutes,
         advance_price_cents AS advancePriceCents, day_of_price_cents AS dayOfPriceCents,
         doors_open_time AS doorsOpenTime, is_ticketing_enabled AS isTicketingEnabled,
         ticket_capacity AS ticketCapacity,
         call_time AS callTime, location, venue_id AS venueId,
         parent_performance_id AS parentPerformanceId, details,
         public_details AS publicDetails, public_graphic_file_id AS publicGraphicFileId,
         publish_on_website AS publishOnWebsite,
         rsvp_follow_up_lead_hours AS rsvpFollowUpLeadHours,
         rsvp_follow_up_mode AS rsvpFollowUpMode,
         set_list_json AS setListJson, set_list_approved AS setListApproved,
         created_at AS createdAt, updated_at AS updatedAt,
         is_canceled AS isCanceled
       FROM events WHERE is_archived = 0 ORDER BY starts_at ASC, id ASC LIMIT 500`,
    )
    .toArray()
    .map((event) => ({
      ...decorateEventWithRsvpDeadline(event, configuration, timezone, now),
      advancePriceCents: event.advancePriceCents,
      callTime: event.callTime,
      createdAt: event.createdAt,
      details: event.details,
      dayOfPriceCents: event.dayOfPriceCents,
      doorsOpenTime: event.doorsOpenTime,
      durationMinutes: event.durationMinutes,
      id: event.id,
      isCanceled: event.isCanceled === 1,
      isTicketingEnabled: event.isTicketingEnabled === 1,
      location: event.location,
      parentPerformanceId: event.parentPerformanceId,
      publicDetails: event.publicDetails,
      publicGraphicFileId: event.publicGraphicFileId,
      publishOnWebsite: event.publishOnWebsite === 1,
      rsvpFollowUpLeadHours: event.rsvpFollowUpLeadHours,
      rsvpFollowUpMode: event.rsvpFollowUpMode,
      setList: parseSetList(event.setListJson),
      setListApproved: event.setListApproved === 1,
      startsAt: event.startsAt,
      ticketCapacity: event.ticketCapacity,
      title: event.title,
      type: event.type,
      updatedAt: event.updatedAt,
      venueId: event.venueId,
    }));
  return Response.json({ events });
}

export function readOrganizationDashboardSummaryFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  now = new Date().toISOString(),
): Response {
  if (!identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const activeProfileCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM profiles WHERE global_status = 'Active'",
    )
    .one().count;
  const upcomingEventCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM events WHERE is_archived = 0 AND is_canceled = 0 AND starts_at >= ?",
      now,
    )
    .one().count;
  const nextEvents = storage.sql
    .exec<DashboardEventRow>(
      `SELECT id, title, type, starts_at AS startsAt
       FROM events
       WHERE is_archived = 0 AND is_canceled = 0 AND starts_at >= ?
       ORDER BY starts_at ASC, id ASC LIMIT 5`,
      now,
    )
    .toArray()
    .map((event) => ({
      id: event.id,
      startsAt: event.startsAt,
      title: event.title,
      type: event.type,
    }));
  return Response.json({ activeProfileCount, nextEvents, upcomingEventCount });
}

export function readOrganizationCalendarSettingsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const timezone = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
      "SELECT timezone FROM organization_metadata LIMIT 1",
    )
    .one().timezone;
  return Response.json({ timezone });
}

function rosterConfigurationFromStore(
  storage: DurableObjectStorage,
): OrganizationRosterConfiguration {
  const raw = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly configuration: string }>(
      `SELECT roster_configuration_json AS configuration
       FROM organization_metadata LIMIT 1`,
    )
    .one().configuration;
  try {
    const configuration: unknown = JSON.parse(raw);
    const parsed = organizationRosterConfigurationRequestSchema.safeParse(configuration);
    return parsed.success
      ? parsed.data
      : organizationRosterConfigurationRequestSchema.parse(defaultRosterConfiguration);
  } catch {
    return organizationRosterConfigurationRequestSchema.parse(defaultRosterConfiguration);
  }
}

export function readRosterConfigurationFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json(rosterConfigurationFromStore(storage));
}

interface EventProfileRsvpRow {
  readonly [column: string]: SqlStorageValue;
  readonly callTime: string;
  readonly details: string;
  readonly displayName: string;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly location: string;
  readonly rsvp: string;
  readonly rsvpNote: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: string;
  readonly venueAddress: string;
  readonly venueName: string;
}

export function readProfileEventRsvpFromStore(
  storage: DurableObjectStorage,
  input: {
    readonly eventId: string | null;
    readonly organizationId: string | null;
    readonly profileId: string | null;
  },
): Response {
  const eventId = z.uuid().safeParse(input.eventId);
  const profileId = z.uuid().safeParse(input.profileId);
  if (!identityMatches(storage, input.organizationId) || !eventId.success || !profileId.success) {
    return Response.json({ code: "profile_event_rsvp_not_found" }, { status: 404 });
  }
  const row = storage.sql
    .exec<EventProfileRsvpRow>(
      `SELECT e.id, e.title, e.type, e.starts_at AS startsAt,
         e.duration_minutes AS durationMinutes, e.call_time AS callTime,
         e.location, e.details,
         COALESCE(v.name, '') AS venueName, COALESCE(v.address, '') AS venueAddress,
         COALESCE(r.rsvp, 'Pending') AS rsvp,
         COALESCE(r.rsvp_note, '') AS rsvpNote,
         p.display_name AS displayName
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       LEFT JOIN event_rosters r ON r.event_id = e.id AND r.profile_id = ?
       CROSS JOIN profiles p ON p.id = ?
       WHERE e.id = ? AND e.is_canceled = 0 LIMIT 1`,
      profileId.data,
      profileId.data,
      eventId.data,
    )
    .toArray()
    .at(0);
  if (!row) {
    return Response.json({ code: "profile_event_rsvp_not_found" }, { status: 404 });
  }
  return Response.json({
    callTime: row.callTime,
    details: row.details,
    displayName: row.displayName,
    durationMinutes: row.durationMinutes,
    id: row.id,
    location: row.location,
    profileId: profileId.data,
    rsvp: row.rsvp,
    rsvpNote: row.rsvpNote,
    startsAt: row.startsAt,
    title: row.title,
    type: row.type,
    venueAddress: row.venueAddress,
    venueName: row.venueName,
  });
}

export function readEventRsvpExportFromStore(
  storage: DurableObjectStorage,
  input: { readonly eventId: string | null; readonly organizationId: string | null },
): Response {
  const eventId = z.uuid().safeParse(input.eventId);
  if (!identityMatches(storage, input.organizationId) || !eventId.success) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const event = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly eventTitle: string;
      readonly eventType: "Performance" | "Rehearsal";
    }>(
      "SELECT title AS eventTitle, type AS eventType FROM events WHERE id = ? LIMIT 1",
      eventId.data,
    )
    .toArray()
    .at(0);
  if (!event) return Response.json({ code: "event_not_found" }, { status: 404 });
  const singers = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly displayName: string;
      readonly isSectionLeader: number;
      readonly rsvp: "No" | "Pending" | "Yes";
      readonly voicePart: string;
    }>(
      `SELECT p.display_name AS displayName, p.voice_part AS voicePart,
         p.is_section_leader AS isSectionLeader, COALESCE(r.rsvp, 'Pending') AS rsvp
       FROM profiles p
       LEFT JOIN event_rosters r ON r.profile_id = p.id AND r.event_id = ?`,
      eventId.data,
    )
    .toArray()
    .map((singer) => ({ ...singer, isSectionLeader: singer.isSectionLeader === 1 }));
  return Response.json({ ...event, ...rosterConfigurationFromStore(storage), singers });
}

function updateRosterConfiguration(
  storage: DurableObjectStorage,
  operation: Extract<ManagementRequest, { readonly action: "update_roster_configuration" }>,
  occurredAt: string,
): Response {
  const labels = new Set(operation.configuration.voiceParts.map(({ label }) => label));
  const assignedVoiceParts = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly voicePart: string }>(
      `SELECT DISTINCT voice_part AS voicePart FROM profiles
       WHERE voice_part <> ''`,
    )
    .toArray();
  if (assignedVoiceParts.some(({ voicePart }) => !labels.has(voicePart))) {
    return Response.json({ code: "voice_part_in_use" }, { status: 409 });
  }
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE organization_metadata SET roster_configuration_json = ?, updated_at = ?",
      JSON.stringify(operation.configuration),
      occurredAt,
    );
    insertAudit(
      storage,
      operation,
      "organization.roster_configuration.updated",
      "organization",
      operation.organizationId,
      {
        sectionCount: operation.configuration.sections.length,
        voicePartCount: operation.configuration.voiceParts.length,
      },
      occurredAt,
    );
  });
  runRosterAutomations(
    storage,
    operation.organizationId,
    new Date(occurredAt),
    operation.requestId,
  );
  return Response.json(operation.configuration);
}

export function listEventAttendanceFromStore(
  storage: DurableObjectStorage,
  input: { readonly eventId: string | null; readonly organizationId: string | null },
): Response {
  const eventId = z.uuid().safeParse(input.eventId);
  if (!identityMatches(storage, input.organizationId) || !eventId.success) {
    return Response.json({ code: "attendance_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "events", eventId.data)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const rows = storage.sql
    .exec<AttendanceRow>(
      `SELECT p.id AS profileId, p.display_name AS displayName,
         COALESCE(p.voice_part, '') AS voicePart,
         CASE
           WHEN e.type = 'Rehearsal'
             AND COALESCE(r.rsvp, 'Pending') = 'Pending'
             AND parent.rsvp IN ('Yes', 'No')
           THEN parent.rsvp
           ELSE COALESCE(r.rsvp, 'Pending')
         END AS rsvp,
         COALESCE(r.attendance, 'Pending') AS attendance,
         r.updated_at AS updatedAt
       FROM profiles p
       JOIN events e ON e.id = ?
       LEFT JOIN event_rosters r ON r.profile_id = p.id AND r.event_id = ?
       LEFT JOIN event_rosters parent
         ON parent.profile_id = p.id AND parent.event_id = e.parent_performance_id
       ORDER BY p.display_name COLLATE NOCASE ASC, p.id ASC LIMIT 500`,
      eventId.data,
      eventId.data,
    )
    .toArray();
  return Response.json({ eventId: eventId.data, rows });
}

export function listEventRsvpHistoryFromStore(
  storage: DurableObjectStorage,
  input: { readonly eventId: string | null; readonly organizationId: string | null },
): Response {
  const eventId = z.uuid().safeParse(input.eventId);
  if (!identityMatches(storage, input.organizationId) || !eventId.success) {
    return Response.json({ code: "event_rsvp_history_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "events", eventId.data)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const entries = storage.sql
    .exec<EventRsvpHistoryRow>(
      `SELECT h.event_id AS eventId, h.profile_id AS profileId,
         COALESCE(p.display_name, 'Removed Profile') AS displayName,
         h.previous_rsvp AS previousRsvp, h.new_rsvp AS newRsvp,
         h.reason, h.automatic, h.actor_type AS actorType, h.occurred_at AS occurredAt
       FROM event_rsvp_history h
       LEFT JOIN profiles p ON p.id = h.profile_id
       WHERE h.event_id = ?
       ORDER BY h.occurred_at DESC, h.id DESC LIMIT 500`,
      eventId.data,
    )
    .toArray()
    .map((entry) => ({ ...entry, automatic: entry.automatic === 1 }));
  return Response.json(
    organizationEventRsvpHistoryResponseSchema.parse({ entries, eventId: eventId.data }),
  );
}

function profileFolderNumberFromRow(row: ProfileFolderNumberRow) {
  return { ...row, folderReturned: row.folderReturned === 1 };
}

export function listProfileFolderNumbersFromStore(
  storage: DurableObjectStorage,
  input: { readonly organizationId: string | null; readonly profileId: string | null },
): Response {
  const profileId = z.uuid().safeParse(input.profileId);
  if (!identityMatches(storage, input.organizationId) || !profileId.success) {
    return Response.json({ code: "profile_folder_numbers_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "profiles", profileId.data)) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  const folderNumbers = storage.sql
    .exec<ProfileFolderNumberRow>(
      `SELECT e.id AS eventId, e.title AS eventTitle, e.type AS eventType,
         e.starts_at AS startsAt, p.id AS profileId,
         COALESCE(r.folder_number, '') AS folderNumber,
         COALESCE(r.folder_returned, 0) AS folderReturned,
         r.updated_at AS updatedAt
       FROM events e
       JOIN profiles p ON p.id = ?
       LEFT JOIN event_rosters r ON r.event_id = e.id AND r.profile_id = p.id
       WHERE e.type = 'Performance' AND e.is_canceled = 0
       ORDER BY e.starts_at DESC, e.id DESC LIMIT 500`,
      profileId.data,
    )
    .toArray()
    .map(profileFolderNumberFromRow);
  return Response.json({ folderNumbers, profileId: profileId.data });
}

function updateProfileFolderNumber(
  storage: DurableObjectStorage,
  operation: Extract<ManagementRequest, { readonly action: "update_profile_folder_number" }>,
  occurredAt: string,
): Response {
  if (!recordExists(storage, "events", operation.eventId)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const eventType = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly type: string }>(
      "SELECT type FROM events WHERE id = ?",
      operation.eventId,
    )
    .one().type;
  if (eventType !== "Performance") {
    return Response.json({ code: "folder_number_requires_performance" }, { status: 409 });
  }
  if (!recordExists(storage, "profiles", operation.profileId)) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO event_rosters
        (event_id, profile_id, rsvp, attendance, folder_number, folder_returned, created_at, updated_at)
       VALUES (?, ?, 'Pending', 'Pending', ?, ?, ?, ?)
       ON CONFLICT(event_id, profile_id) DO UPDATE SET
         folder_number = excluded.folder_number,
         folder_returned = excluded.folder_returned,
         updated_at = excluded.updated_at`,
      operation.eventId,
      operation.profileId,
      operation.folder.folderNumber,
      operation.folder.folderReturned ? 1 : 0,
      occurredAt,
      occurredAt,
    );
    insertAudit(
      storage,
      operation,
      "event.folder_number.updated",
      "event_roster",
      `${operation.eventId}:${operation.profileId}`,
      {
        folderReturned: operation.folder.folderReturned,
        hasFolderNumber: operation.folder.folderNumber.length > 0,
      },
      occurredAt,
    );
  });
  const row = storage.sql
    .exec<ProfileFolderNumberRow>(
      `SELECT e.id AS eventId, e.title AS eventTitle, e.type AS eventType,
         e.starts_at AS startsAt, p.id AS profileId,
         COALESCE(r.folder_number, '') AS folderNumber,
         COALESCE(r.folder_returned, 0) AS folderReturned,
         r.updated_at AS updatedAt
       FROM events e
       JOIN profiles p ON p.id = ?
       LEFT JOIN event_rosters r ON r.event_id = e.id AND r.profile_id = p.id
       WHERE e.id = ? AND e.type = 'Performance'`,
      operation.profileId,
      operation.eventId,
    )
    .toArray()[0];
  return row
    ? Response.json(profileFolderNumberFromRow(row))
    : Response.json({ code: "folder_number_not_found" }, { status: 404 });
}

function updateAttendance(
  storage: DurableObjectStorage,
  operation: Extract<ManagementRequest, { readonly action: "bulk_attendance" }>,
  occurredAt: string,
): Response {
  if (!recordExists(storage, "events", operation.eventId)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  const profileIds = new Set(operation.attendance.updates.map(({ profileId }) => profileId));
  if (profileIds.size !== operation.attendance.updates.length) {
    return Response.json({ code: "duplicate_profile" }, { status: 400 });
  }
  if ([...profileIds].some((profileId) => !recordExists(storage, "profiles", profileId))) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  storage.transactionSync(() => {
    for (const update of operation.attendance.updates) {
      storage.sql.exec(
        `INSERT INTO event_rosters
          (event_id, profile_id, rsvp, attendance, created_at, updated_at)
         VALUES (?, ?, 'Pending', ?, ?, ?)
         ON CONFLICT(event_id, profile_id) DO UPDATE SET
           attendance = excluded.attendance,
           updated_at = excluded.updated_at`,
        operation.eventId,
        update.profileId,
        update.attendance,
        occurredAt,
        occurredAt,
      );
      if (update.attendance === "Present") {
        reconcilePresentAttendance(storage, {
          actor: {
            actorId: "",
            actorType: "system",
            requestId: operation.requestId,
          },
          eventId: operation.eventId,
          occurredAt,
          profileId: update.profileId,
        });
      }
    }
    insertAudit(
      storage,
      operation,
      "event.attendance.updated",
      "event",
      operation.eventId,
      {
        profileCount: operation.attendance.updates.length,
      },
      occurredAt,
    );
  });
  recalculateProfileStatuses(
    storage,
    operation.organizationId,
    new Date(occurredAt),
    operation.requestId,
  );
  return listEventAttendanceFromStore(storage, {
    eventId: operation.eventId,
    organizationId: operation.organizationId,
  });
}

type MemberEventConfiguration = ReturnType<typeof readRosterAutomationConfiguration>;

function attendanceWarningForMemberEvent(
  event: MemberEventRow,
  inherits: boolean,
  directRsvp: MemberEventRow["directRsvp"],
  configuration: MemberEventConfiguration,
) {
  const resolvedRsvp = inherits ? event.parentRsvp : directRsvp;
  if (event.type !== "Performance" || resolvedRsvp !== "Yes" || event.attendanceTotal === 0) {
    return null;
  }
  return {
    missedRehearsals: event.attendanceMissed,
    status:
      event.attendanceMissed >= configuration.attendanceReportWarningThreshold
        ? ("warning" as const)
        : ("clear" as const),
    threshold: configuration.attendanceReportWarningThreshold,
    totalRehearsals: event.attendanceTotal,
  };
}

function practiceStateForMemberEvent(event: MemberEventRow): {
  readonly sourceEventId: string | null;
  readonly status: "available" | "not_available" | "not_published";
  readonly trackCount: number;
} {
  let status: "available" | "not_available" | "not_published" = "not_published";
  if (event.practiceTrackCount > 0) status = "available";
  else if (event.practiceEventId) status = "not_available";
  return {
    sourceEventId: event.practiceEventId,
    status,
    trackCount: event.practiceTrackCount,
  };
}

function seatingStateForMemberEvent(
  event: MemberEventRow,
  inherits: boolean,
  directRsvp: MemberEventRow["directRsvp"],
): { readonly status: "available" | "declined" | "not_assigned" | "not_published" } {
  if (event.type !== "Performance") return { status: "not_published" };
  const resolvedRsvp = inherits ? event.parentRsvp : directRsvp;
  if (resolvedRsvp === "No") return { status: "declined" };
  if (event.seatingChartExists === 0) return { status: "not_published" };
  if (event.seatingAssigned === 0) return { status: "not_assigned" };
  return { status: "available" };
}

function mapMemberEvent(
  event: MemberEventRow,
  profileId: string,
  configuration: MemberEventConfiguration,
  timezone: string,
  now: Date,
) {
  const directRsvp = event.directRsvp ?? "Pending";
  const inherits =
    event.type === "Rehearsal" &&
    directRsvp === "Pending" &&
    event.parentRsvp !== null &&
    event.parentRsvp !== "Pending";
  const sourceSetListJson =
    event.type === "Rehearsal" && event.setListApproved === 0
      ? (event.parentSetListJson ?? "")
      : event.setListJson;
  const resolvedRsvp = inherits ? event.parentRsvp : directRsvp;
  return {
    ...decorateEventWithRsvpDeadline(event, configuration, timezone, now),
    attendanceWarning: attendanceWarningForMemberEvent(event, inherits, directRsvp, configuration),
    callTime: event.callTime,
    details: event.details,
    directRsvp,
    durationMinutes: event.durationMinutes,
    id: event.id,
    isCanceled: event.isCanceled === 1,
    inheritedFromParent: inherits,
    location: event.location,
    featuredAssignments: featuredAssignmentsForProfile(sourceSetListJson, profileId),
    practice: practiceStateForMemberEvent(event),
    resolvedRsvp,
    rsvpNote: event.rsvpNote,
    seating: seatingStateForMemberEvent(event, inherits, directRsvp),
    setList:
      event.practiceEventId !== null && resolvedRsvp === "Yes"
        ? parseSetList(event.setListJson)
        : [],
    startsAt: event.startsAt,
    title: event.title,
    type: event.type,
    venueAddress: event.venueAddress,
    venueName: event.venueName,
  };
}

export function listMemberEventsFromStore(
  storage: DurableObjectStorage,
  input: {
    readonly organizationId: string | null;
    readonly profileId: string | null;
    readonly readAt: string | null;
  },
): Response {
  const profileId = z.uuid().safeParse(input.profileId);
  const readAt = z.iso.datetime().safeParse(input.readAt);
  if (!identityMatches(storage, input.organizationId) || !profileId.success || !readAt.success) {
    return Response.json({ code: "member_schedule_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "profiles", profileId.data)) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  const now = new Date(readAt.data);
  const configuration = readRosterAutomationConfiguration(storage);
  const timezone = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
      "SELECT timezone FROM organization_metadata LIMIT 1",
    )
    .one().timezone;
  const earliest = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const latest = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000).toISOString();
  const events = storage.sql
    .exec<MemberEventRow>(
      `SELECT e.id, e.title, e.type, e.starts_at AS startsAt,
         e.duration_minutes AS durationMinutes, e.call_time AS callTime,
         e.location, e.details, e.set_list_json AS setListJson,
         e.set_list_approved AS setListApproved,
         e.is_canceled AS isCanceled,
         COALESCE(v.name, '') AS venueName, COALESCE(v.address, '') AS venueAddress,
         direct.rsvp AS directRsvp, COALESCE(direct.rsvp_note, '') AS rsvpNote,
         parent.rsvp AS parentRsvp,
         parentEvent.set_list_json AS parentSetListJson,
         CASE
           WHEN e.set_list_approved = 1 THEN e.id
           WHEN e.type = 'Rehearsal' AND parentEvent.set_list_approved = 1
             AND parentEvent.is_archived = 0 AND parentEvent.is_canceled = 0
           THEN parentEvent.id
           ELSE NULL
         END AS practiceEventId,
         CASE
           WHEN e.set_list_approved = 1 THEN (
             SELECT COUNT(*) FROM json_each(e.set_list_json) setItem
             JOIN music_pieces piece ON piece.id = json_extract(setItem.value, '$.pieceId')
             WHERE EXISTS (SELECT 1 FROM json_each(piece.track_file_ids_json))
           )
           WHEN e.type = 'Rehearsal' AND parentEvent.set_list_approved = 1
             AND parentEvent.is_archived = 0 AND parentEvent.is_canceled = 0
           THEN (
             SELECT COUNT(*) FROM json_each(parentEvent.set_list_json) setItem
             JOIN music_pieces piece ON piece.id = json_extract(setItem.value, '$.pieceId')
             WHERE EXISTS (SELECT 1 FROM json_each(piece.track_file_ids_json))
           )
           ELSE 0
         END AS practiceTrackCount,
         CASE WHEN e.type = 'Performance' THEN EXISTS (
           SELECT 1 FROM seating_charts chart WHERE chart.event_id = e.id
         ) ELSE 0 END AS seatingChartExists,
         CASE WHEN e.type = 'Performance' THEN EXISTS (
           SELECT 1 FROM seating_charts chart, json_each(chart.assignments_json) assignment
           WHERE chart.event_id = e.id AND assignment.value = ?
         ) ELSE 0 END AS seatingAssigned,
         CASE WHEN e.type = 'Performance' THEN (
           SELECT COUNT(*) FROM events rehearsal
           LEFT JOIN event_rosters attendance ON attendance.event_id = rehearsal.id
             AND attendance.profile_id = ?
           WHERE rehearsal.parent_performance_id = e.id
             AND rehearsal.type = 'Rehearsal'
             AND rehearsal.is_archived = 0 AND rehearsal.is_canceled = 0
         ) ELSE 0 END AS attendanceTotal,
         CASE WHEN e.type = 'Performance' THEN (
           SELECT COUNT(*) FROM events rehearsal
           JOIN event_rosters attendance ON attendance.event_id = rehearsal.id
             AND attendance.profile_id = ?
           WHERE rehearsal.parent_performance_id = e.id
             AND rehearsal.type = 'Rehearsal'
             AND rehearsal.is_archived = 0 AND rehearsal.is_canceled = 0
             AND attendance.attendance = 'Absent'
         ) ELSE 0 END AS attendanceMissed
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       LEFT JOIN events parentEvent ON parentEvent.id = e.parent_performance_id
       LEFT JOIN event_rosters direct
         ON direct.event_id = e.id AND direct.profile_id = ?
       LEFT JOIN event_rosters parent
         ON parent.event_id = e.parent_performance_id AND parent.profile_id = ?
       WHERE e.is_archived = 0 AND e.is_canceled = 0 AND e.starts_at >= ? AND e.starts_at <= ?
       ORDER BY e.starts_at ASC, e.id ASC LIMIT 500`,
      profileId.data,
      profileId.data,
      profileId.data,
      profileId.data,
      profileId.data,
      earliest,
      latest,
    )
    .toArray()
    .map((event) => mapMemberEvent(event, profileId.data, configuration, timezone, now));
  return Response.json({ events });
}

export function listProfilePerformanceHistoryFromStore(
  storage: DurableObjectStorage,
  input: {
    readonly organizationId: string | null;
    readonly profileId: string | null;
    readonly readAt: string | null;
  },
): Response {
  const profileId = z.uuid().safeParse(input.profileId);
  const readAt = z.iso.datetime().safeParse(input.readAt);
  if (!identityMatches(storage, input.organizationId) || !profileId.success || !readAt.success) {
    return Response.json({ code: "profile_performance_history_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "profiles", profileId.data)) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  const events = storage.sql
    .exec<ProfilePerformanceRow>(
      `SELECT e.id, e.title, e.starts_at AS startsAt, e.location,
         COALESCE(v.name, '') AS venueName,
         COALESCE(r.rsvp, 'Pending') AS rsvp,
         COALESCE(r.attendance, 'Pending') AS attendance
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       LEFT JOIN event_rosters r ON r.event_id = e.id AND r.profile_id = ?
       WHERE e.type = 'Performance' AND e.is_canceled = 0
       ORDER BY e.starts_at DESC, e.id DESC LIMIT 500`,
      profileId.data,
    )
    .toArray()
    .map((event) => ({
      attendance: event.attendance,
      id: event.id,
      location: event.location,
      rsvp: event.rsvp,
      startsAt: event.startsAt,
      title: event.title,
      venueName: event.venueName,
    }));
  const readAtDate = new Date(readAt.data).getTime();
  return Response.json({
    past: events.filter((event) => new Date(event.startsAt).getTime() < readAtDate),
    profileId: profileId.data,
    upcoming: events.filter((event) => new Date(event.startsAt).getTime() >= readAtDate).reverse(),
  });
}

function ticketConfigurationError(
  storage: DurableObjectStorage,
  event: EventOperation["event"],
): Response | null {
  if (event.isTicketingEnabled && event.type !== "Performance") {
    return Response.json({ code: "ticketing_requires_performance" }, { status: 409 });
  }
  if (event.ticketCapacity !== null) {
    const committedQuantity = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly quantity: number }>(
        `SELECT COALESCE(SUM(quantity), 0) AS quantity FROM ticket_purchases
         WHERE event_id = ? AND status IN ('pending', 'paid')`,
        event.id,
      )
      .one().quantity;
    if (committedQuantity > event.ticketCapacity) {
      return Response.json({ code: "ticket_capacity_below_sales" }, { status: 409 });
    }
  }
  return null;
}

function isActivePerformanceReference(
  event:
    | {
        readonly isArchived: number;
        readonly isCanceled: number;
        readonly type: string;
      }
    | undefined,
): boolean {
  return event?.type === "Performance" && event.isArchived === 0 && event.isCanceled === 0;
}

function eventReferenceError(
  storage: DurableObjectStorage,
  event: EventOperation["event"],
): Response | null {
  const ticketError = ticketConfigurationError(storage, event);
  if (ticketError) return ticketError;
  if (event.venueId && !recordExists(storage, "venues", event.venueId)) {
    return Response.json({ code: "venue_not_found" }, { status: 404 });
  }
  if (event.parentPerformanceId && event.type !== "Rehearsal") {
    return Response.json({ code: "parent_performance_requires_rehearsal" }, { status: 409 });
  }
  if (event.parentPerformanceId) {
    const parent = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly isArchived: number;
        readonly isCanceled: number;
        readonly type: string;
      }>(
        "SELECT type, is_archived AS isArchived, is_canceled AS isCanceled FROM events WHERE id = ? LIMIT 1",
        event.parentPerformanceId,
      )
      .toArray()
      .at(0);
    if (!isActivePerformanceReference(parent)) {
      return Response.json({ code: "parent_performance_not_found" }, { status: 404 });
    }
  }
  if (event.publicGraphicFileId) {
    const graphic = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly contentType: string;
        readonly sizeBytes: number;
      }>(
        `SELECT content_type AS contentType, size_bytes AS sizeBytes
         FROM private_files WHERE id = ? AND status = 'ready' LIMIT 1`,
        event.publicGraphicFileId,
      )
      .toArray()
      .at(0);
    if (
      !graphic ||
      !["image/jpeg", "image/png", "image/webp"].includes(graphic.contentType) ||
      graphic.sizeBytes > 5 * 1024 * 1024
    ) {
      return Response.json({ code: "invalid_public_event_graphic" }, { status: 409 });
    }
  }

  const pieceIds = new Set(
    event.setList.flatMap(({ pieceId }) => (pieceId === undefined ? [] : [pieceId])),
  );
  const existingPieceIds = existingRecordIds(storage, "music_pieces", pieceIds);
  if ([...pieceIds].some((id) => !existingPieceIds.has(id))) {
    return Response.json({ code: "music_piece_not_found" }, { status: 409 });
  }

  const profileIds = new Set(
    event.setList.flatMap(({ performerCredits }) =>
      (performerCredits ?? []).flatMap((credit) =>
        credit.kind === "profile" ? [credit.profileId] : [],
      ),
    ),
  );
  const existingProfileIds = existingRecordIds(storage, "profiles", profileIds);
  return [...profileIds].some((id) => !existingProfileIds.has(id))
    ? Response.json({ code: "performer_profile_not_found" }, { status: 409 })
    : null;
}

function writeEvent(
  storage: DurableObjectStorage,
  operation: EventOperation,
  occurredAt: string,
): Response {
  const event = operation.event;
  const referenceError = eventReferenceError(storage, event);
  if (referenceError) return referenceError;
  if (operation.action === "update_event" && !recordExists(storage, "events", event.id)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  storage.transactionSync(() => {
    if (operation.action === "create_event") {
      storage.sql.exec(
        `INSERT INTO events
          (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
           parent_performance_id, details, public_details, public_graphic_file_id,
           publish_on_website, rsvp_follow_up_lead_hours, rsvp_follow_up_mode,
           advance_price_cents, day_of_price_cents, doors_open_time,
           is_ticketing_enabled, ticket_capacity, set_list_json, set_list_approved,
           is_archived, is_canceled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        event.id,
        event.title,
        event.type,
        event.startsAt,
        event.durationMinutes,
        event.callTime,
        event.location,
        event.venueId,
        event.parentPerformanceId,
        event.details,
        event.publicDetails,
        event.publicGraphicFileId,
        event.publishOnWebsite ? 1 : 0,
        event.rsvpFollowUpLeadHours,
        event.rsvpFollowUpMode,
        event.advancePriceCents,
        event.dayOfPriceCents,
        event.doorsOpenTime,
        event.isTicketingEnabled ? 1 : 0,
        event.ticketCapacity,
        JSON.stringify(event.setList),
        event.setListApproved ? 1 : 0,
        occurredAt,
        occurredAt,
      );
    } else {
      storage.sql.exec(
        `UPDATE events SET title = ?, type = ?, starts_at = ?, duration_minutes = ?,
           call_time = ?, location = ?, venue_id = ?, parent_performance_id = ?, details = ?,
           public_details = ?, public_graphic_file_id = ?, publish_on_website = ?,
           rsvp_follow_up_lead_hours = ?, rsvp_follow_up_mode = ?,
           advance_price_cents = ?, day_of_price_cents = ?, doors_open_time = ?,
           is_ticketing_enabled = ?, ticket_capacity = ?, set_list_json = ?,
           set_list_approved = ?, updated_at = ?
         WHERE id = ?`,
        event.title,
        event.type,
        event.startsAt,
        event.durationMinutes,
        event.callTime,
        event.location,
        event.venueId,
        event.parentPerformanceId,
        event.details,
        event.publicDetails,
        event.publicGraphicFileId,
        event.publishOnWebsite ? 1 : 0,
        event.rsvpFollowUpLeadHours,
        event.rsvpFollowUpMode,
        event.advancePriceCents,
        event.dayOfPriceCents,
        event.doorsOpenTime,
        event.isTicketingEnabled ? 1 : 0,
        event.ticketCapacity,
        JSON.stringify(event.setList),
        event.setListApproved ? 1 : 0,
        occurredAt,
        event.id,
      );
    }
    insertAudit(
      storage,
      operation,
      operation.action === "create_event" ? "event.created" : "event.updated",
      "event",
      event.id,
      {
        isTicketingEnabled: event.isTicketingEnabled,
        publishOnWebsite: event.publishOnWebsite,
        rsvpFollowUpLeadHours: event.rsvpFollowUpLeadHours,
        rsvpFollowUpMode: event.rsvpFollowUpMode,
        startsAt: event.startsAt,
        title: event.title,
        type: event.type,
      },
      occurredAt,
    );
  });
  const createdAt =
    operation.action === "create_event"
      ? occurredAt
      : storage.sql
          .exec<{ readonly [column: string]: SqlStorageValue; readonly createdAt: string }>(
            "SELECT created_at AS createdAt FROM events WHERE id = ?",
            event.id,
          )
          .one().createdAt;
  const isCanceled =
    operation.action === "create_event"
      ? 0
      : storage.sql
          .exec<{ readonly [column: string]: SqlStorageValue; readonly isCanceled: number }>(
            "SELECT is_canceled AS isCanceled FROM events WHERE id = ?",
            event.id,
          )
          .one().isCanceled;
  const configuration = readRosterAutomationConfiguration(storage);
  const timezone = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
      "SELECT timezone FROM organization_metadata LIMIT 1",
    )
    .one().timezone;
  return Response.json({
    ...event,
    isCanceled: isCanceled === 1,
    ...decorateEventWithRsvpDeadline(
      { ...event, isCanceled: isCanceled === 1 },
      configuration,
      timezone,
      new Date(occurredAt),
    ),
    createdAt,
    updatedAt: occurredAt,
  });
}

function writeVenue(
  storage: DurableObjectStorage,
  operation: VenueOperation,
  occurredAt: string,
): Response {
  if (operation.action === "create_venue") {
    const venue = operation.venue;
    storage.transactionSync(() => {
      storage.sql.exec(
        "INSERT INTO venues (id, name, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        venue.id,
        venue.name,
        venue.address,
        occurredAt,
        occurredAt,
      );
      insertAudit(storage, operation, "venue.created", "venue", venue.id, venue, occurredAt);
    });
    return Response.json({ ...venue, createdAt: occurredAt, updatedAt: occurredAt });
  }
  if (operation.action === "update_venue") {
    const venue = operation.venue;
    const existing = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly createdAt: string }>(
        "SELECT created_at AS createdAt FROM venues WHERE id = ?",
        venue.id,
      )
      .toArray()[0];
    if (!existing) return Response.json({ code: "venue_not_found" }, { status: 404 });
    storage.transactionSync(() => {
      storage.sql.exec(
        "UPDATE venues SET name = ?, address = ?, updated_at = ? WHERE id = ?",
        venue.name,
        venue.address,
        occurredAt,
        venue.id,
      );
      insertAudit(storage, operation, "venue.updated", "venue", venue.id, venue, occurredAt);
    });
    return Response.json({ ...venue, createdAt: existing.createdAt, updatedAt: occurredAt });
  }
  if (!recordExists(storage, "venues", operation.venueId)) {
    return Response.json({ code: "venue_not_found" }, { status: 404 });
  }
  const referenceCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      `SELECT
         (SELECT COUNT(*) FROM events WHERE venue_id = ?) +
         (SELECT COUNT(*) FROM seating_charts WHERE venue_id = ?) AS count`,
      operation.venueId,
      operation.venueId,
    )
    .one().count;
  if (referenceCount > 0) {
    return Response.json({ code: "venue_in_use" }, { status: 409 });
  }
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM venues WHERE id = ?", operation.venueId);
    insertAudit(
      storage,
      operation,
      "venue.deleted",
      "venue",
      operation.venueId,
      { deleted: true },
      occurredAt,
    );
  });
  return Response.json({ status: "deleted", venueId: operation.venueId });
}

function updateTimezone(
  storage: DurableObjectStorage,
  operation: Extract<ManagementRequest, { readonly action: "update_timezone" }>,
  occurredAt: string,
): Response {
  if (!isValidTimeZone(operation.settings.timezone)) {
    return Response.json({ code: "invalid_timezone" }, { status: 400 });
  }
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE organization_metadata SET timezone = ?, updated_at = ?",
      operation.settings.timezone,
      occurredAt,
    );
    insertAudit(
      storage,
      operation,
      "organization.timezone.updated",
      "organization",
      operation.organizationId,
      { timezone: operation.settings.timezone },
      occurredAt,
    );
  });
  return Response.json(operation.settings);
}

// eslint-disable-next-line complexity -- the calendar store dispatches the bounded mutation union.
export async function manageOrganizationCalendarInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = managementRequestSchema.safeParse(await request.json());
  if (!parsed.success)
    return Response.json({ code: "invalid_calendar_operation" }, { status: 400 });
  if (!identityMatches(storage, parsed.data.organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  if (parsed.data.action === "bulk_attendance") {
    return updateAttendance(storage, parsed.data, occurredAt);
  }
  if (parsed.data.action === "update_profile_folder_number") {
    return updateProfileFolderNumber(storage, parsed.data, occurredAt);
  }
  if (parsed.data.action === "update_roster_configuration") {
    return updateRosterConfiguration(storage, parsed.data, occurredAt);
  }
  if (parsed.data.action === "update_timezone") {
    return updateTimezone(storage, parsed.data, occurredAt);
  }
  if (
    parsed.data.action === "create_venue" ||
    parsed.data.action === "update_venue" ||
    parsed.data.action === "delete_venue"
  ) {
    return writeVenue(storage, parsed.data, occurredAt);
  }
  if (parsed.data.action === "create_event" || parsed.data.action === "update_event") {
    return writeEvent(storage, parsed.data, occurredAt);
  }
  if (parsed.data.action === "archive_event") {
    const operation = parsed.data;
    if (!recordExists(storage, "events", operation.eventId)) {
      return Response.json({ code: "event_not_found" }, { status: 404 });
    }
    const childCount = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
        "SELECT COUNT(*) AS count FROM events WHERE parent_performance_id = ? AND is_archived = 0",
        operation.eventId,
      )
      .one().count;
    storage.transactionSync(() => {
      storage.sql.exec(
        "UPDATE events SET is_archived = 1, updated_at = ? WHERE id = ?",
        occurredAt,
        operation.eventId,
      );
      storage.sql.exec(
        `UPDATE events SET is_archived = 1, updated_at = ?
         WHERE parent_performance_id = ? AND is_archived = 0`,
        occurredAt,
        operation.eventId,
      );
      insertAudit(
        storage,
        operation,
        "event.archived",
        "event",
        operation.eventId,
        { archived: true, childEventsArchived: childCount },
        occurredAt,
      );
    });
    return Response.json({ eventId: operation.eventId, status: "archived" });
  }
  if (parsed.data.action === "cancel_event") {
    const operation = parsed.data;
    const eventState = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly isArchived: number;
        readonly isCanceled: number;
      }>(
        "SELECT is_archived AS isArchived, is_canceled AS isCanceled FROM events WHERE id = ? LIMIT 1",
        operation.eventId,
      )
      .toArray()
      .at(0);
    if (!eventState || eventState.isArchived === 1) {
      return Response.json({ code: "event_not_found" }, { status: 404 });
    }
    if (eventState.isCanceled === 1) {
      return Response.json({ eventId: operation.eventId, status: "canceled" });
    }
    const childCount = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
        "SELECT COUNT(*) AS count FROM events WHERE parent_performance_id = ? AND is_archived = 0 AND is_canceled = 0",
        operation.eventId,
      )
      .one().count;
    storage.transactionSync(() => {
      storage.sql.exec(
        "UPDATE events SET is_canceled = 1, updated_at = ? WHERE id = ? AND is_archived = 0",
        occurredAt,
        operation.eventId,
      );
      storage.sql.exec(
        `UPDATE events SET is_canceled = 1, updated_at = ?
         WHERE parent_performance_id = ? AND is_archived = 0 AND is_canceled = 0`,
        occurredAt,
        operation.eventId,
      );
      insertAudit(
        storage,
        operation,
        "event.canceled",
        "event",
        operation.eventId,
        { canceled: true, childEventsCanceled: childCount },
        occurredAt,
      );
    });
    return Response.json({ eventId: operation.eventId, status: "canceled" });
  }
  const rsvpOperation = parsed.data;
  if (!recordExists(storage, "events", rsvpOperation.eventId)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "profiles", rsvpOperation.rsvp.profileId)) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  const event = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly durationMinutes: number | null;
      readonly isCanceled: number;
      readonly startsAt: string;
      readonly type: "Performance" | "Rehearsal";
    }>(
      "SELECT type, starts_at AS startsAt, duration_minutes AS durationMinutes, is_canceled AS isCanceled FROM events WHERE id = ? LIMIT 1",
      rsvpOperation.eventId,
    )
    .toArray()
    .at(0);
  if (!event) return Response.json({ code: "event_not_found" }, { status: 404 });
  if (event.isCanceled === 1) {
    return Response.json({ code: "event_canceled" }, { status: 409 });
  }
  if (rsvpOperation.selfService) {
    const configuration = readRosterAutomationConfiguration(storage);
    const timezone = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
        "SELECT timezone FROM organization_metadata LIMIT 1",
      )
      .one().timezone;
    const deadlineFields = decorateEventWithRsvpDeadline(
      event,
      configuration,
      timezone,
      new Date(occurredAt),
    );
    if (!deadlineFields.rsvpSelfServiceOpen) {
      return Response.json({ code: "rsvp_closed" }, { status: 409 });
    }
  }
  storage.transactionSync(() => {
    const rsvpNote = rsvpOperation.rsvp.rsvp === "No" ? rsvpOperation.rsvp.rsvpNote : "";
    recordEventRsvpChange(storage, {
      actor: {
        actorId: rsvpOperation.actorUserId,
        actorType: "organization_member",
        requestId: rsvpOperation.requestId,
      },
      automatic: false,
      eventId: rsvpOperation.eventId,
      newRsvp: rsvpOperation.rsvp.rsvp,
      occurredAt,
      profileId: rsvpOperation.rsvp.profileId,
      reason: rsvpOperation.selfService ? "Member updated RSVP." : "Administrator updated RSVP.",
      rsvpNote,
    });
  });
  recalculateProfileStatuses(
    storage,
    rsvpOperation.organizationId,
    new Date(occurredAt),
    rsvpOperation.requestId,
  );
  return Response.json({
    eventId: rsvpOperation.eventId,
    ...rsvpOperation.rsvp,
    rsvpNote: rsvpOperation.rsvp.rsvp === "No" ? rsvpOperation.rsvp.rsvpNote : "",
    updatedAt: occurredAt,
  });
}
