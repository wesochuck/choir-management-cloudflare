import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { getModuleState } from "../organization/organizationSetup";
import { isCanonicalAuthHost } from "../auth/config";
import type { Env } from "../env";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import { stripeEventSchema, verifyStripeWebhookSignature, type StripeEvent } from "./stripeWebhook";

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
      : paymentType === "ticket" || paymentType === "bundle"
        ? ["ticketing"]
        : ["ticketing", "donations"];
  let matched = false;
  for (const path of paths) {
    const target = {
      action: path === "donations" ? "stripe_donation_refunded" : "stripe_ticket_refunded",
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
  const requestUrl = new URL(context.req.url);
  if (!isCanonicalAuthHost(requestUrl.hostname, context.env.PRODUCT_BASE_DOMAIN)) {
    return problem(
      context,
      "organization_not_found",
      "The webhook host is not a canonical Organization host.",
      404,
    );
  }
  const resolved = await resolveOrganization(requestUrl, context.env);
  if (!resolved.ok)
    return problem(
      context,
      "organization_not_found",
      "The webhook host is not a registered Organization host.",
      404,
    );
  const organizationId = resolved.value.organizationId;
  const object = event.data.object;
  const metadata = objectMetadata(object);
  if (metadata.organizationId && metadata.organizationId !== organizationId) {
    return problem(
      context,
      "organization_mismatch",
      "Webhook Organization metadata does not match its host.",
      409,
    );
  }
  const paymentType = metadata.paymentType ?? "";
  const moduleId = paymentType === "dues" ? "people" : "programs";
  try {
    const modules = await getModuleState(context.env, organizationId);
    if (!(modules.find((module) => module.id === moduleId)?.enabled ?? false)) {
      return problem(
        context,
        "module_disabled",
        "The payment module is disabled for this Organization.",
        404,
      );
    }
  } catch {
    return problem(
      context,
      "module_state_unavailable",
      "Organization module state is temporarily unavailable.",
      503,
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
  if (prepared.event.type === "checkout.session.completed") {
    return handleCompleted(context, prepared.organizationId, prepared.paymentType, prepared.values);
  }
  if (prepared.event.type === "checkout.session.expired") {
    return handleExpired(context, prepared.organizationId, prepared.paymentType, prepared.values);
  }
  if (!prepared.values.providerPaymentId) {
    return problem(
      context,
      "invalid_webhook_event",
      "Refund event is missing its payment identifier.",
      400,
    );
  }
  return handleRefunded(context, prepared.organizationId, prepared.paymentType, prepared.values);
}
