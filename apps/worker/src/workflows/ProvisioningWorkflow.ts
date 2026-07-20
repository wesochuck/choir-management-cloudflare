import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { z } from "zod";

import type { Env } from "../env";

const provisioningParamsSchema = z.object({
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

export type ProvisioningParams = z.infer<typeof provisioningParamsSchema>;

export class ProvisioningWorkflow extends WorkflowEntrypoint<Env, ProvisioningParams> {
  override async run(event: WorkflowEvent<ProvisioningParams>, step: WorkflowStep): Promise<void> {
    const params = provisioningParamsSchema.parse(event.payload);
    await step.do("initialize organization store", async () => {
      const objectId = this.env.ORGANIZATION_STORE.idFromName(params.organizationId);
      const response = await this.env.ORGANIZATION_STORE.get(objectId).fetch(
        "https://organization.internal/internal/health",
      );
      if (!response.ok) {
        throw new Error("Organization store initialization failed");
      }
      return { initialized: true };
    });
  }
}
