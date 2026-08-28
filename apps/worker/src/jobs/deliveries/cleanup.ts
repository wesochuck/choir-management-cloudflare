import { mutateOrganizationStore } from "../../organization/rpc/repository";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";

export async function cleanupStaleCheckout(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  const response = await mutateOrganizationStore(
    env,
    job.organizationId,
    "/internal/payments/cleanup",
    { organizationId: job.organizationId },
  );
  if (!response.ok) throw new Error("Stale payment cleanup was rejected.");
}
