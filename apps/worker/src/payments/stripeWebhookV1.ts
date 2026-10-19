import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import { organizationTicketOrderSchema } from "@choir/contracts";
import { deliveryOrigin } from "../jobs/deliveries/shared";
import { queueTicketSaleAlert } from "../organization/ticketSaleAlerts";
import { organizationStoreStub } from "../organization/rpc/client";
import { retrieveStripePaymentSettlement } from "./stripeConnect";
import { resolveOrganizationForStripeAccount } from "./stripeRouting";
import {
  stripeChargeRefundIsComplete,
  stripeCheckoutSessionIsPaid,
  stripeEventSchema,
  verifyStripeWebhookSignature,
  type StripeEvent,
} from "./stripeWebhook";
import {
  bodyCode,
  dispatch,
  problem,
  stripeRefundDispatchMatched,
  type StripeContext,
  type StripeObject,
} from "./stripeWebhookShared";

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

async function reconcileCompletedPaymentFee(
  context: StripeContext,
  organizationId: string,
  values: {
    readonly checkoutRequestId?: string;
    readonly providerPaymentId: string;
    readonly providerSessionId: string;
    readonly stripeEventId: string;
  },
  accountId: string,
): Promise<void> {
  if (!context.env.STRIPE_SECRET_KEY) {
    return;
  }
  let reconciled = false;
  try {
    const settlement = await retrieveStripePaymentSettlement(
      context.env.STRIPE_SECRET_KEY,
      accountId,
      values.providerPaymentId,
    );
    if (settlement.feeCents !== null) {
      const reconcileResult = await dispatch(
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
      if (reconcileResult.response.ok) {
        reconciled = true;
      } else {
        console.warn(
          JSON.stringify({
            environment: context.env.APP_ENV,
            event: "stripe_fee_reconciliation_dispatch_failed",
            organizationId,
            providerPaymentId: values.providerPaymentId,
            status: reconcileResult.response.status,
          }),
        );
      }
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

  if (!reconciled) {
    try {
      const result = await organizationStoreStub(
        context.env,
        organizationId,
      ).schedulePaymentFeeReconciliation({
        organizationId,
        providerPaymentId: values.providerPaymentId,
      });
      if (result.status === "rejected") {
        console.error(
          JSON.stringify({
            code: "code" in result ? result.code : "fee_reconciliation_rejected",
            environment: context.env.APP_ENV,
            event: "stripe_fee_reconciliation_schedule_rejected",
            organizationId,
            providerPaymentId: values.providerPaymentId,
            requestId: context.get("requestId"),
          }),
        );
      }
    } catch (error: unknown) {
      console.error(
        JSON.stringify({
          environment: context.env.APP_ENV,
          event: "stripe_fee_reconciliation_schedule_failed",
          organizationId,
          providerPaymentId: values.providerPaymentId,
          reason: error instanceof Error ? error.name : "unknown_error",
          requestId: context.get("requestId"),
        }),
      );
    }
  }
}

async function queueStripeTicketSaleAlert(
  context: StripeContext,
  organizationId: string,
  resultBody: unknown,
): Promise<void> {
  const isDuplicate =
    typeof resultBody === "object" && resultBody !== null && "duplicate" in resultBody;
  if (isDuplicate) return;

  const parsedPurchase = organizationTicketOrderSchema.safeParse(resultBody);
  if (!parsedPurchase.success || parsedPurchase.data.status !== "paid") return;

  try {
    const origin = await deliveryOrigin(context.env, organizationId, { unsubscribeUrl: null });
    await queueTicketSaleAlert(context.env, {
      actorUserId: "stripe",
      amountPaidCents: parsedPurchase.data.amountPaidCents,
      buyerEmail: parsedPurchase.data.buyerEmail,
      buyerName: parsedPurchase.data.buyerName,
      currency: parsedPurchase.data.currency,
      eventId: parsedPurchase.data.eventId,
      eventStartsAt: parsedPurchase.data.eventStartsAt,
      eventTitle:
        parsedPurchase.data.bundleTitle.trim().length > 0
          ? parsedPurchase.data.bundleTitle
          : parsedPurchase.data.eventTitle,
      orderUrl: `${origin}/admin/tickets`,
      organizationId,
      organizationOrigin: origin,
      purchaseId: parsedPurchase.data.id,
      quantity: parsedPurchase.data.quantity,
      requestId: context.get("requestId"),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ticket_sale_alert_queue_failed",
        organizationId,
        purchaseId: parsedPurchase.data.id,
        reason: error instanceof Error ? error.message : "unknown_error",
      }),
    );
  }
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

  if (accountId && values.providerPaymentId) {
    await reconcileCompletedPaymentFee(context, organizationId, values, accountId);
  }

  if (target.action === "stripe_ticket_completed") {
    await queueStripeTicketSaleAlert(context, organizationId, result.body);
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

async function readVerifiedEvent(
  context: StripeContext,
  secret: string,
  rawBody: string,
): Promise<StripeEvent | Response> {
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

export async function dispatchStripeV1Webhook(
  context: StripeContext,
  rawBody: string,
  secret: string,
): Promise<Response> {
  const event = await readVerifiedEvent(context, secret, rawBody);
  if (event instanceof Response) return event;
  const prepared = await prepareWebhookContext(context, event);
  if (prepared instanceof Response) return prepared;
  return dispatchPreparedWebhook(context, prepared);
}
