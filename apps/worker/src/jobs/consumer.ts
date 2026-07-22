import { z } from "zod";
import { renderCommunicationTemplate } from "@choir/domain";

import type { Env } from "../env";
import { deliverOrganizationCommunication } from "../communications/provider";
import {
  readCommunicationDeliveryJob,
  recordCommunicationDeliveryResults,
} from "../organization/organizationCommunications";
import { deliveryJobSchema, type DeliveryJob } from "./contracts";
import { issueSignedLink } from "../security/signedLinks";

type JobConsumerEnv = Pick<
  Env,
  | "BREVO_API_KEY"
  | "BREVO_EMAIL_FROM"
  | "BREVO_EMAIL_FROM_NAME"
  | "BREVO_SMS_ALLOWED_RECIPIENTS"
  | "BREVO_SMS_SENDER"
  | "EXTERNAL_EFFECTS_MODE"
  | "ORGANIZATION_STORE"
  | "SIGNED_LINK_SECRET"
>;
type DeadLetterConsumerEnv = Pick<Env, "CONTROL_DB">;

const claimResponseSchema = z.object({
  claimed: z.boolean(),
  status: z.string(),
});
const completionResponseSchema = z.object({ completed: z.boolean() });
const deliveryAttemptSchema = z.number().int().min(1).max(10);
const failureResponseSchema = z.object({ failed: z.boolean() });
const ticketNotificationJobSchema = z.object({
  buyerName: z.string().min(1).max(200),
  contentMarkdown: z.string().max(100_000),
  destination: z.email(),
  eventStartsAt: z.iso.datetime(),
  id: z.uuid(),
  purchaseId: z.uuid(),
  status: z.enum(["queued", "processing"]),
  subject: z.string().max(300),
});

function retryDelaySeconds(attempt: number): number {
  const exponentialDelay = Math.min(300, 2 ** attempt);
  const deterministicJitter = (attempt * 17) % 11;
  return exponentialDelay + deterministicJitter;
}

async function recordJobFailure(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  try {
    const objectId = env.ORGANIZATION_STORE.idFromName(job.organizationId);
    const failureResponse = await env.ORGANIZATION_STORE.get(objectId).fetch(
      "https://organization.internal/internal/jobs/fail",
      {
        body: JSON.stringify({
          attempt: job.attempt,
          failedAt: new Date().toISOString(),
          idempotencyKey: job.idempotencyKey,
          jobId: job.jobId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const failure = failureResponseSchema.safeParse(await failureResponse.json());
    if (!failureResponse.ok || !failure.success || !failure.data.failed) {
      console.error(
        JSON.stringify({
          event: "queue_job_failure_record_rejected",
          jobId: job.jobId,
          kind: job.kind,
          organizationId: job.organizationId,
        }),
      );
    }
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        errorType: error instanceof Error ? error.name : "UnknownError",
        event: "queue_job_failure_record_failed",
        jobId: job.jobId,
        kind: job.kind,
        organizationId: job.organizationId,
      }),
    );
  }
}

async function deliverCommunicationJob(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  const deliveryJob = await readCommunicationDeliveryJob(env, job.organizationId, job.jobId);
  const results = [];
  for (const delivery of deliveryJob.deliveries) {
    const result = await deliverOrganizationCommunication(env, {
      channel: delivery.channel,
      contentMarkdown: renderCommunicationTemplate(
        deliveryJob.contentMarkdown,
        delivery.recipientName,
      ),
      deliveryId: delivery.id,
      destination: delivery.destination,
      messageId: deliveryJob.messageId,
      recipientName: delivery.recipientName,
      subject: renderCommunicationTemplate(deliveryJob.subject, delivery.recipientName),
      unsubscribeUrl: delivery.unsubscribeUrl,
    });
    results.push({ deliveryId: delivery.id, ...result });
  }
  await recordCommunicationDeliveryResults(env, {
    jobId: job.jobId,
    organizationId: job.organizationId,
    results,
  });
}

async function deliverTicketNotificationJob(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  const objectId = env.ORGANIZATION_STORE.idFromName(job.organizationId);
  const objectStub = env.ORGANIZATION_STORE.get(objectId);
  const url = new URL("https://organization.internal/internal/ticketing/notification-job");
  url.searchParams.set("organizationId", job.organizationId);
  url.searchParams.set("jobId", job.jobId);
  const response = await objectStub.fetch(url);
  const notification = ticketNotificationJobSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!response.ok || !notification.success) {
    throw new Error("The ticket notification job is unavailable.");
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const eventEndsAt =
    Math.floor(new Date(notification.data.eventStartsAt).getTime() / 1000) + 86_400;
  const scanToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt: Math.max(issuedAt + 3_600, eventEndsAt),
    issuedAt,
    nonce: crypto.randomUUID(),
    organizationId: job.organizationId,
    purpose: "ticket_scan",
    resourceId: notification.data.purchaseId,
    version: 1,
  });
  const result = await deliverOrganizationCommunication(env, {
    channel: "email",
    contentMarkdown: `${notification.data.contentMarkdown}\n\nTicket credential: ${scanToken}`,
    deliveryId: notification.data.id,
    destination: notification.data.destination,
    messageId: notification.data.id,
    recipientName: notification.data.buyerName,
    subject: notification.data.subject,
    unsubscribeUrl: null,
  });
  const recordResponse = await objectStub.fetch(
    "https://organization.internal/internal/ticketing/manage",
    {
      body: JSON.stringify({
        action: "record_ticket_notification_result",
        failureDetail: result.failureDetail,
        jobId: job.jobId,
        organizationId: job.organizationId,
        providerMessageId: result.providerMessageId,
        status: result.status,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!recordResponse.ok) throw new Error("The ticket notification result was rejected.");
}

async function dispatchDeliveryJob(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  if (job.kind === "communication_delivery") {
    await deliverCommunicationJob(env, job);
    return;
  }
  if (job.kind === "ticket_notification") {
    await deliverTicketNotificationJob(env, job);
    return;
  }
  if (env.EXTERNAL_EFFECTS_MODE !== "fake" && env.EXTERNAL_EFFECTS_MODE !== "disabled") {
    throw new Error("No sandbox provider adapter is configured for this job kind");
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

export async function processDeadLetterBatch(
  batch: MessageBatch,
  env: DeadLetterConsumerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const parsed = deliveryJobSchema.safeParse(message.body);
    const observedAt = new Date().toISOString();
    const recordId = `${batch.queue}:${message.id}`;
    await env.CONTROL_DB.prepare(
      `INSERT INTO job_dead_letters
        (id, queue_name, message_id, message_valid, observed_attempt,
         organization_id, job_id, job_kind, idempotency_key,
         first_seen_at, last_seen_at, observation_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         observed_attempt = excluded.observed_attempt,
         observation_count = job_dead_letters.observation_count + 1`,
    )
      .bind(
        recordId,
        batch.queue,
        message.id,
        parsed.success ? 1 : 0,
        message.attempts,
        parsed.success ? parsed.data.organizationId : null,
        parsed.success ? parsed.data.jobId : null,
        parsed.success ? parsed.data.kind : null,
        parsed.success ? parsed.data.idempotencyKey : null,
        observedAt,
        observedAt,
      )
      .run();
    message.ack();
    console.error(
      JSON.stringify({
        event: "queue_job_dead_lettered",
        jobId: parsed.success ? parsed.data.jobId : null,
        kind: parsed.success ? parsed.data.kind : null,
        messageId: message.id,
        organizationId: parsed.success ? parsed.data.organizationId : null,
        queue: batch.queue,
      }),
    );
  }
}
