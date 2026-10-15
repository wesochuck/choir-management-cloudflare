import {
  duesCashPaymentRequestSchema,
  duesCheckoutRequestSchema,
  duesCheckoutResponseSchema,
  duesRecordSchema,
  duesRecordsResponseSchema,
  transactionFeeSettingsSchema,
  seasonCreateRequestSchema,
  seasonSchema,
  seasonUpdateRequestSchema,
  seasonsResponseSchema,
  type DuesCashPaymentRequest,
  type DuesCheckoutRequest,
  type DuesRecord,
  type Season,
  type SeasonCreateRequest,
  type SeasonUpdateRequest,
} from "@choir/contracts";
import { transactionProcessingFeeCents } from "@choir/domain";
import { z } from "zod";

import type { Env } from "../env";
import {
  createStripeCheckoutSession,
  expireStripeCheckoutSession,
  retrieveStripeCheckoutReconciliationSession,
  StripeCheckoutError,
} from "../payments/stripeConnect";
import { ticketCheckoutMode } from "../payments/ticketCheckout";
import { readOrganizationPaymentActivations } from "./organizationPaymentSettings";
import { PaymentRefundError, requestOrganizationProviderRefund } from "../payments/refundRequest";
import {
  invokeOrganizationRpc,
  organizationStoreStub,
  type OrganizationStoreStub,
} from "./rpc/client";
import { mutateOrganizationStore, readOrganizationStore, storeErrorCode } from "./rpc/repository";

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export class SeasonError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SeasonError";
  }
}

async function expirePendingDuesCheckout(
  organizationStore: ReturnType<typeof organizationStoreStub>,
  organizationId: string,
  requestId: string,
  pendingSessionId: string,
): Promise<void> {
  const response = await invokeOrganizationRpc(
    organizationStore,
    "https://organization.internal/internal/seasons/manage",
    {
      body: JSON.stringify({
        action: "stripe_dues_expired",
        checkoutRequestId: requestId,
        organizationId,
        providerPaymentId: "",
        providerSessionId: pendingSessionId,
        stripeEventId: `checkout-failed:${requestId}`,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new SeasonError(
      "dues_checkout_cleanup_failed",
      503,
      "The failed dues checkout could not be released.",
    );
  }
}

async function mutateSeason(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await mutateOrganizationStore(env, organizationId, "/internal/seasons/manage", {
    ...body,
    organizationId,
  });
  if (!response.ok) {
    const code = await storeErrorCode(response, "season_error");
    const status =
      response.status === 400 || response.status === 404 || response.status === 409
        ? response.status
        : 503;
    throw new SeasonError(code, status, "The season could not be updated.");
  }
  return response;
}

export async function isOnlineDuesPaymentsAvailable(
  env: Pick<
    Env,
    | "APP_ENV"
    | "EXTERNAL_EFFECTS_MODE"
    | "ORGANIZATION_STORE"
    | "STRIPE_PAYMENTS_ENABLED"
    | "STRIPE_SECRET_KEY"
  >,
  organizationId: string,
): Promise<boolean> {
  let checkoutMode: "fake" | "stripe";
  try {
    checkoutMode = ticketCheckoutMode(env);
  } catch {
    return false;
  }

  try {
    const paymentSettings = await readOrganizationPaymentActivations(env, organizationId);
    if (!paymentSettings.activations.dues) {
      return false;
    }

    if (checkoutMode === "fake") {
      return true;
    }

    const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
    if (!secretKey) {
      return false;
    }

    const stripeResponse = await invokeOrganizationRpc(
      organizationStoreStub(env, organizationId),
      `https://organization.internal/internal/stripe-connect?organizationId=${encodeURIComponent(organizationId)}`,
    );
    if (!stripeResponse.ok) {
      return false;
    }

    const stripeStatus = z
      .object({
        accountId: z
          .string()
          .regex(/^acct_[A-Za-z0-9]+$/)
          .nullable(),
        status: z.enum(["not_started", "onboarding", "restricted", "ready"]),
      })
      .safeParse(await stripeResponse.json().catch(() => null));

    if (
      !stripeStatus.success ||
      stripeStatus.data.status !== "ready" ||
      !stripeStatus.data.accountId
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// eslint-disable-next-line complexity -- this coordinates fake and Stripe Connect checkout paths.
export async function createDuesCheckoutSession(
  env: Pick<
    Env,
    | "APP_ENV"
    | "EXTERNAL_EFFECTS_MODE"
    | "ORGANIZATION_STORE"
    | "SIGNED_LINK_SECRET"
    | "STRIPE_PAYMENTS_ENABLED"
    | "STRIPE_SECRET_KEY"
  >,
  organizationId: string,
  origin: string,
  checkout: DuesCheckoutRequest,
  recipientEmail?: string,
) {
  const validated = duesCheckoutRequestSchema.parse(checkout);
  const requestId = crypto.randomUUID();
  const organizationStore = organizationStoreStub(env, organizationId);
  let checkoutMode: "fake" | "stripe";
  try {
    checkoutMode = ticketCheckoutMode(env);
  } catch {
    throw new SeasonError("dues_disabled", 501, "Online dues are disabled.");
  }
  const paymentSettings = await readOrganizationPaymentActivations(env, organizationId);
  if (!paymentSettings.activations.dues) {
    throw new SeasonError(
      "payments_not_activated",
      409,
      "Online dues payments are not enabled for this Organization.",
    );
  }
  if (checkoutMode === "fake") {
    const response = await invokeOrganizationRpc(
      organizationStore,
      "https://organization.internal/internal/seasons/manage",
      {
        body: JSON.stringify({
          action: "create_dues_checkout",
          checkout: validated,
          organizationId,
          origin,
          recipientEmail,
          requestId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    if (!response.ok) {
      const code = await storeErrorCode(response, "season_error");
      throw new SeasonError(code, response.status, "The dues checkout could not be created.");
    }
    return duesCheckoutResponseSchema.parse(await response.json());
  }

  const [seasonsResponse, feeResponse, stripeResponse] = await Promise.all([
    invokeOrganizationRpc(
      organizationStore,
      `https://organization.internal/internal/seasons/list?organizationId=${encodeURIComponent(organizationId)}`,
    ),
    invokeOrganizationRpc(
      organizationStore,
      `https://organization.internal/internal/transaction-fee-settings?organizationId=${encodeURIComponent(organizationId)}`,
    ),
    invokeOrganizationRpc(
      organizationStore,
      `https://organization.internal/internal/stripe-connect?organizationId=${encodeURIComponent(organizationId)}`,
    ),
  ]);
  if (!seasonsResponse.ok) throw new SeasonError("season_not_found", 404, "Season not found.");
  const seasonsBody = await seasonsResponse.json();
  const parsedSeasonList = seasonsResponseSchema.omit({ requestId: true }).safeParse(seasonsBody);
  if (!parsedSeasonList.success) {
    throw new SeasonError("seasons_unavailable", 503, "Seasons unavailable.");
  }
  const selectedSeason = parsedSeasonList.data.seasons.find(({ id }) => id === validated.seasonId);
  if (!selectedSeason) throw new SeasonError("season_not_found", 404, "Season not found.");

  const feeSettings = transactionFeeSettingsSchema.safeParse(
    await feeResponse.json().catch(() => null),
  );
  if (!feeResponse.ok || !feeSettings.success) {
    throw new SeasonError("transaction_fees_unavailable", 503, "Transaction fees are unavailable.");
  }
  const stripeStatus = z
    .object({
      accountId: z
        .string()
        .regex(/^acct_[A-Za-z0-9]+$/)
        .nullable(),
      status: z.enum(["not_started", "onboarding", "restricted", "ready"]),
    })
    .safeParse(await stripeResponse.json().catch(() => null));
  if (!stripeResponse.ok || !stripeStatus.success || stripeStatus.data.status !== "ready") {
    throw new SeasonError(
      "stripe_account_not_ready",
      409,
      "Online dues are not available until the Organization finishes Stripe setup.",
    );
  }
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!secretKey || !stripeStatus.data.accountId) {
    throw new SeasonError(
      "stripe_not_configured",
      503,
      "Online dues are not configured for this Organization.",
    );
  }
  const totalBaseAmountCents = selectedSeason.duesAmountCents * validated.profileIds.length;
  const totalFeeCents = transactionProcessingFeeCents(totalBaseAmountCents, feeSettings.data);
  const pendingSessionId = `pending_${requestId}`;
  const pendingResponse = await invokeOrganizationRpc(
    organizationStore,
    "https://organization.internal/internal/seasons/manage",
    {
      body: JSON.stringify({
        action: "prepare_dues_checkout",
        checkout: validated,
        organizationId,
        origin,
        recipientEmail,
        providerSessionId: pendingSessionId,
        requestId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!pendingResponse.ok) {
    throw new SeasonError(
      await storeErrorCode(pendingResponse, "season_error"),
      pendingResponse.status,
      "The dues checkout could not be reserved.",
    );
  }
  let stripeSession: { readonly id: string; readonly url: string };
  try {
    stripeSession = await createStripeCheckoutSession(secretKey, stripeStatus.data.accountId, {
      cancelUrl: new URL("/dues?checkout=cancelled", origin).href,
      currency: "usd",
      metadata: {
        checkout_request_id: requestId,
        organization_id: organizationId,
        payment_type: "dues",
        profile_ids: validated.profileIds.join(","),
        season_id: validated.seasonId,
      },
      lineItems: [
        {
          productName: `${selectedSeason.name} dues`,
          quantity: validated.profileIds.length,
          unitAmountCents: selectedSeason.duesAmountCents,
        },
        ...(totalFeeCents > 0
          ? [
              {
                productName: "Processing fee",
                productDescription: "Covers payment processing costs",
                quantity: 1,
                unitAmountCents: totalFeeCents,
              },
            ]
          : []),
      ],
      ...(recipientEmail ? { customerEmail: recipientEmail } : {}),
      organizationName: paymentSettings.organizationName,
      successUrl: new URL("/dues?checkout=success", origin).href,
    });
  } catch (error: unknown) {
    await expirePendingDuesCheckout(organizationStore, organizationId, requestId, pendingSessionId);
    if (error instanceof StripeCheckoutError) {
      throw new SeasonError("stripe_checkout_unavailable", 503, "Stripe checkout is unavailable.");
    }
    throw error;
  }
  const response = await invokeOrganizationRpc(
    organizationStore,
    "https://organization.internal/internal/seasons/manage",
    {
      body: JSON.stringify({
        action: "attach_dues_session",
        organizationId,
        providerSessionId: stripeSession.id,
        requestId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    await expirePendingDuesCheckout(organizationStore, organizationId, requestId, pendingSessionId);
    const code = await storeErrorCode(response, "season_error");
    throw new SeasonError(code, response.status, "The dues checkout could not be created.");
  }
  return duesCheckoutResponseSchema.parse({
    checkoutMode,
    sessionId: stripeSession.id,
    url: stripeSession.url,
  });
}

export async function listSeasons(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<readonly Season[]> {
  const response = await readOrganizationStore(env, organizationId, "/internal/seasons/list");
  if (!response.ok) throw new SeasonError("seasons_unavailable", 503, "Seasons unavailable.");
  return seasonsResponseSchema.omit({ requestId: true }).parse(await response.json()).seasons;
}

export async function listDues(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<readonly DuesRecord[]> {
  const response = await readOrganizationStore(env, organizationId, "/internal/seasons/dues");
  if (!response.ok) throw new SeasonError("dues_unavailable", 503, "Dues unavailable.");
  return duesRecordsResponseSchema.omit({ requestId: true }).parse(await response.json()).dues;
}

export async function createSeason(
  env: Pick<Env, "ORGANIZATION_STORE">,
  context: ActorContext,
  season: SeasonCreateRequest,
): Promise<Season> {
  const response = await mutateSeason(env, context.organizationId, {
    action: "create_season",
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    season: seasonCreateRequestSchema.parse(season),
    seasonId: crypto.randomUUID(),
  });
  return seasonSchema.parse(await response.json());
}

export async function updateSeason(
  env: Pick<Env, "ORGANIZATION_STORE">,
  context: ActorContext,
  seasonId: string,
  season: SeasonUpdateRequest,
): Promise<Season> {
  const response = await mutateSeason(env, context.organizationId, {
    action: "update_season",
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    season: seasonUpdateRequestSchema.parse(season),
    seasonId: z.uuid().parse(seasonId),
  });
  return seasonSchema.parse(await response.json());
}

export async function activateSeason(
  env: Pick<Env, "ORGANIZATION_STORE">,
  context: ActorContext,
  seasonId: string,
): Promise<Season> {
  const response = await mutateSeason(env, context.organizationId, {
    action: "activate_season",
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    seasonId: z.uuid().parse(seasonId),
  });
  return seasonSchema.parse(await response.json());
}

export async function deleteSeason(
  env: Pick<Env, "ORGANIZATION_STORE">,
  context: ActorContext,
  seasonId: string,
): Promise<void> {
  await mutateSeason(env, context.organizationId, {
    action: "delete_season",
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    seasonId: z.uuid().parse(seasonId),
  });
}

export async function refundDues(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "ORGANIZATION_STORE" | "STRIPE_SECRET_KEY">,
  actor: ActorContext,
  duesId: string,
): Promise<DuesRecord> {
  const current = (await listDues(env, actor.organizationId)).find(({ id }) => id === duesId);
  if (!current) throw new SeasonError("dues_not_found", 404, "Dues record not found.");
  let refundRequest: { readonly fake: boolean };
  try {
    refundRequest = await requestOrganizationProviderRefund(env, {
      actorUserId: actor.actorUserId,
      organizationId: actor.organizationId,
      paymentType: "dues",
      requestId: actor.requestId,
      resourceId: z.uuid().parse(duesId),
    });
  } catch (error: unknown) {
    if (error instanceof PaymentRefundError) {
      throw new SeasonError(error.code, error.status, error.message);
    }
    throw error;
  }
  if (!refundRequest.fake) return { ...current, refundRequested: true };
  const response = await mutateOrganizationStore(
    env,
    actor.organizationId,
    "/internal/seasons/manage",
    {
      action: "refund_dues",
      ...actor,
      duesId: z.uuid().parse(duesId),
    },
  );
  if (!response.ok) {
    const code = await storeErrorCode(response, "season_error");
    throw new SeasonError(code, response.status, "The dues could not be refunded.");
  }
  return duesRecordSchema.parse(await response.json());
}

async function verifyAndExpireStripeSession(
  secretKey: string,
  connectedAccountId: string,
  sessionId: string,
): Promise<void> {
  const session = await retrieveStripeCheckoutReconciliationSession(
    secretKey,
    connectedAccountId,
    sessionId,
  );
  if (session.paymentStatus === "paid") {
    throw new SeasonError(
      "dues_already_paid",
      409,
      "This dues checkout was completed and paid online.",
    );
  }
  if (session.status === "open") {
    const expiredSession = await expireStripeCheckoutSession(
      secretKey,
      connectedAccountId,
      sessionId,
    );
    if (expiredSession.status !== "expired" || expiredSession.paymentStatus === "paid") {
      throw new SeasonError(
        "dues_cancellation_failed",
        409,
        "Stripe checkout session could not be cancelled.",
      );
    }
  } else if (session.status !== "expired") {
    throw new SeasonError(
      "dues_cancellation_failed",
      409,
      `Stripe checkout session status is ${session.status ?? "unknown"}, cannot cancel.`,
    );
  }
}

const duesTargetSchema = z.object({
  createdAt: z.string(),
  id: z.uuid(),
  paymentMethod: z.enum(["cash", "online"]),
  providerSessionId: z.string(),
  sharedCheckout: z.boolean(),
  status: z.enum(["expired", "paid", "pending", "refunded"]),
});

type DuesTarget = z.infer<typeof duesTargetSchema>;

async function expireConnectedStripeSession(
  env: Pick<Env, "STRIPE_SECRET_KEY">,
  stub: OrganizationStoreStub,
  organizationId: string,
  sessionId: string,
): Promise<void> {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!secretKey) {
    throw new SeasonError("stripe_not_configured", 503, "Stripe is not configured.");
  }
  const statusUrl = new URL("https://organization.internal/internal/stripe-connect");
  statusUrl.searchParams.set("organizationId", organizationId);
  const statusResponse = await invokeOrganizationRpc(stub, statusUrl);
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
    throw new SeasonError(
      "stripe_account_not_ready",
      409,
      "Stripe account is unavailable for this Organization.",
    );
  }
  await verifyAndExpireStripeSession(secretKey, status.data.accountId, sessionId);
}

async function validatePendingOnlineCheckout(
  env: Pick<Env, "STRIPE_SECRET_KEY">,
  stub: OrganizationStoreStub,
  organizationId: string,
  cashPayment: DuesCashPaymentRequest,
  target: DuesTarget,
): Promise<{ expectedDuesId: string; expectedProviderSessionId: string }> {
  if (target.sharedCheckout) {
    throw new SeasonError(
      "dues_shared_checkout",
      409,
      "This dues entry is part of a group checkout with multiple members and cannot be converted individually.",
    );
  }
  if (!cashPayment.cancelPendingOnlineCheckout) {
    throw new SeasonError(
      "dues_checkout_in_progress",
      409,
      "An online checkout is in progress for this member.",
    );
  }
  if (cashPayment.expectedDuesId && cashPayment.expectedDuesId !== target.id) {
    throw new SeasonError(
      "dues_state_conflict",
      409,
      "The dues record has changed. Please refresh and try again.",
    );
  }
  if (target.providerSessionId.startsWith("cs_")) {
    await expireConnectedStripeSession(env, stub, organizationId, target.providerSessionId);
  } else if (target.providerSessionId.startsWith("pending_")) {
    const ageMs = Date.now() - new Date(target.createdAt).getTime();
    if (Number.isFinite(ageMs) && ageMs < 30_000) {
      throw new SeasonError(
        "dues_checkout_in_progress",
        409,
        "Online checkout is currently being initialized. Please wait a moment and try again.",
      );
    }
  }
  return {
    expectedDuesId: target.id,
    expectedProviderSessionId: target.providerSessionId,
  };
}

export async function markOrganizationDuesPaidInCash(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "ORGANIZATION_STORE" | "STRIPE_SECRET_KEY">,
  actor: ActorContext,
  cashPayment: DuesCashPaymentRequest,
): Promise<DuesRecord> {
  const stub = organizationStoreStub(env, actor.organizationId);
  const targetUrl = new URL("https://organization.internal/internal/seasons/dues-target");
  targetUrl.searchParams.set("organizationId", actor.organizationId);
  targetUrl.searchParams.set("seasonId", cashPayment.seasonId);
  targetUrl.searchParams.set("profileId", cashPayment.profileId);
  const targetResponse = await invokeOrganizationRpc(stub, targetUrl);

  let expectedDuesId = cashPayment.expectedDuesId;
  let expectedProviderSessionId: string | undefined;

  if (targetResponse.ok) {
    const targetParsed = duesTargetSchema.safeParse(await targetResponse.json().catch(() => null));
    if (targetParsed.success) {
      const target = targetParsed.data;
      if (target.status === "paid") {
        if (target.paymentMethod === "cash") {
          const current = (await listDues(env, actor.organizationId)).find(
            ({ id }) => id === target.id,
          );
          if (current) return current;
        }
        throw new SeasonError("dues_already_paid", 409, "Dues have already been paid.");
      }
      if (target.status === "refunded") {
        throw new SeasonError("dues_refunded", 409, "Dues have already been refunded.");
      }
      if (target.paymentMethod === "online" && target.status === "pending") {
        const validated = await validatePendingOnlineCheckout(
          env,
          stub,
          actor.organizationId,
          cashPayment,
          target,
        );
        expectedDuesId = validated.expectedDuesId;
        expectedProviderSessionId = validated.expectedProviderSessionId;
      }
    }
  }

  const response = await mutateOrganizationStore(
    env,
    actor.organizationId,
    "/internal/seasons/manage",
    {
      action: "mark_dues_cash_paid",
      ...actor,
      cashPayment: duesCashPaymentRequestSchema.parse(cashPayment),
      expectedDuesId,
      expectedProviderSessionId,
    },
  );
  if (!response.ok) {
    const code = await storeErrorCode(response, "season_error");
    throw new SeasonError(code, response.status, "The cash dues payment could not be recorded.");
  }
  return duesRecordSchema.parse(await response.json());
}
