import { z } from "zod";
import { communicationOverviewSchema, type CommunicationOverviewItem } from "@choir/contracts";
import { identityMatches, parseMessage } from "./communicationStore/shared";
import { messageColumns, type MessageRow } from "./communicationStore/contracts";
import { upcomingCommunications } from "./communicationStore/upcoming";

const inputSchema = z.object({ organizationId: z.string().min(1).max(128) });
type NotificationSource = "ticket" | "audition" | "checkout_reminder";
interface NotificationRow {
  readonly [column: string]: SqlStorageValue;
  readonly id: string;
  readonly subject: string;
  readonly timestamp: string;
  readonly eventId: string | null;
  readonly status: string;
  readonly providerStatus: string | null;
}
const sources = {
  ticket: {
    subject: "COALESCE(rendered_subject,subject)",
    event: "event_id",
    table: "ticket_notifications",
    state: "status",
    time: "COALESCE(sent_at,scheduled_for)",
    updated: "updated_at",
    pending: "queued",
    processing: "processing",
    due: "scheduled_for",
  },
  audition: {
    subject: "subject",
    event: "NULL",
    table: "audition_notifications",
    state: "status",
    time: "COALESCE(sent_at,scheduled_for)",
    updated: "updated_at",
    pending: "queued",
    processing: "processing",
    due: "scheduled_for",
  },
  checkout_reminder: {
    subject: "'Incomplete checkout reminder'",
    event: "NULL",
    table: "checkout_reminders",
    state: "state",
    time: "COALESCE(sent_at,due_at)",
    updated: "COALESCE(terminal_at,due_at)",
    pending: "scheduled",
    processing: "sending",
    due: "due_at",
  },
} as const;

function order(items: CommunicationOverviewItem[], ascending = false) {
  return items.sort(
    (a, b) =>
      (ascending ? 1 : -1) * a.timestamp.localeCompare(b.timestamp) ||
      a.source.localeCompare(b.source) ||
      a.id.localeCompare(b.id),
  );
}
function section(items: CommunicationOverviewItem[], limit: number, ascending = false) {
  const unique = new Map(items.map((item) => [`${item.source}:${item.id}`, item]));
  const sorted = order([...unique.values()], ascending);
  return { items: sorted.slice(0, limit), hasMore: sorted.length > limit };
}
function messageItem(
  storage: DurableObjectStorage,
  row: MessageRow & { automatic: number },
  timestamp: string,
): CommunicationOverviewItem {
  const message = parseMessage(row);
  const failed =
    storage.sql
      .exec<{ id: string }>(
        "SELECT id FROM communication_deliveries WHERE message_id=? AND (status='failed' OR provider_status IN ('bounced','failed','rejected','complained')) LIMIT 1",
        row.id,
      )
      .toArray().length > 0;
  return {
    id: row.id,
    source: "message",
    subject: message.subject || "Untitled message",
    timestamp,
    automatic: row.automatic === 1,
    channel: message.channel,
    status:
      message.status === "Sent" && failed
        ? "Sent with issues"
        : message.status === "Canceled"
          ? "Failed"
          : message.status,
    projected: false,
    recipientCount: message.reach.total,
    href: `/admin/communications?tab=messages&messageId=${row.id}`,
    message,
  };
}
function messages(
  storage: DurableObjectStorage,
  status: "Draft" | "Sent" | "Failed" | "Queued",
  limit: number,
  staleBefore?: string,
) {
  const time = status === "Sent" ? "COALESCE(sent_at,created_at)" : "updated_at";
  const rows = storage.sql
    .exec<MessageRow & { automatic: number; timestamp: string }>(
      `SELECT ${messageColumns}, CASE WHEN automation_json IS NOT NULL OR created_by='system:scheduler' THEN 1 ELSE 0 END AS automatic,
       ${time} AS timestamp FROM communication_messages INDEXED BY ${status === "Sent" ? "communication_overview_sent" : "communication_overview_state"} WHERE canceled_at IS NULL AND status='${status}'
       ${
         staleBefore
           ? `AND updated_at < ? AND NOT EXISTS (
         SELECT 1 FROM communication_deliveries d JOIN job_ledger l ON l.job_id=d.delivery_job_id
         WHERE d.message_id=communication_messages.id AND l.status='claimed' AND l.claimed_at >= ?)`
           : ""
       } ORDER BY ${time} DESC,id DESC LIMIT ?`,
      ...(staleBefore ? [staleBefore, staleBefore] : []),
      limit,
    )
    .toArray();
  return rows.map((row) => {
    const item = messageItem(storage, row, row.timestamp);
    return staleBefore ? { ...item, status: "Delayed" as const } : item;
  });
}
type NotificationMode = "recent" | "failed" | "delayed" | "upcoming" | "issues";
function notificationStatus(
  mode: NotificationMode,
  providerStatus: string | null,
): CommunicationOverviewItem["status"] {
  if (
    mode === "issues" ||
    (mode === "recent" &&
      providerStatus &&
      ["bounced", "failed", "rejected", "complained"].includes(providerStatus))
  )
    return "Sent with issues";
  if (mode === "recent") return "Sent";
  if (mode === "failed") return "Failed";
  return mode === "delayed" ? "Delayed" : "Scheduled";
}
function notificationIndex(source: NotificationSource, mode: NotificationMode) {
  if (source === "checkout_reminder") return "";
  if (mode === "recent") return `INDEXED BY ${source}_overview_sent`;
  return mode === "issues" ? `INDEXED BY ${source}_overview_issues` : "";
}
function notificationTimestamp(mode: NotificationMode, source: NotificationSource) {
  const config = sources[source];
  return mode === "recent"
    ? config.time
    : mode === "upcoming"
      ? config.due
      : mode === "issues"
        ? "COALESCE(provider_event_at,updated_at)"
        : config.updated;
}

function checkoutStatePartition(source: NotificationSource, mode: NotificationMode) {
  return source === "checkout_reminder" && mode !== "upcoming"
    ? "AND state IN ('sent','failed','sending')"
    : "";
}
function notificationRows(
  storage: DurableObjectStorage,
  source: NotificationSource,
  mode: NotificationMode,
  now: string,
  horizon: string,
  stale: string,
) {
  const config = sources[source];
  const state =
    mode === "recent" || mode === "issues"
      ? "sent"
      : mode === "failed"
        ? "failed"
        : mode === "delayed"
          ? config.processing
          : config.pending;
  const timestamp = notificationTimestamp(mode, source);
  const predicate =
    mode === "issues"
      ? "AND provider_status IN ('bounced','failed','rejected','complained')"
      : mode === "delayed"
        ? `AND ${source === "checkout_reminder" ? "link_issued_at" : "updated_at"} < ?`
        : mode === "upcoming"
          ? `AND ${config.due} > ? AND ${config.due} <= ?`
          : "";
  return storage.sql
    .exec<NotificationRow>(
      `SELECT id,${config.subject} AS subject,
    ${timestamp} AS timestamp,${config.event} AS eventId,${config.state} AS status,${source === "checkout_reminder" ? "NULL" : "provider_status"} AS providerStatus
    FROM ${config.table} ${notificationIndex(source, mode)} WHERE ${config.state}='${state}' ${checkoutStatePartition(source, mode)} ${predicate}
    ORDER BY ${timestamp} ${mode === "upcoming" ? "ASC" : "DESC"},id DESC LIMIT ?`,
      ...(mode === "delayed" ? [stale] : mode === "upcoming" ? [now, horizon] : []),
      mode === "recent" ? 6 : 4,
    )
    .toArray();
}

function notifications(
  storage: DurableObjectStorage,
  source: NotificationSource,
  mode: NotificationMode,
  now: string,
  horizon: string,
  stale: string,
): CommunicationOverviewItem[] {
  const rows = notificationRows(storage, source, mode, now, horizon, stale);
  return rows.map((row) => {
    let subject = row.subject;
    if (source === "ticket") {
      const purchase = storage.sql
        .exec<{ title: string; buyer: string }>(
          `SELECT COALESCE(NULLIF(p.bundle_title,''),e.title,p.event_title) AS title,p.buyer_name AS buyer FROM ticket_notifications n JOIN ticket_purchases p ON p.id=n.purchase_id LEFT JOIN events e ON e.id=n.event_id WHERE n.id=?`,
          row.id,
        )
        .toArray()
        .at(0);
      if (purchase)
        subject = subject
          .replaceAll("{eventTitle}", purchase.title)
          .replaceAll("{ticketBundleName}", purchase.title)
          .replaceAll("{buyerName}", purchase.buyer);
    }
    return {
      id: row.id,
      source,
      subject,
      timestamp: row.timestamp,
      channel: "Email",
      automatic: true,
      status: notificationStatus(mode, row.providerStatus),
      projected: false,
      recipientCount: 1,
      href:
        source === "ticket"
          ? `/admin/tickets${row.eventId ? `?eventId=${encodeURIComponent(row.eventId)}` : ""}`
          : source === "audition"
            ? "/admin/auditions"
            : "/admin/settings?tab=payments",
      message: null,
    };
  });
}

function scheduledItems(
  storage: DurableObjectStorage,
  now: string,
  horizon: string,
): CommunicationOverviewItem[] {
  const rows = storage.sql
    .exec<{ id: string; kind: string; key: string; timestamp: string }>(
      `SELECT job_id AS id,kind,idempotency_key AS key,due_at AS timestamp FROM scheduled_job_outbox o
     WHERE enqueued_at IS NULL AND due_at > ? AND due_at <= ?
       AND kind IN ('attendance_report','event_reminder','rsvp_follow_up')
       AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.id=('communication:organization.communication.queued:' || o.job_id))
     ORDER BY due_at,job_id LIMIT 4`,
      now,
      horizon,
    )
    .toArray();
  return rows.map((row) => {
    const eventId = row.key.split(":")[2] ?? "";
    const event = storage.sql
      .exec<{ title: string }>("SELECT title FROM events WHERE id=?", eventId)
      .toArray()
      .at(0);
    const label =
      row.kind === "attendance_report"
        ? "Attendance report"
        : row.kind === "event_reminder"
          ? "Event reminder"
          : "RSVP follow-up";
    return {
      id: row.id,
      source: "scheduler",
      subject: event ? `${label}: ${event.title}` : label,
      timestamp: row.timestamp,
      channel: "Email",
      automatic: true,
      status: "Scheduled",
      projected: false,
      recipientCount: null,
      href:
        row.kind === "attendance_report"
          ? "/admin/attendance"
          : `/admin/rsvp?eventId=${encodeURIComponent(eventId)}`,
      message: null,
    };
  });
}

export function readCommunicationOverview(
  storage: DurableObjectStorage,
  input: { organizationId: string },
  now = new Date(),
) {
  const { organizationId } = inputSchema.parse(input);
  if (!identityMatches(storage, organizationId)) return null;
  const timestamp = now.toISOString();
  const horizon = new Date(now.getTime() + 7 * 86400000).toISOString();
  const stale = new Date(now.getTime() - 15 * 60_000).toISOString();
  const drafts = section(messages(storage, "Draft", 4), 3);
  const recentItems = messages(storage, "Sent", 6);
  const attentionItems = [
    ...messages(storage, "Failed", 4),
    ...messages(storage, "Queued", 4, stale),
  ];
  // Only the currently failed delivery partition is examined; canceled messages are excluded.
  const partial = storage.sql
    .exec<{ messageId: string; issueTimestamp: string }>(
      `SELECT d.message_id AS messageId, MAX(d.updated_at) AS issueTimestamp FROM communication_deliveries d INDEXED BY communication_overview_failed_deliveries
    JOIN communication_messages m ON m.id=d.message_id WHERE (d.status='failed' OR d.provider_status IN ('bounced','failed','rejected','complained')) AND m.status='Sent' AND m.canceled_at IS NULL
    GROUP BY d.message_id ORDER BY MAX(d.updated_at) DESC,d.message_id LIMIT 4`,
    )
    .toArray();
  for (const { messageId, issueTimestamp } of partial) {
    const row = storage.sql
      .exec<MessageRow & { automatic: number }>(
        `SELECT ${messageColumns},CASE WHEN automation_json IS NOT NULL OR created_by='system:scheduler' THEN 1 ELSE 0 END AS automatic FROM communication_messages WHERE id=?`,
        messageId,
      )
      .toArray()
      .at(0);
    if (row) attentionItems.push(messageItem(storage, row, issueTimestamp));
  }
  const upcomingItems = scheduledItems(storage, timestamp, horizon);
  for (const source of ["ticket", "audition", "checkout_reminder"] as const) {
    recentItems.push(...notifications(storage, source, "recent", timestamp, horizon, stale));
    attentionItems.push(
      ...notifications(storage, source, "failed", timestamp, horizon, stale),
      ...notifications(storage, source, "delayed", timestamp, horizon, stale),
    );
    if (source !== "checkout_reminder")
      attentionItems.push(...notifications(storage, source, "issues", timestamp, horizon, stale));
    upcomingItems.push(...notifications(storage, source, "upcoming", timestamp, horizon, stale));
  }
  for (const state of ["failed", "claimed"] as const) {
    const jobs = storage.sql
      .exec<{ id: string; kind: string; timestamp: string }>(
        `SELECT job_id AS id,kind,COALESCE(failed_at,claimed_at) AS timestamp
      FROM job_ledger l INDEXED BY communication_overview_jobs WHERE status=? AND kind IN ('attendance_report','event_reminder','rsvp_follow_up')
      ${state === "claimed" ? "AND claimed_at < ?" : ""}
      AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.id=('communication:organization.communication.queued:' || l.job_id))
      ORDER BY COALESCE(failed_at,claimed_at) DESC,job_id DESC LIMIT 4`,
        state,
        ...(state === "claimed" ? [stale] : []),
      )
      .toArray();
    attentionItems.push(
      ...jobs.map((job) => ({
        id: job.id,
        source: "scheduler" as const,
        subject:
          job.kind === "attendance_report"
            ? "Attendance report"
            : job.kind === "event_reminder"
              ? "Event reminder"
              : "RSVP follow-up",
        timestamp: job.timestamp,
        status: state === "failed" ? ("Failed" as const) : ("Delayed" as const),
        automatic: true,
        projected: false,
        channel: "Email" as const,
        recipientCount: null,
        href: job.kind === "attendance_report" ? "/admin/attendance" : "/admin/rsvp",
        message: null,
      })),
    );
  }
  for (const preview of upcomingCommunications(storage, organizationId, now, 7, 4)) {
    upcomingItems.push({
      id: preview.id,
      source: "scheduler",
      subject: preview.subject,
      timestamp: preview.scheduledAt,
      status: "Scheduled",
      automatic: true,
      projected: true,
      channel: "Email",
      recipientCount: null,
      href:
        preview.kind === "ticket_reminder"
          ? `/admin/tickets?eventId=${encodeURIComponent(preview.eventId ?? "")}`
          : preview.kind === "attendance_report"
            ? "/admin/attendance"
            : `/admin/rsvp?eventId=${encodeURIComponent(preview.eventId ?? "")}`,
      message: null,
    });
  }
  const recent = section(recentItems, 5);
  const attention = section(attentionItems, 3);
  const upcoming = section(upcomingItems, 3, true);
  const timezone = storage.sql
    .exec<{ timezone: string }>("SELECT timezone FROM organization_metadata LIMIT 1")
    .one().timezone;
  return communicationOverviewSchema.parse({
    timezone,
    asOf: timestamp,
    drafts: drafts.items,
    recent: recent.items,
    upcoming: upcoming.items,
    attention: attention.items,
    hasMore: {
      drafts: drafts.hasMore,
      recent: recent.hasMore,
      upcoming: upcoming.hasMore,
      attention: attention.hasMore,
    },
  });
}
