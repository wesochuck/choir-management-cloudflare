import type { z } from "zod";

import { readTicketMessageTemplate } from "../ticketMessageTemplates";
import type {
  resendConfirmationOperationSchema,
  ticketNotificationResultOperationSchema,
} from "../ticketingStore/contracts";
import { purchaseSelect, type TicketPurchaseRow } from "../ticketingStore/contracts";

export function queueTicketConfirmation(
  storage: DurableObjectStorage,
  purchase: TicketPurchaseRow,
  occurredAt: string,
): boolean {
  const dedupeKey = `ticket-confirmation:${purchase.id}`;
  const existing = storage.sql
    .exec<{ readonly id: string }>(
      "SELECT id FROM ticket_notifications WHERE dedupe_key = ? LIMIT 1",
      dedupeKey,
    )
    .toArray()
    .at(0);
  if (existing) return false;

  const notificationTemplate = readTicketMessageTemplate(
    storage,
    purchase.bundleId ? "bundle_confirmation" : "confirmation",
  );
  const notificationId = crypto.randomUUID();
  storage.sql.exec(
    `INSERT INTO ticket_notifications
      (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
       content_markdown, status, scheduled_for, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'confirmation', ?, ?, ?, 'queued', ?, ?, ?)`,
    notificationId,
    purchase.id,
    purchase.bundleId ? null : purchase.eventId,
    dedupeKey,
    purchase.buyerEmail,
    notificationTemplate.subject,
    notificationTemplate.contentMarkdown,
    occurredAt,
    occurredAt,
    occurredAt,
  );
  storage.sql.exec(
    `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
     VALUES (?, 'ticket_notification', ?, ?, ?)`,
    crypto.randomUUID(),
    `ticket-notification:${notificationId}`,
    occurredAt,
    occurredAt,
  );
  return true;
}

export function recordTicketNotificationResult(
  storage: DurableObjectStorage,
  operation: z.infer<typeof ticketNotificationResultOperationSchema>,
): Response {
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'ticket_notification' LIMIT 1`,
      operation.jobId,
    )
    .toArray()
    .at(0);
  const notificationId = job?.idempotencyKey.split(":")[1];
  if (!notificationId) {
    return Response.json({ code: "ticket_notification_not_found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  storage.sql.exec(
    `UPDATE ticket_notifications SET status = ?, attempts = attempts + 1,
      provider_message_id = ?,
      provider_status = CASE WHEN ? = 'sent' AND ? IS NOT NULL AND provider_status IS NULL THEN 'accepted' ELSE provider_status END,
      failure_detail = ?, updated_at = ?,
      sent_at = CASE WHEN ? IN ('sent', 'suppressed') THEN ? ELSE sent_at END
     WHERE id = ?`,
    operation.status,
    operation.providerMessageId,
    operation.status,
    operation.providerMessageId,
    operation.failureDetail,
    now,
    operation.status,
    now,
    notificationId,
  );
  return Response.json({ recorded: true });
}

export function resendTicketConfirmation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof resendConfirmationOperationSchema>,
): Response {
  const row = storage.sql
    .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, operation.purchaseId)
    .toArray()
    .at(0);
  if (!row) return Response.json({ code: "ticket_purchase_not_found" }, { status: 404 });
  if (row.status !== "paid") {
    return Response.json({ code: "ticket_purchase_not_confirmable" }, { status: 409 });
  }
  const notificationId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const notificationTemplate = readTicketMessageTemplate(
    storage,
    row.bundleId ? "bundle_confirmation" : "confirmation",
  );
  const recipientEmail = operation.recipientEmail ?? row.buyerEmail;
  if (!recipientEmail) {
    return Response.json({ code: "ticket_recipient_missing" }, { status: 400 });
  }
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO ticket_notifications
        (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
         content_markdown, status, scheduled_for, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'confirmation', ?, ?, ?, 'queued', ?, ?, ?)`,
      notificationId,
      row.id,
      row.bundleId ? null : row.eventId,
      `ticket-confirmation-resend:${row.id}:${operation.requestId}`,
      recipientEmail,
      notificationTemplate.subject,
      notificationTemplate.contentMarkdown,
      now,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'ticket_notification', ?, ?, ?)`,
      jobId,
      `ticket-notification:${notificationId}`,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'ticket.confirmation.queued',
        'ticket_purchase', ?, ?, '{}', ?)`,
      `ticket-confirmation-resend:${operation.requestId}`,
      operation.actorUserId,
      row.id,
      operation.requestId,
      now,
    );
  });
  return Response.json({ queued: true });
}
