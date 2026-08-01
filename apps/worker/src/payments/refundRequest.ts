import { z } from "zod";

import type { Env } from "../env";
import { createStripeRefund, StripeConnectError } from "./stripeConnect";

export class PaymentRefundError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PaymentRefundError";
  }
}

const targetSchema = z.object({
  amountCents: z.number().int().nonnegative(),
  paymentType: z.enum(["ticket", "bundle", "donation", "dues"]),
  providerPaymentId: z.string().max(256),
  refundRequested: z.boolean().default(false),
  resourceId: z.uuid(),
  status: z.string(),
});

export async function requestOrganizationProviderRefund(
  env: Pick<Env, "ORGANIZATION_STORE" | "STRIPE_SECRET_KEY">,
  input: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly paymentType: "ticket" | "bundle" | "donation" | "dues";
    readonly requestId: string;
    readonly resourceId: string;
  },
): Promise<{ readonly fake: boolean }> {
  const targetUrl = new URL("https://organization.internal/internal/payments/refund-target");
  targetUrl.searchParams.set("organizationId", input.organizationId);
  targetUrl.searchParams.set("paymentType", input.paymentType);
  targetUrl.searchParams.set("resourceId", input.resourceId);
  const stub = env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(input.organizationId));
  const targetResponse = await stub.fetch(targetUrl);
  const target = targetSchema.safeParse(await targetResponse.json().catch(() => null));
  if (!targetResponse.ok || !target.success) {
    throw new PaymentRefundError(
      "payment_refund_target_not_found",
      404,
      "Payment refund target not found.",
    );
  }
  if (target.data.status !== "paid") {
    throw new PaymentRefundError(
      "payment_not_refundable",
      409,
      "Only paid payments can be refunded.",
    );
  }
  if (target.data.refundRequested) return { fake: false };
  if (target.data.providerPaymentId.startsWith("fake_payment_")) return { fake: true };
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!secretKey) {
    throw new PaymentRefundError(
      "stripe_not_configured",
      503,
      "Stripe refunds are not configured.",
    );
  }
  const statusUrl = new URL("https://organization.internal/internal/stripe-connect");
  statusUrl.searchParams.set("organizationId", input.organizationId);
  const statusResponse = await stub.fetch(statusUrl);
  const status = z
    .object({
      accountId: z
        .string()
        .regex(/^acct_[A-Za-z0-9]+$/)
        .nullable(),
      status: z.string(),
    })
    .safeParse(await statusResponse.json().catch(() => null));
  if (!statusResponse.ok || !status.success || !status.data.accountId) {
    throw new PaymentRefundError(
      "stripe_account_not_ready",
      409,
      "Stripe refunds are unavailable for this Organization.",
    );
  }
  try {
    await createStripeRefund(
      secretKey,
      status.data.accountId,
      target.data.providerPaymentId,
      `refund-${input.paymentType}-${input.resourceId}`,
    );
  } catch (error: unknown) {
    if (error instanceof StripeConnectError) {
      throw new PaymentRefundError(
        "stripe_refund_unavailable",
        503,
        "Stripe could not start the refund.",
      );
    }
    throw error;
  }
  const requestResponse = await stub.fetch(
    "https://organization.internal/internal/payments/refund-request",
    {
      body: JSON.stringify({
        action: "record_provider_refund_requested",
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        paymentType: input.paymentType,
        requestId: input.requestId,
        resourceId: input.resourceId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!requestResponse.ok) {
    throw new PaymentRefundError(
      "refund_request_not_recorded",
      503,
      "The refund request could not be recorded.",
    );
  }
  return { fake: false };
}
