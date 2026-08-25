import { datePartInTimeZone, zonedLocalDateTimeToUtc } from "@choir/domain";
import { z } from "zod";

import { type MemberEventRow, type ProfilePerformanceRow } from "./contracts";
import {
  decorateEventWithRsvpDeadline,
  readRosterAutomationConfiguration,
} from "../statusAutomationStore";
import {
  featuredAssignmentsForProfile,
  identityMatches,
  parseSetList,
  recordExists,
} from "./shared";

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
    ...decorateEventWithRsvpDeadline(event, timezone, now),
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
    readonly includePast?: boolean;
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
  // The member dashboard is organized by the Organization's calendar day, not by the
  // event's exact start time. Keep today's events available through 11:59 PM locally so a
  // performance that has already started does not appear as a stale past event in the
  // "Upcoming events" section until the day is over.
  const today = datePartInTimeZone(now, timezone);
  const earliest = input.includePast
    ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString()
    : (zonedLocalDateTimeToUtc(`${today}T00:00`, timezone) ?? now.toISOString());
  const latest = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000).toISOString();
  const events = storage.sql
    .exec<MemberEventRow>(
      `SELECT e.id, e.title, e.type, e.starts_at AS startsAt,
         e.duration_minutes AS durationMinutes, e.call_time AS callTime,
         e.location, e.details, e.set_list_json AS setListJson,
         e.set_list_approved AS setListApproved,
         e.is_canceled AS isCanceled, e.rsvp_deadline_date AS rsvpDeadlineDate,
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
           JOIN event_rosters attendance ON attendance.event_id = rehearsal.id
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
             AND (attendance.attendance = 'Absent'
               OR (attendance.attendance = 'Pending' AND attendance.rsvp = 'No'))
         ) ELSE 0 END AS attendanceMissed
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       LEFT JOIN events parentEvent ON parentEvent.id = e.parent_performance_id
       LEFT JOIN event_rosters direct
         ON direct.event_id = e.id AND direct.profile_id = ?
       LEFT JOIN event_rosters parent
         ON parent.event_id = e.parent_performance_id AND parent.profile_id = ?
       WHERE e.is_archived = 0 AND e.is_canceled = 0 AND e.starts_at >= ? AND e.starts_at <= ?
         AND (e.type <> 'Rehearsal' OR parent.rsvp IS NULL OR parent.rsvp <> 'No')
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
