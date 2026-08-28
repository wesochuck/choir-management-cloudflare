import {
  donationCheckoutRequestSchema,
  donationRecordSchema,
  donationRecordsResponseSchema,
  publicDonationReceiptResponseSchema,
  patronRecordsResponseSchema,
  type DonationCheckoutRequest,
  type DonationRecord,
  type PatronRecord,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";
import { issueSignedLink, verifySignedLinkScope } from "../security/signedLinks";
import { createStripeCheckoutSession, StripeCheckoutError } from "../payments/stripeConnect";
import { TicketCheckoutUnavailableError, ticketCheckoutMode } from "../payments/ticketCheckout";
import { readOrganizationPaymentActivations } from "./organizationPaymentSettings";
import { PaymentRefundError, requestOrganizationProviderRefund } from "../payments/refundRequest";
import { invokeOrganizationRpc, organizationStoreStub } from "./rpc/client";
import { mutateOrganizationStore, readOrganizationStore, storeErrorCode } from "./rpc/repository";

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export class DonationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DonationError";
  }
}

async function expirePendingDonationCheckout(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  donationId: string,
  checkoutRequestId: string,
  providerSessionId: string,
): Promise<void> {
  const response = await mutateOrganizationStore(
    env,
    organizationId,
    "/internal/donations/manage",
    {
      action: "stripe_donation_expired",
      checkoutRequestId,
      organizationId,
      providerPaymentId: "",
      providerSessionId,
      stripeEventId: `checkout-failed:${donationId}`,
    },
  );
  if (!response.ok)
    throw new DonationError(
      "donation_checkout_cleanup_failed",
      503,
      "The donation checkout could not be cleaned up.",
    );
}

type CheckoutMode = "disabled" | "fake" | "stripe";

function donationCheckoutMode(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "STRIPE_PAYMENTS_ENABLED">,
): CheckoutMode {
  try {
    return ticketCheckoutMode(env);
  } catch (error: unknown) {
    if (error instanceof TicketCheckoutUnavailableError) return "disabled";
    throw error;
  }
}

// eslint-disable-next-line complexity -- coordinates the fake and Stripe Connect checkout paths.
export async function createDonationCheckoutSession(
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
  checkout: DonationCheckoutRequest,
) {
  const validated = donationCheckoutRequestSchema.parse(checkout);
  const checkoutMode = donationCheckoutMode(env);
  if (checkoutMode === "disabled") {
    throw new DonationError("donations_disabled", 501, "Donations are disabled.");
  }
  const donationId = crypto.randomUUID();
  if (checkoutMode === "stripe") {
    const settings = await readOrganizationPaymentActivations(env, organizationId);
    if (!settings.activations.donations) {
      throw new DonationError(
        "payments_not_activated",
        409,
        "Online donation payments are not enabled for this Organization.",
      );
    }
    const stripeStatusResponse = await invokeOrganizationRpc(
      organizationStoreStub(env, organizationId),
      `https://organization.internal/internal/stripe-connect?organizationId=${encodeURIComponent(organizationId)}`,
    );
    const stripeStatus = z
      .object({
        accountId: z
          .string()
          .regex(/^acct_[A-Za-z0-9]+$/)
          .nullable(),
        status: z.enum(["not_started", "onboarding", "restricted", "ready"]),
      })
      .safeParse(await stripeStatusResponse.json().catch(() => null));
    const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
    if (!stripeStatusResponse.ok || !stripeStatus.success || stripeStatus.data.status !== "ready") {
      throw new DonationError(
        "stripe_account_not_ready",
        409,
        "Online donations are not available until the Organization finishes Stripe setup.",
      );
    }
    if (!secretKey || !stripeStatus.data.accountId) {
      throw new DonationError("stripe_not_configured", 503, "Online donations are not configured.");
    }
    const pendingSessionId = `pending_${donationId}`;
    const pendingResponse = await mutateOrganizationStore(
      env,
      organizationId,
      "/internal/donations/manage",
      {
        action: "create_stripe_pending_donation",
        checkout: validated,
        donationId,
        organizationId,
        providerSessionId: pendingSessionId,
      },
    );
    if (!pendingResponse.ok) {
      throw new DonationError(
        await storeErrorCode(pendingResponse, "donation_error"),
        pendingResponse.status,
        "The donation could not be reserved.",
      );
    }
    const pendingDonation = donationRecordSchema.parse(await pendingResponse.json());
    const successToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      issuedAt: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
      organizationId,
      purpose: "donation_receipt",
      resourceId: pendingDonation.id,
      version: 1,
    });
    const successUrl = new URL("/donate/success", origin);
    successUrl.searchParams.set("token", successToken);
    const lineItems = [
      { productName: "Donation", quantity: 1, unitAmountCents: pendingDonation.amountCents },
    ];
    if (pendingDonation.feeCents > 0) {
      lineItems.push({
        productName: "Processing fee",
        quantity: 1,
        unitAmountCents: pendingDonation.feeCents,
      });
    }
    let stripeSession: { readonly id: string; readonly url: string };
    try {
      stripeSession = await createStripeCheckoutSession(secretKey, stripeStatus.data.accountId, {
        cancelUrl: new URL("/donate", origin).href,
        currency: "usd",
        customerEmail: pendingDonation.buyerEmail,
        lineItems,
        metadata: {
          checkout_request_id: validated.checkoutRequestId,
          donation_id: pendingDonation.id,
          organization_id: organizationId,
          payment_type: "donation",
        },
        organizationName: settings.organizationName,
        successUrl: successUrl.href,
      });
    } catch (error: unknown) {
      await expirePendingDonationCheckout(
        env,
        organizationId,
        donationId,
        validated.checkoutRequestId,
        pendingSessionId,
      );
      if (error instanceof StripeCheckoutError) {
        throw new DonationError(
          "stripe_checkout_unavailable",
          503,
          "Stripe checkout is unavailable.",
        );
      }
      throw error;
    }
    const attachedResponse = await mutateOrganizationStore(
      env,
      organizationId,
      "/internal/donations/manage",
      {
        action: "attach_stripe_donation_session",
        donationId,
        organizationId,
        providerSessionId: stripeSession.id,
      },
    );
    if (!attachedResponse.ok) {
      await expirePendingDonationCheckout(
        env,
        organizationId,
        donationId,
        validated.checkoutRequestId,
        pendingSessionId,
      );
      throw new DonationError(
        "donation_checkout_attach_failed",
        503,
        "Stripe checkout could not be attached.",
      );
    }
    return {
      checkoutMode,
      donation: donationRecordSchema.parse(await attachedResponse.json()),
      successToken,
      url: stripeSession.url,
    };
  }
  const providerSessionId = `fake_session_${crypto.randomUUID()}`;
  const response = await mutateOrganizationStore(
    env,
    organizationId,
    "/internal/donations/manage",
    {
      action: "create_donation_checkout",
      checkout: validated,
      donationId,
      organizationId,
      providerSessionId,
    },
  );
  if (!response.ok) {
    const code = await storeErrorCode(response, "donation_error");
    throw new DonationError(code, response.status, "The donation could not be completed.");
  }
  const donation = donationRecordSchema.parse(await response.json());
  const issuedAt = Math.floor(Date.now() / 1000);
  const successToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt: issuedAt + 7 * 24 * 60 * 60,
    issuedAt,
    nonce: crypto.randomUUID(),
    organizationId,
    purpose: "donation_receipt",
    resourceId: donation.id,
    version: 1,
  });
  const url = new URL("/donate/success", origin);
  url.searchParams.set("token", successToken);
  return {
    checkoutMode,
    donation: donationRecordSchema.parse(donation),
    successToken,
    url: url.href,
  };
}

export async function listOrganizationDonations(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<readonly DonationRecord[]> {
  const response = await readOrganizationStore(env, organizationId, "/internal/donations/list");
  if (!response.ok) throw new DonationError("donations_unavailable", 503, "Donations unavailable.");
  return donationRecordsResponseSchema.omit({ requestId: true }).parse(await response.json())
    .donations;
}

export async function listOrganizationPatrons(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<readonly PatronRecord[]> {
  const response = await readOrganizationStore(env, organizationId, "/internal/donations/patrons");
  if (!response.ok) throw new DonationError("patrons_unavailable", 503, "Patrons unavailable.");
  return patronRecordsResponseSchema.omit({ requestId: true }).parse(await response.json()).patrons;
}

export async function readPublicDonationReceipt(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  token: string,
) {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "donation_receipt",
  });
  if (!envelope?.resourceId || !z.uuid().safeParse(envelope.resourceId).success) {
    throw new DonationError("donation_receipt_invalid", 404, "Donation receipt not found.");
  }
  const url = new URL("https://organization.internal/internal/donations/donation");
  url.searchParams.set("donationId", envelope.resourceId);
  url.searchParams.set("organizationId", organizationId);
  const response = await invokeOrganizationRpc(organizationStoreStub(env, organizationId), url);
  if (!response.ok) throw new DonationError("donation_not_found", 404, "Donation not found.");
  const donation = donationRecordSchema.parse(await response.json());
  return publicDonationReceiptResponseSchema.parse({
    ...donation,
    requestId: crypto.randomUUID(),
  });
}

export async function recordManualOrganizationDonation(
  env: Pick<Env, "ORGANIZATION_STORE">,
  actor: ActorContext,
  donation: unknown,
): Promise<DonationRecord> {
  const response = await mutateOrganizationStore(
    env,
    actor.organizationId,
    "/internal/donations/manage",
    {
      action: "create_manual_donation",
      ...actor,
      donation,
      donationId: crypto.randomUUID(),
    },
  );
  if (!response.ok) {
    const code = await storeErrorCode(response, "donation_error");
    throw new DonationError(code, response.status, "The manual donation could not be recorded.");
  }
  return donationRecordSchema.parse(await response.json());
}

export async function updateOrganizationDonationThankYou(
  env: Pick<Env, "ORGANIZATION_STORE">,
  actor: ActorContext,
  payload: { readonly donationId: string; readonly thankYouSent: boolean },
): Promise<DonationRecord> {
  const response = await mutateOrganizationStore(
    env,
    actor.organizationId,
    "/internal/donations/manage",
    {
      action: "update_donation_thank_you",
      ...actor,
      donationId: payload.donationId,
      thankYouSent: payload.thankYouSent,
    },
  );
  if (!response.ok) {
    const code = await storeErrorCode(response, "donation_error");
    throw new DonationError(
      code,
      response.status,
      "The thank-you letter status could not be updated.",
    );
  }
  return donationRecordSchema.parse(await response.json());
}

export async function refundOrganizationDonation(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "ORGANIZATION_STORE" | "STRIPE_SECRET_KEY">,
  actor: ActorContext,
  donationId: string,
): Promise<DonationRecord> {
  const current = (await listOrganizationDonations(env, actor.organizationId)).find(
    ({ id }) => id === donationId,
  );
  if (!current) throw new DonationError("donation_not_found", 404, "Donation not found.");
  if (current.paymentMethod === "stripe") {
    let refundRequest: { readonly fake: boolean };
    try {
      refundRequest = await requestOrganizationProviderRefund(env, {
        actorUserId: actor.actorUserId,
        organizationId: actor.organizationId,
        paymentType: "donation",
        requestId: actor.requestId,
        resourceId: z.uuid().parse(donationId),
      });
    } catch (error: unknown) {
      if (error instanceof PaymentRefundError) {
        throw new DonationError(error.code, error.status, error.message);
      }
      throw error;
    }
    if (!refundRequest.fake) return { ...current, refundRequested: true };
  }
  const response = await mutateOrganizationStore(
    env,
    actor.organizationId,
    "/internal/donations/manage",
    {
      action: "refund_donation",
      ...actor,
      donationId: z.uuid().parse(donationId),
    },
  );
  if (!response.ok) {
    const code = await storeErrorCode(response, "donation_error");
    throw new DonationError(code, response.status, "The donation could not be refunded.");
  }
  return donationRecordSchema.parse(await response.json());
}
