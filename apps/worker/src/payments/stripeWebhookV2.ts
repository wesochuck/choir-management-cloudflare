import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import { mapStripeAccountReadiness, retrieveStripeConnectedAccount } from "./stripeConnect";
import {
  resolveOrganizationForStripeAccount,
  upsertStripeAccountOrganization,
} from "./stripeRouting";
import {
  stripeV2EventSchema,
  verifyStripeWebhookSignature,
  type StripeV2Event,
} from "./stripeWebhook";
import {
  problem,
  readRawBody,
  validateLivemodeMismatch,
  type StripeContext,
} from "./stripeWebhookShared";

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

export async function dispatchStripeV2Webhook(
  context: StripeContext,
  preReadBody?: string,
): Promise<Response> {
  const secret = (
    context.env.STRIPE_V2_EVENT_DESTINATION_SECRET ??
    context.env.STRIPE_WEBHOOK_SECRET ??
    ""
  ).trim();
  const secretUnavailable = checkV2SecretConfigured(context, secret);
  if (secretUnavailable) return secretUnavailable;

  const rawBody = preReadBody ?? (await readRawBody(context));
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

export async function handleStripeV2Webhook(context: StripeContext): Promise<Response> {
  return dispatchStripeV2Webhook(context);
}
