import { deliveryJobSchema, type DeliveryJob } from "../jobs/contracts";

import { z } from "zod";

const retryJobRequestSchema = deliveryJobSchema.extend({
  actorUserId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

interface StoredJobRow {
  readonly [column: string]: SqlStorageValue;
  readonly attempt: number;
  readonly jobId: string;
  readonly kind: DeliveryJob["kind"];
  readonly lastErrorCode: string;
  readonly status: "claimed" | "completed" | "failed";
  readonly terminalAt: string | null;
}

interface OutboxRow {
  readonly [column: string]: SqlStorageValue;
  readonly enqueuedAt: string | null;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly kind: DeliveryJob["kind"];
}

type PreparationResult =
  { readonly code: string; readonly ok: false; readonly status: 404 | 409 } | { readonly ok: true };

function failure(code: string, status: 404 | 409): PreparationResult {
  return { code, ok: false, status };
}

function keyRemainder(key: string, prefix: string): string | null {
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

function keyIdentifier(key: string, prefix: string): string | null {
  const remainder = keyRemainder(key, prefix);
  if (!remainder) return null;
  const identifier = remainder.split(":", 1)[0] ?? "";
  return identifier.length > 0 ? identifier : null;
}

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

function prepareCommunicationRetry(
  storage: DurableObjectStorage,
  job: DeliveryJob,
): PreparationResult {
  const messageId = keyIdentifier(job.idempotencyKey, "communication:");
  if (!messageId || !z.uuid().safeParse(messageId).success) {
    return failure("communication_job_invalid", 409);
  }
  const message = storage.sql
    .exec<{ readonly id: string; readonly status: string }>(
      "SELECT id, status FROM communication_messages WHERE id = ? LIMIT 1",
      messageId,
    )
    .toArray()
    .at(0);
  const retryableDeliveries = storage.sql
    .exec<{ readonly count: number }>(
      `SELECT COUNT(*) AS count FROM communication_deliveries
       WHERE message_id = ? AND status IN ('failed', 'processing', 'queued')`,
      messageId,
    )
    .one().count;
  if (!message || message.status === "Draft" || retryableDeliveries === 0) {
    return failure("communication_job_not_retryable", 409);
  }
  storage.sql.exec(
    `UPDATE communication_deliveries
     SET status = 'queued', failure_detail = '', provider_message_id = NULL, updated_at = ?
     WHERE message_id = ? AND status IN ('failed', 'processing')`,
    new Date().toISOString(),
    messageId,
  );
  storage.sql.exec(
    "UPDATE communication_messages SET status = 'Queued', updated_at = ? WHERE id = ?",
    new Date().toISOString(),
    messageId,
  );
  return { ok: true };
}

function prepareNotificationRetry(
  storage: DurableObjectStorage,
  job: DeliveryJob,
  kind: "audition_notification" | "ticket_notification",
): PreparationResult {
  const prefix =
    kind === "audition_notification" ? "audition-notification:" : "ticket-notification:";
  const notificationId = keyIdentifier(job.idempotencyKey, prefix);
  if (!notificationId || !z.uuid().safeParse(notificationId).success) {
    return failure(`${kind}_job_invalid`, 409);
  }
  const table =
    kind === "audition_notification" ? "audition_notifications" : "ticket_notifications";
  const row = storage.sql
    .exec<{ readonly id: string; readonly status: string }>(
      `SELECT id, status FROM ${table} WHERE id = ? LIMIT 1`,
      notificationId,
    )
    .toArray()
    .at(0);
  if (!row || !["failed", "processing", "queued"].includes(row.status)) {
    return failure(`${kind}_job_not_retryable`, 409);
  }
  storage.sql.exec(
    `UPDATE ${table}
     SET status = 'queued', failure_detail = '', provider_message_id = NULL,
       sent_at = NULL, updated_at = ?
     WHERE id = ? AND status IN ('failed', 'processing')`,
    new Date().toISOString(),
    notificationId,
  );
  return { ok: true };
}

function preparePaymentNotificationRetry(
  storage: DurableObjectStorage,
  job: DeliveryJob,
): PreparationResult {
  if (!job.idempotencyKey.startsWith("payment-notification:")) {
    return failure("payment_notification_job_invalid", 409);
  }
  const row = storage.sql
    .exec<{ readonly id: string; readonly status: string }>(
      "SELECT id, status FROM payment_notifications WHERE id = ? LIMIT 1",
      job.jobId,
    )
    .toArray()
    .at(0);
  if (!row || !["failed", "processing", "queued"].includes(row.status)) {
    return failure("payment_notification_job_not_retryable", 409);
  }
  storage.sql.exec(
    `UPDATE payment_notifications
     SET status = 'queued', failure_detail = '', provider_message_id = NULL,
       sent_at = NULL, updated_at = ?
     WHERE id = ? AND status IN ('failed', 'processing')`,
    new Date().toISOString(),
    job.jobId,
  );
  return { ok: true };
}

function prepareExportRetry(storage: DurableObjectStorage, job: DeliveryJob): PreparationResult {
  if (job.idempotencyKey !== `organization-export:${job.jobId}`) {
    return failure("organization_export_job_invalid", 409);
  }
  const row = storage.sql
    .exec<{ readonly id: string; readonly status: string }>(
      "SELECT id, status FROM organization_exports WHERE id = ? LIMIT 1",
      job.jobId,
    )
    .toArray()
    .at(0);
  if (!row || !["failed", "processing", "queued"].includes(row.status)) {
    return failure("organization_export_job_not_retryable", 409);
  }
  storage.sql.exec(
    `UPDATE organization_exports
     SET status = 'queued', error_code = '', archive_key = NULL, byte_count = NULL,
       checksum_sha256 = NULL, updated_at = ?
     WHERE id = ? AND status IN ('failed', 'processing')`,
    new Date().toISOString(),
    job.jobId,
  );
  return { ok: true };
}

function prepareScheduledRetry(storage: DurableObjectStorage, job: DeliveryJob): PreparationResult {
  const organizationId = identity(storage);
  if (!organizationId) return failure("organization_not_provisioned", 404);
  if (job.kind === "event_reminder" || job.kind === "rsvp_follow_up") {
    const prefix = `${job.kind === "event_reminder" ? "event-reminder" : "rsvp-follow-up"}:${organizationId}:`;
    const eventId = keyRemainder(job.idempotencyKey, prefix)?.split(":retry:", 1)[0] ?? null;
    if (!eventId) return failure(`${job.kind}_job_invalid`, 409);
    const event = storage.sql
      .exec<{ readonly id: string }>("SELECT id FROM events WHERE id = ? LIMIT 1", eventId)
      .toArray()
      .at(0);
    if (!event) return failure(`${job.kind}_job_not_found`, 404);
    if (job.kind === "event_reminder") {
      storage.sql.exec("UPDATE events SET reminder_sent_at = NULL WHERE id = ?", eventId);
    }
    return { ok: true };
  }
  if (job.kind === "attendance_report") {
    const prefix = `post-event-report:${organizationId}:`;
    const eventId = keyIdentifier(job.idempotencyKey, prefix);
    if (!eventId) return failure("attendance_report_job_invalid", 409);
    const event = storage.sql
      .exec<{ readonly id: string }>(
        "SELECT id FROM events WHERE id = ? AND type = 'Performance' LIMIT 1",
        eventId,
      )
      .toArray()
      .at(0);
    return event ? { ok: true } : failure("attendance_report_job_not_found", 404);
  }
  if (job.kind === "stale_checkout_cleanup") {
    return job.idempotencyKey.startsWith(`scheduler:${organizationId}:stale_checkout_cleanup:`)
      ? { ok: true }
      : failure("stale_checkout_cleanup_job_invalid", 409);
  }
  return failure("job_kind_not_retryable", 409);
}

function prepareRetry(storage: DurableObjectStorage, job: DeliveryJob): PreparationResult {
  switch (job.kind) {
    case "communication_delivery":
      return prepareCommunicationRetry(storage, job);
    case "audition_notification":
      return prepareNotificationRetry(storage, job, "audition_notification");
    case "ticket_notification":
      return prepareNotificationRetry(storage, job, "ticket_notification");
    case "payment_notification":
      return preparePaymentNotificationRetry(storage, job);
    case "organization_export":
      return prepareExportRetry(storage, job);
    case "attendance_report":
    case "event_reminder":
    case "rsvp_follow_up":
    case "stale_checkout_cleanup":
      return prepareScheduledRetry(storage, job);
  }
}

// eslint-disable-next-line complexity -- validates and prepares each supported stored job kind before one bounded enqueue.
export async function retryJobInStore(
  storage: DurableObjectStorage,
  queue: Queue<DeliveryJob>,
  input: unknown,
): Promise<Response> {
  const parsed = retryJobRequestSchema.safeParse(input);
  if (!parsed.success) return Response.json({ code: "invalid_retry_job" }, { status: 400 });
  const job = parsed.data;
  if (identity(storage) !== job.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }

  const outbox = storage.sql
    .exec<OutboxRow>(
      `SELECT job_id AS jobId, kind, idempotency_key AS idempotencyKey, enqueued_at AS enqueuedAt
       FROM scheduled_job_outbox WHERE job_id = ? LIMIT 1`,
      job.jobId,
    )
    .toArray()
    .at(0);
  if (!outbox) {
    return Response.json({ code: "job_identity_conflict" }, { status: 409 });
  }
  if (outbox.kind !== job.kind || outbox.idempotencyKey !== job.idempotencyKey) {
    return Response.json({ code: "job_identity_conflict" }, { status: 409 });
  }

  const ledger = storage.sql
    .exec<StoredJobRow>(
      `SELECT job_id AS jobId, kind, status, attempt,
         terminal_at AS terminalAt, last_error_code AS lastErrorCode
       FROM job_ledger WHERE idempotency_key = ? LIMIT 1`,
      job.idempotencyKey,
    )
    .toArray()
    .at(0);
  if (!ledger) {
    return Response.json({ code: "job_ledger_not_found" }, { status: 409 });
  }
  if (ledger.jobId !== job.jobId || ledger.kind !== job.kind) {
    return Response.json({ code: "job_ledger_not_found" }, { status: 409 });
  }
  if (ledger.status === "completed") {
    return Response.json({ code: "job_already_completed" }, { status: 409 });
  }
  if (
    ledger.attempt === 0 &&
    ledger.lastErrorCode === "platform_retry_queued" &&
    outbox.enqueuedAt !== null
  ) {
    return Response.json({ retryQueued: true });
  }
  if (ledger.status !== "failed") {
    return Response.json({ code: "job_not_failed" }, { status: 409 });
  }

  const preparation = prepareRetry(storage, job);
  if (!preparation.ok) {
    return Response.json({ code: preparation.code }, { status: preparation.status });
  }

  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE job_ledger
       SET status = 'failed', attempt = 0, claimed_at = ?, completed_at = NULL,
         failed_at = ?, terminal_at = NULL, last_error_code = 'platform_retry_queued'
       WHERE idempotency_key = ? AND job_id = ? AND status = 'failed'`,
      now,
      now,
      job.idempotencyKey,
      job.jobId,
    );
    storage.sql.exec(
      "UPDATE scheduled_job_outbox SET enqueued_at = NULL WHERE job_id = ?",
      job.jobId,
    );
    storage.sql.exec(
      `INSERT OR IGNORE INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'platform_administrator', ?, 'organization.job.retry_requested',
         'job', ?, ?, ?, ?)`,
      `platform-job-retry:${job.jobId}:${job.requestId}`,
      job.actorUserId,
      job.jobId,
      job.requestId,
      JSON.stringify({ idempotencyKey: job.idempotencyKey, kind: job.kind }),
      now,
    );
  });

  try {
    await queue.send({
      attempt: 1,
      idempotencyKey: job.idempotencyKey,
      jobId: job.jobId,
      kind: job.kind,
      organizationId: job.organizationId,
      version: 1,
    });
  } catch {
    await storage.setAlarm(Date.now() + 60_000);
    return Response.json({ code: "queue_unavailable" }, { status: 503 });
  }

  storage.sql.exec(
    "UPDATE scheduled_job_outbox SET enqueued_at = ? WHERE job_id = ? AND enqueued_at IS NULL",
    now,
    job.jobId,
  );
  return Response.json({ retryQueued: true });
}
