import { z } from "zod";

const stripeAccountSchema = z.object({
  charges_enabled: z.boolean().default(false),
  details_submitted: z.boolean().default(false),
  id: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  payouts_enabled: z.boolean().default(false),
  requirements: z
    .object({ currently_due: z.array(z.string()).default([]) })
    .default({ currently_due: [] }),
});

type StripeAccount = z.infer<typeof stripeAccountSchema>;

export class StripeConnectError extends Error {
  readonly status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = "StripeConnectError";
    this.status = status;
  }
}

function stripeMessage(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return "Stripe Connect could not complete the request.";
  }
  const error = body.error;
  return typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : "Stripe Connect could not complete the request.";
}

async function stripeRequest(
  secretKey: string,
  path: string,
  init: {
    readonly body?: URLSearchParams;
    readonly method: "GET" | "POST";
    readonly idempotencyKey?: string;
  },
): Promise<unknown> {
  const headers = new Headers({ authorization: `Bearer ${secretKey}` });
  if (init.body) {
    headers.set("content-type", "application/x-www-form-urlencoded");
  }
  if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  const requestInit: RequestInit = { headers, method: init.method };
  if (init.body) requestInit.body = init.body;
  const response = await fetch(`https://api.stripe.com${path}`, requestInit);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new StripeConnectError(stripeMessage(body), response.status);
  return body;
}

export async function createStripeConnectedAccount(
  secretKey: string,
  organizationId: string,
  organizationName: string,
): Promise<StripeAccount> {
  const body = new URLSearchParams({
    "business_profile[name]": organizationName,
    "capabilities[card_payments][requested]": "true",
    "capabilities[transfers][requested]": "true",
    "metadata[organization_id]": organizationId,
    type: "express",
  });
  return stripeAccountSchema.parse(
    await stripeRequest(secretKey, "/v1/accounts", {
      body,
      idempotencyKey: `organization-${organizationId}`,
      method: "POST",
    }),
  );
}

export async function retrieveStripeConnectedAccount(
  secretKey: string,
  accountId: string,
): Promise<StripeAccount> {
  return stripeAccountSchema.parse(
    await stripeRequest(secretKey, `/v1/accounts/${encodeURIComponent(accountId)}`, {
      method: "GET",
    }),
  );
}

export async function createStripeAccountOnboardingLink(
  secretKey: string,
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<string> {
  const body = new URLSearchParams({
    account: accountId,
    collect: "eventually_due",
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
  const response = await stripeRequest(secretKey, "/v1/account_links", { body, method: "POST" });
  const url = z
    .url()
    .safeParse(
      typeof response === "object" && response !== null && "url" in response ? response.url : null,
    );
  if (!url.success) throw new StripeConnectError("Stripe did not return an onboarding link.");
  return url.data;
}
