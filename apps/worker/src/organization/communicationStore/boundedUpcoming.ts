import type {
  CommunicationScheduledMessage,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import {
  addCalendarDays,
  datePartInTimeZone,
  rsvpDeadlineFromDate,
  zonedLocalDateTimeToUtc,
} from "@choir/domain";
import { readRosterAutomationConfiguration } from "../statusAutomationStore";
import {
  attendanceReportDueAt,
  eventReminderDueAt,
  ticketReminderDueAt,
  EVENT_REMINDER_LEAD_MS,
  TICKET_REMINDER_LEAD_MS,
} from "../communicationSchedule";

interface EventRow {
  readonly [column: string]: SqlStorageValue;
  readonly id: string;
  readonly title: string;
  readonly startsAt: string;
}
const active = "e.is_archived=0 AND e.is_canceled=0";
const unbooked = `NOT EXISTS (SELECT 1 FROM scheduled_job_outbox o WHERE o.idempotency_key=(? || e.id))
 AND NOT EXISTS (SELECT 1 FROM job_ledger l WHERE l.idempotency_key=(? || e.id))`;
function planned(
  event: EventRow,
  kind: CommunicationScheduledMessage["kind"],
  key: string,
  label: string,
  dueAt: number,
  timezone: string,
): CommunicationScheduledMessage {
  return {
    id: `planned:${key}:${event.id}`,
    eventId: event.id,
    eventTitle: event.title,
    kind,
    subject: `${label}: ${event.title}`,
    scheduledAt: new Date(dueAt).toISOString(),
    timezone,
    status: "Scheduled",
    projected: true,
    recipientCount: 0,
  };
}
function reminders(
  storage: DurableObjectStorage,
  organizationId: string,
  now: number,
  horizon: number,
  timezone: string,
  limit: number,
) {
  const key = `event-reminder:${organizationId}:`;
  return storage.sql
    .exec<EventRow>(
      `SELECT e.id,e.title,e.starts_at AS startsAt FROM events e INDEXED BY idx_events_active_calendar
    WHERE ${active} AND e.reminder_sent_at IS NULL AND e.starts_at > ? AND e.starts_at <= ? AND ${unbooked}
    ORDER BY e.starts_at,e.id LIMIT ?`,
      new Date(now + EVENT_REMINDER_LEAD_MS).toISOString(),
      new Date(horizon + EVENT_REMINDER_LEAD_MS).toISOString(),
      key,
      key,
      limit,
    )
    .toArray()
    .map((event) =>
      planned(
        event,
        "event_reminder",
        "event-reminder",
        "Event reminder",
        eventReminderDueAt(event.startsAt),
        timezone,
      ),
    );
}
function reports(
  storage: DurableObjectStorage,
  organizationId: string,
  now: number,
  horizon: number,
  timezone: string,
  limit: number,
  days: number,
  rehearsals: boolean,
) {
  const result: CommunicationScheduledMessage[] = [];
  const key = `post-event-report:${organizationId}:`;
  // At most days+4 calendar partitions; each date has one timezone-aware report time.
  const first = addCalendarDays(datePartInTimeZone(new Date(now), timezone), -2);
  for (let offset = 0; offset < days + 4; offset++) {
    const day = addCalendarDays(first, offset);
    const start = zonedLocalDateTimeToUtc(`${day}T00:00`, timezone);
    const end = zonedLocalDateTimeToUtc(`${addCalendarDays(day, 1)}T00:00`, timezone);
    if (!start || !end) continue;
    const due = attendanceReportDueAt(start, timezone);
    if (due <= now || due > horizon) continue;
    const events = storage.sql
      .exec<EventRow>(
        `SELECT e.id,e.title,e.starts_at AS startsAt FROM events e INDEXED BY idx_events_active_calendar
      WHERE ${active} AND e.starts_at >= ? AND e.starts_at < ? AND (e.type='Performance' OR (?=1 AND e.type='Rehearsal'))
      AND ${unbooked} ORDER BY e.id LIMIT ?`,
        start,
        end,
        rehearsals ? 1 : 0,
        key,
        key,
        limit,
      )
      .toArray();
    result.push(
      ...events.map((event) =>
        planned(
          event,
          "attendance_report",
          "post-event-report",
          "Attendance report",
          due,
          timezone,
        ),
      ),
    );
  }
  return result;
}
function followUps(
  storage: DurableObjectStorage,
  organizationId: string,
  now: number,
  horizon: number,
  timezone: string,
  limit: number,
  days: number,
  configuration: OrganizationRosterConfiguration,
) {
  if (!configuration.rsvpExpiryEnabled) return [];
  const first = addCalendarDays(datePartInTimeZone(new Date(now), timezone), -1);
  const deadlines: Record<string, number> = {};
  // The existing RSVP contract caps lead times at 30 days. Only these dates can fall in this window.
  for (let offset = 0; offset < days + 33; offset++) {
    const date = addCalendarDays(first, offset);
    const deadline = rsvpDeadlineFromDate(date, timezone);
    if (deadline) deadlines[date] = Date.parse(deadline.deadlineAt);
  }
  const key = `rsvp-follow-up:${organizationId}:`;
  return storage.sql
    .exec<EventRow & { dueAt: number }>(
      `WITH candidates AS (
    SELECT e.id,e.title,e.starts_at AS startsAt,
      json_extract(?, '$."' || e.rsvp_deadline_date || '"') - (CASE WHEN e.rsvp_follow_up_mode='enabled' THEN e.rsvp_follow_up_lead_hours ELSE ? END)*3600000 AS dueAt
    FROM events e INDEXED BY idx_events_active_rsvp_deadline WHERE ${active} AND e.type='Performance'
      AND e.rsvp_deadline_date IS NOT NULL AND e.rsvp_deadline_date >= ? AND e.rsvp_deadline_date <= ? AND e.starts_at > ?
      AND (e.rsvp_follow_up_mode='enabled' OR (e.rsvp_follow_up_mode='inherit' AND ?=1)) AND ${unbooked}
    ) SELECT * FROM candidates WHERE dueAt > ? AND dueAt <= ? ORDER BY dueAt,id LIMIT ?`,
      JSON.stringify(deadlines),
      configuration.rsvpFollowUpLeadHours,
      first,
      addCalendarDays(first, days + 32),
      new Date(now).toISOString(),
      configuration.rsvpFollowUpEnabled ? 1 : 0,
      key,
      key,
      now,
      horizon,
      limit,
    )
    .toArray()
    .map((event) =>
      planned(event, "rsvp_follow_up", "rsvp-follow-up", "RSVP follow-up", event.dueAt, timezone),
    );
}
function tickets(
  storage: DurableObjectStorage,
  now: number,
  horizon: number,
  timezone: string,
  limit: number,
) {
  const unscheduled = `NOT EXISTS (SELECT 1 FROM ticket_notifications n WHERE n.dedupe_key=('ticket-reminder:' || p.id || ':' || e.id || ':' || strftime('%Y-%m-%dT%H:%M:%fZ',e.starts_at)))`;
  return storage.sql
    .exec<EventRow>(
      `SELECT e.id,e.title,e.starts_at AS startsAt FROM events e INDEXED BY idx_events_active_calendar
    WHERE ${active} AND e.starts_at > ? AND e.starts_at <= ? AND (
      EXISTS (SELECT 1 FROM ticket_purchases p WHERE p.event_id=e.id AND p.bundle_id IS NULL AND p.status='paid' AND ${unscheduled})
      OR EXISTS (SELECT 1 FROM ticket_bundle_allocations a JOIN ticket_purchases p ON p.id=a.purchase_id WHERE a.event_id=e.id AND p.status='paid' AND ${unscheduled}))
    ORDER BY e.starts_at,e.id LIMIT ?`,
      new Date(now + TICKET_REMINDER_LEAD_MS).toISOString(),
      new Date(horizon + TICKET_REMINDER_LEAD_MS).toISOString(),
      limit,
    )
    .toArray()
    .map((event) =>
      planned(
        event,
        "ticket_reminder",
        "ticket-reminder",
        "Ticket reminder",
        ticketReminderDueAt(event.startsAt),
        timezone,
      ),
    );
}
/** Overview predictions use limited indexed source queries, never complete event/purchase histories. */
export function boundedUpcomingCommunications(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
  days: number,
  limit: number,
): readonly CommunicationScheduledMessage[] {
  const timezone = storage.sql
    .exec<{ timezone: string }>("SELECT timezone FROM organization_metadata LIMIT 1")
    .one().timezone;
  const configuration = readRosterAutomationConfiguration(storage);
  const start = now.getTime();
  const horizon = start + days * 86400000;
  return [
    ...reminders(storage, organizationId, start, horizon, timezone, limit),
    ...reports(
      storage,
      organizationId,
      start,
      horizon,
      timezone,
      limit,
      days,
      configuration.rehearsalAttendanceReportsEnabled,
    ),
    ...followUps(storage, organizationId, start, horizon, timezone, limit, days, configuration),
    ...tickets(storage, start, horizon, timezone, limit),
  ]
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
