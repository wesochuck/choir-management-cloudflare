import { z } from "zod";

import type { Env } from "../env";
import { deliveryJobSchema } from "./contracts";

const claimResponseSchema = z.object({
  claimed: z.boolean(),
  status: z.string(),
});

function retryDelaySeconds(attempt: number): number {
  const exponentialDelay = Math.min(300, 2 ** attempt);
  const deterministicJitter = (attempt * 17) % 11;
  return exponentialDelay + deterministicJitter;
}

export async function processDeliveryBatch(batch: MessageBatch, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const parsed = deliveryJobSchema.safeParse(message.body);
    if (!parsed.success) {
      console.error(JSON.stringify({ event: "invalid_queue_message", messageId: message.id }));
      message.ack();
      continue;
    }

    const job = parsed.data;
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
        continue;
      }

      if (env.EXTERNAL_EFFECTS_MODE !== "fake" && env.EXTERNAL_EFFECTS_MODE !== "disabled") {
        throw new Error("No sandbox provider adapter is configured for this job kind");
      }

      const completeResponse = await objectStub.fetch(
        "https://organization.internal/internal/jobs/complete",
        {
          body: JSON.stringify({
            completedAt: new Date().toISOString(),
            idempotencyKey: job.idempotencyKey,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!completeResponse.ok) {
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
      console.error(
        JSON.stringify({
          errorType: error instanceof Error ? error.name : "UnknownError",
          event: "queue_job_failed",
          jobId: job.jobId,
          kind: job.kind,
          organizationId: job.organizationId,
        }),
      );
      message.retry({ delaySeconds: retryDelaySeconds(job.attempt) });
    }
  }
}
