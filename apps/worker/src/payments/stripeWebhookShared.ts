import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { Env } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";

export interface StripeHonoEnvironment {
  Bindings: Env;
  Variables: { requestId: string };
}

export type StripeContext = Context<StripeHonoEnvironment>;
export type StripeObject = Record<string, unknown>;

export interface DispatchResult {
  readonly body: unknown;
  readonly response: Response;
}

export function problem(
  context: StripeContext,
  code: string,
  message: string,
  status: ContentfulStatusCode,
): Response {
  const requestId = context.get("requestId");
  const endpointFamily = context.req.path.includes("/v2") ? "v2" : "classic";
  console.warn(
    JSON.stringify({
      code,
      endpointFamily,
      environment: context.env.APP_ENV,
      event: "stripe_webhook_failure",
      requestId,
      status,
    }),
  );
  return context.json({ code, message, requestId }, status);
}

export async function readRawBody(context: StripeContext): Promise<string | Response> {
  try {
    const bytes = await context.req.raw.clone().arrayBuffer();
    if (bytes.byteLength > 1_000_000)
      return problem(context, "request_too_large", "Webhook payload is too large.", 413);
    return new TextDecoder().decode(bytes);
  } catch {
    return problem(context, "invalid_webhook_body", "Webhook payload could not be read.", 400);
  }
}

export function validateLivemodeMismatch(appEnv: string, livemode: boolean): boolean {
  if (appEnv === "staging" && livemode) return true;
  if (appEnv === "production" && !livemode) return true;
  if (appEnv === "local" && livemode) return true;
  return false;
}

export function bodyCode(body: unknown): string {
  return typeof body === "object" &&
    body !== null &&
    "code" in body &&
    typeof body.code === "string"
    ? body.code
    : "stripe_webhook_rejected";
}

export function stripeRefundDispatchMatched(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const refunded = "refunded" in body && typeof body.refunded === "number" ? body.refunded : 0;
  return refunded > 0 || ("duplicate" in body && body.duplicate === true);
}

export async function dispatch(
  context: StripeContext,
  organizationId: string,
  target: { readonly action: string; readonly path: string },
  values: {
    readonly checkoutRequestId?: string;
    readonly providerPaymentId: string;
    readonly providerSessionId: string;
    readonly stripeEventId: string;
    readonly paymentType?: string;
    readonly disputeStatus?: string;
    readonly reason?: string;
    readonly amountCents?: number;
    readonly processorFeeCents?: number;
    readonly providerBalanceTransactionId?: string;
  },
): Promise<DispatchResult> {
  const response = await invokeOrganizationRpc(
    organizationStoreStub(context.env, organizationId),
    `https://organization.internal/internal/${target.path}/manage`,
    {
      body: JSON.stringify({ organizationId, ...target, ...values }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  return { body: await response.json().catch(() => null), response };
}
