import type { communicationSendRequestSchema } from "@choir/contracts";
import { communicationTemplateSchema } from "@choir/contracts";
import { communicationReach } from "@choir/domain";
import type { z } from "zod";

import type {
  cancelOperationSchema,
  deliveryResultOperationSchema,
  deleteDraftOperationSchema,
  deleteTemplateOperationSchema,
  recipientSchema,
  retryOperationSchema,
  saveOperationSchema,
  saveTemplateOperationSchema,
  sendOperationSchema,
  updateTemplateOperationSchema,
} from "./contracts";
import { MAX_COMMUNICATION_DELIVERIES, type TemplateRow } from "./contracts";
import { audit, readMessage } from "./shared";

function deliveryRows(
  message: z.infer<typeof communicationSendRequestSchema>,
  recipients: readonly z.infer<typeof recipientSchema>[],
  messageId: string,
  now: string,
) {
  const seen = new Set<string>();
  return recipients.flatMap((recipient) => {
    const values: { channel: "email" | "sms"; destination: string }[] = [];
    if (message.channel !== "SMS" && recipient.email) {
      values.push({ channel: "email", destination: recipient.email });
    }
    if (message.channel !== "Email" && recipient.phone) {
      values.push({ channel: "sms", destination: recipient.phone });
    }
    return values.flatMap((value) => {
      const key = `${recipient.profileId}:${value.channel}:${value.destination.trim().toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          ...value,
          id: crypto.randomUUID(),
          messageId,
          now,
          recipient,
        },
      ];
    });
  });
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
  const reach = communicationReach(operation.recipients, operation.message.channel);
  if (reach.total === 0)
    return Response.json({ code: "communication_has_no_recipients" }, { status: 409 });
  const deliveries = deliveryRows(
    operation.message,
    operation.recipients,
    operation.messageId,
    now,
  );
  if (deliveries.length > MAX_COMMUNICATION_DELIVERIES) {
    return Response.json({ code: "communication_delivery_limit_exceeded" }, { status: 413 });
  }
  const inserted = storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT${operation.dedupeKey ? " OR IGNORE" : ""} INTO communication_messages
        (id, channel, status, subject, content_markdown, audience_json, reach_json,
         created_by, created_at, updated_at, queued_at, dedupe_key)
       VALUES (?, ?, 'Queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      operation.messageId,
      operation.message.channel,
      operation.message.subject,
      operation.message.contentMarkdown,
      JSON.stringify(operation.message.audience),
      JSON.stringify(reach),
      operation.actorUserId,
      now,
      now,
      now,
      operation.dedupeKey ?? null,
    );
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
      return false;
    }
    for (const delivery of deliveries) {
      storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status,
           created_at, updated_at, unsubscribe_url)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
        delivery.id,
        delivery.messageId,
        delivery.recipient.profileId,
        delivery.recipient.name,
        delivery.channel,
        delivery.destination,
        delivery.now,
        delivery.now,
        delivery.channel === "email" ? delivery.recipient.unsubscribeUrl : null,
      );
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
    return true;
  });
  if (!inserted) {
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
  await storage.setAlarm(Date.now() + 1);
  return Response.json(readMessage(storage, operation.messageId));
}

export function saveDraft(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveOperationSchema>,
  now: string,
): Response {
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO communication_messages
        (id, channel, status, subject, content_markdown, audience_json, reach_json,
         created_by, created_at, updated_at)
       VALUES (?, ?, 'Draft', ?, ?, ?, ?, ?, ?, ?)`,
      operation.messageId,
      operation.message.channel,
      operation.message.subject,
      operation.message.contentMarkdown,
      JSON.stringify(operation.message.audience),
      JSON.stringify(operation.reach),
      operation.actorUserId,
      now,
      now,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.draft.saved",
      operation.messageId,
      { channel: operation.message.channel },
      now,
    );
  });
  return Response.json(readMessage(storage, operation.messageId));
}

export function saveTemplate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveTemplateOperationSchema>,
  now: string,
): Response {
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      operation.templateId,
      operation.template.title,
      operation.template.channel,
      operation.template.subject,
      operation.template.contentMarkdown,
      now,
      now,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.saved",
      operation.templateId,
      { channel: operation.template.channel, title: operation.template.title },
      now,
      "communication_template",
    );
  });
  const row = storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
        is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates WHERE id = ? LIMIT 1`,
      operation.templateId,
    )
    .one();
  return Response.json(communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }));
}

export function updateTemplate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof updateTemplateOperationSchema>,
  now: string,
): Response {
  const found = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM communication_templates WHERE id = ? LIMIT 1",
      operation.templateId,
    )
    .toArray()
    .at(0);
  if (!found) return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE communication_templates
       SET title = ?, channel = ?, subject = ?, content_markdown = ?, updated_at = ?
       WHERE id = ?`,
      operation.template.title,
      operation.template.channel,
      operation.template.subject,
      operation.template.contentMarkdown,
      now,
      operation.templateId,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.updated",
      operation.templateId,
      { channel: operation.template.channel, title: operation.template.title },
      now,
      "communication_template",
    );
  });
  const row = storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
        is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates WHERE id = ? LIMIT 1`,
      operation.templateId,
    )
    .one();
  return Response.json(communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }));
}

export function deleteTemplate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof deleteTemplateOperationSchema>,
  now: string,
): Response {
  const found = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly isSystem: number }>(
      "SELECT is_system AS isSystem FROM communication_templates WHERE id = ? LIMIT 1",
      operation.templateId,
    )
    .toArray()
    .at(0);
  if (!found) return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  if (found.isSystem === 1)
    return Response.json({ code: "communication_system_template_protected" }, { status: 409 });
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM communication_templates WHERE id = ?", operation.templateId);
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.deleted",
      operation.templateId,
      {},
      now,
      "communication_template",
    );
  });
  return Response.json({ id: operation.templateId, status: "deleted" });
}

export function deleteDraft(
  storage: DurableObjectStorage,
  operation: z.infer<typeof deleteDraftOperationSchema>,
  now: string,
): Response {
  const message = readMessage(storage, operation.messageId);
  if (message?.status !== "Draft")
    return Response.json({ code: "communication_draft_not_found" }, { status: 404 });
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM communication_messages WHERE id = ?", operation.messageId);
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.draft.deleted",
      operation.messageId,
      {},
      now,
    );
  });
  return Response.json({ id: operation.messageId, status: "deleted" });
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
      `UPDATE communication_deliveries SET status = 'queued', failure_detail = '', updated_at = ?
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
  await storage.setAlarm(Date.now() + 1);
  return Response.json({ messageId: operation.messageId, retried: failed });
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
         WHERE id = ? AND message_id = ? AND status IN ('queued', 'processing')`,
        result.status,
        result.providerMessageId,
        result.status,
        result.providerMessageId,
        result.failureDetail,
        now,
        now,
        result.deliveryId,
        messageId,
      );
    }
    const counts = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly failed: number;
        readonly remaining: number;
        readonly sent: number;
      }>(
        `SELECT SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS remaining,
          SUM(CASE WHEN status IN ('sent', 'suppressed') THEN 1 ELSE 0 END) AS sent
         FROM communication_deliveries WHERE message_id = ?`,
        messageId,
      )
      .one();
    const status = counts.remaining > 0 ? "Queued" : counts.sent > 0 ? "Sent" : "Failed";
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
