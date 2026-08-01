import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";

export async function cleanupStaleCheckout(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  const objectStub = env.ORGANIZATION_STORE.get(
    env.ORGANIZATION_STORE.idFromName(job.organizationId),
  );
  const response = await objectStub.fetch(
    "https://organization.internal/internal/payments/cleanup",
    {
      body: JSON.stringify({ organizationId: job.organizationId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw new Error("Stale payment cleanup was rejected.");
}
