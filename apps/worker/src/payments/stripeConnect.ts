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

const stripeCheckoutSessionSchema = z.object({
  id: z.string().regex(/^cs_[A-Za-z0-9_]+$/),
  url: z.url(),
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

export class StripeCheckoutError extends Error {
  readonly status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = "StripeCheckoutError";
    this.status = status;
  }
}

export function stripeAccountIsReady(account: {
  readonly charges_enabled: boolean;
  readonly payouts_enabled: boolean;
  readonly requirements: { readonly currently_due: readonly string[] };
}): boolean {
  return (
    account.charges_enabled &&
    account.payouts_enabled &&
    account.requirements.currently_due.length === 0
  );
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
    readonly stripeAccount?: string;
    readonly errorType?: "checkout" | "connect";
  },
): Promise<unknown> {
  const headers = new Headers({ authorization: `Bearer ${secretKey}` });
  if (init.body) {
    headers.set("content-type", "application/x-www-form-urlencoded");
  }
  if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  if (init.stripeAccount) headers.set("stripe-account", init.stripeAccount);
  const requestInit: RequestInit = { headers, method: init.method };
  if (init.body) requestInit.body = init.body;
  const response = await fetch(`https://api.stripe.com${path}`, requestInit);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const ErrorType = init.errorType === "checkout" ? StripeCheckoutError : StripeConnectError;
    throw new ErrorType(stripeMessage(body), response.status);
  }
  return body;
}

export interface StripeCheckoutSessionInput {
  readonly cancelUrl: string;
  readonly currency: "usd";
  readonly metadata: Readonly<Record<string, string>>;
  readonly organizationName: string;
  readonly productName?: string;
  readonly quantity?: number;
  readonly successUrl: string;
  readonly unitAmountCents?: number;
  readonly lineItems?: readonly {
    readonly productName: string;
    readonly quantity: number;
    readonly unitAmountCents: number;
  }[];
  readonly customerEmail?: string;
}

export async function createStripeCheckoutSession(
  secretKey: string,
  connectedAccountId: string,
  input: StripeCheckoutSessionInput,
): Promise<{ readonly id: string; readonly url: string }> {
  const lineItems = input.lineItems ?? [
    {
      productName: input.productName ?? "Organization payment",
      quantity: input.quantity ?? 1,
      unitAmountCents: input.unitAmountCents ?? 0,
    },
  ];
  const body = new URLSearchParams({
    cancel_url: input.cancelUrl,
    mode: "payment",
    success_url: input.successUrl,
  });
  lineItems.forEach((lineItem, index) => {
    body.set(`line_items[${String(index)}][price_data][currency]`, input.currency);
    body.set(`line_items[${String(index)}][price_data][product_data][name]`, lineItem.productName);
    body.set(
      `line_items[${String(index)}][price_data][product_data][description]`,
      `Payment to ${input.organizationName}`,
    );
    body.set(
      `line_items[${String(index)}][price_data][unit_amount]`,
      String(lineItem.unitAmountCents),
    );
    body.set(`line_items[${String(index)}][quantity]`, String(lineItem.quantity));
  });
  if (input.customerEmail) body.set("customer_email", input.customerEmail);
  for (const [key, value] of Object.entries(input.metadata)) {
    body.set(`metadata[${key}]`, value);
  }
  return stripeCheckoutSessionSchema.parse(
    await stripeRequest(secretKey, "/v1/checkout/sessions", {
      body,
      idempotencyKey: `payment-checkout-${input.metadata.checkout_request_id ?? crypto.randomUUID()}`,
      method: "POST",
      errorType: "checkout",
      stripeAccount: connectedAccountId,
    }),
  );
}

export async function createStripeRefund(
  secretKey: string,
  connectedAccountId: string,
  providerPaymentId: string,
  idempotencyKey: string,
): Promise<{ readonly id: string; readonly status: string }> {
  const body = new URLSearchParams({ payment_intent: providerPaymentId });
  const result: unknown = await stripeRequest(secretKey, "/v1/refunds", {
    body,
    errorType: "connect",
    idempotencyKey,
    method: "POST",
    stripeAccount: connectedAccountId,
  });
  const parsed = z
    .object({ id: z.string().min(1).max(256), status: z.string().min(1).max(64) })
    .parse(result);
  return parsed;
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
