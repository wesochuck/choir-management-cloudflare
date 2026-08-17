import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";

export async function cleanupStaleCheckout(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  const response = await invokeOrganizationRpc(
    organizationStoreStub(env, job.organizationId),
    "https://organization.internal/internal/payments/cleanup",
    {
      body: JSON.stringify({ organizationId: job.organizationId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw new Error("Stale payment cleanup was rejected.");
}
