import {
  communicationDeliveryRecipientSchema,
  communicationDeliverySummarySchema,
  communicationRecipientSubjectFromLegacy,
  communicationRecipientSubjectSchema,
  communicationScheduledMessageSchema,
  communicationTemplateSchema,
} from "@choir/contracts";
import { renderCommunicationTemplate, summarizeCommunicationDeliveries } from "@choir/domain";
import { z } from "zod";

import {
  messageColumns,
  unsubscribeContactOperationSchema,
  unsubscribeOperationSchema,
  type DeliveryRow,
  type MessageRow,
  type TemplateRow,
} from "./contracts";
import { eventCommunicationContext, identityMatches, parseMessage, readMessage } from "./shared";

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
  if (!Number.isInteger(sourceRank) || sourceRank < 0 || sourceRank > 3) return null;
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
};

function buildHistoryWhere(
  origin?: string | null,
  status?: string | null,
  cursor?: HistoryCursor | null,
): { readonly bindings: unknown[]; readonly whereSql: string } {
  const whereClauses: string[] = [];
  const bindings: unknown[] = [];

  if (origin === "manual") {
    whereClauses.push("source_rank = 3");
  } else if (origin === "automated") {
    whereClauses.push("source_rank < 3");
  }

  const normalizedStatus = (status ?? "all").toLowerCase();
  const mappedStatus = STATUS_FILTER_MAP[normalizedStatus];
  if (mappedStatus) {
    whereClauses.push(`status = '${mappedStatus}'`);
  }

  if (cursor) {
    whereClauses.push(
      "(sort_timestamp < ? OR (sort_timestamp = ? AND (source_rank < ? OR (source_rank = ? AND id < ?))))",
    );
    bindings.push(
      cursor.sortTimestamp,
      cursor.sortTimestamp,
      cursor.sourceRank,
      cursor.sourceRank,
      cursor.id,
    );
  }

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

function mapHistoryRow(row: HistoryRow) {
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
      message,
      sortTimestamp,
    };
  }
  const scheduledMessage = communicationScheduledMessageSchema.parse({
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

export function listCommunicationHistoryFromStore(
  storage: DurableObjectStorage,
  input: {
    readonly cursor?: string | null;
    readonly limit?: string | number | null;
    readonly organizationId: string | null;
    readonly origin?: string | null;
    readonly status?: string | null;
  },
): Response {
  if (!input.organizationId || !identityMatches(storage, input.organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }

  const rawLimit = Number(input.limit ?? 50);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
  const cursor = parseHistoryCursor(input.cursor ?? null);
  const { bindings, whereSql } = buildHistoryWhere(input.origin, input.status, cursor);
  bindings.push(limit + 1);

  const sql = `
    WITH combined AS (
      SELECT
        'manual' AS kind,
        3 AS source_rank,
        id,
        COALESCE(sent_at, created_at) AS sort_timestamp,
        CASE WHEN canceled_at IS NOT NULL THEN 'Canceled' ELSE status END AS status,
        subject,
        channel,
        created_at AS createdAt,
        updated_at AS updatedAt,
        sent_at AS sentAt,
        canceled_at AS canceledAt,
        reach_json AS reachJson,
        audience_json AS audienceJson,
        content_markdown AS contentMarkdown,
        NULL AS eventId,
        NULL AS eventTitle,
        NULL AS autoKind,
        NULL AS recipientCount
      FROM communication_messages

      UNION ALL

      SELECT
        'automated' AS kind,
        2 AS source_rank,
        n.id,
        n.scheduled_for AS sort_timestamp,
        CASE WHEN n.status = 'failed' THEN 'Failed' WHEN n.status IN ('sent', 'suppressed') THEN 'Sent' ELSE 'Queued' END AS status,
        n.subject,
        'Email' AS channel,
        NULL AS createdAt,
        NULL AS updatedAt,
        NULL AS sentAt,
        NULL AS canceledAt,
        NULL AS reachJson,
        NULL AS audienceJson,
        NULL AS contentMarkdown,
        n.event_id AS eventId,
        COALESCE(e.title, p.event_title) AS eventTitle,
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
        CASE WHEN n.status = 'failed' THEN 'Failed' WHEN n.status IN ('sent', 'suppressed') THEN 'Sent' ELSE 'Queued' END AS status,
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
    ORDER BY sort_timestamp DESC, source_rank DESC, id DESC
    LIMIT ?
  `;

  const rows = storage.sql.exec<HistoryRow>(sql, ...bindings).toArray();
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map(mapHistoryRow);

  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow
      ? `${lastRow.sortTimestamp}|${String(lastRow.sourceRank)}|${lastRow.id}`
      : null;

  return Response.json({
    items,
    nextCursor,
  });
}

function bulletinPreview(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\{\{POLL_LINK:[0-9a-f-]{36}\}\}/gi, "Respond to poll")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/[`*_#>()!-]/g, " ")
    .replace(/[[]/g, " ")
    .replace(/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

interface MemberBulletinQueryResult {
  readonly [column: string]: SqlStorageValue;
  readonly audienceJson: string;
  readonly contentMarkdown: string;
  readonly id: string;
  readonly recipientName: string;
  readonly sentAt: string;
  readonly subject: string;
}

export function listMemberBulletinsFromStore(
  storage: DurableObjectStorage,
  input: { readonly organizationId: string | null; readonly profileId: string | null },
): Response {
  if (!input.organizationId || !identityMatches(storage, input.organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const profileId = z.uuid().safeParse(input.profileId);
  if (!profileId.success) {
    return Response.json({ bulletins: [] });
  }

  const rawBulletins = storage.sql
    .exec<MemberBulletinQueryResult>(
      `SELECT m.id, m.subject, m.content_markdown AS contentMarkdown,
         m.audience_json AS audienceJson, m.sent_at AS sentAt,
         COALESCE(NULLIF(d.recipient_name, ''), p.display_name, '') AS recipientName
       FROM communication_messages m
       LEFT JOIN profiles p ON p.id = ?
       JOIN communication_deliveries d ON d.message_id = m.id
       WHERE m.status = 'Sent' AND d.profile_id = ? AND d.status = 'sent'
       GROUP BY m.id
       ORDER BY sentAt DESC, m.id DESC LIMIT 5`,
      profileId.data,
      profileId.data,
    )
    .toArray();

  const bulletins = rawBulletins.map((raw) => {
    let eventId: string | null = null;
    try {
      const parsedAudience: unknown = JSON.parse(raw.audienceJson);
      if (
        typeof parsedAudience === "object" &&
        parsedAudience !== null &&
        "eventId" in parsedAudience &&
        typeof parsedAudience.eventId === "string" &&
        parsedAudience.eventId.length > 0
      ) {
        eventId = parsedAudience.eventId;
      }
    } catch {
      // Ignore malformed audienceJson
    }
    const context = eventCommunicationContext(storage, eventId);
    const templatedContent = renderCommunicationTemplate(
      raw.contentMarkdown,
      raw.recipientName,
      context ?? undefined,
    );
    const templatedSubject = renderCommunicationTemplate(
      raw.subject,
      raw.recipientName,
      context ?? undefined,
    );
    const contentWithLinks = templatedContent
      .replace(
        /\{\{RSVP_LINKS\}\}|\{rsvpLinks\}/gi,
        eventId ? "[Open RSVP](/schedule)" : "RSVP link unavailable",
      )
      .replace(
        /\{\{PLAYER_LINK\}\}|\{playerLink\}/gi,
        eventId ? "[Open practice player](/practice)" : "Practice player unavailable",
      )
      .replace(/\{\{TICKET_LINK\}\}|\{ticketLink\}/gi, "[View ticket order](/tickets)")
      .replace(/\{\{TICKET_ORDER_LINK\}\}|\{ticketOrderLink\}/gi, "[View order details](/tickets)")
      .replace(/\{\{AUDITION_LINK\}\}|\{auditionLink\}/gi, "[Review audition details](/auditions)");

    return {
      contentMarkdown: contentWithLinks,
      id: raw.id,
      preview: bulletinPreview(contentWithLinks),
      sentAt: raw.sentAt,
      subject: templatedSubject,
    };
  });

  return Response.json({ bulletins });
}

interface ProfileDeliveryRow {
  readonly [column: string]: SqlStorageValue;
  readonly attempts: number;
  readonly channel: "email" | "sms";
  readonly destination: string;
  readonly failureDetail: string;
  readonly lastAttemptAt: string | null;
  readonly messageId: string;
  readonly providerEventAt: string | null;
  readonly providerReason: string;
  readonly providerStatus:
    "accepted" | "bounced" | "complained" | "deferred" | "delivered" | "failed" | "rejected" | null;
  readonly recipientName: string;
  readonly status: "failed" | "processing" | "queued" | "sent" | "suppressed";
  readonly subject: string | null;
  readonly updatedAt: string;
}

export function listProfileDeliveriesFromStore(
  storage: DurableObjectStorage,
  input: { readonly organizationId: string | null; readonly profileId: string | null },
): Response {
  if (!input.organizationId || !identityMatches(storage, input.organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const profileId = z.uuid().safeParse(input.profileId);
  if (!profileId.success) return Response.json({ code: "profile_not_found" }, { status: 404 });
  const rows = storage.sql
    .exec<ProfileDeliveryRow>(
      `SELECT d.id, d.message_id AS messageId, m.subject, d.recipient_name AS recipientName,
         d.channel, d.destination, d.status, d.attempts,
         d.failure_detail AS failureDetail, d.last_attempt_at AS lastAttemptAt,
         d.provider_status AS providerStatus, d.provider_event_at AS providerEventAt,
         d.provider_reason AS providerReason, d.updated_at AS updatedAt
       FROM communication_deliveries d
       LEFT JOIN communication_messages m ON m.id = d.message_id
       WHERE d.profile_id = ?
       ORDER BY COALESCE(d.last_attempt_at, d.updated_at) DESC, d.id DESC
       LIMIT 25`,
      profileId.data,
    )
    .toArray()
    .map((row) => ({
      attempts: row.attempts,
      channel: row.channel,
      destination: row.destination,
      failureDetail: row.failureDetail,
      lastAttemptAt: row.lastAttemptAt ?? row.updatedAt,
      messageId: row.messageId,
      providerEventAt: row.providerEventAt,
      providerReason: row.providerReason,
      providerStatus: row.providerStatus,
      recipientName: row.recipientName,
      status: row.status,
      subject: row.subject ?? "(no subject)",
      updatedAt: row.updatedAt,
    }));
  return Response.json({ deliveries: rows });
}

interface ScheduledTicketMessageRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string | null;
  readonly eventTitle: string;
  readonly id: string;
  readonly kind: "confirmation" | "reminder" | "refund";
  readonly scheduledAt: string;
  readonly status: "failed" | "processing" | "queued" | "sent" | "suppressed";
  readonly subject: string;
}

interface ScheduledAuditionMessageRow {
  readonly [column: string]: SqlStorageValue;
  readonly auditionName: string;
  readonly id: string;
  readonly kind:
    "admin_alert" | "audition_reminder" | "inquiry_confirmation" | "scheduled_confirmation";
  readonly scheduledAt: string;
  readonly status: "failed" | "processing" | "queued" | "sent" | "suppressed";
  readonly subject: string;
}

interface ScheduledOutboxMessageRow {
  readonly [column: string]: SqlStorageValue;
  readonly dueAt: string;
  readonly enqueuedAt: string | null;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly jobStatus: "claimed" | "completed" | "failed" | null;
  readonly kind: "attendance_report" | "event_reminder" | "rsvp_follow_up";
}

function scheduledJobStatus(
  enqueuedAt: string | null,
  jobStatus: ScheduledOutboxMessageRow["jobStatus"],
): "Failed" | "Queued" | "Scheduled" | "Sent" {
  if (jobStatus === "completed") return "Sent";
  if (jobStatus === "failed") return "Failed";
  return enqueuedAt ? "Queued" : "Scheduled";
}

export function listCommunicationScheduledMessagesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const messages: z.infer<typeof communicationScheduledMessageSchema>[] = storage.sql
    .exec<ScheduledTicketMessageRow>(
      `SELECT n.id,
        CASE WHEN n.dedupe_key LIKE 'ticket-refund:%' THEN 'refund' ELSE n.kind END AS kind,
        n.subject, n.status,
        n.scheduled_for AS scheduledAt, n.event_id AS eventId,
        COALESCE(e.title, p.event_title) AS eventTitle
       FROM ticket_notifications n
       JOIN ticket_purchases p ON p.id = n.purchase_id
       LEFT JOIN events e ON e.id = n.event_id
       ORDER BY n.scheduled_for DESC, n.id DESC LIMIT 100`,
    )
    .toArray()
    .map((row) =>
      communicationScheduledMessageSchema.parse({
        eventId: row.eventId,
        eventTitle: row.eventTitle,
        id: row.id,
        kind:
          row.kind === "reminder"
            ? "ticket_reminder"
            : row.kind === "refund"
              ? "ticket_refund"
              : "ticket_confirmation",
        recipientCount: 1,
        scheduledAt: row.scheduledAt,
        status:
          row.status === "failed"
            ? "Failed"
            : row.status === "sent" || row.status === "suppressed"
              ? "Sent"
              : "Queued",
        subject: row.subject,
      }),
    );

  const auditionMessages = storage.sql
    .exec<ScheduledAuditionMessageRow>(
      `SELECT n.id, n.kind, n.subject, n.status,
        n.scheduled_for AS scheduledAt, a.name AS auditionName
       FROM audition_notifications n
       JOIN auditions a ON a.id = n.audition_id
       WHERE n.kind IN ('scheduled_confirmation', 'audition_reminder')
       ORDER BY n.scheduled_for DESC, n.id DESC LIMIT 100`,
    )
    .toArray();
  for (const message of auditionMessages) {
    messages.push(
      communicationScheduledMessageSchema.parse({
        eventId: null,
        eventTitle: `Audition: ${message.auditionName}`,
        id: message.id,
        kind: message.kind === "audition_reminder" ? "audition_reminder" : "audition_confirmation",
        recipientCount: 1,
        scheduledAt: message.scheduledAt,
        status:
          message.status === "failed"
            ? "Failed"
            : message.status === "sent" || message.status === "suppressed"
              ? "Sent"
              : "Queued",
        subject: message.subject,
      }),
    );
  }

  const scheduledJobs = storage.sql
    .exec<ScheduledOutboxMessageRow>(
      `SELECT o.job_id AS jobId, o.kind, o.idempotency_key AS idempotencyKey,
        o.due_at AS dueAt, o.enqueued_at AS enqueuedAt, l.status AS jobStatus
       FROM scheduled_job_outbox o
       LEFT JOIN job_ledger l ON l.job_id = o.job_id
       WHERE o.kind IN ('event_reminder', 'rsvp_follow_up', 'attendance_report')
       ORDER BY o.due_at DESC, o.job_id DESC LIMIT 100`,
    )
    .toArray();
  for (const job of scheduledJobs) {
    const eventId = job.idempotencyKey.split(":").at(-1) ?? "";
    const event = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly title: string }>(
        "SELECT title FROM events WHERE id = ? LIMIT 1",
        eventId,
      )
      .toArray()
      .at(0);
    if (!event) continue;
    messages.push(
      communicationScheduledMessageSchema.parse({
        eventId,
        eventTitle: event.title,
        id: job.jobId,
        kind: job.kind,
        recipientCount: 0,
        scheduledAt: job.dueAt,
        status: scheduledJobStatus(job.enqueuedAt, job.jobStatus),
        subject:
          job.kind === "event_reminder"
            ? "Event reminder: " + event.title
            : job.kind === "rsvp_follow_up"
              ? "RSVP follow-up: " + event.title
              : "Attendance report: " + event.title,
      }),
    );
  }
  messages.sort(
    (left, right) => new Date(right.scheduledAt).getTime() - new Date(left.scheduledAt).getTime(),
  );
  return Response.json({ messages: messages.slice(0, 200) });
}

interface TemplateCursor {
  readonly id: string;
  readonly isSystem: number;
  readonly title: string;
}

function parseTemplateCursor(cursor: string | null): TemplateCursor | null {
  if (!cursor || cursor.length > 512) return null;
  const parts = cursor.split("|");
  if (parts.length !== 3) return null;
  const isSystemStr = parts[0];
  const encodedTitle = parts[1];
  const id = parts[2];
  if (!isSystemStr || !encodedTitle || !id) return null;
  const isSystem = Number(isSystemStr);
  if (isSystem !== 0 && isSystem !== 1) return null;
  if (id.length > 128) return null;
  try {
    const title = decodeURIComponent(encodedTitle);
    return { id, isSystem, title };
  } catch {
    return null;
  }
}

function queryTemplateRows(
  storage: DurableObjectStorage,
  cursor: TemplateCursor | null,
  limit: number,
): readonly TemplateRow[] {
  if (cursor) {
    return storage.sql
      .exec<TemplateRow>(
        `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
          is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
         FROM communication_templates
         WHERE is_system < ?
           OR (is_system = ? AND (
             title COLLATE NOCASE > ?
             OR (title COLLATE NOCASE = ? AND id > ?)
           ))
         ORDER BY is_system DESC, title COLLATE NOCASE ASC, id ASC
         LIMIT ?`,
        cursor.isSystem,
        cursor.isSystem,
        cursor.title,
        cursor.title,
        cursor.id,
        limit + 1,
      )
      .toArray();
  }
  return storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
        is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates
       ORDER BY is_system DESC, title COLLATE NOCASE ASC, id ASC
       LIMIT ?`,
      limit + 1,
    )
    .toArray();
}

function parseTemplatesInput(
  input:
    | string
    | null
    | {
        readonly cursor?: string | null;
        readonly limit?: string | number | null;
        readonly organizationId: string | null;
      },
): {
  readonly cursor: TemplateCursor | null;
  readonly limit: number;
  readonly organizationId: string | null;
} {
  if (typeof input === "string" || input === null) {
    return { cursor: null, limit: 50, organizationId: input };
  }
  const rawLimit = Number(input.limit ?? 50);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
  const cursor = parseTemplateCursor(input.cursor ?? null);
  return { cursor, limit, organizationId: input.organizationId };
}

export function listCommunicationTemplatesFromStore(
  storage: DurableObjectStorage,
  input:
    | string
    | null
    | {
        readonly cursor?: string | null;
        readonly limit?: string | number | null;
        readonly organizationId: string | null;
      },
): Response {
  const { cursor, limit, organizationId } = parseTemplatesInput(input);
  if (!organizationId || !identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }

  const rows = queryTemplateRows(storage, cursor, limit);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const templates = pageRows.map((row) =>
    communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }),
  );

  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow
      ? `${lastRow.isSystem ? "1" : "0"}|${encodeURIComponent(lastRow.title)}|${lastRow.id}`
      : null;

  return Response.json({
    nextCursor,
    templates,
  });
}

export function readCommunicationTemplateFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  templateId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const parsedId = z.uuid().safeParse(templateId);
  if (!parsedId.success) {
    return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  }
  const row = storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
         is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates WHERE id = ? LIMIT 1`,
      parsedId.data,
    )
    .toArray()
    .at(0);
  return row
    ? Response.json(communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }))
    : Response.json({ code: "communication_template_not_found" }, { status: 404 });
}

export async function unsubscribeCommunicationProfileInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = unsubscribeOperationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ code: "invalid_unsubscribe_request" }, { status: 400 });
  const operation = parsed.data;
  if (!identityMatches(storage, operation.organizationId))
    return Response.json({ code: "unsubscribe_not_found" }, { status: 404 });
  const profile = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM profiles WHERE id = ? LIMIT 1",
      operation.profileId,
    )
    .toArray()
    .at(0);
  if (!profile) return Response.json({ code: "unsubscribe_not_found" }, { status: 404 });
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE profiles SET do_not_email = 1, updated_at = ? WHERE id = ?",
      now,
      operation.profileId,
    );
    storage.sql.exec(
      `INSERT INTO communication_suppressions
        (id, profile_id, channel, reason, active, created_at, updated_at)
       VALUES (?, ?, 'email', 'user_unsubscribe', 1, ?, ?)
       ON CONFLICT(profile_id, channel) DO UPDATE SET
         reason = 'user_unsubscribe', active = 1, updated_at = excluded.updated_at`,
      crypto.randomUUID(),
      operation.profileId,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id,
        request_id, change_summary, occurred_at)
       VALUES (?, 'public_link', ?, 'organization.communication.unsubscribed',
        'profile', ?, ?, ?, ?)`,
      `communication-unsubscribe:${operation.requestId}`,
      operation.profileId,
      operation.profileId,
      operation.requestId,
      JSON.stringify({ channel: "email" }),
      now,
    );
  });
  return Response.json({ success: true });
}

/**
 * Phase 7 contact-aware unsubscribe.
 *
 * Never touches `profiles` or `communication_suppressions` (those rows are
 * keyed by profile ID; writing a contact ID there would be the fake-ID
 * bolt-on the plan forbids). The contact's own email preference row is the
 * suppression record: `unsubscribed` blocks every future marketing email in
 * audience resolution and in the pre-delivery suppression recheck,
 * regardless of list membership. Lists, commerce history, and linked
 * profiles are left untouched.
 */
export async function unsubscribeCommunicationContactInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = unsubscribeContactOperationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json({ code: "invalid_unsubscribe_request" }, { status: 400 });
  const operation = parsed.data;
  if (!identityMatches(storage, operation.organizationId))
    return Response.json({ code: "unsubscribe_not_found" }, { status: 404 });
  const contact = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM contacts WHERE id = ? LIMIT 1",
      operation.contactId,
    )
    .toArray()
    .at(0);
  if (!contact) return Response.json({ code: "unsubscribe_not_found" }, { status: 404 });
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO contact_communication_preferences
        (contact_id, channel, status, source, observed_at, updated_at)
       VALUES (?, 'email', 'unsubscribed', 'user_unsubscribe', ?, ?)
       ON CONFLICT(contact_id, channel) DO UPDATE SET
         status = 'unsubscribed',
         source = CASE
           WHEN contact_communication_preferences.source IS NULL
             OR contact_communication_preferences.source = ''
           THEN 'user_unsubscribe'
           ELSE contact_communication_preferences.source
         END,
         observed_at = CASE WHEN contact_communication_preferences.status != 'unsubscribed'
           THEN excluded.observed_at ELSE contact_communication_preferences.observed_at END,
         updated_at = excluded.updated_at`,
      operation.contactId,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id,
        request_id, change_summary, occurred_at)
       VALUES (?, 'public_link', ?, 'organization.communication.contact.unsubscribed',
        'contact', ?, ?, ?, ?)`,
      `communication-contact-unsubscribe:${operation.requestId}`,
      operation.contactId,
      operation.contactId,
      operation.requestId,
      JSON.stringify({ channel: "email" }),
      now,
    );
  });
  return Response.json({ success: true });
}

function parseDeliverySubject(value: unknown, profileId: string) {
  if (typeof value === "string" && value !== "") {
    try {
      const parsed = communicationRecipientSubjectSchema.safeParse(JSON.parse(value));
      if (parsed.success) return parsed.data;
    } catch {
      // Fall through to the legacy adapter below.
    }
  }
  return communicationRecipientSubjectFromLegacy(profileId);
}

export function readCommunicationSummaryFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  messageId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const parsedMessageId = z.uuid().safeParse(messageId);
  if (!parsedMessageId.success || !readMessage(storage, parsedMessageId.data))
    return Response.json({ code: "communication_message_not_found" }, { status: 404 });
  const records = storage.sql
    .exec<DeliveryRow>(
      `SELECT id, message_id AS messageId, recipient_name AS recipientName, channel, destination,
        status, attempts, failure_detail AS failureDetail, provider_status AS providerStatus,
        updated_at AS updatedAt
       FROM communication_deliveries WHERE message_id = ? ORDER BY id LIMIT 10000`,
      parsedMessageId.data,
    )
    .toArray();
  const summary = summarizeCommunicationDeliveries(parsedMessageId.data, records);
  return Response.json(
    communicationDeliverySummarySchema.parse({
      ...summary,
      recipients: records.slice(0, 1_000).map((record) => ({
        channel: record.channel,
        providerStatus: record.providerStatus,
        recipientName: record.recipientName,
        status: record.status,
      })),
    }),
  );
}

interface RecipientRow {
  readonly [column: string]: SqlStorageValue;
  readonly channel: "email" | "sms";
  readonly id: string;
  readonly providerStatus:
    "accepted" | "delivered" | "deferred" | "bounced" | "failed" | "rejected" | "complained" | null;
  readonly recipientName: string;
  readonly status: "failed" | "processing" | "queued" | "sent" | "suppressed";
}

export function listCommunicationRecipientsFromStore(
  storage: DurableObjectStorage,
  input: {
    readonly cursor?: string | null;
    readonly limit?: string | number | null;
    readonly messageId: string | null;
    readonly organizationId: string | null;
  },
): Response {
  if (!input.organizationId || !identityMatches(storage, input.organizationId)) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const parsedMessageId = z.uuid().safeParse(input.messageId);
  if (!parsedMessageId.success || !readMessage(storage, parsedMessageId.data)) {
    return Response.json({ code: "communication_message_not_found" }, { status: 404 });
  }

  const rawLimit = Number(input.limit ?? 100);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 100;
  const cursor = input.cursor && input.cursor.length <= 128 ? input.cursor : null;

  const rows = cursor
    ? storage.sql
        .exec<RecipientRow>(
          `SELECT id, recipient_name AS recipientName, channel, status, provider_status AS providerStatus
           FROM communication_deliveries
           WHERE message_id = ? AND id > ?
           ORDER BY id ASC
           LIMIT ?`,
          parsedMessageId.data,
          cursor,
          limit + 1,
        )
        .toArray()
    : storage.sql
        .exec<RecipientRow>(
          `SELECT id, recipient_name AS recipientName, channel, status, provider_status AS providerStatus
           FROM communication_deliveries
           WHERE message_id = ?
           ORDER BY id ASC
           LIMIT ?`,
          parsedMessageId.data,
          limit + 1,
        )
        .toArray();

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const recipients = pageRows.map((r) =>
    communicationDeliveryRecipientSchema.parse({
      channel: r.channel,
      providerStatus: r.providerStatus,
      recipientName: r.recipientName,
      status: r.status,
    }),
  );

  const lastRow = pageRows.at(-1);
  const nextCursor = hasMore && lastRow ? lastRow.id : null;

  return Response.json({
    nextCursor,
    recipients,
  });
}

export function readCommunicationJobFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  jobId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const parsedJobId = z.uuid().safeParse(jobId);
  if (!parsedJobId.success)
    return Response.json({ code: "communication_job_not_found" }, { status: 404 });
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'communication_delivery' LIMIT 1`,
      parsedJobId.data,
    )
    .toArray()
    .at(0);
  const messageId = job?.idempotencyKey.split(":")[1];
  if (!messageId) return Response.json({ code: "communication_job_not_found" }, { status: 404 });
  const message = readMessage(storage, messageId);
  if (!message) return Response.json({ code: "communication_message_not_found" }, { status: 404 });
  const deliveries = storage.transactionSync(() => {
    const current = storage.sql
      .exec<{
        readonly canceledAt: string | null;
        readonly status: "Draft" | "Failed" | "Queued" | "Sent";
      }>(
        `SELECT status, canceled_at AS canceledAt
         FROM communication_messages WHERE id = ? LIMIT 1`,
        messageId,
      )
      .toArray()
      .at(0);
    if (!current || current.canceledAt || current.status !== "Queued") return [];
    const now = new Date().toISOString();
    const contactPreferenceSuppression =
      message.audience.ticketBuyerMode === "ticket_service"
        ? `OR EXISTS (
             SELECT 1 FROM contact_communication_preferences pref
             WHERE pref.contact_id = communication_deliveries.profile_id
               AND pref.channel = 'email' AND pref.status = 'unsubscribed'
               AND pref.source IN ('provider_bounce', 'provider_complaint')
           )`
        : `OR EXISTS (
             SELECT 1 FROM contact_communication_preferences pref
             WHERE pref.contact_id = communication_deliveries.profile_id
               AND pref.channel = 'email' AND pref.status = 'unsubscribed'
           )`;
    storage.sql.exec(
      `UPDATE communication_deliveries
       SET status = 'suppressed', failure_detail = '', updated_at = ?
       WHERE message_id = ? AND channel = 'email' AND status = 'queued'
         AND (
           EXISTS (
           SELECT 1 FROM profiles p
             WHERE (
               p.id = communication_deliveries.profile_id OR EXISTS (
                 SELECT 1 FROM contacts linked_contact
                 WHERE linked_contact.id = communication_deliveries.profile_id
                   AND linked_contact.profile_id = p.id
               )
             )
               AND (
                 p.do_not_email = 1 OR p.provider_email_suppressed = 1
                 OR p.last_bounce_at <> '' OR EXISTS (
                   SELECT 1 FROM communication_suppressions s
                   WHERE s.profile_id = p.id AND s.channel = 'email' AND s.active = 1
                 )
               )
           )
           ${contactPreferenceSuppression}
           OR EXISTS (
             SELECT 1 FROM contacts c
             JOIN communication_suppressions s ON s.profile_id = c.profile_id
             WHERE c.id = communication_deliveries.profile_id
               AND s.channel = 'email' AND s.active = 1
           )
         )`,
      now,
      messageId,
    );
    const queued = storage.sql
      .exec<
        Pick<
          DeliveryRow,
          | "channel"
          | "destination"
          | "id"
          | "profileId"
          | "recipientName"
          | "recipientSubjectJson"
          | "unsubscribeUrl"
        >
      >(
        `SELECT id, message_id AS messageId, profile_id AS profileId, recipient_name AS recipientName,
          channel, destination, unsubscribe_url AS unsubscribeUrl,
          recipient_subject_json AS recipientSubjectJson
         FROM communication_deliveries WHERE message_id = ? AND status = 'queued'
         ORDER BY id LIMIT 1000`,
        messageId,
      )
      .toArray();
    storage.sql.exec(
      `UPDATE communication_deliveries SET status = 'processing', updated_at = ?
       WHERE message_id = ? AND status = 'queued'`,
      now,
      messageId,
    );
    return queued.map(
      ({
        channel,
        destination,
        id,
        profileId,
        recipientName,
        recipientSubjectJson,
        unsubscribeUrl,
      }) => ({
        channel,
        destination,
        id,
        profileId,
        recipientName,
        subject: parseDeliverySubject(recipientSubjectJson, profileId),
        unsubscribeUrl,
      }),
    );
  });
  const eventId = message.audience.eventId;
  const context = eventCommunicationContext(
    storage,
    eventId,
    message.audience.ticketBuyerMode === "ticket_service",
  );
  return Response.json({
    contentMarkdown: message.contentMarkdown,
    context,
    deliveries,
    messageId,
    subject: message.subject,
    ticketServiceNotice: message.audience.ticketBuyerMode === "ticket_service",
  });
}
