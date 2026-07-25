import { z } from "zod";

function identity(
  storage: DurableObjectStorage,
): { readonly organizationId: string; readonly name: string; readonly slug: string } | undefined {
  return storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly name: string;
      readonly organizationId: string;
      readonly slug: string;
    }>("SELECT organization_id AS organizationId, name, slug FROM organization_metadata LIMIT 1")
    .toArray()
    .at(0);
}

interface RecipientRow {
  readonly [column: string]: SqlStorageValue;
  readonly phone: string;
  readonly profileId: string;
  readonly recipientName: string;
}

function readRsvpYesRecipients(
  storage: DurableObjectStorage,
  eventId: string,
): readonly RecipientRow[] {
  return storage.sql
    .exec<RecipientRow>(
      `SELECT p.id AS profileId, p.display_name AS recipientName,
         p.phone AS phone
       FROM event_rosters r
       JOIN profiles p ON p.id = r.profile_id
       WHERE r.event_id = ? AND r.rsvp = 'Yes'
         AND p.do_not_email = 0
       ORDER BY p.display_name COLLATE NOCASE ASC, p.id ASC
       LIMIT 500`,
      eventId,
    )
    .toArray();
}

interface EventSummaryRow {
  readonly [column: string]: SqlStorageValue;
  readonly callTime: string;
  readonly details: string;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly location: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: string;
  readonly venueAddress: string;
  readonly venueName: string;
}

function readEventSummary(storage: DurableObjectStorage, eventId: string): EventSummaryRow | null {
  return (
    storage.sql
      .exec<EventSummaryRow>(
        `SELECT e.id, e.title, e.type, e.starts_at AS startsAt,
         e.duration_minutes AS durationMinutes, e.call_time AS callTime,
         e.location, e.details,
         COALESCE(v.name, '') AS venueName, COALESCE(v.address, '') AS venueAddress
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.id = ? LIMIT 1`,
        eventId,
      )
      .toArray()
      .at(0) ?? null
  );
}

export function readEventReminderJobFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  jobId: string | null,
): Response {
  const org = identity(storage);
  if (org?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const parsedJobId = z.uuid().safeParse(jobId);
  if (!parsedJobId.success) {
    return Response.json({ code: "event_reminder_job_not_found" }, { status: 404 });
  }
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'event_reminder' LIMIT 1`,
      parsedJobId.data,
    )
    .toArray()
    .at(0);
  const eventId = job?.idempotencyKey.split(":")[2];
  if (!eventId) {
    return Response.json({ code: "event_reminder_job_not_found" }, { status: 404 });
  }
  const event = readEventSummary(storage, eventId);
  if (!event) {
    return Response.json({ code: "event_reminder_job_not_found" }, { status: 404 });
  }
  const recipients = readRsvpYesRecipients(storage, eventId);
  return Response.json({
    event: {
      callTime: event.callTime,
      details: event.details,
      durationMinutes: event.durationMinutes,
      id: event.id,
      location: event.location,
      startsAt: event.startsAt,
      title: event.title,
      type: event.type,
      venueAddress: event.venueAddress,
      venueName: event.venueName,
    },
    eventId,
    recipients,
  });
}

interface AttendanceRosterRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendance: string;
  readonly displayName: string;
  readonly profileId: string;
  readonly rsvp: string;
  readonly voicePart: string;
}

export function readAttendanceReportJobFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  jobId: string | null,
): Response {
  const org = identity(storage);
  if (org?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const parsedJobId = z.uuid().safeParse(jobId);
  if (!parsedJobId.success) {
    return Response.json({ code: "attendance_report_job_not_found" }, { status: 404 });
  }
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'attendance_report' LIMIT 1`,
      parsedJobId.data,
    )
    .toArray()
    .at(0);
  const eventId = job?.idempotencyKey.split(":")[2];
  if (!eventId) {
    return Response.json({ code: "attendance_report_job_not_found" }, { status: 404 });
  }
  const event = readEventSummary(storage, eventId);
  if (!event) {
    return Response.json({ code: "attendance_report_job_not_found" }, { status: 404 });
  }
  const roster = storage.sql
    .exec<AttendanceRosterRow>(
      `SELECT p.id AS profileId, p.display_name AS displayName,
         p.voice_part AS voicePart, r.rsvp, r.attendance
       FROM event_rosters r
       JOIN profiles p ON p.id = r.profile_id
       WHERE r.event_id = ?
       ORDER BY p.display_name COLLATE NOCASE ASC, p.id ASC
       LIMIT 500`,
      eventId,
    )
    .toArray();
  return Response.json({
    event: {
      callTime: event.callTime,
      details: event.details,
      durationMinutes: event.durationMinutes,
      id: event.id,
      location: event.location,
      startsAt: event.startsAt,
      title: event.title,
      type: event.type,
      venueAddress: event.venueAddress,
      venueName: event.venueName,
    },
    eventId,
    roster,
  });
}
