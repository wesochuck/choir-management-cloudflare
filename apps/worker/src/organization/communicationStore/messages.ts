import type {
  communicationSendRequestSchema,
  CommunicationRecipientSubject,
} from "@choir/contracts";
import {
  communicationRecipientSubjectFromLegacy,
  communicationRecipientSubjectSchema,
} from "@choir/contracts";
import { communicationReach, normalizeEmail } from "@choir/domain";
import type { z } from "zod";

import type {
  cancelOperationSchema,
  deliveryResultOperationSchema,
  recipientSchema,
  retryOperationSchema,
  sendOperationSchema,
} from "./contracts";
import { MAX_COMMUNICATION_DELIVERIES } from "./contracts";
import {
  insertQueuedMessage,
  targetEventPurchaseExists,
  updateReviewedDraftForSend,
} from "./drafts";
import { audit, readMessage } from "./shared";
import { wakeOrganizationAlarm } from "../scheduler";
import { insertNotificationReceipt } from "../notificationInboxStore";

function deliveryRows(
  message: z.infer<typeof communicationSendRequestSchema>,
  recipients: readonly z.infer<typeof recipientSchema>[],
  messageId: string,
  now: string,
) {
  const seen = new Set<string>();
  return recipients.flatMap((recipient) => {
    const subject: CommunicationRecipientSubject =
      recipient.subject ?? communicationRecipientSubjectFromLegacy(recipient.profileId);
    const values: { channel: "email" | "sms"; destination: string }[] = [];
    if (message.channel !== "SMS" && recipient.email) {
      values.push({ channel: "email", destination: recipient.email });
    }
    if (message.channel !== "Email" && recipient.phone) {
      values.push({ channel: "sms", destination: recipient.phone });
    }
    return values.flatMap((value) => {
      const key = `${subject.kind}:${recipient.profileId}:${value.channel}:${value.destination.trim().toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          ...value,
          id: crypto.randomUUID(),
          messageId,
          now,
          recipient,
          subject,
        },
      ];
    });
  });
}

function promotionAudienceChangedByPurchase(
  storage: DurableObjectStorage,
  operation: z.infer<typeof sendOperationSchema>,
): boolean {
  const promotion = operation.message.eventPromotion;
  const excludedEventId = operation.message.audience.excludeTicketBuyersForEventId;
  if (!promotion || excludedEventId !== promotion.eventId) return false;

  const emailAddresses = [
    ...new Set(
      operation.recipients
        .map((recipient) => normalizeEmail(recipient.email))
        .filter((email) => email.length > 0),
    ),
  ];
  const contactIds = [
    ...new Set(
      operation.recipients.flatMap((recipient) => {
        const subject =
          recipient.subject ?? communicationRecipientSubjectFromLegacy(recipient.profileId);
        return subject.kind === "contact" ? [subject.contactId] : [];
      }),
    ),
  ];
  return (
    targetEventPurchaseExists(storage, excludedEventId, "normalized_buyer_email", emailAddresses) ||
    targetEventPurchaseExists(storage, excludedEventId, "contact_id", contactIds)
  );
}

export async function sendMessage(
  storage: DurableObjectStorage,
  operation: z.infer<typeof sendOperationSchema>,
  now: string,
): Promise<Response> {
  if (operation.dedupeKey) {
    const existing = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        "SELECT id FROM communication_messages WHERE dedupe_key = ? LIMIT 1",
        operation.dedupeKey,
      )
      .toArray()
      .at(0);
    if (existing) {
      const message = readMessage(storage, existing.id);
      if (!message) throw new Error("The deduplicated communication message could not be read.");
      return Response.json(message);
    }
  }
  const reach = communicationReach(
    operation.recipients,
    operation.message.channel,
    operation.undeliverableTicketBuyerPurchases,
    operation.ticketBuyerPurchasesOverLimit,
    operation.audienceOverLimit,
  );
  if (reach.total === 0)
    return Response.json({ code: "communication_has_no_recipients" }, { status: 409 });
  if (operation.message.eventPromotion && operation.message.messageId !== operation.messageId) {
    return Response.json({ code: "event_promotion_draft_required" }, { status: 409 });
  }
  const deliveries = deliveryRows(
    operation.message,
    operation.recipients,
    operation.messageId,
    now,
  );
  if (deliveries.length > MAX_COMMUNICATION_DELIVERIES) {
    return Response.json({ code: "communication_delivery_limit_exceeded" }, { status: 413 });
  }
  const isPromotion = Boolean(operation.message.eventPromotion);
  const isReviewedDraft = isPromotion || Boolean(operation.message.reviewSnapshot);
  const inserted = storage.transactionSync(() => {
    if (isPromotion && promotionAudienceChangedByPurchase(storage, operation)) {
      return "promotion_review_stale";
    }
    if (isReviewedDraft && !updateReviewedDraftForSend(storage, operation, reach, now))
      return "draft_conflict";
    if (isPromotion) {
      storage.sql.exec(
        "UPDATE event_communication_links SET operation_key = NULL WHERE message_id = ?",
        operation.messageId,
      );
    }
    if (!isReviewedDraft) insertQueuedMessage(storage, operation, reach, now);
    const persisted = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        operation.dedupeKey
          ? "SELECT id FROM communication_messages WHERE dedupe_key = ? LIMIT 1"
          : "SELECT id FROM communication_messages WHERE id = ? LIMIT 1",
        operation.dedupeKey ?? operation.messageId,
      )
      .toArray()
      .at(0);
    if (!persisted) throw new Error("The communication message was not persisted.");
    if (persisted.id !== operation.messageId) {
      return "dedupe_conflict";
    }
    for (const delivery of deliveries) {
      storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status,
           created_at, updated_at, unsubscribe_url, recipient_subject_json)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
        delivery.id,
        delivery.messageId,
        delivery.recipient.profileId,
        delivery.recipient.name,
        delivery.channel,
        delivery.destination,
        delivery.now,
        delivery.now,
        delivery.channel === "email" ? delivery.recipient.unsubscribeUrl : null,
        JSON.stringify(delivery.subject),
      );
    }
    if (operation.inboxNotification) {
      const uniqueProfileIds = [...new Set(deliveries.map((d) => d.recipient.profileId))];
      for (const profileId of uniqueProfileIds) {
        insertNotificationReceipt(storage, {
          body: operation.inboxNotification.body,
          destinationPath: operation.inboxNotification.destinationPath,
          kind: operation.inboxNotification.kind,
          now,
          originalOccurredAt: operation.inboxNotification.originalOccurredAt,
          recipientProfileId: profileId,
          sourceKey: operation.inboxNotification.sourceKey,
          title: operation.inboxNotification.title,
        });
      }
    }
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'communication_delivery', ?, ?, ?)`,
      operation.jobId,
      `communication:${operation.messageId}:initial`,
      now,
      now,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.queued",
      operation.messageId,
      { channel: operation.message.channel, deliveryCount: deliveries.length, reach },
      now,
      "communication_message",
      operation.actorType,
    );
    return "queued";
  });
  if (inserted !== "queued") {
    if (inserted === "promotion_review_stale") {
      return Response.json({ code: "event_promotion_review_stale" }, { status: 409 });
    }
    if (inserted === "draft_conflict") {
      return Response.json({ code: "communication_draft_revision_conflict" }, { status: 409 });
    }
    const existing = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        "SELECT id FROM communication_messages WHERE dedupe_key = ? LIMIT 1",
        operation.dedupeKey,
      )
      .toArray()
      .at(0);
    if (!existing) throw new Error("The deduplicated communication message could not be read.");
    const message = readMessage(storage, existing.id);
    if (!message) throw new Error("The deduplicated communication message could not be read.");
    return Response.json(message);
  }
  await wakeOrganizationAlarm(storage);
  return Response.json(readMessage(storage, operation.messageId));
}

export function cancelMessage(
  storage: DurableObjectStorage,
  operation: z.infer<typeof cancelOperationSchema>,
  now: string,
): Response {
  return storage.transactionSync(() => {
    const current = storage.sql
      .exec<{
        readonly canceledAt: string | null;
        readonly status: "Draft" | "Failed" | "Queued" | "Sent";
      }>(
        `SELECT status, canceled_at AS canceledAt
         FROM communication_messages WHERE id = ? LIMIT 1`,
        operation.messageId,
      )
      .toArray()
      .at(0);
    if (!current) {
      return Response.json({ code: "communication_message_not_found" }, { status: 404 });
    }
    if (current.canceledAt) {
      const message = readMessage(storage, operation.messageId);
      if (!message) {
        return Response.json({ code: "communication_message_not_found" }, { status: 404 });
      }
      return Response.json(message);
    }
    if (current.status !== "Queued") {
      return Response.json({ code: "communication_message_not_queued" }, { status: 409 });
    }
    const activeDeliveries = storage.sql
      .exec<{ readonly count: number }>(
        `SELECT COUNT(*) AS count FROM communication_deliveries
         WHERE message_id = ? AND status IN ('processing', 'sent')`,
        operation.messageId,
      )
      .one().count;
    if (activeDeliveries > 0) {
      return Response.json({ code: "communication_delivery_started" }, { status: 409 });
    }
    storage.sql.exec(
      `UPDATE communication_deliveries
       SET status = 'suppressed', failure_detail = 'Canceled before delivery', updated_at = ?
       WHERE message_id = ? AND status IN ('queued', 'failed')`,
      now,
      operation.messageId,
    );
    storage.sql.exec(
      `UPDATE communication_messages
       SET status = 'Failed', canceled_at = ?, sent_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'Queued' AND canceled_at IS NULL`,
      now,
      now,
      operation.messageId,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.canceled",
      operation.messageId,
      {},
      now,
    );
    const message = readMessage(storage, operation.messageId);
    if (!message) {
      return Response.json({ code: "communication_message_not_found" }, { status: 404 });
    }
    return Response.json(message);
  });
}

export async function retryMessage(
  storage: DurableObjectStorage,
  operation: z.infer<typeof retryOperationSchema>,
  now: string,
): Promise<Response> {
  const message = readMessage(storage, operation.messageId);
  if (!message || message.status === "Draft")
    return Response.json({ code: "communication_message_not_found" }, { status: 404 });
  const failed = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM communication_deliveries WHERE message_id = ? AND status = 'failed'",
      operation.messageId,
    )
    .one().count;
  if (failed === 0)
    return Response.json({ code: "communication_has_no_failed_deliveries" }, { status: 409 });
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE communication_deliveries SET status = 'queued', delivery_job_id = NULL, failure_detail = '', updated_at = ?
       WHERE message_id = ? AND status = 'failed'`,
      now,
      operation.messageId,
    );
    storage.sql.exec(
      "UPDATE communication_messages SET status = 'Queued', updated_at = ? WHERE id = ?",
      now,
      operation.messageId,
    );
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'communication_delivery', ?, ?, ?)`,
      operation.jobId,
      `communication:${operation.messageId}:retry:${operation.requestId}`,
      now,
      now,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.retry.queued",
      operation.messageId,
      { deliveryCount: failed },
      now,
    );
  });
  await wakeOrganizationAlarm(storage);
  return Response.json({ messageId: operation.messageId, retried: failed });
}

function resolveRecipientContactId(
  storage: DurableObjectStorage,
  deliveryId: string,
): string | null {
  const row = storage.sql
    .exec<{
      readonly channel: string;
      readonly profile_id: string;
      readonly recipient_subject_json: string | null;
    }>(
      `SELECT channel, profile_id, recipient_subject_json
       FROM communication_deliveries WHERE id = ? LIMIT 1`,
      deliveryId,
    )
    .toArray()
    .at(0);
  if (row?.channel !== "email") return null;
  if (row.recipient_subject_json) {
    try {
      const parsed = communicationRecipientSubjectSchema.safeParse(
        JSON.parse(row.recipient_subject_json) as unknown,
      );
      if (parsed.success && parsed.data.kind === "contact") {
        return parsed.data.contactId;
      }
    } catch {
      // Ignore invalid JSON
    }
  }
  if (row.profile_id) {
    const contact = storage.sql
      .exec<{ readonly id: string }>("SELECT id FROM contacts WHERE id = ? LIMIT 1", row.profile_id)
      .toArray()
      .at(0);
    if (contact) return contact.id;
  }
  return null;
}

function markDeliveredContactEmailPreference(
  storage: DurableObjectStorage,
  deliveryId: string,
  now: string,
): void {
  const contactId = resolveRecipientContactId(storage, deliveryId);
  if (!contactId) return;
  storage.sql.exec(
    `INSERT INTO contact_communication_preferences
      (contact_id, channel, status, source, observed_at, updated_at)
     VALUES (?, 'email', 'subscribed', 'email_delivered', ?, ?)
     ON CONFLICT(contact_id, channel) DO UPDATE SET
       status = CASE
         WHEN contact_communication_preferences.status = 'unsubscribed' THEN 'unsubscribed'
         ELSE 'subscribed'
       END,
       source = CASE
         WHEN contact_communication_preferences.status = 'unsubscribed'
           THEN contact_communication_preferences.source
         WHEN contact_communication_preferences.source IS NULL
           OR contact_communication_preferences.source = ''
           OR contact_communication_preferences.source = 'import'
           OR contact_communication_preferences.status != 'subscribed'
           THEN 'email_delivered'
         ELSE contact_communication_preferences.source
       END,
       observed_at = CASE
         WHEN contact_communication_preferences.status != 'unsubscribed' THEN excluded.observed_at
         ELSE contact_communication_preferences.observed_at
       END,
       updated_at = CASE
         WHEN contact_communication_preferences.status != 'unsubscribed' THEN excluded.updated_at
         ELSE contact_communication_preferences.updated_at
       END`,
    contactId,
    now,
    now,
  );
}

export function recordDeliveryResults(
  storage: DurableObjectStorage,
  operation: z.infer<typeof deliveryResultOperationSchema>,
  now: string,
): Response {
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'communication_delivery' LIMIT 1`,
      operation.jobId,
    )
    .toArray()
    .at(0);
  if (!job) return Response.json({ code: "communication_job_not_found" }, { status: 404 });
  const messageId = job.idempotencyKey.split(":")[1];
  if (!messageId) return Response.json({ code: "communication_job_invalid" }, { status: 409 });
  storage.transactionSync(() => {
    for (const result of operation.results) {
      storage.sql.exec(
        `UPDATE communication_deliveries
         SET status = ?, attempts = attempts + 1, provider_message_id = ?,
           provider_status = CASE
             WHEN ? = 'sent' AND ? IS NOT NULL AND provider_status IS NULL THEN 'accepted'
             ELSE provider_status END,
           failure_detail = ?,
           last_attempt_at = ?, updated_at = ?
         WHERE id = ? AND message_id = ? AND status IN ('queued', 'processing')
           AND (delivery_job_id = ? OR delivery_job_id IS NULL)`,
        result.status,
        result.providerMessageId,
        result.status,
        result.providerMessageId,
        result.failureDetail,
        now,
        now,
        result.deliveryId,
        messageId,
        operation.jobId,
      );
      if (result.status === "sent") {
        markDeliveredContactEmailPreference(storage, result.deliveryId, now);
      }
    }
    const hasStatus = (statuses: readonly string[]) =>
      storage.sql
        .exec<{ readonly found: number }>(
          `SELECT 1 AS found FROM communication_deliveries
       WHERE message_id = ? AND status IN (SELECT value FROM json_each(?)) LIMIT 1`,
          messageId,
          JSON.stringify(statuses),
        )
        .toArray().length > 0;
    const status = hasStatus(["queued", "processing"])
      ? "Queued"
      : hasStatus(["sent", "suppressed"])
        ? "Sent"
        : "Failed";
    storage.sql.exec(
      `UPDATE communication_messages SET status = ?, sent_at = CASE WHEN ? = 'Sent' THEN ? ELSE sent_at END,
        updated_at = ? WHERE id = ? AND canceled_at IS NULL`,
      status,
      status,
      now,
      now,
      messageId,
    );
  });
  return Response.json({ recorded: true });
}
