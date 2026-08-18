import {
  communicationDeliverySummarySchema,
  communicationScheduledMessageSchema,
  communicationTemplateSchema,
} from "@choir/contracts";
import { renderCommunicationTemplate, summarizeCommunicationDeliveries } from "@choir/domain";
import { z } from "zod";

import {
  messageColumns,
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

function bulletinPreview(value: string): string {
  return value
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
  if (!profileId.success) return Response.json({ code: "profile_not_found" }, { status: 404 });
  const rawBulletins = storage.sql
    .exec<MemberBulletinQueryResult>(
      `SELECT m.id, m.subject, m.content_markdown AS contentMarkdown,
         m.audience_json AS audienceJson,
         COALESCE(MAX(d.recipient_name), (SELECT display_name FROM profiles WHERE id = ?), '') AS recipientName,
         COALESCE(m.sent_at, MAX(d.updated_at)) AS sentAt
       FROM communication_messages m
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
      .replace(/\{\{POLL_LINK:([0-9a-f-]{36})\}\}/gi, "[Respond to poll](/dashboard)")
      .replace(/\{\{TICKET_LINK\}\}|\{ticketLink\}/gi, "[View ticket order](/tickets)")
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
  readonly kind: "confirmation" | "reminder";
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
      `SELECT n.id, n.kind, n.subject, n.status,
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
        kind: row.kind === "reminder" ? "ticket_reminder" : "ticket_confirmation",
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

export function listCommunicationTemplatesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const templates = storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
        is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates ORDER BY is_system DESC, title COLLATE NOCASE, id LIMIT 200`,
    )
    .toArray()
    .map((row) => communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }));
  return Response.json({ templates });
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
    storage.sql.exec(
      `UPDATE communication_deliveries
       SET status = 'suppressed', failure_detail = '', updated_at = ?
       WHERE message_id = ? AND channel = 'email' AND status = 'queued'
         AND EXISTS (
           SELECT 1 FROM profiles p
           WHERE p.id = communication_deliveries.profile_id
             AND (
               p.do_not_email = 1 OR EXISTS (
                 SELECT 1 FROM communication_suppressions s
                 WHERE s.profile_id = p.id AND s.channel = 'email' AND s.active = 1
               )
             )
         )`,
      now,
      messageId,
    );
    const queued = storage.sql
      .exec<
        Pick<
          DeliveryRow,
          "channel" | "destination" | "id" | "profileId" | "recipientName" | "unsubscribeUrl"
        >
      >(
        `SELECT id, message_id AS messageId, profile_id AS profileId, recipient_name AS recipientName,
          channel, destination, unsubscribe_url AS unsubscribeUrl
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
    return queued.map(({ channel, destination, id, profileId, recipientName, unsubscribeUrl }) => ({
      channel,
      destination,
      id,
      profileId,
      recipientName,
      unsubscribeUrl,
    }));
  });
  const eventId = message.audience.eventId;
  const context = eventCommunicationContext(storage, eventId);
  return Response.json({
    contentMarkdown: message.contentMarkdown,
    context,
    deliveries,
    messageId,
    subject: message.subject,
  });
}
