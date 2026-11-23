import { boundedUpcomingCommunications } from "./boundedUpcoming";
import type { CommunicationScheduledMessage } from "@choir/contracts";
import { readRosterAutomationConfiguration } from "../statusAutomationStore";
import {
  attendanceReportDueAt,
  donorListDueAt,
  ticketCloseoutDueAt,
  ticketWillCallDueAt,
  eventReminderDueAt,
  ticketReminderDueAt,
  rsvpFollowUpSchedule,
  COMMUNICATION_PREVIEW_DAYS,
  EVENT_REMINDER_LEAD_MS,
  ATTENDANCE_REPORT_LOOKBACK_MS,
  TICKET_CLOSEOUT_DELAY_MS,
  TICKET_WILL_CALL_LEAD_MS,
  DONOR_LIST_LEAD_MS,
} from "../communicationSchedule";

interface UpcomingEvent {
  readonly [column: string]: SqlStorageValue;
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly startsAt: string;
  readonly reminderSentAt: string | null;
  readonly rsvpDeadlineDate: string | null;
  readonly rsvpFollowUpMode: "disabled" | "enabled" | "inherit";
  readonly rsvpFollowUpLeadHours: number | null;
}

function upcomingTicketReminderMessages(
  storage: DurableObjectStorage,
  now: Date,
  horizon: number,
  timezone: string,
): readonly CommunicationScheduledMessage[] {
  // Event-scoped allocations cover individual tickets and bundle purchases without a cross-tenant lookup.
  const tickets = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly eventId: string;
      readonly purchaseCount: number;
      readonly title: string;
      readonly startsAt: string;
    }>(
      `WITH ticket_events AS (
       SELECT p.id AS purchaseId, e.id AS eventId, e.title, e.starts_at AS startsAt
       FROM events e JOIN ticket_purchases p ON p.event_id = e.id
       WHERE p.bundle_id IS NULL AND p.status = 'paid' AND e.is_archived = 0 AND e.is_canceled = 0
         AND e.starts_at > ? AND e.starts_at <= ?
       UNION ALL
       SELECT p.id, e.id, e.title, e.starts_at
       FROM events e JOIN ticket_bundle_allocations a ON a.event_id = e.id
       JOIN ticket_purchases p ON p.id = a.purchase_id
       WHERE p.status = 'paid' AND e.is_archived = 0 AND e.is_canceled = 0
         AND e.starts_at > ? AND e.starts_at <= ?
     ) SELECT t.eventId, t.title, t.startsAt, COUNT(DISTINCT t.purchaseId) AS purchaseCount
     FROM ticket_events t WHERE NOT EXISTS (
       SELECT 1 FROM ticket_notifications n WHERE n.dedupe_key =
         ('ticket-reminder:' || t.purchaseId || ':' || t.eventId || ':' || strftime('%Y-%m-%dT%H:%M:%fZ', t.startsAt))
     ) GROUP BY t.eventId, t.title, t.startsAt`,
      now.toISOString(),
      new Date(horizon + 86400000).toISOString(),
      now.toISOString(),
      new Date(horizon + 86400000).toISOString(),
    )
    .toArray();
  const messages: CommunicationScheduledMessage[] = [];
  for (const ticket of tickets) {
    const dueAt = ticketReminderDueAt(ticket.startsAt);
    if (dueAt <= now.getTime() || dueAt > horizon) continue;
    messages.push({
      eventId: ticket.eventId,
      eventTitle: ticket.title,
      id: `planned:ticket-reminder:${ticket.eventId}`,
      kind: "ticket_reminder",
      recipientCount: ticket.purchaseCount,
      scheduledAt: new Date(dueAt).toISOString(),
      status: "Scheduled",
      subject: `Ticket reminder: ${ticket.title}`,
      projected: true,
      timezone,
    });
  }
  return messages;
}

/** Read-only predictions. Actual eligibility and recipients are resolved at delivery time. */
export function upcomingCommunications(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
  previewDays = COMMUNICATION_PREVIEW_DAYS,
  limit?: number,
): readonly CommunicationScheduledMessage[] {
  if (limit !== undefined)
    return boundedUpcomingCommunications(storage, organizationId, now, previewDays, limit);
  const timezone = storage.sql
    .exec<{ readonly timezone: string }>("SELECT timezone FROM organization_metadata LIMIT 1")
    .one().timezone;
  const configuration = readRosterAutomationConfiguration(storage);
  const horizon = now.getTime() + previewDays * 86400000;
  const eventColumns = `id, title, type, starts_at AS startsAt, reminder_sent_at AS reminderSentAt,
    rsvp_deadline_date AS rsvpDeadlineDate, rsvp_follow_up_mode AS rsvpFollowUpMode,
    rsvp_follow_up_lead_hours AS rsvpFollowUpLeadHours`;
  const events = storage.sql
    .exec<UpcomingEvent>(
      `SELECT ${eventColumns}
     FROM events WHERE is_archived = 0 AND is_canceled = 0 AND starts_at > ? AND starts_at <= ?
     UNION
     SELECT ${eventColumns} FROM events INDEXED BY idx_events_active_rsvp_deadline
     WHERE type = 'Performance' AND is_archived = 0 AND is_canceled = 0
       AND rsvp_deadline_date IS NOT NULL AND rsvp_deadline_date >= ? AND rsvp_deadline_date <= ?
       AND starts_at > ?`,
      new Date(now.getTime() - ATTENDANCE_REPORT_LOOKBACK_MS).toISOString(),
      new Date(horizon + Math.max(EVENT_REMINDER_LEAD_MS, DONOR_LIST_LEAD_MS)).toISOString(),
      // Allow timezone offsets and the maximum configurable 30-day RSVP lead time.
      new Date(now.getTime() - 86400000).toISOString().slice(0, 10),
      new Date(horizon + 31 * 86400000).toISOString().slice(0, 10),
      now.toISOString(),
    )
    .toArray();
  const ticketCloseoutStartAfter = new Date(now.getTime() - TICKET_CLOSEOUT_DELAY_MS).toISOString();
  const ticketCloseoutEndBefore = new Date(horizon - TICKET_CLOSEOUT_DELAY_MS).toISOString();
  const ticketCloseoutEventIds = new Set(
    storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly eventId: string }>(
        `SELECT e.id AS eventId
         FROM events e
         WHERE e.type = 'Performance' AND e.is_archived = 0 AND e.is_canceled = 0
           AND e.starts_at > ? AND e.starts_at <= ?
           AND (
             EXISTS (
               SELECT 1 FROM ticket_purchases p
               WHERE p.event_id = e.id AND p.bundle_id IS NULL
                 AND p.status IN ('paid', 'refunded')
             )
             OR EXISTS (
               SELECT 1 FROM ticket_bundle_allocations a
               JOIN ticket_purchases p ON p.id = a.purchase_id
               WHERE a.event_id = e.id AND p.status IN ('paid', 'refunded')
             )
           )
         ORDER BY e.starts_at, e.id
         LIMIT 200`,
        ticketCloseoutStartAfter,
        ticketCloseoutEndBefore,
      )
      .toArray()
      .map(({ eventId }) => eventId),
  );
  const ticketWillCallStartAfter = now.toISOString();
  const ticketWillCallEndBefore = new Date(horizon + TICKET_WILL_CALL_LEAD_MS).toISOString();
  const ticketWillCallEventIds = new Set(
    storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly eventId: string }>(
        `SELECT e.id AS eventId
         FROM events e
         WHERE e.type = 'Performance' AND e.is_archived = 0 AND e.is_canceled = 0
           AND e.is_ticketing_enabled = 1
           AND e.starts_at > ? AND e.starts_at <= ?
           AND (
             EXISTS (
               SELECT 1 FROM ticket_purchases p
               WHERE p.event_id = e.id AND p.bundle_id IS NULL AND p.status = 'paid'
             )
             OR EXISTS (
               SELECT 1 FROM ticket_bundle_allocations a
               JOIN ticket_purchases p ON p.id = a.purchase_id
               WHERE a.event_id = e.id AND p.status = 'paid'
             )
           )
         ORDER BY e.starts_at, e.id
         LIMIT 200`,
        ticketWillCallStartAfter,
        ticketWillCallEndBefore,
      )
      .toArray()
      .map(({ eventId }) => eventId),
  );
  const hasDonations =
    storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        "SELECT id FROM donations ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .toArray().length > 0;
  const donorListEventIds = new Set(
    hasDonations
      ? storage.sql
          .exec<{ readonly [column: string]: SqlStorageValue; readonly eventId: string }>(
            `SELECT e.id AS eventId
             FROM events e
             WHERE e.type = 'Performance' AND e.is_archived = 0 AND e.is_canceled = 0
               AND e.starts_at > ? AND e.starts_at <= ?
             ORDER BY e.starts_at, e.id
             LIMIT 200`,
            new Date(now.getTime() + DONOR_LIST_LEAD_MS).toISOString(),
            new Date(horizon + DONOR_LIST_LEAD_MS).toISOString(),
          )
          .toArray()
          .map(({ eventId }) => eventId)
      : [],
  );
  const predictions: { readonly key: string; readonly message: CommunicationScheduledMessage }[] =
    [];
  function add(
    event: UpcomingEvent,
    kind: CommunicationScheduledMessage["kind"],
    dueAt: number,
    key: string,
    subject: string,
  ): void {
    if (!Number.isFinite(dueAt) || dueAt <= now.getTime() || dueAt > horizon) return;
    predictions.push({
      key,
      message: {
        eventId: event.id,
        eventTitle: event.title,
        id: `planned:${key.slice(0, key.indexOf(":"))}:${event.id}`,
        kind,
        recipientCount: 0,
        scheduledAt: new Date(dueAt).toISOString(),
        status: "Scheduled",
        subject,
        projected: true,
        timezone,
      },
    });
  }
  for (const event of events) {
    if (!event.reminderSentAt)
      add(
        event,
        "event_reminder",
        eventReminderDueAt(event.startsAt),
        `event-reminder:${organizationId}:${event.id}`,
        `Event reminder: ${event.title}`,
      );
    if (event.type === "Performance") {
      const schedule = rsvpFollowUpSchedule(event, configuration, timezone);
      if (schedule)
        add(
          event,
          "rsvp_follow_up",
          schedule.dueAt,
          `rsvp-follow-up:${organizationId}:${event.id}`,
          `RSVP follow-up: ${event.title}`,
        );
      add(
        event,
        "attendance_report",
        attendanceReportDueAt(event.startsAt, timezone),
        `post-event-report:${organizationId}:${event.id}`,
        `Attendance report: ${event.title}`,
      );
      if (ticketCloseoutEventIds.has(event.id)) {
        add(
          event,
          "ticket_closeout",
          ticketCloseoutDueAt(event.startsAt),
          `ticket-closeout:${organizationId}:${event.id}`,
          `Ticket closeout: ${event.title}`,
        );
      }
      if (ticketWillCallEventIds.has(event.id)) {
        add(
          event,
          "ticket_will_call",
          ticketWillCallDueAt(event.startsAt),
          `ticket-will-call:${organizationId}:${event.id}:${event.startsAt}`,
          `Will-call list: ${event.title}`,
        );
      }
      if (donorListEventIds.has(event.id)) {
        add(
          event,
          "donor_list_reminder",
          donorListDueAt(event.startsAt),
          `donor-list:${organizationId}:${event.id}:${event.startsAt}`,
          `Donor list: ${event.title}`,
        );
      }
    } else if (event.type === "Rehearsal" && configuration.rehearsalAttendanceReportsEnabled) {
      add(
        event,
        "attendance_report",
        attendanceReportDueAt(event.startsAt, timezone),
        `post-event-report:${organizationId}:${event.id}`,
        `Attendance report: ${event.title}`,
      );
    }
  }
  const keys = JSON.stringify(predictions.map(({ key }) => key));
  const existing = new Set(
    storage.sql
      .exec<{ readonly key: string }>(
        `SELECT idempotency_key AS key FROM scheduled_job_outbox
      WHERE idempotency_key IN (SELECT value FROM json_each(?))
     UNION SELECT idempotency_key AS key FROM job_ledger
      WHERE idempotency_key IN (SELECT value FROM json_each(?))`,
        keys,
        keys,
      )
      .toArray()
      .map(({ key }) => key),
  );
  return [
    ...predictions.filter(({ key }) => !existing.has(key)).map(({ message }) => message),
    ...upcomingTicketReminderMessages(storage, now, horizon, timezone),
  ];
}
