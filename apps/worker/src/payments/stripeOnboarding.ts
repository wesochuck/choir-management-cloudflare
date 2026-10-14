import { z } from "zod";
import { stripeV2Request, StripeConnectError } from "./stripeClient";
import { stripeV2AccountSchema, type StripeV2Account } from "./stripeAccountReadiness";

const stripeV2AccountLinkSchema = z.object({
  object: z.literal("v2.core.account_link").optional(),
  url: z.url(),
});

export async function createStripeConnectedAccount(
  secretKey: string,
  organizationId: string,
  organizationName: string,
  country = "US",
): Promise<StripeV2Account> {
  const body = {
    configuration: {
      merchant: {
        capabilities: {
          card_payments: {
            requested: true,
          },
        },
      },
    },
    dashboard: "full",
    defaults: {
      responsibilities: {
        fees_collector: "stripe",
        losses_collector: "stripe",
      },
    },
    display_name: organizationName,
    identity: {
      country,
    },
    include: ["configuration.merchant", "defaults", "requirements"],
    metadata: {
      organization_id: organizationId,
    },
  };

  const response = await stripeV2Request(secretKey, "/v2/core/accounts", {
    body,
    idempotencyKey: `organization-${organizationId}`,
    method: "POST",
  });
  return stripeV2AccountSchema.parse(response);
}

export async function retrieveStripeConnectedAccount(
  secretKey: string,
  accountId: string,
): Promise<StripeV2Account> {
  const query = new URLSearchParams([
    ["include[0]", "configuration.merchant"],
    ["include[1]", "defaults"],
    ["include[2]", "requirements"],
  ]);
  const response = await stripeV2Request(
    secretKey,
    `/v2/core/accounts/${encodeURIComponent(accountId)}?${query.toString()}`,
    { method: "GET" },
  );
  return stripeV2AccountSchema.parse(response);
}

export async function createStripeAccountOnboardingLink(
  secretKey: string,
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<string> {
  const body = {
    account: accountId,
    use_case: {
      account_onboarding: {
        collection_options: {
          fields: "eventually_due",
        },
        configurations: ["merchant"],
        refresh_url: refreshUrl,
        return_url: returnUrl,
      },
      type: "account_onboarding",
    },
  };

  const response = await stripeV2Request(secretKey, "/v2/core/account_links", {
    body,
    method: "POST",
  });
  const parsed = stripeV2AccountLinkSchema.safeParse(response);
  if (!parsed.success) {
    throw new StripeConnectError("Stripe did not return a valid onboarding link.");
  }
  return parsed.data.url;
}
