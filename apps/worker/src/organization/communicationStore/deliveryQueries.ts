import type { SqlStorageValue } from "@cloudflare/workers-types";
import {
  communicationDeliveryRecipientSchema,
  communicationDeliverySummarySchema,
  communicationRecipientSubjectFromLegacy,
  communicationRecipientSubjectSchema,
} from "@choir/contracts";
import { summarizeCommunicationDeliveries } from "@choir/domain";
import { z } from "zod";

import { type DeliveryRow } from "./contracts";
import { eventCommunicationContext, identityMatches, readMessage } from "./shared";

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
             WHERE p.id IN (
               communication_deliveries.profile_id,
               (
                 SELECT linked_contact.profile_id
                 FROM contacts linked_contact
                 WHERE linked_contact.id = communication_deliveries.profile_id
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
           OR EXISTS (
             SELECT 1 FROM communication_messages m, profiles p
             WHERE m.id = communication_deliveries.message_id
               AND p.id IN (
                 communication_deliveries.profile_id,
                 (
                   SELECT linked_contact.profile_id
                   FROM contacts linked_contact
                   WHERE linked_contact.id = communication_deliveries.profile_id
                 )
               )
               AND json_extract(m.automation_json, '$.kind') = 'event_reminder'
               AND (
                 (
                   json_extract(m.automation_json, '$.eventType') = 'Rehearsal'
                   AND p.receive_rehearsal_reminders = 0
                 )
                 OR (
                   json_extract(m.automation_json, '$.eventType') = 'Performance'
                   AND p.receive_performance_reminders = 0
                 )
                 OR (
                   json_extract(m.automation_json, '$.eventType') NOT IN ('Rehearsal', 'Performance')
                   AND p.receive_other_event_reminders = 0
                 )
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
