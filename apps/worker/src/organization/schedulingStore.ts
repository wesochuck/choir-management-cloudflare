import { z } from "zod";

import { readRosterAutomationConfiguration } from "./statusAutomationStore";

function identity(storage: DurableObjectStorage):
  | {
      readonly organizationId: string;
      readonly name: string;
      readonly slug: string;
      readonly timezone: string;
    }
  | undefined {
  return storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly name: string;
      readonly organizationId: string;
      readonly slug: string;
      readonly timezone: string;
    }>(
      "SELECT organization_id AS organizationId, name, slug, timezone FROM organization_metadata LIMIT 1",
    )
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
  rsvp: "Pending" | "Yes",
): readonly RecipientRow[] {
  const targetEventId =
    storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly parentPerformanceId: string | null;
      }>(
        "SELECT parent_performance_id AS parentPerformanceId FROM events WHERE id = ? LIMIT 1",
        eventId,
      )
      .toArray()
      .at(0)?.parentPerformanceId ?? eventId;
  return storage.sql
    .exec<RecipientRow>(
      `SELECT p.id AS profileId, p.display_name AS recipientName,
         p.phone AS phone
       FROM event_rosters r
       JOIN profiles p ON p.id = r.profile_id
       WHERE r.event_id = ? AND r.rsvp = ? AND p.global_status = 'Active'
         AND p.voice_part <> '' AND p.do_not_email = 0
         AND NOT EXISTS (
           SELECT 1 FROM communication_suppressions s
           WHERE s.profile_id = p.id AND s.channel = 'email' AND s.active = 1
         )
       ORDER BY p.display_name COLLATE NOCASE ASC, p.id ASC
       LIMIT 500`,
      targetEventId,
      rsvp,
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
  readonly parentPerformanceId: string | null;
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
         e.location, e.details, e.parent_performance_id AS parentPerformanceId,
         COALESCE(v.name, '') AS venueName, COALESCE(v.address, '') AS venueAddress
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.id = ? AND e.is_archived = 0 AND e.is_canceled = 0 LIMIT 1`,
        eventId,
      )
      .toArray()
      .at(0) ?? null
  );
}

function eventIdFromCommunicationJobKey(idempotencyKey: string): string | null {
  const parts = idempotencyKey.split(":");
  return parts.at(-2) === "retry" ? (parts.at(-3) ?? null) : (parts.at(-1) ?? null);
}

function readEventCommunicationJobFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  jobId: string | null,
  kind: "event_reminder" | "rsvp_follow_up",
  rsvp: "Pending" | "Yes",
): Response {
  const org = identity(storage);
  if (org?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const parsedJobId = z.uuid().safeParse(jobId);
  if (!parsedJobId.success) {
    return Response.json({ code: `${kind}_job_not_found` }, { status: 404 });
  }
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = ? LIMIT 1`,
      parsedJobId.data,
      kind,
    )
    .toArray()
    .at(0);
  const eventId = job ? eventIdFromCommunicationJobKey(job.idempotencyKey) : null;
  if (!eventId) {
    return Response.json({ code: `${kind}_job_not_found` }, { status: 404 });
  }
  const event = readEventSummary(storage, eventId);
  if (!event) {
    return Response.json({ code: `${kind}_job_not_found` }, { status: 404 });
  }
  const recipients = readRsvpYesRecipients(storage, eventId, rsvp);
  return Response.json({
    event: {
      callTime: event.callTime,
      details: event.details,
      durationMinutes: event.durationMinutes,
      id: event.id,
      location: event.location,
      parentPerformanceId: event.parentPerformanceId,
      startsAt: event.startsAt,
      title: event.title,
      type: event.type,
      timezone: org.timezone,
      venueAddress: event.venueAddress,
      venueName: event.venueName,
    },
    eventId,
    recipients,
  });
}

export function readEventReminderJobFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  jobId: string | null,
): Response {
  return readEventCommunicationJobFromStore(
    storage,
    organizationId,
    jobId,
    "event_reminder",
    "Yes",
  );
}

export function readRsvpFollowUpJobFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  jobId: string | null,
): Response {
  return readEventCommunicationJobFromStore(
    storage,
    organizationId,
    jobId,
    "rsvp_follow_up",
    "Pending",
  );
}

interface AttendanceRosterRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendance: string;
  readonly displayName: string;
  readonly profileId: string;
  readonly rsvp: string;
  readonly voicePart: string;
}

interface ReportProfileRow {
  readonly [column: string]: SqlStorageValue;
  readonly displayName: string;
  readonly doNotEmail: number;
  readonly emailSuppressed: number;
  readonly globalStatus: string;
  readonly id: string;
  readonly receiveAttendanceReports: number;
}

interface LinkedRehearsalRosterRow {
  readonly [column: string]: SqlStorageValue;
  readonly attendance: string;
  readonly displayName: string | null;
  readonly eventId: string;
  readonly eventStartsAt: string;
  readonly eventTitle: string;
  readonly profileId: string | null;
  readonly rsvp: string | null;
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
  if (event?.type !== "Performance") {
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
  const reportProfiles = storage.sql
    .exec<ReportProfileRow>(
      `SELECT id, display_name AS displayName, global_status AS globalStatus,
         do_not_email AS doNotEmail, receive_attendance_reports AS receiveAttendanceReports,
         EXISTS (
           SELECT 1 FROM communication_suppressions s
           WHERE s.profile_id = profiles.id AND s.channel = 'email' AND s.active = 1
         ) AS emailSuppressed
       FROM profiles WHERE global_status = 'Active' LIMIT 500`,
    )
    .toArray();
  const warningThreshold =
    readRosterAutomationConfiguration(storage).attendanceReportWarningThreshold;
  const performanceEventId = event.id;
  const performerProfileIds = performanceEventId
    ? storage.sql
        .exec<{ readonly [column: string]: SqlStorageValue; readonly profileId: string }>(
          `SELECT r.profile_id AS profileId FROM event_rosters r
           JOIN profiles p ON p.id = r.profile_id
           WHERE r.event_id = ? AND r.rsvp = 'Yes' AND p.global_status = 'Active'
             AND p.voice_part <> ''`,
          performanceEventId,
        )
        .toArray()
        .map(({ profileId }) => profileId)
    : [];
  const linkedRehearsalRows = performanceEventId
    ? storage.sql
        .exec<LinkedRehearsalRosterRow>(
          `SELECT e.id AS eventId, e.title AS eventTitle, e.starts_at AS eventStartsAt,
             r.profile_id AS profileId, p.display_name AS displayName,
             r.rsvp, r.attendance
           FROM events e
           LEFT JOIN event_rosters r ON r.event_id = e.id
           LEFT JOIN profiles p ON p.id = r.profile_id
           WHERE e.parent_performance_id = ? AND e.type = 'Rehearsal'
             AND e.is_archived = 0 AND e.is_canceled = 0
           ORDER BY e.starts_at, e.id, p.display_name COLLATE NOCASE, p.id
           LIMIT 5000`,
          performanceEventId,
        )
        .toArray()
    : [];
  return Response.json({
    event: {
      callTime: event.callTime,
      details: event.details,
      durationMinutes: event.durationMinutes,
      id: event.id,
      location: event.location,
      parentPerformanceId: event.parentPerformanceId,
      startsAt: event.startsAt,
      title: event.title,
      type: event.type,
      timezone: org.timezone,
      venueAddress: event.venueAddress,
      venueName: event.venueName,
    },
    eventId,
    performerProfileIds,
    reportProfiles,
    linkedRehearsalRows,
    recipients: [],
    roster,
    warningThreshold,
  });
}

export function prepareAttendanceReportJobFromStore(
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
  const eventId = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'attendance_report' LIMIT 1`,
      parsedJobId.data,
    )
    .toArray()
    .at(0)
    ?.idempotencyKey.split(":")
    .at(-1);
  if (!eventId) {
    return Response.json({ code: "attendance_report_job_not_found" }, { status: 404 });
  }
  const event = readEventSummary(storage, eventId);
  if (event?.type !== "Performance") {
    return Response.json({ code: "attendance_report_job_not_found" }, { status: 404 });
  }
  const finalizedAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE event_rosters SET attendance = 'Absent' WHERE event_id = ? AND attendance = 'Pending'",
      eventId,
    );
    const finalizedCount = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
        "SELECT changes() AS count",
      )
      .one().count;
    if (finalizedCount > 0) {
      storage.sql.exec(
        `INSERT OR IGNORE INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'organization_system', 'system:scheduler',
           'organization.attendance.finalized', 'event', ?, ?, ?, ?)`,
        `attendance-finalize:${parsedJobId.data}`,
        eventId,
        parsedJobId.data,
        JSON.stringify({ markedAbsent: finalizedCount }),
        finalizedAt,
      );
    }
  });
  return readAttendanceReportJobFromStore(storage, organizationId, jobId);
}
