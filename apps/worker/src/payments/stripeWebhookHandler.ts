import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { Env } from "../env";
import { resolveOrganizationForStripeAccount } from "./stripeRouting";
import {
  stripeChargeRefundIsComplete,
  stripeCheckoutSessionIsPaid,
  stripeEventSchema,
  verifyStripeWebhookSignature,
  type StripeEvent,
} from "./stripeWebhook";

interface StripeHonoEnvironment {
  Bindings: Env;
  Variables: { requestId: string };
}

type StripeContext = Context<StripeHonoEnvironment>;
type StripeObject = Record<string, unknown>;
interface DispatchResult {
  readonly body: unknown;
  readonly response: Response;
}

function problem(
  context: StripeContext,
  code: string,
  message: string,
  status: ContentfulStatusCode,
): Response {
  return context.json({ code, message, requestId: context.get("requestId") }, status);
}

function objectString(object: StripeObject, key: string): string {
  const value = object[key];
  return typeof value === "string" ? value.trim() : "";
}

function objectMetadata(object: StripeObject): Record<string, string> {
  const value = object.metadata;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, entry]) => [key, entry.trim()]),
  );
}

function metadataValue(metadata: Readonly<Record<string, string>>, ...keys: string[]): string {
  for (const key of keys) {
    const value = metadata[key]?.trim();
    if (value) return value;
  }
  return "";
}

function paymentTarget(
  paymentType: string,
): { readonly action: string; readonly path: string } | null {
  switch (paymentType) {
    case "donation":
      return { action: "stripe_donation_completed", path: "donations" };
    case "dues":
      return { action: "stripe_dues_completed", path: "seasons" };
    case "ticket":
    case "bundle":
      return { action: "stripe_ticket_completed", path: "ticketing" };
    default:
      return null;
  }
}

function expiredTarget(
  paymentType: string,
): { readonly action: string; readonly path: string } | null {
  switch (paymentType) {
    case "donation":
      return { action: "stripe_donation_expired", path: "donations" };
    case "dues":
      return { action: "stripe_dues_expired", path: "seasons" };
    case "ticket":
    case "bundle":
      return { action: "stripe_ticket_expired", path: "ticketing" };
    default:
      return null;
  }
}

async function dispatch(
  context: StripeContext,
  organizationId: string,
  target: { readonly action: string; readonly path: string },
  values: {
    readonly providerPaymentId: string;
    readonly providerSessionId: string;
    readonly stripeEventId: string;
    readonly paymentType?: string;
    readonly disputeStatus?: string;
  },
): Promise<DispatchResult> {
  const stub = context.env.ORGANIZATION_STORE.get(
    context.env.ORGANIZATION_STORE.idFromName(organizationId),
  );
  const response = await stub.fetch(
    `https://organization.internal/internal/${target.path}/manage`,
    {
      body: JSON.stringify({ organizationId, ...target, ...values }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  return { body: await response.json().catch(() => null), response };
}

function bodyCode(body: unknown): string {
  return typeof body === "object" &&
    body !== null &&
    "code" in body &&
    typeof body.code === "string"
    ? body.code
    : "stripe_webhook_rejected";
}

async function handleCompleted(
  context: StripeContext,
  organizationId: string,
  paymentType: string,
  values: {
    readonly providerPaymentId: string;
    readonly providerSessionId: string;
    readonly stripeEventId: string;
  },
): Promise<Response> {
  const target = paymentTarget(paymentType);
  if (!target)
    return problem(
      context,
      "invalid_payment_type",
      "Webhook metadata does not identify a supported payment.",
      400,
    );
  const result = await dispatch(context, organizationId, target, values);
  if (!result.response.ok) {
    const status: ContentfulStatusCode =
      result.response.status === 404 || result.response.status === 409
        ? result.response.status
        : 503;
    return problem(
      context,
      bodyCode(result.body),
      "The payment event could not be applied.",
      status,
    );
  }
  return context.json({
    eventId: values.stripeEventId,
    requestId: context.get("requestId"),
    success: true,
  });
}

async function handleExpired(
  context: StripeContext,
  organizationId: string,
  paymentType: string,
  values: {
    readonly providerPaymentId: string;
    readonly providerSessionId: string;
    readonly stripeEventId: string;
  },
): Promise<Response> {
  const target = expiredTarget(paymentType);
  if (!target)
    return context.json({
      eventId: values.stripeEventId,
      ignored: true,
      requestId: context.get("requestId"),
      success: true,
    });
  const result = await dispatch(context, organizationId, target, values);
  if (!result.response.ok && result.response.status !== 404) {
    return problem(
      context,
      "stripe_webhook_rejected",
      "The expired payment event could not be applied.",
      503,
    );
  }
  return context.json({
    eventId: values.stripeEventId,
    requestId: context.get("requestId"),
    success: true,
  });
}

// eslint-disable-next-line complexity -- maps a verified Stripe refund to the typed Organization operation.
async function handleRefunded(
  context: StripeContext,
  organizationId: string,
  paymentType: string,
  values: {
    readonly providerPaymentId: string;
    readonly providerSessionId: string;
    readonly stripeEventId: string;
  },
): Promise<Response> {
  const paths =
    paymentType === "donation"
      ? ["donations"]
      : paymentType === "dues"
        ? ["seasons"]
        : paymentType === "ticket" || paymentType === "bundle"
          ? ["ticketing"]
          : ["ticketing", "donations", "seasons"];
  let matched = false;
  for (const path of paths) {
    const target = {
      action:
        path === "donations"
          ? "stripe_donation_refunded"
          : path === "seasons"
            ? "stripe_dues_refunded"
            : "stripe_ticket_refunded",
      path,
    };
    const result = await dispatch(context, organizationId, target, values);
    if (result.response.ok) {
      const refunded =
        typeof result.body === "object" &&
        result.body !== null &&
        "refunded" in result.body &&
        typeof result.body.refunded === "number"
          ? result.body.refunded
          : 0;
      matched = matched || refunded > 0;
    } else if (result.response.status !== 404) {
      return problem(
        context,
        "stripe_webhook_rejected",
        "The refund event could not be applied.",
        503,
      );
    }
  }
  return matched
    ? context.json({
        eventId: values.stripeEventId,
        requestId: context.get("requestId"),
        success: true,
      })
    : problem(context, "payment_not_found", "No matching payment was found.", 404);
}

async function handleDispute(
  context: StripeContext,
  organizationId: string,
  paymentType: string,
  values: {
    readonly providerDisputeId: string;
    readonly providerPaymentId: string;
    readonly stripeEventId: string;
  },
  status: string,
): Promise<Response> {
  const result = await dispatch(
    context,
    organizationId,
    {
      action: "record_payment_dispute",
      path: "payments",
    },
    {
      disputeStatus: status,
      paymentType,
      providerPaymentId: values.providerPaymentId,
      providerSessionId: values.providerDisputeId,
      stripeEventId: values.stripeEventId,
    },
  );
  if (!result.response.ok) {
    return problem(
      context,
      bodyCode(result.body),
      "The payment dispute could not be recorded.",
      result.response.status === 404 ? 404 : 503,
    );
  }
  return context.json({
    eventId: values.stripeEventId,
    requestId: context.get("requestId"),
    success: true,
  });
}

async function readRawBody(context: StripeContext): Promise<string | Response> {
  try {
    const bytes = await context.req.raw.clone().arrayBuffer();
    if (bytes.byteLength > 1_000_000)
      return problem(context, "request_too_large", "Webhook payload is too large.", 413);
    return new TextDecoder().decode(bytes);
  } catch {
    return problem(context, "invalid_webhook_body", "Webhook payload could not be read.", 400);
  }
}

async function readVerifiedEvent(
  context: StripeContext,
  secret: string,
): Promise<StripeEvent | Response> {
  const rawBody = await readRawBody(context);
  if (rawBody instanceof Response) return rawBody;
  if (
    !(await verifyStripeWebhookSignature(
      secret,
      context.req.header("Stripe-Signature") ?? null,
      rawBody,
    ))
  ) {
    return problem(context, "invalid_webhook_signature", "Webhook signature is invalid.", 400);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody) as unknown;
  } catch {
    return problem(context, "invalid_webhook_body", "Webhook payload is not valid JSON.", 400);
  }
  const parsed = stripeEventSchema.safeParse(decoded);
  if (!parsed.success)
    return problem(context, "invalid_webhook_event", "Webhook event is invalid.", 400);
  return parsed.data;
}

interface PreparedWebhook {
  readonly event: StripeEvent;
  readonly organizationId: string;
  readonly paymentType: string;
  readonly values: {
    readonly providerPaymentId: string;
    readonly providerSessionId: string;
    readonly stripeEventId: string;
  };
}

async function prepareWebhookContext(
  context: StripeContext,
  event: StripeEvent,
): Promise<PreparedWebhook | Response> {
  const mapped = await resolveOrganizationForStripeAccount(context.env.CONTROL_DB, event.account);
  if (!mapped || mapped.status === "disabled")
    return problem(
      context,
      "organization_not_found",
      "The Stripe connected account is not registered for an Organization.",
      404,
    );
  const organizationId = mapped.organizationId;
  const object = event.data.object;
  const metadata = objectMetadata(object);
  const metadataOrganizationId = metadataValue(metadata, "organization_id", "organizationId");
  if (metadataOrganizationId && metadataOrganizationId !== organizationId) {
    return problem(
      context,
      "organization_mismatch",
      "Webhook Organization metadata does not match the connected account.",
      409,
    );
  }
  const paymentType = metadataValue(metadata, "payment_type", "paymentType");
  if (!paymentType && event.type.startsWith("checkout.session")) {
    return problem(
      context,
      "invalid_payment_type",
      "Webhook metadata does not identify a supported payment.",
      400,
    );
  }
  const providerSessionId = objectString(object, "id");
  const providerPaymentId = objectString(object, "payment_intent");
  if (!providerSessionId)
    return problem(
      context,
      "invalid_webhook_event",
      "Webhook event is missing its provider session.",
      400,
    );
  return {
    event,
    organizationId,
    paymentType,
    values: { providerPaymentId, providerSessionId, stripeEventId: event.id },
  };
}

async function dispatchPreparedWebhook(
  context: StripeContext,
  prepared: PreparedWebhook,
): Promise<Response> {
  if (prepared.event.type === "checkout.session.completed") {
    if (!stripeCheckoutSessionIsPaid(prepared.event.data.object)) {
      return context.json({
        eventId: prepared.event.id,
        ignored: true,
        reason: "payment_pending",
        requestId: context.get("requestId"),
        success: true,
      });
    }
    return handleCompleted(context, prepared.organizationId, prepared.paymentType, prepared.values);
  }
  if (prepared.event.type === "checkout.session.async_payment_succeeded") {
    return handleCompleted(context, prepared.organizationId, prepared.paymentType, prepared.values);
  }
  if (
    prepared.event.type === "checkout.session.async_payment_failed" ||
    prepared.event.type === "checkout.session.expired"
  ) {
    return handleExpired(context, prepared.organizationId, prepared.paymentType, prepared.values);
  }
  if (prepared.event.type.startsWith("charge.dispute.")) {
    if (!prepared.values.providerPaymentId) {
      return problem(
        context,
        "invalid_webhook_event",
        "Dispute event is missing its payment identifier.",
        400,
      );
    }
    return handleDispute(
      context,
      prepared.organizationId,
      prepared.paymentType || "unknown",
      {
        providerDisputeId: prepared.values.providerSessionId,
        providerPaymentId: prepared.values.providerPaymentId,
        stripeEventId: prepared.values.stripeEventId,
      },
      prepared.event.type,
    );
  }
  if (!prepared.values.providerPaymentId) {
    return problem(
      context,
      "invalid_webhook_event",
      "Refund event is missing its payment identifier.",
      400,
    );
  }
  if (!stripeChargeRefundIsComplete(prepared.event.data.object)) {
    return context.json({
      eventId: prepared.event.id,
      ignored: true,
      reason: "partial_or_unverified_refund",
      requestId: context.get("requestId"),
      success: true,
    });
  }
  return handleRefunded(context, prepared.organizationId, prepared.paymentType, prepared.values);
}

export async function handleStripeWebhook(context: StripeContext): Promise<Response> {
  const secret = context.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret && context.env.APP_ENV === "local" && context.env.EXTERNAL_EFFECTS_MODE === "fake") {
    return context.json({ mode: "fake", received: true, requestId: context.get("requestId") });
  }
  if (!secret)
    return problem(
      context,
      "stripe_webhook_unavailable",
      "Stripe webhook verification is not configured for this environment.",
      503,
    );
  const event = await readVerifiedEvent(context, secret);
  if (event instanceof Response) return event;
  const prepared = await prepareWebhookContext(context, event);
  if (prepared instanceof Response) return prepared;
  return dispatchPreparedWebhook(context, prepared);
}
