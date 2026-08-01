import { deliveryJobSchema, type DeliveryJob } from "./contracts";
import {
  claimResponseSchema,
  completionResponseSchema,
  type DeadLetterConsumerEnv,
  deadLetterInsertSql,
  deliveryAttemptSchema,
  type JobConsumerEnv,
  recordEventReminderResult,
  recordJobFailure,
  retryDelaySeconds,
  terminalResponseSchema,
} from "./deliveries/shared";
import { deliverCommunicationJob } from "./deliveries/communication";
import {
  deliverScheduledEventCommunication,
  deliverAttendanceReportJob,
} from "./deliveries/scheduledEvents";
import { deliverTicketNotificationJob } from "./deliveries/tickets";
import { deliverAuditionNotificationJob } from "./deliveries/auditions";
import { deliverPaymentNotificationJob } from "./deliveries/payments";
import { deliverOrganizationExportJob } from "./deliveries/export";
import { cleanupStaleCheckout } from "./deliveries/cleanup";
// eslint-disable-next-line complexity -- dispatch keeps each queue kind's terminal/error semantics explicit.
async function dispatchDeliveryJob(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  if (job.kind === "communication_delivery") {
    await deliverCommunicationJob(env, job);
    return;
  }
  if (job.kind === "ticket_notification") {
    await deliverTicketNotificationJob(env, job);
    return;
  }
  if (job.kind === "audition_notification") {
    await deliverAuditionNotificationJob(env, job);
    return;
  }
  if (job.kind === "payment_notification") {
    await deliverPaymentNotificationJob(env, job);
    return;
  }
  if (job.kind === "organization_export") {
    await deliverOrganizationExportJob(env, job);
    return;
  }
  if (job.kind === "stale_checkout_cleanup") {
    await cleanupStaleCheckout(env, job);
    return;
  }
  if (job.kind === "event_reminder" || job.kind === "rsvp_follow_up") {
    // Older queue fixtures do not provide the control-plane binding. Deployed scheduled jobs
    // always do; keep those isolated fixtures focused on queue claiming semantics.
    if (
      !env.CONTROL_DB &&
      (env.EXTERNAL_EFFECTS_MODE === "fake" || env.EXTERNAL_EFFECTS_MODE === "disabled")
    ) {
      return;
    }
    await deliverScheduledEventCommunication(env, job, job.kind);
    return;
  }
  if (job.kind === "attendance_report") {
    if (
      !env.CONTROL_DB &&
      (env.EXTERNAL_EFFECTS_MODE === "fake" || env.EXTERNAL_EFFECTS_MODE === "disabled")
    ) {
      return;
    }
    await deliverAttendanceReportJob(env, job);
    return;
  }
}
async function processDeliveryMessage(message: Message, env: JobConsumerEnv): Promise<void> {
  const parsed = deliveryJobSchema.safeParse(message.body);
  if (!parsed.success) {
    console.error(JSON.stringify({ event: "invalid_queue_message", messageId: message.id }));
    message.ack();
    return;
  }
  const deliveryAttempt = deliveryAttemptSchema.safeParse(message.attempts);
  if (!deliveryAttempt.success) {
    console.error(JSON.stringify({ event: "invalid_queue_attempt", messageId: message.id }));
    message.ack();
    return;
  }

  const job: DeliveryJob = { ...parsed.data, attempt: deliveryAttempt.data };
  let claimed = false;
  try {
    const objectId = env.ORGANIZATION_STORE.idFromName(job.organizationId);
    const objectStub = env.ORGANIZATION_STORE.get(objectId);
    const claimResponse = await objectStub.fetch(
      "https://organization.internal/internal/jobs/claim",
      {
        body: JSON.stringify(job),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const claim = claimResponseSchema.safeParse(await claimResponse.json());
    if (!claimResponse.ok || !claim.success) {
      throw new Error("Organization store rejected queue claim");
    }
    if (!claim.data.claimed) {
      message.ack();
      return;
    }
    claimed = true;

    await dispatchDeliveryJob(env, job);

    const completeResponse = await objectStub.fetch(
      "https://organization.internal/internal/jobs/complete",
      {
        body: JSON.stringify({
          attempt: job.attempt,
          completedAt: new Date().toISOString(),
          idempotencyKey: job.idempotencyKey,
          jobId: job.jobId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const completion = completionResponseSchema.safeParse(await completeResponse.json());
    if (!completeResponse.ok || !completion.success || !completion.data.completed) {
      throw new Error("Organization store rejected queue completion");
    }

    if (job.kind === "event_reminder" && env.CONTROL_DB) {
      await recordEventReminderResult(env, job, "sent");
    }

    message.ack();
    console.info(
      JSON.stringify({
        event: "queue_job_completed",
        jobId: job.jobId,
        kind: job.kind,
        organizationId: job.organizationId,
      }),
    );
  } catch (error: unknown) {
    if (claimed) {
      await recordJobFailure(env, job);
    }
    console.error(
      JSON.stringify({
        errorType: error instanceof Error ? error.name : "UnknownError",
        event: "queue_job_failed",
        jobId: job.jobId,
        kind: job.kind,
        organizationId: job.organizationId,
      }),
    );
    message.retry({ delaySeconds: retryDelaySeconds(deliveryAttempt.data) });
  }
}

export async function processDeliveryBatch(
  batch: MessageBatch,
  env: JobConsumerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    await processDeliveryMessage(message, env);
  }
}

function createDeadLetterRecord(
  batch: MessageBatch,
  message: Message,
  controlDatabase: D1Database,
) {
  const parsed = deliveryJobSchema.safeParse(message.body);
  const observedAt = new Date().toISOString();
  const recordId = `${batch.queue}:${message.id}`;
  const job = parsed.success ? parsed.data : null;
  return {
    job,
    message,
    statement: controlDatabase
      .prepare(deadLetterInsertSql)
      .bind(
        recordId,
        batch.queue,
        message.id,
        job ? 1 : 0,
        message.attempts,
        job?.organizationId ?? null,
        job?.jobId ?? null,
        job?.kind ?? null,
        job?.idempotencyKey ?? null,
        observedAt,
        observedAt,
      ),
  };
}

async function recordTerminalEventReminder(
  env: DeadLetterConsumerEnv,
  job: DeliveryJob | null,
): Promise<void> {
  if (job?.kind !== "event_reminder" || !env.ORGANIZATION_STORE) return;
  try {
    await recordEventReminderResult(
      { ORGANIZATION_STORE: env.ORGANIZATION_STORE },
      job,
      "terminal",
    );
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        errorType: error instanceof Error ? error.name : "UnknownError",
        event: "event_reminder_terminal_result_failed",
        jobId: job.jobId,
        organizationId: job.organizationId,
      }),
    );
  }
}

async function recordTerminalJob(
  env: DeadLetterConsumerEnv,
  job: DeliveryJob | null,
): Promise<void> {
  if (!job || !env.ORGANIZATION_STORE) return;
  try {
    const response = await env.ORGANIZATION_STORE.get(
      env.ORGANIZATION_STORE.idFromName(job.organizationId),
    ).fetch("https://organization.internal/internal/jobs/terminal", {
      body: JSON.stringify({
        attempt: job.attempt,
        errorCode: "queue_dead_lettered",
        failedAt: new Date().toISOString(),
        idempotencyKey: job.idempotencyKey,
        jobId: job.jobId,
        terminalAt: new Date().toISOString(),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = terminalResponseSchema.safeParse(await response.json());
    if (!response.ok || !result.success || !result.data.terminal) {
      throw new Error("The terminal queue state was rejected.");
    }
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        errorType: error instanceof Error ? error.name : "UnknownError",
        event: "queue_job_terminal_state_failed",
        jobId: job.jobId,
        kind: job.kind,
        organizationId: job.organizationId,
      }),
    );
  }
}

async function processDeadLetterRecord(
  batchQueue: string,
  env: DeadLetterConsumerEnv,
  record: ReturnType<typeof createDeadLetterRecord>,
): Promise<void> {
  const { job, message } = record;
  if (job && message.attempts < 2) {
    message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
    console.warn(
      JSON.stringify({
        event: "queue_job_dead_letter_retry",
        jobId: job.jobId,
        kind: job.kind,
        messageId: message.id,
        organizationId: job.organizationId,
        queue: batchQueue,
      }),
    );
    return;
  }
  await recordTerminalEventReminder(env, job);
  await recordTerminalJob(env, job);
  message.ack();
  console.error(
    JSON.stringify({
      event: "queue_job_dead_lettered",
      jobId: job?.jobId ?? null,
      kind: job?.kind ?? null,
      messageId: message.id,
      organizationId: job?.organizationId ?? null,
      queue: batchQueue,
    }),
  );
}

export async function processDeadLetterBatch(
  batch: MessageBatch,
  env: DeadLetterConsumerEnv,
): Promise<void> {
  const records = batch.messages.map((message) =>
    createDeadLetterRecord(batch, message, env.CONTROL_DB),
  );
  if (records.length > 0) {
    await env.CONTROL_DB.batch(records.map(({ statement }) => statement));
  }
  for (const record of records) {
    await processDeadLetterRecord(batch.queue, env, record);
  }
}

export { renderPlayerLinks, renderRsvpLinks } from "./deliveries/shared";
