import { z } from "zod";

const queueSchema = z.object({
  action: z.literal("queue_payment_notification"),
  contentMarkdown: z.string().max(100_000),
  dedupeKey: z.string().min(1).max(256),
  destination: z.email(),
  organizationId: z.string().min(1).max(128),
  paymentType: z.enum(["donation", "dues"]),
  recipientName: z.string().min(1).max(200),
  resourceId: z.uuid(),
  subject: z.string().min(1).max(300),
});
const resultSchema = z.object({
  action: z.literal("record_payment_notification_result"),
  failureDetail: z.string().max(2_000),
  jobId: z.uuid(),
  organizationId: z.string().min(1).max(128),
  providerMessageId: z.string().max(512).nullable(),
  status: z.enum(["failed", "sent", "suppressed"]),
});

function identity(storage: DurableObjectStorage): string | null {
  return (
    storage.sql
      .exec<{ readonly organizationId: string }>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId ?? null
  );
}

export function queuePaymentNotificationInStore(
  storage: DurableObjectStorage,
  input: unknown,
): Response {
  const request = queueSchema.safeParse(input);
  if (!request.success)
    return Response.json({ code: "invalid_payment_notification" }, { status: 400 });
  if (identity(storage) !== request.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const now = new Date().toISOString();
  const notificationId = crypto.randomUUID();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT OR IGNORE INTO payment_notifications
        (id, payment_type, resource_id, dedupe_key, destination, recipient_name,
         subject, content_markdown, status, scheduled_for, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      notificationId,
      request.data.paymentType,
      request.data.resourceId,
      request.data.dedupeKey,
      request.data.destination.toLowerCase(),
      request.data.recipientName,
      request.data.subject,
      request.data.contentMarkdown,
      now,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT OR IGNORE INTO scheduled_job_outbox
        (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'payment_notification', ?, ?, ?)`,
      notificationId,
      `payment-notification:${request.data.dedupeKey}`,
      now,
      now,
    );
  });
  return Response.json({ queued: true, notificationId });
}

export function readPaymentNotificationJobFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  jobId: string | null,
): Response {
  const parsedJobId = z.uuid().safeParse(jobId);
  if (identity(storage) !== organizationId || !parsedJobId.success) {
    return Response.json({ code: "payment_notification_not_found" }, { status: 404 });
  }
  const row = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly contentMarkdown: string;
      readonly destination: string;
      readonly id: string;
      readonly paymentType: "donation" | "dues";
      readonly recipientName: string;
      readonly resourceId: string;
      readonly status: "queued" | "processing";
      readonly subject: string;
      readonly providerEventAt: string | null;
      readonly providerMessageId: string | null;
      readonly providerReason: string;
      readonly providerStatus: string | null;
    }>(
      `SELECT id, payment_type AS paymentType, resource_id AS resourceId, destination,
        recipient_name AS recipientName, subject, content_markdown AS contentMarkdown, status,
        provider_event_at AS providerEventAt, provider_message_id AS providerMessageId,
        provider_reason AS providerReason, provider_status AS providerStatus
       FROM payment_notifications WHERE id = ? LIMIT 1`,
      parsedJobId.data,
    )
    .toArray()
    .at(0);
  if (!row || !["queued", "processing"].includes(row.status)) {
    return Response.json({ code: "payment_notification_not_found" }, { status: 404 });
  }
  storage.sql.exec(
    `UPDATE payment_notifications SET status = 'processing', attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND status = 'queued'`,
    new Date().toISOString(),
    row.id,
  );
  return Response.json(row);
}

export function recordPaymentNotificationResultInStore(
  storage: DurableObjectStorage,
  input: unknown,
): Response {
  const result = resultSchema.safeParse(input);
  if (!result.success)
    return Response.json({ code: "invalid_payment_notification_result" }, { status: 400 });
  if (identity(storage) !== result.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const sentAt = result.data.status === "sent" ? new Date().toISOString() : null;
  storage.sql.exec(
    `UPDATE payment_notifications
     SET status = ?, failure_detail = ?, provider_message_id = ?,
       provider_status = CASE WHEN ? = 'sent' AND ? IS NOT NULL AND provider_status IS NULL THEN 'accepted' ELSE provider_status END,
       sent_at = ?, updated_at = ?
     WHERE id = ?`,
    result.data.status,
    result.data.failureDetail,
    result.data.providerMessageId,
    result.data.status,
    result.data.providerMessageId,
    sentAt,
    new Date().toISOString(),
    result.data.jobId,
  );
  return Response.json({ recorded: true });
}
