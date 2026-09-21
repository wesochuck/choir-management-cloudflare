import { z } from "zod";

import type { Env } from "../../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";

export function stripePaymentsGlobalEnabled(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "STRIPE_PAYMENTS_ENABLED">,
): boolean {
  return (
    env.APP_ENV !== "local" &&
    env.EXTERNAL_EFFECTS_MODE !== "disabled" &&
    env.STRIPE_PAYMENTS_ENABLED?.trim().toLowerCase() === "true"
  );
}

export async function readOrganizationStripeStatus(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
) {
  const url = new URL("https://organization.internal/internal/stripe-connect");
  url.searchParams.set("organizationId", organizationId);
  const response = await invokeOrganizationRpc(organizationStoreStub(env, organizationId), url);
  const status = z
    .object({
      accountId: z
        .string()
        .regex(/^acct_[A-Za-z0-9]+$/)
        .nullable(),
      chargesEnabled: z.boolean(),
      detailsSubmitted: z.boolean(),
      payoutsEnabled: z.boolean(),
      requirementsDue: z.array(z.string()),
      status: z.enum(["not_started", "onboarding", "restricted", "ready"]),
      cardPaymentsStatus: z.string().optional(),
      dashboardType: z.string().optional(),
      feesCollector: z.string().optional(),
      lastSyncedAt: z.string().nullable().optional(),
      lossesCollector: z.string().optional(),
      payoutsStatus: z.string().optional(),
    })
    .safeParse(await response.json().catch(() => null));
  if (!response.ok || !status.success) throw new Error("stripe_status_unavailable");
  return status.data;
}
