import { z } from "zod";

import type { Env } from "../env";
import { deliveryJobSchema, type DeliveryJob } from "./contracts";

type JobConsumerEnv = Pick<Env, "EXTERNAL_EFFECTS_MODE" | "ORGANIZATION_STORE">;

const claimResponseSchema = z.object({
  claimed: z.boolean(),
  status: z.string(),
});
const completionResponseSchema = z.object({ completed: z.boolean() });
const deliveryAttemptSchema = z.number().int().min(1).max(10);
const failureResponseSchema = z.object({ failed: z.boolean() });

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

    if (env.EXTERNAL_EFFECTS_MODE !== "fake" && env.EXTERNAL_EFFECTS_MODE !== "disabled") {
      throw new Error("No sandbox provider adapter is configured for this job kind");
    }

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
