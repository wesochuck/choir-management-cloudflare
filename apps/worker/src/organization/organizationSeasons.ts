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
  type DuesCheckoutRequest,
  type DuesRecord,
  type Season,
  type SeasonCreateRequest,
  type SeasonUpdateRequest,
} from "@choir/contracts";
import { transactionProcessingFeeCents } from "@choir/domain";
import { z } from "zod";

import type { Env } from "../env";
import { createStripeCheckoutSession, StripeCheckoutError } from "../payments/stripeConnect";
import { ticketCheckoutMode } from "../payments/ticketCheckout";
import { readOrganizationPaymentActivations } from "./organizationPaymentSettings";
import { PaymentRefundError, requestOrganizationProviderRefund } from "../payments/refundRequest";
import { invokeOrganizationRpc, organizationStoreStub } from "./rpc/client";
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
  const paymentSettings = await readOrganizationPaymentActivations(env, organizationId);
  if (!paymentSettings.activations.dues) {
    throw new SeasonError(
      "payments_not_activated",
      409,
      "Online dues payments are not enabled for this Organization.",
    );
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
  const feeCents = transactionProcessingFeeCents(selectedSeason.duesAmountCents, feeSettings.data);
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
        ...(feeCents > 0
          ? [
              {
                productName: "Processing fee",
                quantity: validated.profileIds.length,
                unitAmountCents: feeCents,
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

export async function markOrganizationDuesPaidInCash(
  env: Pick<Env, "ORGANIZATION_STORE">,
  actor: ActorContext,
  cashPayment: { readonly profileId: string; readonly seasonId: string },
): Promise<DuesRecord> {
  const response = await mutateOrganizationStore(
    env,
    actor.organizationId,
    "/internal/seasons/manage",
    {
      action: "mark_dues_cash_paid",
      ...actor,
      cashPayment: duesCashPaymentRequestSchema.parse(cashPayment),
    },
  );
  if (!response.ok) {
    const code = await storeErrorCode(response, "season_error");
    throw new SeasonError(code, response.status, "The cash dues payment could not be recorded.");
  }
  return duesRecordSchema.parse(await response.json());
}
