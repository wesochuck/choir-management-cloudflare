import { communicationHistorySearch } from "./historySearch";
import type { SqlStorageValue } from "@cloudflare/workers-types";
import {
  communicationScheduledMessageSchema,
  communicationHistorySearchSchema,
} from "@choir/contracts";

import { messageColumns, type CommunicationAudienceStorage, type MessageRow } from "./contracts";
import { identityMatches, parseMessage } from "./shared";
import { upcomingCommunications } from "./upcoming";

export function listCommunicationMessagesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const messages = storage.sql
    .exec<MessageRow>(
      `SELECT ${messageColumns} FROM communication_messages
       ORDER BY created_at DESC, id DESC LIMIT 100`,
    )
    .toArray()
    .map(parseMessage);
  return Response.json({ messages });
}

export function listEventPromotionMessagesFromStore(
  storage: CommunicationAudienceStorage,
  organizationId: string | null,
  eventId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  if (
    !eventId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)
  ) {
    return Response.json({ code: "invalid_event_id" }, { status: 400 });
  }
  const messages = storage.sql
    .exec<MessageRow>(
      `SELECT ${messageColumns} FROM communication_messages
       WHERE id IN (
         SELECT message_id FROM event_communication_links WHERE event_id = ?
       )
       ORDER BY created_at DESC, id DESC`,
      eventId,
    )
    .toArray()
    .map(parseMessage);
  return Response.json({ messages });
}

interface HistoryCursor {
  readonly id: string;
  readonly sortTimestamp: string;
  readonly sourceRank: number;
}

function parseHistoryCursor(cursor: string | null): HistoryCursor | null {
  if (!cursor || cursor.length > 256) return null;
  const parts = cursor.split("|");
  if (parts.length !== 3) return null;
  const sortTimestamp = parts[0];
  const rankStr = parts[1];
  const id = parts[2];
  if (!sortTimestamp || !rankStr || !id) return null;
  const sourceRank = Number(rankStr);
  if (!Number.isInteger(sourceRank) || sourceRank < 0 || sourceRank > 5) return null;
  if (id.length > 128) return null;
  if (isNaN(Date.parse(sortTimestamp))) return null;
  return { id, sortTimestamp, sourceRank };
}

interface HistoryRow {
  readonly [column: string]: SqlStorageValue;
  readonly audienceJson: string | null;
  readonly autoKind: string | null;
  readonly canceledAt: string | null;
  readonly channel: string;
  readonly contentMarkdown: string | null;
  readonly createdAt: string | null;
  readonly eventId: string | null;
  readonly eventTitle: string | null;
  readonly id: string;
  readonly kind: "automated" | "manual";
  readonly reachJson: string | null;
  readonly recipientCount: number | null;
  readonly sentAt: string | null;
  readonly sortTimestamp: string;
  readonly sourceRank: number;
  readonly status: string;
  readonly subject: string;
  readonly updatedAt: string | null;
}

const STATUS_FILTER_MAP: Readonly<Record<string, string>> = {
  canceled: "Canceled",
  draft: "Draft",
  failed: "Failed",
  queued: "Queued",
  scheduled: "Scheduled",
  sent: "Sent",
  skipped: "Skipped",
};

function buildHistoryWhere(
  origin?: string | null,
  status?: string | null,
  cursor?: HistoryCursor | null,
  ascending = false,
  search = "",
  timezone = "UTC",
): { readonly bindings: unknown[]; readonly whereSql: string } {
  const whereClauses: string[] = [];
  const bindings: unknown[] = [];

  if (origin === "manual") {
    whereClauses.push("source_rank = 3 AND autoKind IS NULL");
  } else if (origin === "automated") {
    whereClauses.push("(source_rank != 3 OR autoKind IS NOT NULL)");
  }

  const normalizedStatus = (status ?? "all").toLowerCase();
  const mappedStatus = STATUS_FILTER_MAP[normalizedStatus];
  if (mappedStatus) {
    whereClauses.push(`status = '${mappedStatus}'`);
  }

  if (cursor) {
    whereClauses.push(
      `(sort_timestamp ${ascending ? ">" : "<"} ? OR (sort_timestamp = ? AND (source_rank < ? OR (source_rank = ? AND id < ?))))`,
    );
    bindings.push(
      cursor.sortTimestamp,
      cursor.sortTimestamp,
      cursor.sourceRank,
      cursor.sourceRank,
      cursor.id,
    );
  }

  const searchFilter = communicationHistorySearch(search, timezone);
  whereClauses.push(...searchFilter.clauses);
  bindings.push(...searchFilter.bindings);
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  return { bindings, whereSql };
}

function parseManualMessageStatus(status: string): MessageRow["status"] {
  switch (status) {
    case "Draft":
    case "Queued":
    case "Sent":
    case "Failed":
      return status;
    default:
      return "Draft";
  }
}

function mapHistoryRow(row: HistoryRow, timezone: string) {
  const sortTimestamp = new Date(row.sortTimestamp).toISOString();
  if (row.kind === "manual") {
    const message = parseMessage({
      audienceJson: row.audienceJson ?? "{}",
      canceledAt: row.canceledAt,
      channel: row.channel === "Both" || row.channel === "SMS" ? row.channel : "Email",
      contentMarkdown: row.contentMarkdown ?? "",
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : sortTimestamp,
      id: row.id,
      reachJson: row.reachJson ?? "{}",
      sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : null,
      status: parseManualMessageStatus(row.status),
      subject: row.subject,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : sortTimestamp,
    });
    return {
      kind: "manual" as const,
      ...(row.autoKind ? { automatic: true } : {}),
      message,
      sortTimestamp,
    };
  }
  const reminderDetails = reminderHistoryDetails(row);
  const scheduledMessage = communicationScheduledMessageSchema.parse({
    ...reminderDetails,
    projected: row.id.startsWith("planned:"),
    timezone,
    eventId: row.eventId,
    eventTitle: row.eventTitle ?? "",
    id: row.id,
    kind: row.autoKind,
    recipientCount: row.recipientCount ?? 0,
    scheduledAt: sortTimestamp,
    status: row.status,
    subject: row.subject,
  });
  return {
    kind: "automated" as const,
    scheduledMessage,
    sortTimestamp,
  };
}

function parseHistorySearch(search: string | undefined) {
  return communicationHistorySearchSchema.parse(search ?? "");
}

export function queryCommunicationHistoryFromStore(
  storage: DurableObjectStorage,
  input: {
    readonly search?: string;
    readonly includePreviews?: boolean;
    readonly cursor?: string | null;
    readonly limit?: string | number | null;
    readonly organizationId: string | null;
    readonly origin?: string | null;
    readonly status?: string | null;
  },
) {
  if (!input.organizationId || !identityMatches(storage, input.organizationId)) {
    return null;
  }

  const now = new Date();
  const timezone = storage.sql
    .exec<{ readonly timezone: string }>("SELECT timezone FROM organization_metadata LIMIT 1")
    .one().timezone;
  const projected =
    input.includePreviews === false ||
    input.origin === "manual" ||
    (input.status && !["all", "scheduled"].includes(input.status))
      ? []
      : upcomingCommunications(storage, input.organizationId, now);
  const ascending = input.status === "scheduled";
  const rawLimit = Number(input.limit ?? 50);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
  const cursor = parseHistoryCursor(input.cursor ?? null);
  const { bindings, whereSql } = buildHistoryWhere(
    input.origin,
    input.status,
    cursor,
    ascending,
    parseHistorySearch(input.search),
    timezone,
  );
  bindings.push(limit + 1);
  bindings.unshift(JSON.stringify(projected), now.toISOString(), now.toISOString());

  const sql = `
    WITH reminder_history AS (
      SELECT 'automated' AS kind,5 AS source_rank,r.id,r.due_at AS sort_timestamp,
        CASE r.state WHEN 'sent' THEN 'Sent' WHEN 'skipped' THEN 'Skipped' WHEN 'failed' THEN 'Failed'
          WHEN 'scheduled' THEN 'Scheduled' ELSE 'Queued' END AS status,
        'Incomplete checkout reminder' AS subject,'Email' AS channel,
        NULL AS createdAt,NULL AS updatedAt,NULL AS sentAt,NULL AS canceledAt,NULL AS reachJson,NULL AS audienceJson,
        json_object('email',p.email,'skipReason',r.skip_reason) AS contentMarkdown,
        NULL AS eventId,CASE r.kind WHEN 'ticket' THEN 'Ticket checkout' ELSE 'Donation checkout' END AS eventTitle,
        'checkout_reminder' AS autoKind,1 AS recipientCount
      FROM checkout_reminders r JOIN checkout_reminder_recipients p ON p.id = r.recipient_id
    ), existing_history AS (
      SELECT 'automated' AS kind, 4 AS source_rank,
        json_extract(value, '$.id') AS id,
        json_extract(value, '$.scheduledAt') AS sort_timestamp,
        'Scheduled' AS status, json_extract(value, '$.subject') AS subject,
        'Email' AS channel, NULL AS createdAt, NULL AS updatedAt, NULL AS sentAt,
        NULL AS canceledAt, NULL AS reachJson, NULL AS audienceJson, NULL AS contentMarkdown,
        json_extract(value, '$.eventId') AS eventId, json_extract(value, '$.eventTitle') AS eventTitle,
        json_extract(value, '$.kind') AS autoKind, json_extract(value, '$.recipientCount') AS recipientCount
      FROM json_each(?)
      UNION ALL
      SELECT
        'manual' AS kind,
        3 AS source_rank,
        m.id,
        COALESCE(m.sent_at, m.created_at) AS sort_timestamp,
        CASE WHEN m.canceled_at IS NOT NULL THEN 'Canceled' ELSE m.status END AS status,
        CASE
          WHEN m.subject LIKE '%{eventTitle}%' AND e.title IS NOT NULL AND e.title <> ''
          THEN REPLACE(REPLACE(m.subject, '{eventTitle}', e.title), '{eventType}', COALESCE(e.type, ''))
          ELSE m.subject
        END AS subject,
        m.channel,
        m.created_at AS createdAt,
        m.updated_at AS updatedAt,
        m.sent_at AS sentAt,
        m.canceled_at AS canceledAt,
        m.reach_json AS reachJson,
        m.audience_json AS audienceJson,
        m.content_markdown AS contentMarkdown,
        COALESCE(json_extract(m.automation_json, '$.eventId'), json_extract(m.audience_json, '$.eventId')) AS eventId,
        e.title AS eventTitle,
        CASE WHEN m.automation_json IS NOT NULL OR m.created_by='system:scheduler' THEN COALESCE(json_extract(m.automation_json, '$.kind'),'automatic') ELSE NULL END AS autoKind,
        NULL AS recipientCount
      FROM communication_messages m
      LEFT JOIN events e ON e.id = COALESCE(json_extract(m.automation_json, '$.eventId'), json_extract(m.audience_json, '$.eventId'))

      UNION ALL

      SELECT
        'automated' AS kind,
        2 AS source_rank,
        n.id,
        n.scheduled_for AS sort_timestamp,
        CASE
          WHEN n.status = 'failed' THEN 'Failed'
          WHEN n.status = 'suppressed' THEN 'Skipped'
          WHEN n.status = 'sent' THEN 'Sent'
          WHEN n.status = 'queued' AND n.scheduled_for > ? AND NOT EXISTS (
            SELECT 1 FROM scheduled_job_outbox x
            WHERE x.idempotency_key = ('ticket-notification:' || n.id)
              AND x.enqueued_at IS NOT NULL
          ) THEN 'Scheduled'
          ELSE 'Queued'
        END AS status,
        COALESCE(
          n.rendered_subject,
          CASE
            WHEN p.bundle_title <> '' THEN REPLACE(REPLACE(REPLACE(n.subject, '{ticketBundleName}', p.bundle_title), '{eventTitle}', p.bundle_title), '{buyerName}', p.buyer_name)
            WHEN COALESCE(e.title, p.event_title) <> '' THEN REPLACE(REPLACE(REPLACE(n.subject, '{eventTitle}', COALESCE(e.title, p.event_title)), '{ticketBundleName}', COALESCE(e.title, p.event_title)), '{buyerName}', p.buyer_name)
            ELSE n.subject
          END
        ) AS subject,
        'Email' AS channel,
        NULL AS createdAt,
        NULL AS updatedAt,
        NULL AS sentAt,
        NULL AS canceledAt,
        NULL AS reachJson,
        NULL AS audienceJson,
        COALESCE(n.rendered_content_markdown, n.content_markdown) AS contentMarkdown,
        n.event_id AS eventId,
        COALESCE(NULLIF(p.bundle_title, ''), e.title, p.event_title) AS eventTitle,
        CASE
          WHEN n.dedupe_key LIKE 'ticket-refund:%' OR n.kind = 'refund' THEN 'ticket_refund'
          WHEN n.kind = 'reminder' THEN 'ticket_reminder'
          ELSE 'ticket_confirmation'
        END AS autoKind,
        1 AS recipientCount
      FROM ticket_notifications n
      JOIN ticket_purchases p ON p.id = n.purchase_id
      LEFT JOIN events e ON e.id = n.event_id

      UNION ALL

      SELECT
        'automated' AS kind,
        1 AS source_rank,
        n.id,
        n.scheduled_for AS sort_timestamp,
        CASE
          WHEN n.status = 'failed' THEN 'Failed'
          WHEN n.status = 'suppressed' THEN 'Skipped'
          WHEN n.status = 'sent' THEN 'Sent'
          WHEN n.status = 'queued' AND n.scheduled_for > ? AND NOT EXISTS (
            SELECT 1 FROM scheduled_job_outbox x
            WHERE x.idempotency_key = ('audition-notification:' || n.id)
              AND x.enqueued_at IS NOT NULL
          ) THEN 'Scheduled'
          ELSE 'Queued'
        END AS status,
        n.subject,
        'Email' AS channel,
        NULL AS createdAt,
        NULL AS updatedAt,
        NULL AS sentAt,
        NULL AS canceledAt,
        NULL AS reachJson,
        NULL AS audienceJson,
        NULL AS contentMarkdown,
        NULL AS eventId,
        ('Audition: ' || a.name) AS eventTitle,
        CASE WHEN n.kind = 'audition_reminder' THEN 'audition_reminder' ELSE 'audition_confirmation' END AS autoKind,
        1 AS recipientCount
      FROM audition_notifications n
      JOIN auditions a ON a.id = n.audition_id
      WHERE n.kind IN ('scheduled_confirmation', 'audition_reminder')

      UNION ALL

      SELECT
        'automated' AS kind,
        0 AS source_rank,
        o.job_id AS id,
        o.due_at AS sort_timestamp,
        CASE
          WHEN l.status = 'completed' THEN 'Sent'
          WHEN l.status = 'failed' THEN 'Failed'
          WHEN o.enqueued_at IS NOT NULL THEN 'Queued'
          ELSE 'Scheduled'
        END AS status,
        CASE
          WHEN o.kind = 'event_reminder' THEN ('Event reminder: ' || e.title)
          WHEN o.kind = 'rsvp_follow_up' THEN ('RSVP follow-up: ' || e.title)
          ELSE ('Attendance report: ' || e.title)
        END AS subject,
        'Email' AS channel,
        NULL AS createdAt,
        NULL AS updatedAt,
        NULL AS sentAt,
        NULL AS canceledAt,
        NULL AS reachJson,
        NULL AS audienceJson,
        NULL AS contentMarkdown,
        e.id AS eventId,
        e.title AS eventTitle,
        o.kind AS autoKind,
        0 AS recipientCount
      FROM scheduled_job_outbox o
      LEFT JOIN job_ledger l ON l.job_id = o.job_id
      JOIN events e ON (o.idempotency_key LIKE ('%:' || e.id) OR o.idempotency_key LIKE ('%:' || e.id || ':%'))
      WHERE o.kind IN ('event_reminder', 'rsvp_follow_up', 'attendance_report')
        AND (l.status IS NULL OR l.status != 'completed')
        AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.id=('communication:organization.communication.queued:' || o.job_id))
    ), combined AS (
      SELECT * FROM reminder_history UNION ALL SELECT * FROM existing_history
    )
    SELECT
      kind,
      source_rank AS sourceRank,
      id,
      sort_timestamp AS sortTimestamp,
      status,
      subject,
      channel,
      createdAt,
      updatedAt,
      sentAt,
      canceledAt,
      reachJson,
      audienceJson,
      contentMarkdown,
      eventId,
      eventTitle,
      autoKind,
      recipientCount
    FROM combined
    ${whereSql}
    ORDER BY sort_timestamp ${ascending ? "ASC" : "DESC"}, source_rank DESC, id DESC
    LIMIT ?
  `;

  const rows = storage.sql.exec<HistoryRow>(sql, ...bindings).toArray();
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map((row) => mapHistoryRow(row, timezone));

  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow
      ? `${lastRow.sortTimestamp}|${String(lastRow.sourceRank)}|${lastRow.id}`
      : null;

  return { items, nextCursor };
}

export function listCommunicationHistoryFromStore(
  storage: DurableObjectStorage,
  input: Parameters<typeof queryCommunicationHistoryFromStore>[1],
): Response {
  const page = queryCommunicationHistoryFromStore(storage, input);
  return page
    ? Response.json(page)
    : Response.json({ code: "organization_not_found" }, { status: 404 });
}

function reminderHistoryDetails(row: HistoryRow) {
  const reminderDetails =
    row.autoKind === "checkout_reminder" && row.contentMarkdown
      ? (JSON.parse(row.contentMarkdown) as unknown)
      : null;
  const details = reminderDetails && typeof reminderDetails === "object" ? reminderDetails : {};
  const reminderEmail =
    "email" in details && typeof details.email === "string" ? details.email : undefined;
  const skipReason =
    "skipReason" in details && typeof details.skipReason === "string" ? details.skipReason : null;
  return reminderEmail ? { recipientEmail: reminderEmail, skipReason } : {};
}
