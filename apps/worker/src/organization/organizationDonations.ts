import {
  donationCheckoutRequestSchema,
  donationRecordSchema,
  donationRecordsResponseSchema,
  patronRecordsResponseSchema,
  type DonationCheckoutRequest,
  type DonationRecord,
  type PatronRecord,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";
import { issueSignedLink } from "../security/signedLinks";

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

function stub(env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) {
  return env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));
}

async function errorCode(response: Response): Promise<string> {
  const value: unknown = await response.json().catch(() => null);
  return typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string"
    ? value.code
    : "donation_error";
}

type CheckoutMode = "disabled" | "fake" | "stripe";

function donationCheckoutMode(env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE">): CheckoutMode {
  if (env.EXTERNAL_EFFECTS_MODE === "disabled" || env.APP_ENV === "production") return "disabled";
  if (env.EXTERNAL_EFFECTS_MODE === "fake") return "fake";
  return "stripe";
}

export async function createDonationCheckoutSession(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
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
  const providerSessionId = `fake_session_${crypto.randomUUID()}`;
  const response = await stub(env, organizationId).fetch(
    "https://organization.internal/internal/donations/manage",
    {
      body: JSON.stringify({
        action: "create_donation_checkout",
        checkout: validated,
        donationId,
        organizationId,
        providerSessionId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    const code = await errorCode(response);
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
  const url = new URL("https://organization.internal/internal/donations/list");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok)
    throw new DonationError("donations_unavailable", 503, "Donations unavailable.");
  return donationRecordsResponseSchema
    .omit({ requestId: true })
    .parse(await response.json()).donations;
}

export async function listOrganizationPatrons(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<readonly PatronRecord[]> {
  const url = new URL("https://organization.internal/internal/donations/patrons");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok)
    throw new DonationError("patrons_unavailable", 503, "Patrons unavailable.");
  return patronRecordsResponseSchema.omit({ requestId: true }).parse(await response.json()).patrons;
}

export async function refundOrganizationDonation(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "ORGANIZATION_STORE">,
  actor: ActorContext,
  donationId: string,
): Promise<DonationRecord> {
  donationCheckoutMode(env);
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/donations/manage",
    {
      body: JSON.stringify({
        action: "refund_donation",
        ...actor,
        donationId: z.uuid().parse(donationId),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    const code = await errorCode(response);
    throw new DonationError(code, response.status, "The donation could not be refunded.");
  }
  return donationRecordSchema.parse(await response.json());
}
