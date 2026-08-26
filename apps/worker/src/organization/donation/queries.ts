import { donationPaymentMethodSchema, donationTributeTypeSchema } from "@choir/contracts";
import { z } from "zod";

import type { createFakeCheckoutOperationSchema } from "./types";
import { type DonationRow, type IdentityRow, type PatronRow, donationSelect } from "./types";

export function identity(storage: DurableObjectStorage): IdentityRow | undefined {
  return storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
}

export function donationByStripeOperation(
  storage: DurableObjectStorage,
  providerSessionId: string,
  checkoutRequestId?: string,
): DonationRow | undefined {
  return storage.sql
    .exec<DonationRow>(
      `${donationSelect}
       WHERE d.provider_session_id = ?
          OR (? IS NOT NULL AND d.checkout_request_id = ?)
       LIMIT 1`,
      providerSessionId,
      checkoutRequestId ?? null,
      checkoutRequestId ?? null,
    )
    .toArray()
    .at(0);
}

export function donationResult(row: DonationRow) {
  const tributeTypeParsed = donationTributeTypeSchema.safeParse(row.tributeType);
  const tributeType = tributeTypeParsed.success ? tributeTypeParsed.data : "none";
  const paymentMethodParsed = donationPaymentMethodSchema.safeParse(row.paymentMethod);
  const paymentMethod = paymentMethodParsed.success ? paymentMethodParsed.data : "stripe";
  return {
    amountCents: row.amountCents,
    anonymous: row.anonymous === 1,
    buyerEmail: row.buyerEmail,
    buyerName: row.buyerName,
    createdAt: row.createdAt,
    expiredAt: row.expiredAt,
    feeCents: row.feeCents,
    id: row.id,
    marketingConsent: row.marketingConsent === 1,
    patronId: row.patronId,
    paymentMethod,
    paymentReference: row.paymentReference,
    refundRequested: row.refundRequested === 1,
    status: row.status,
    thankYouSentAt: row.thankYouSentAt,
    tributeName: row.tributeName,
    tributeNotifyEmail: row.tributeNotifyEmail,
    tributeType,
    updatedAt: row.updatedAt,
  };
}

export function donationById(
  storage: DurableObjectStorage,
  donationId: string,
): DonationRow | undefined {
  return storage.sql
    .exec<DonationRow>(`${donationSelect} WHERE d.id = ? LIMIT 1`, donationId)
    .toArray()
    .at(0);
}

export function donationByCheckoutRequest(
  storage: DurableObjectStorage,
  checkoutRequestId: string,
): DonationRow | undefined {
  return storage.sql
    .exec<DonationRow>(
      `${donationSelect} WHERE d.checkout_request_id = ? LIMIT 1`,
      checkoutRequestId,
    )
    .toArray()
    .at(0);
}

export function sameCheckoutRequest(
  existing: DonationRow,
  checkout: z.infer<typeof createFakeCheckoutOperationSchema>["checkout"],
): boolean {
  return (
    existing.buyerName === checkout.buyerName &&
    existing.buyerEmail === checkout.buyerEmail.toLowerCase() &&
    existing.amountCents === checkout.amountCents &&
    existing.anonymous === (checkout.anonymous ? 1 : 0) &&
    existing.marketingConsent === (checkout.marketingConsent ? 1 : 0) &&
    existing.tributeType === checkout.tributeType &&
    existing.tributeName === checkout.tributeName &&
    existing.tributeNotifyEmail === checkout.tributeNotifyEmail
  );
}

export function listDonationsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (identity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({
    donations: storage.sql
      .exec<DonationRow>(`${donationSelect} ORDER BY d.created_at DESC, d.id DESC LIMIT 500`)
      .toArray()
      .map(donationResult),
  });
}

export function readDonationFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  donationId: string | null,
): Response {
  const parsedId = z.uuid().safeParse(donationId);
  if (identity(storage)?.organizationId !== organizationId || !parsedId.success) {
    return Response.json({ code: "donation_not_found" }, { status: 404 });
  }
  const donation = donationById(storage, parsedId.data);
  return donation
    ? Response.json(donationResult(donation))
    : Response.json({ code: "donation_not_found" }, { status: 404 });
}

export function listPatronsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (identity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({
    patrons: storage.sql
      .exec<PatronRow>(
        `SELECT id, name, email, total_donated_cents AS totalDonatedCents,
          donation_count AS donationCount,
          first_donated_at AS firstDonatedAt,
          last_donated_at AS lastDonatedAt
         FROM patrons
         ORDER BY total_donated_cents DESC, name COLLATE NOCASE ASC, id ASC LIMIT 500`,
      )
      .toArray(),
  });
}
