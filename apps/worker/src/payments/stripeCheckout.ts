import { z } from "zod";
import { isSupportedPaidCheckoutAmount } from "@choir/domain";
import { stripeV1Request, StripeCheckoutError, StripeConnectError } from "./stripeClient";

const stripeCheckoutSessionSchema = z.object({
  id: z.string().regex(/^cs_[A-Za-z0-9_]+$/),
  url: z.url(),
});

const stripeCheckoutReconciliationSessionSchema = z.object({
  amount_total: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().nullable().optional(),
  id: z.string(),
  metadata: z.record(z.string(), z.string()).default({}),
  mode: z.string(),
  payment_intent: z
    .union([z.string(), z.object({ id: z.string() })])
    .nullable()
    .optional(),
  payment_status: z.string(),
  status: z.string().nullable(),
});

export interface StripeCheckoutReconciliationSession {
  readonly amountTotalCents: number | null;
  readonly currency: string | null;
  readonly id: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly mode: string;
  readonly paymentIntentId: string | null;
  readonly paymentStatus: string;
  readonly status: string | null;
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
    readonly productDescription?: string;
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
  const totalCents = lineItems.reduce(
    (sum, lineItem) => sum + lineItem.unitAmountCents * lineItem.quantity,
    0,
  );
  if (!isSupportedPaidCheckoutAmount(totalCents)) {
    throw new StripeCheckoutError(
      "Card payments must total at least $0.50.",
      422,
      "ticket_checkout_amount_too_small",
    );
  }
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
      lineItem.productDescription ?? `Payment to ${input.organizationName}`,
    );
    body.set(
      `line_items[${String(index)}][price_data][unit_amount]`,
      String(lineItem.unitAmountCents),
    );
    body.set(`line_items[${String(index)}][quantity]`, String(lineItem.quantity));
  });
  if (input.customerEmail) body.set("customer_email", input.customerEmail);
  body.set("expires_at", String(Math.floor(Date.now() / 1000) + 1800));
  for (const [key, value] of Object.entries(input.metadata)) {
    body.set(`metadata[${key}]`, value);
    body.set(`payment_intent_data[metadata][${key}]`, value);
  }
  return stripeCheckoutSessionSchema.parse(
    await stripeV1Request(secretKey, "/v1/checkout/sessions", {
      body,
      errorType: "checkout",
      idempotencyKey: `payment-checkout-${input.metadata.checkout_request_id ?? crypto.randomUUID()}`,
      method: "POST",
      stripeAccount: connectedAccountId,
    }),
  );
}

export async function retrieveStripeCheckoutSession(
  secretKey: string,
  connectedAccountId: string,
  sessionId: string,
): Promise<{ readonly id: string; readonly url: string }> {
  return stripeCheckoutSessionSchema.parse(
    await stripeV1Request(secretKey, `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      errorType: "checkout",
      method: "GET",
      stripeAccount: connectedAccountId,
    }),
  );
}

export async function retrieveStripeCheckoutReconciliationSession(
  secretKey: string,
  connectedAccountId: string,
  sessionId: string,
): Promise<StripeCheckoutReconciliationSession> {
  const result: unknown = await stripeV1Request(
    secretKey,
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      errorType: "connect",
      method: "GET",
      stripeAccount: connectedAccountId,
    },
  );
  const parsed = stripeCheckoutReconciliationSessionSchema.safeParse(result);
  if (!parsed.success) {
    throw new StripeConnectError(
      "Stripe Checkout session could not be verified for reconciliation.",
      502,
      { code: "stripe_checkout_session_invalid" },
    );
  }
  const paymentIntent = parsed.data.payment_intent;
  return {
    amountTotalCents: parsed.data.amount_total ?? null,
    currency: parsed.data.currency ?? null,
    id: parsed.data.id,
    metadata: parsed.data.metadata,
    mode: parsed.data.mode,
    paymentIntentId:
      typeof paymentIntent === "string" ? paymentIntent : (paymentIntent?.id ?? null),
    paymentStatus: parsed.data.payment_status,
    status: parsed.data.status,
  };
}

export async function createStripeRefund(
  secretKey: string,
  connectedAccountId: string,
  providerPaymentId: string,
  idempotencyKey: string,
): Promise<{ readonly id: string; readonly status: string }> {
  const body = new URLSearchParams({ payment_intent: providerPaymentId });
  const result: unknown = await stripeV1Request(secretKey, "/v1/refunds", {
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
