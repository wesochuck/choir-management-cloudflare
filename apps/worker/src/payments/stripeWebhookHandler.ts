import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { Env } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import {
  mapStripeAccountReadiness,
  retrieveStripeConnectedAccount,
  retrieveStripePaymentSettlement,
} from "./stripeConnect";
import {
  resolveOrganizationForStripeAccount,
  upsertStripeAccountOrganization,
} from "./stripeRouting";
import {
  stripeChargeRefundIsComplete,
  stripeCheckoutSessionIsPaid,
  stripeEventSchema,
  stripeV2EventSchema,
  verifyStripeWebhookSignature,
  type StripeEvent,
  type StripeV2Event,
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

function bodyCode(body: unknown): string {
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

async function handleCompleted(
  context: StripeContext,
  organizationId: string,
  paymentType: string,
  values: {
    readonly checkoutRequestId?: string;
    readonly providerPaymentId: string;
    readonly providerSessionId: string;
    readonly stripeEventId: string;
  },
  accountId?: string,
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

  if (accountId && values.providerPaymentId && context.env.STRIPE_SECRET_KEY) {
    try {
      const settlement = await retrieveStripePaymentSettlement(
        context.env.STRIPE_SECRET_KEY,
        accountId,
        values.providerPaymentId,
      );
      if (settlement.feeCents !== null) {
        await dispatch(
          context,
          organizationId,
          { action: "reconcile_payment_processor_fee", path: "payments" },
          {
            ...values,
            processorFeeCents: settlement.feeCents,
            ...(settlement.balanceTransactionId
              ? { providerBalanceTransactionId: settlement.balanceTransactionId }
              : {}),
          },
        );
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          environment: context.env.APP_ENV,
          event: "stripe_fee_reconciliation_deferred",
          organizationId,
          providerPaymentId: values.providerPaymentId,
          reason: error instanceof Error ? error.message : "unknown_error",
          requestId: context.get("requestId"),
        }),
      );
    }
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
    readonly checkoutRequestId?: string;
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

async function handleDirectRefunded(
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
        : ["ticketing"];
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
      matched = matched || stripeRefundDispatchMatched(result.body);
    } else if (result.response.status !== 404) {
      return problem(
        context,
        bodyCode(result.body),
        "The refund event could not be applied.",
        result.response.status === 409 ? 409 : 503,
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

async function handleReconciledRefunded(
  context: StripeContext,
  organizationId: string,
  values: {
    readonly providerPaymentId: string;
    readonly providerSessionId: string;
    readonly stripeEventId: string;
  },
): Promise<Response> {
  const target = {
    action: "reconcile_provider_refund",
    path: "payments",
  };
  const result = await dispatch(context, organizationId, target, values);
  if (result.response.ok) {
    return context.json({
      eventId: values.stripeEventId,
      requestId: context.get("requestId"),
      success: true,
    });
  }
  const status: ContentfulStatusCode =
    result.response.status === 404 ? 404 : result.response.status === 409 ? 409 : 503;
  return problem(
    context,
    bodyCode(result.body),
    result.response.status === 404
      ? "No matching payment was found."
      : "The refund event could not be reconciled.",
    status,
  );
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
  if (paymentTarget(paymentType) !== null) {
    return handleDirectRefunded(context, organizationId, paymentType, values);
  }
  return handleReconciledRefunded(context, organizationId, values);
}

async function handleDispute(
  context: StripeContext,
  organizationId: string,
  paymentType: string,
  values: {
    readonly providerDisputeId: string;
    readonly providerPaymentId: string;
    readonly stripeEventId: string;
    readonly reason: string;
    readonly amountCents: number;
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
      reason: values.reason,
      amountCents: values.amountCents,
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
  const event = parsed.data;
  if (context.env.APP_ENV === "staging" && event.livemode) {
    return problem(
      context,
      "livemode_mismatch",
      "Test-mode Stripe events are required in staging.",
      400,
    );
  }
  if (context.env.APP_ENV === "production" && !event.livemode) {
    return problem(
      context,
      "livemode_mismatch",
      "Live Stripe events are required in production.",
      400,
    );
  }
  if (context.env.APP_ENV === "local" && event.livemode) {
    return problem(
      context,
      "livemode_mismatch",
      "Test-mode Stripe events are required in local development.",
      400,
    );
  }
  return event;
}

interface PreparedWebhook {
  readonly accountId?: string;
  readonly event: StripeEvent;
  readonly organizationId: string;
  readonly paymentType: string;
  readonly values: {
    readonly checkoutRequestId?: string;
    readonly providerPaymentId: string;
    readonly providerSessionId: string;
    readonly stripeEventId: string;
    readonly disputeReason?: string;
    readonly disputeAmountCents?: number;
  };
}

function validateLivemodeMismatch(appEnv: string, livemode: boolean): boolean {
  if (appEnv === "staging" && livemode) return true;
  if (appEnv === "production" && !livemode) return true;
  if (appEnv === "local" && livemode) return true;
  return false;
}

async function handleV2AccountClosed(
  context: StripeContext,
  organizationId: string,
  accountId: string,
  eventId: string,
  requestId: string,
): Promise<Response> {
  const storeResponse = await invokeOrganizationRpc(
    organizationStoreStub(context.env, organizationId),
    "https://organization.internal/internal/stripe-connect",
    {
      body: JSON.stringify({
        accountId,
        actorUserId: "stripe",
        cardPaymentsStatus: "restricted",
        chargesEnabled: false,
        dashboardType: "full",
        detailsSubmitted: true,
        feesCollector: "stripe",
        lossesCollector: "stripe",
        organizationId,
        payoutsEnabled: false,
        payoutsStatus: "restricted",
        requestId,
        requirementsDue: [],
        status: "restricted",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!storeResponse.ok) {
    return problem(
      context,
      "stripe_webhook_rejected",
      "The connected account state could not be updated.",
      503,
    );
  }
  await upsertStripeAccountOrganization(context.env.CONTROL_DB, {
    accountId,
    organizationId,
    status: "disabled",
  });
  return context.json({
    eventId,
    requestId,
    success: true,
  });
}

async function handleV2AccountUpdated(
  context: StripeContext,
  organizationId: string,
  accountId: string,
  eventId: string,
  requestId: string,
): Promise<Response> {
  const secretKey = context.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return problem(
      context,
      "stripe_connect_unavailable",
      "Platform Stripe credentials are not configured.",
      503,
    );
  }

  let account;
  try {
    account = await retrieveStripeConnectedAccount(secretKey, accountId);
  } catch (error: unknown) {
    return problem(
      context,
      "stripe_retrieval_failed",
      error instanceof Error ? error.message : "Failed to retrieve current Stripe account state.",
      502,
    );
  }

  const readiness = mapStripeAccountReadiness(account);

  const storeResponse = await invokeOrganizationRpc(
    organizationStoreStub(context.env, organizationId),
    "https://organization.internal/internal/stripe-connect",
    {
      body: JSON.stringify({
        accountId,
        actorUserId: "stripe",
        cardPaymentsStatus: readiness.cardPaymentsStatus,
        chargesEnabled: readiness.chargesEnabled,
        dashboardType: readiness.dashboardType,
        detailsSubmitted: readiness.detailsSubmitted,
        feesCollector: readiness.feesCollector,
        lossesCollector: readiness.lossesCollector,
        organizationId,
        payoutsEnabled: readiness.payoutsEnabled,
        payoutsStatus: readiness.payoutsStatus,
        requestId,
        requirementsDue: readiness.requirementsDue,
        status: readiness.status,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!storeResponse.ok) {
    return problem(
      context,
      "stripe_webhook_rejected",
      "The connected account state could not be updated.",
      503,
    );
  }

  await upsertStripeAccountOrganization(context.env.CONTROL_DB, {
    accountId,
    organizationId,
    status: readiness.ready ? "active" : "pending",
  });

  return context.json({
    eventId,
    requestId,
    success: true,
  });
}

function checkV2SecretConfigured(context: StripeContext, secret: string): Response | null {
  if (!secret && context.env.APP_ENV === "local" && context.env.EXTERNAL_EFFECTS_MODE === "fake") {
    return context.json({ mode: "fake", received: true, requestId: context.get("requestId") });
  }
  if (!secret) {
    return problem(
      context,
      "stripe_webhook_unavailable",
      "Stripe v2 webhook verification is not configured for this environment.",
      503,
    );
  }
  return null;
}

async function parseVerifiedV2Event(
  context: StripeContext,
  secret: string,
  rawBody: string,
): Promise<Response | StripeV2Event> {
  const validSignature = await verifyStripeWebhookSignature(
    secret,
    context.req.header("Stripe-Signature") ?? null,
    rawBody,
  );
  if (!validSignature) {
    return problem(context, "invalid_webhook_signature", "Webhook signature is invalid.", 400);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody);
  } catch {
    return problem(context, "invalid_webhook_body", "Webhook payload is not valid JSON.", 400);
  }

  const parsed = stripeV2EventSchema.safeParse(decoded);
  if (!parsed.success) {
    return problem(context, "invalid_webhook_event", "Webhook event is invalid.", 400);
  }
  const event = parsed.data;

  if (validateLivemodeMismatch(context.env.APP_ENV, event.livemode)) {
    return problem(
      context,
      "livemode_mismatch",
      event.livemode
        ? "Test-mode Stripe events are required in staging and local development."
        : "Live Stripe events are required in production.",
      400,
    );
  }

  return event;
}

export async function handleStripeV2Webhook(context: StripeContext): Promise<Response> {
  const secret = (
    context.env.STRIPE_V2_EVENT_DESTINATION_SECRET ??
    context.env.STRIPE_WEBHOOK_SECRET ??
    ""
  ).trim();
  const secretUnavailable = checkV2SecretConfigured(context, secret);
  if (secretUnavailable) return secretUnavailable;

  const rawBody = await readRawBody(context);
  if (rawBody instanceof Response) return rawBody;

  const eventOrResponse = await parseVerifiedV2Event(context, secret, rawBody);
  if (eventOrResponse instanceof Response) return eventOrResponse;
  const event = eventOrResponse;

  const accountId = event.related_object?.id;
  if (!accountId) {
    return context.json({
      eventId: event.id,
      ignored: true,
      reason: "irrelevant_event_type",
      requestId: context.get("requestId"),
      success: true,
    });
  }

  const mapped = await resolveOrganizationForStripeAccount(context.env.CONTROL_DB, accountId);
  if (!mapped || mapped.status === "disabled") {
    return context.json({
      eventId: event.id,
      ignored: true,
      reason: "unknown_account",
      requestId: context.get("requestId"),
      success: true,
    });
  }

  const requestId = context.get("requestId");
  if (event.type === "v2.core.account.closed") {
    return await handleV2AccountClosed(
      context,
      mapped.organizationId,
      accountId,
      event.id,
      requestId,
    );
  }
  return await handleV2AccountUpdated(
    context,
    mapped.organizationId,
    accountId,
    event.id,
    requestId,
  );
}

// eslint-disable-next-line complexity -- validates connected-account, metadata, and event identity.
async function prepareWebhookContext(
  context: StripeContext,
  event: StripeEvent,
): Promise<PreparedWebhook | Response> {
  const accountId = event.account ?? "";
  if (!accountId) {
    return problem(
      context,
      "invalid_webhook_event",
      "Webhook event is missing account identification.",
      400,
    );
  }
  const mapped = await resolveOrganizationForStripeAccount(context.env.CONTROL_DB, accountId);
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
  const checkoutRequestId = z
    .uuid()
    .safeParse(metadataValue(metadata, "checkout_request_id", "checkoutRequestId"));
  if (!paymentType && event.type.startsWith("checkout.session")) {
    return problem(
      context,
      "invalid_payment_type",
      "Webhook metadata does not identify a supported payment.",
      400,
    );
  }
  const providerSessionId = objectString(object, "id");
  const providerPaymentId =
    objectString(object, "payment_intent") ||
    (event.type.startsWith("charge.") ? objectString(object, "id") : "");
  const disputeReason = objectString(object, "reason");
  const disputeAmountCents =
    typeof object.amount === "number" && Number.isSafeInteger(object.amount) && object.amount >= 0
      ? object.amount
      : undefined;
  if (!providerSessionId)
    return problem(
      context,
      "invalid_webhook_event",
      "Webhook event is missing its provider session.",
      400,
    );
  return {
    accountId,
    event,
    organizationId,
    paymentType,
    values: {
      ...(checkoutRequestId.success ? { checkoutRequestId: checkoutRequestId.data } : {}),
      providerPaymentId,
      providerSessionId,
      stripeEventId: event.id,
      ...(event.type.startsWith("charge.dispute.") && disputeReason ? { disputeReason } : {}),
      ...(event.type.startsWith("charge.dispute.") && disputeAmountCents !== undefined
        ? { disputeAmountCents }
        : {}),
    },
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
    return handleCompleted(
      context,
      prepared.organizationId,
      prepared.paymentType,
      prepared.values,
      prepared.accountId,
    );
  }
  if (prepared.event.type === "checkout.session.async_payment_succeeded") {
    return handleCompleted(
      context,
      prepared.organizationId,
      prepared.paymentType,
      prepared.values,
      prepared.accountId,
    );
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
    if (!prepared.values.disputeReason || prepared.values.disputeAmountCents === undefined) {
      return problem(
        context,
        "invalid_webhook_event",
        "Dispute event is missing its reason or amount.",
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
        reason: prepared.values.disputeReason,
        amountCents: prepared.values.disputeAmountCents,
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
    return await handleStripeV2Webhook(context);
  }

  const event = await readVerifiedEvent(context, secret);
  if (event instanceof Response) return event;
  const prepared = await prepareWebhookContext(context, event);
  if (prepared instanceof Response) return prepared;
  return dispatchPreparedWebhook(context, prepared);
}
