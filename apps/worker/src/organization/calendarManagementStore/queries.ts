import { z } from "zod";

import { decorateEventWithRsvpDeadline } from "../statusAutomationStore";
import { type DashboardEventRow, type EventRow, type VenueRow } from "./contracts";
import { identityMatches, parseSetList, rosterConfigurationFromStore } from "./shared";

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
  const now = new Date();
  const timezone = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
      "SELECT timezone FROM organization_metadata LIMIT 1",
    )
    .one().timezone;
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
         rsvp_follow_up_mode AS rsvpFollowUpMode, rsvp_deadline_date AS rsvpDeadlineDate,
         set_list_json AS setListJson, set_list_approved AS setListApproved,
         set_list_default_transition_seconds AS setListDefaultTransitionSeconds,
         created_at AS createdAt, updated_at AS updatedAt,
         is_canceled AS isCanceled
       FROM events WHERE is_archived = 0 ORDER BY starts_at DESC, id DESC LIMIT 500`,
    )
    .toArray()
    .map((event) => ({
      ...decorateEventWithRsvpDeadline(event, timezone, now),
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
      setListDefaultTransitionSeconds: event.setListDefaultTransitionSeconds,
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
  const doNotEmailCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM profiles WHERE do_not_email = 1",
    )
    .one().count;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentBounceCount = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM profiles WHERE last_bounce_at >= ?",
      thirtyDaysAgo,
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
  return Response.json({
    activeProfileCount,
    doNotEmailCount,
    nextEvents,
    recentBounceCount,
    upcomingEventCount,
  });
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
  readonly isCanceled: number;
  readonly location: string;
  readonly rsvpDeadlineDate: string;
  readonly rsvp: string;
  readonly rsvpNote: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal";
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
         e.is_canceled AS isCanceled, e.location, e.details,
         COALESCE(e.rsvp_deadline_date, '') AS rsvpDeadlineDate,
         COALESCE(v.name, '') AS venueName, COALESCE(v.address, '') AS venueAddress,
         COALESCE(r.rsvp, 'Pending') AS rsvp,
         COALESCE(r.rsvp_note, '') AS rsvpNote,
         p.display_name AS displayName
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       LEFT JOIN event_rosters r ON r.event_id = e.id AND r.profile_id = ?
       CROSS JOIN profiles p ON p.id = ?
       WHERE e.id = ? AND e.is_archived = 0 AND e.is_canceled = 0 LIMIT 1`,
      profileId.data,
      profileId.data,
      eventId.data,
    )
    .toArray()
    .at(0);
  if (!row) {
    return Response.json({ code: "profile_event_rsvp_not_found" }, { status: 404 });
  }
  const timezone = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
      "SELECT timezone FROM organization_metadata LIMIT 1",
    )
    .one().timezone;
  const rsvpDeadline = decorateEventWithRsvpDeadline(
    {
      durationMinutes: row.durationMinutes,
      isCanceled: row.isCanceled,
      rsvpDeadlineDate: row.rsvpDeadlineDate === "" ? null : row.rsvpDeadlineDate,
      startsAt: row.startsAt,
      type: row.type,
    },
    timezone,
  );
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
    rsvpSelfServiceOpen: rsvpDeadline.rsvpSelfServiceOpen,
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
       LEFT JOIN event_rosters r ON r.profile_id = p.id AND r.event_id = ?
       WHERE p.hidden = 0`,
      eventId.data,
    )
    .toArray()
    .map((singer) => ({ ...singer, isSectionLeader: singer.isSectionLeader === 1 }));
  return Response.json({ ...event, ...rosterConfigurationFromStore(storage), singers });
}
