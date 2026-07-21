import {
  organizationEventRequestSchema,
  organizationRsvpRequestSchema,
  organizationVenueRequestSchema,
} from "@choir/contracts";
import { z } from "zod";

const actorSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

const managementRequestSchema = z.discriminatedUnion("action", [
  actorSchema.extend({
    action: z.literal("create_event"),
    event: organizationEventRequestSchema.extend({ id: z.uuid() }),
  }),
  actorSchema.extend({
    action: z.literal("create_venue"),
    venue: organizationVenueRequestSchema.extend({ id: z.uuid() }),
  }),
  actorSchema.extend({
    action: z.literal("set_rsvp"),
    eventId: z.uuid(),
    rsvp: organizationRsvpRequestSchema,
  }),
]);

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
  if (parsed.data.action === "create_venue") {
    const venue = parsed.data.venue;
    storage.transactionSync(() => {
      storage.sql.exec(
        "INSERT INTO venues (id, name, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        venue.id,
        venue.name,
        venue.address,
        occurredAt,
        occurredAt,
      );
      insertAudit(storage, parsed.data, "venue.created", "venue", venue.id, venue, occurredAt);
    });
    return Response.json({ ...venue, createdAt: occurredAt, updatedAt: occurredAt });
  }
  if (parsed.data.action === "create_event") {
    const event = parsed.data.event;
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
    storage.transactionSync(() => {
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
      insertAudit(
        storage,
        parsed.data,
        "event.created",
        "event",
        event.id,
        {
          startsAt: event.startsAt,
          title: event.title,
          type: event.type,
        },
        occurredAt,
      );
    });
    return Response.json({ ...event, createdAt: occurredAt, updatedAt: occurredAt });
  }
  const rsvpOperation = parsed.data;
  if (!recordExists(storage, "events", rsvpOperation.eventId)) {
    return Response.json({ code: "event_not_found" }, { status: 404 });
  }
  if (!recordExists(storage, "profiles", rsvpOperation.rsvp.profileId)) {
    return Response.json({ code: "profile_not_found" }, { status: 404 });
  }
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO event_rosters (event_id, profile_id, rsvp, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(event_id, profile_id) DO UPDATE SET
         rsvp = excluded.rsvp, updated_at = excluded.updated_at`,
      rsvpOperation.eventId,
      rsvpOperation.rsvp.profileId,
      rsvpOperation.rsvp.rsvp,
      occurredAt,
      occurredAt,
    );
    insertAudit(
      storage,
      rsvpOperation,
      "event.rsvp.updated",
      "event_roster",
      `${rsvpOperation.eventId}:${rsvpOperation.rsvp.profileId}`,
      { rsvp: rsvpOperation.rsvp.rsvp },
      occurredAt,
    );
  });
  return Response.json({
    eventId: rsvpOperation.eventId,
    ...rsvpOperation.rsvp,
    updatedAt: occurredAt,
  });
}
