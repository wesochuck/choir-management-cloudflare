import type { SqlStorageValue } from "@cloudflare/workers-types";
import { communicationScheduledMessageSchema } from "@choir/contracts";
import { renderCommunicationTemplate } from "@choir/domain";
import { z } from "zod";

import { eventCommunicationContext, identityMatches } from "./shared";
import { upcomingCommunications } from "./upcoming";

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

interface ScheduledTicketMessageRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string | null;
  readonly eventTitle: string;
  readonly id: string;
  readonly kind: "confirmation" | "reminder" | "refund";
  readonly scheduledAt: string;
  readonly enqueuedAt: string | null;
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
  readonly enqueuedAt: string | null;
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

function notificationStatus(
  message: {
    readonly status: ScheduledTicketMessageRow["status"];
    readonly scheduledAt: string;
    readonly enqueuedAt: string | null;
  },
  now: Date,
): "Failed" | "Queued" | "Scheduled" | "Sent" {
  if (message.status === "failed") return "Failed";
  if (message.status === "sent" || message.status === "suppressed") return "Sent";
  return message.status === "queued" &&
    !message.enqueuedAt &&
    Date.parse(message.scheduledAt) > now.getTime()
    ? "Scheduled"
    : "Queued";
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
  const now = new Date();
  const timezone = storage.sql
    .exec<{ readonly timezone: string }>("SELECT timezone FROM organization_metadata LIMIT 1")
    .one().timezone;
  const messages: z.infer<typeof communicationScheduledMessageSchema>[] = storage.sql
    .exec<ScheduledTicketMessageRow>(
      `SELECT n.id,
        CASE WHEN n.dedupe_key LIKE 'ticket-refund:%' THEN 'refund' ELSE n.kind END AS kind,
        COALESCE(
          n.rendered_subject,
          CASE
            WHEN p.bundle_title <> '' THEN REPLACE(REPLACE(REPLACE(n.subject, '{ticketBundleName}', p.bundle_title), '{eventTitle}', p.bundle_title), '{buyerName}', p.buyer_name)
            WHEN COALESCE(e.title, p.event_title) <> '' THEN REPLACE(REPLACE(REPLACE(n.subject, '{eventTitle}', COALESCE(e.title, p.event_title)), '{ticketBundleName}', COALESCE(e.title, p.event_title)), '{buyerName}', p.buyer_name)
            ELSE n.subject
          END
        ) AS subject,
        n.status,
        n.scheduled_for AS scheduledAt,
        (SELECT enqueued_at FROM scheduled_job_outbox WHERE idempotency_key = ('ticket-notification:' || n.id)) AS enqueuedAt,
        n.event_id AS eventId,
        COALESCE(NULLIF(p.bundle_title, ''), e.title, p.event_title) AS eventTitle
       FROM ticket_notifications n
       JOIN ticket_purchases p ON p.id = n.purchase_id
       LEFT JOIN events e ON e.id = n.event_id
       ORDER BY n.scheduled_for DESC, n.id DESC LIMIT 100`,
    )
    .toArray()
    .map((row) =>
      communicationScheduledMessageSchema.parse({
        timezone,
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
        status: notificationStatus(row, now),
        subject: row.subject,
      }),
    );

  const auditionMessages = storage.sql
    .exec<ScheduledAuditionMessageRow>(
      `SELECT n.id, n.kind, n.subject, n.status,
        n.scheduled_for AS scheduledAt,
        (SELECT enqueued_at FROM scheduled_job_outbox WHERE idempotency_key = ('audition-notification:' || n.id)) AS enqueuedAt,
        a.name AS auditionName
       FROM audition_notifications n
       JOIN auditions a ON a.id = n.audition_id
       WHERE n.kind IN ('scheduled_confirmation', 'audition_reminder')
       ORDER BY n.scheduled_for DESC, n.id DESC LIMIT 100`,
    )
    .toArray();
  for (const message of auditionMessages) {
    messages.push(
      communicationScheduledMessageSchema.parse({
        timezone,
        eventId: null,
        eventTitle: `Audition: ${message.auditionName}`,
        id: message.id,
        kind: message.kind === "audition_reminder" ? "audition_reminder" : "audition_confirmation",
        recipientCount: 1,
        scheduledAt: message.scheduledAt,
        status: notificationStatus(message, now),
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
    const parts = job.idempotencyKey.split(":");
    const eventId = (parts.at(-2) === "retry" ? parts.at(-3) : parts.at(-1)) ?? "";
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
        timezone,
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
  messages.push(...upcomingCommunications(storage, organizationId, now));
  messages.sort((left, right) => {
    if (left.status === "Scheduled" && right.status !== "Scheduled") return -1;
    if (right.status === "Scheduled" && left.status !== "Scheduled") return 1;
    return (
      (left.status === "Scheduled" ? 1 : -1) *
      (Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt))
    );
  });
  return Response.json({ messages: messages.slice(0, 200) });
}
