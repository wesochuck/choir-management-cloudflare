import {
  organizationAttendanceBulkRequestSchema,
  organizationEventRequestSchema,
  organizationCalendarSettingsRequestSchema,
  organizationRsvpRequestSchema,
  organizationRosterConfigurationRequestSchema,
  organizationVenueRequestSchema,
  type OrganizationRosterConfiguration,
} from "@choir/contracts";
import { defaultRosterConfiguration, isValidTimeZone } from "@choir/domain";
import { z } from "zod";

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
    action: z.literal("create_venue"),
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
  { readonly action: "create_venue" | "delete_venue" }
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
  readonly callTime: string;
  readonly createdAt: string;
  readonly details: string;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly location: string;
  readonly parentPerformanceId: string | null;
  readonly setListApproved: number;
  readonly setListJson: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal";
  readonly updatedAt: string;
  readonly venueId: string | null;
}

interface MemberEventRow {
  readonly [column: string]: SqlStorageValue;
  readonly callTime: string;
  readonly details: string;
  readonly directRsvp: "No" | "Pending" | "Yes" | null;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly location: string;
  readonly parentRsvp: "No" | "Pending" | "Yes" | null;
  readonly rsvpNote: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal";
  readonly venueAddress: string;
  readonly venueName: string;
}

interface AttendanceRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendance: "Absent" | "Pending" | "Present";
  readonly displayName: string;
  readonly folderNumber: string;
  readonly folderReturned: number;
  readonly profileId: string;
  readonly rsvp: "No" | "Pending" | "Yes";
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
  const events = storage.sql
    .exec<EventRow>(
      `SELECT id, title, type, starts_at AS startsAt, duration_minutes AS durationMinutes,
         call_time AS callTime, location, venue_id AS venueId,
         parent_performance_id AS parentPerformanceId, details,
         set_list_json AS setListJson, set_list_approved AS setListApproved,
         created_at AS createdAt, updated_at AS updatedAt
       FROM events WHERE is_archived = 0 ORDER BY starts_at ASC, id ASC LIMIT 500`,
    )
    .toArray()
    .map((event) => ({
      callTime: event.callTime,
      createdAt: event.createdAt,
      details: event.details,
      durationMinutes: event.durationMinutes,
      id: event.id,
      location: event.location,
      parentPerformanceId: event.parentPerformanceId,
      setList: parseSetList(event.setListJson),
      setListApproved: event.setListApproved === 1,
      startsAt: event.startsAt,
      title: event.title,
      type: event.type,
      updatedAt: event.updatedAt,
      venueId: event.venueId,
    }));
  return Response.json({ events });
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
         COALESCE(r.rsvp, 'Pending') AS rsvp,
         COALESCE(r.attendance, 'Pending') AS attendance,
         COALESCE(r.folder_number, '') AS folderNumber,
         COALESCE(r.folder_returned, 0) AS folderReturned,
         r.updated_at AS updatedAt
       FROM profiles p
       LEFT JOIN event_rosters r ON r.profile_id = p.id AND r.event_id = ?
       ORDER BY p.display_name COLLATE NOCASE ASC, p.id ASC LIMIT 500`,
      eventId.data,
    )
    .toArray()
    .map((row) => ({ ...row, folderReturned: row.folderReturned === 1 }));
  return Response.json({ eventId: eventId.data, rows });
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
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id, profile_id) DO UPDATE SET
           attendance = excluded.attendance,
           rsvp = CASE
             WHEN excluded.attendance = 'Present' AND event_rosters.rsvp = 'Pending' THEN 'Yes'
             ELSE event_rosters.rsvp
           END,
           updated_at = excluded.updated_at`,
        operation.eventId,
        update.profileId,
        update.attendance === "Present" ? "Yes" : "Pending",
        update.attendance,
        occurredAt,
        occurredAt,
      );
      if (update.folderNumber !== undefined || update.folderReturned !== undefined) {
        storage.sql.exec(
          `UPDATE event_rosters SET
             folder_number = COALESCE(?, folder_number),
             folder_returned = COALESCE(?, folder_returned),
             updated_at = ?
           WHERE event_id = ? AND profile_id = ?`,
          update.folderNumber ?? null,
          update.folderReturned === undefined ? null : update.folderReturned ? 1 : 0,
          occurredAt,
          operation.eventId,
          update.profileId,
        );
      }
    }
    insertAudit(
      storage,
      operation,
      "event.attendance.updated",
      "event",
      operation.eventId,
      {
        folderUpdateCount: operation.attendance.updates.filter(
          ({ folderNumber, folderReturned }) =>
            folderNumber !== undefined || folderReturned !== undefined,
        ).length,
        profileCount: operation.attendance.updates.length,
      },
      occurredAt,
    );
  });
  return listEventAttendanceFromStore(storage, {
    eventId: operation.eventId,
    organizationId: operation.organizationId,
  });
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
  const earliest = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const latest = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000).toISOString();
  const events = storage.sql
    .exec<MemberEventRow>(
      `SELECT e.id, e.title, e.type, e.starts_at AS startsAt,
         e.duration_minutes AS durationMinutes, e.call_time AS callTime,
         e.location, e.details,
         COALESCE(v.name, '') AS venueName, COALESCE(v.address, '') AS venueAddress,
         direct.rsvp AS directRsvp, COALESCE(direct.rsvp_note, '') AS rsvpNote,
         parent.rsvp AS parentRsvp
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       LEFT JOIN event_rosters direct
         ON direct.event_id = e.id AND direct.profile_id = ?
       LEFT JOIN event_rosters parent
         ON parent.event_id = e.parent_performance_id AND parent.profile_id = ?
       WHERE e.is_archived = 0 AND e.starts_at >= ? AND e.starts_at <= ?
       ORDER BY e.starts_at ASC, e.id ASC LIMIT 500`,
      profileId.data,
      profileId.data,
      earliest,
      latest,
    )
    .toArray()
    .map((event) => {
      const directRsvp = event.directRsvp ?? "Pending";
      const inherits =
        event.type === "Rehearsal" &&
        directRsvp === "Pending" &&
        event.parentRsvp !== null &&
        event.parentRsvp !== "Pending";
      return {
        callTime: event.callTime,
        details: event.details,
        directRsvp,
        durationMinutes: event.durationMinutes,
        id: event.id,
        inheritedFromParent: inherits,
        location: event.location,
        resolvedRsvp: inherits ? event.parentRsvp : directRsvp,
        rsvpNote: event.rsvpNote,
        startsAt: event.startsAt,
        title: event.title,
        type: event.type,
        venueAddress: event.venueAddress,
        venueName: event.venueName,
      };
    });
  return Response.json({ events });
}

function eventReferenceError(
  storage: DurableObjectStorage,
  event: EventOperation["event"],
): Response | null {
  if (event.venueId && !recordExists(storage, "venues", event.venueId)) {
    return Response.json({ code: "venue_not_found" }, { status: 404 });
  }
  if (event.parentPerformanceId) {
    const parent = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly type: string }>(
        "SELECT type FROM events WHERE id = ? LIMIT 1",
        event.parentPerformanceId,
      )
      .toArray()
      .at(0);
    if (parent?.type !== "Performance") {
      return Response.json({ code: "parent_performance_not_found" }, { status: 404 });
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
           parent_performance_id, details, set_list_json, set_list_approved,
           is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
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
        JSON.stringify(event.setList),
        event.setListApproved ? 1 : 0,
        occurredAt,
        occurredAt,
      );
    } else {
      storage.sql.exec(
        `UPDATE events SET title = ?, type = ?, starts_at = ?, duration_minutes = ?,
           call_time = ?, location = ?, venue_id = ?, parent_performance_id = ?, details = ?,
           set_list_json = ?, set_list_approved = ?, updated_at = ?
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
      { startsAt: event.startsAt, title: event.title, type: event.type },
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
  return Response.json({ ...event, createdAt, updatedAt: occurredAt });
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
  if (parsed.data.action === "update_roster_configuration") {
    return updateRosterConfiguration(storage, parsed.data, occurredAt);
  }
  if (parsed.data.action === "update_timezone") {
    return updateTimezone(storage, parsed.data, occurredAt);
  }
  if (parsed.data.action === "create_venue" || parsed.data.action === "delete_venue") {
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
  const rsvpOperation = parsed.data;
  if (!recordExists(storage, "events", rsvpOperation.eventId)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "profiles", rsvpOperation.rsvp.profileId)) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  storage.transactionSync(() => {
    const rsvpNote = rsvpOperation.rsvp.rsvp === "No" ? rsvpOperation.rsvp.rsvpNote : "";
    storage.sql.exec(
      `INSERT INTO event_rosters (event_id, profile_id, rsvp, rsvp_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, profile_id) DO UPDATE SET
         rsvp = excluded.rsvp, rsvp_note = excluded.rsvp_note, updated_at = excluded.updated_at`,
      rsvpOperation.eventId,
      rsvpOperation.rsvp.profileId,
      rsvpOperation.rsvp.rsvp,
      rsvpNote,
      occurredAt,
      occurredAt,
    );
    insertAudit(
      storage,
      rsvpOperation,
      "event.rsvp.updated",
      "event_roster",
      `${rsvpOperation.eventId}:${rsvpOperation.rsvp.profileId}`,
      { hasNote: rsvpNote.length > 0, rsvp: rsvpOperation.rsvp.rsvp },
      occurredAt,
    );
  });
  return Response.json({
    eventId: rsvpOperation.eventId,
    ...rsvpOperation.rsvp,
    rsvpNote: rsvpOperation.rsvp.rsvp === "No" ? rsvpOperation.rsvp.rsvpNote : "",
    updatedAt: occurredAt,
  });
}
