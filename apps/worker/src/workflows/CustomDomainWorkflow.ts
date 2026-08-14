import { organizationIdSchema, requestIdSchema } from "@choir/contracts";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { z } from "zod";

import type { Env } from "../env";
import { CustomDomainProviderError, ensureCustomHostname } from "../tenancy/customDomainProvider";
import {
  readPublicDomain,
  recordCustomDomainProviderError,
  recordCustomDomainProviderState,
} from "../tenancy/registerPublicDomain";

const MAX_RECONCILIATION_ATTEMPTS = 12;
const RECONCILIATION_DELAY = "5 minutes";

export const customDomainParamsSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  attempt: z.number().int().nonnegative().max(MAX_RECONCILIATION_ATTEMPTS),
  domainId: z.uuid(),
  organizationId: organizationIdSchema,
  requestId: requestIdSchema,
});

export type CustomDomainParams = z.infer<typeof customDomainParamsSchema>;

export class CustomDomainWorkflow extends WorkflowEntrypoint<Env, CustomDomainParams> {
  override async run(event: WorkflowEvent<CustomDomainParams>, step: WorkflowStep): Promise<void> {
    const params = customDomainParamsSchema.parse(event.payload);
    for (let attempt = params.attempt; attempt <= MAX_RECONCILIATION_ATTEMPTS; attempt += 1) {
      const domain = await step.do(`load custom domain ${String(attempt)}`, async () =>
        readPublicDomain(this.env.CONTROL_DB, params),
      );
      if (!domain || domain.status === "disabled") return;

      try {
        const providerState = await step.do(`reconcile custom hostname ${String(attempt)}`, () =>
          ensureCustomHostname(this.env, {
            hostname: domain.hostname,
            providerHostnameId: domain.providerHostnameId,
          }),
        );
        if (providerState.providerStatus === "error") {
          throw new CustomDomainProviderError(
            "Cloudflare reported an error for this custom hostname.",
          );
        }
        const updated = await step.do(`record custom hostname ${String(attempt)}`, () =>
          recordCustomDomainProviderState(this.env, {
            actorUserId: params.actorUserId,
            domainId: params.domainId,
            now: new Date(),
            organizationId: params.organizationId,
            providerState,
            requestId: params.requestId,
          }),
        );
        if (!updated || updated.status === "active" || attempt === MAX_RECONCILIATION_ATTEMPTS) {
          return;
        }
      } catch (error: unknown) {
        const message =
          error instanceof CustomDomainProviderError
            ? error.message
            : "Custom-hostname reconciliation failed.";
        await step.do(`record custom hostname error ${String(attempt)}`, () =>
          recordCustomDomainProviderError(this.env, {
            actorUserId: params.actorUserId,
            domainId: params.domainId,
            message,
            now: new Date(),
            organizationId: params.organizationId,
            requestId: params.requestId,
          }),
        );
        if (!(error instanceof CustomDomainProviderError) || !error.retryable) return;
      }

      if (attempt < MAX_RECONCILIATION_ATTEMPTS) {
        await step.sleep(`wait for custom hostname ${String(attempt)}`, RECONCILIATION_DELAY);
      }
    }
  }
}
