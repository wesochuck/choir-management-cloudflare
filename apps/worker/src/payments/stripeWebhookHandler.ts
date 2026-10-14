import { dispatchStripeV1Webhook } from "./stripeWebhookV1";
import { dispatchStripeV2Webhook, handleStripeV2Webhook } from "./stripeWebhookV2";
import {
  problem,
  readRawBody,
  stripeRefundDispatchMatched,
  type StripeContext,
} from "./stripeWebhookShared";

export { handleStripeV2Webhook, stripeRefundDispatchMatched };

function checkWebhookSecretConfigured(context: StripeContext, secret: string): Response | null {
  if (!secret && context.env.APP_ENV === "local" && context.env.EXTERNAL_EFFECTS_MODE === "fake") {
    return context.json({ mode: "fake", received: true, requestId: context.get("requestId") });
  }
  if (!secret) {
    return problem(
      context,
      "stripe_webhook_unavailable",
      "Stripe webhook verification is not configured for this environment.",
      503,
    );
  }
  return null;
}

function isV2EventPayload(rawBody: string): boolean {
  try {
    const json: unknown = JSON.parse(rawBody);
    if (typeof json !== "object" || json === null) return false;
    const isObject = "object" in json && json.object === "v2.core.event";
    const isType = "type" in json && typeof json.type === "string" && json.type.startsWith("v2.");
    return isObject || isType;
  } catch {
    return false;
  }
}

export async function handleStripeWebhook(context: StripeContext): Promise<Response> {
  const secret = context.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  const secretUnavailable = checkWebhookSecretConfigured(context, secret);
  if (secretUnavailable) return secretUnavailable;

  const rawBody = await readRawBody(context);
  if (rawBody instanceof Response) return rawBody;

  if (isV2EventPayload(rawBody)) {
    return await dispatchStripeV2Webhook(context, rawBody);
  }

  return await dispatchStripeV1Webhook(context, rawBody, secret);
}
