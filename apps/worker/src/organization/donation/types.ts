import { donationCheckoutRequestSchema, manualDonationCreateRequestSchema } from "@choir/contracts";
import { z } from "zod";

export const organizationContextSchema = z.object({
  organizationId: z.string().min(1).max(128),
});

export const createFakeCheckoutOperationSchema = organizationContextSchema.extend({
  action: z.literal("create_donation_checkout"),
  checkout: donationCheckoutRequestSchema,
  donationId: z.uuid(),
  providerSessionId: z.string().min(1).max(256),
});

export const createPendingCheckoutOperationSchema = organizationContextSchema.extend({
  action: z.literal("create_stripe_pending_donation"),
  checkout: donationCheckoutRequestSchema,
  donationId: z.uuid(),
  providerSessionId: z.string().min(1).max(256),
});

export const createManualDonationOperationSchema = organizationContextSchema.extend({
  action: z.literal("create_manual_donation"),
  actorUserId: z.string().min(1).max(128),
  donation: manualDonationCreateRequestSchema,
  donationId: z.uuid(),
  requestId: z.uuid(),
});

export const updateDonationThankYouOperationSchema = organizationContextSchema.extend({
  action: z.literal("update_donation_thank_you"),
  actorUserId: z.string().min(1).max(128),
  donationId: z.uuid(),
  requestId: z.uuid(),
  thankYouSent: z.boolean(),
});

export const attachStripeSessionOperationSchema = organizationContextSchema.extend({
  action: z.literal("attach_stripe_donation_session"),
  donationId: z.uuid(),
  providerSessionId: z.string().min(1).max(256),
});

export const refundOperationSchema = organizationContextSchema.extend({
  action: z.literal("refund_donation"),
  actorUserId: z.string().min(1).max(128),
  donationId: z.uuid(),
  requestId: z.uuid(),
});

export const stripeDonationOperationSchema = organizationContextSchema.extend({
  checkoutRequestId: z.uuid().optional(),
  providerPaymentId: z.string().trim().max(256),
  providerSessionId: z.string().trim().min(1).max(256),
  stripeEventId: z.string().trim().min(1).max(256),
});
export const stripeDonationCompletedOperationSchema = stripeDonationOperationSchema.extend({
  action: z.literal("stripe_donation_completed"),
});
export const stripeDonationExpiredOperationSchema = stripeDonationOperationSchema.extend({
  action: z.literal("stripe_donation_expired"),
});
export const stripeDonationRefundedOperationSchema = organizationContextSchema.extend({
  action: z.literal("stripe_donation_refunded"),
  providerPaymentId: z.string().trim().min(1).max(256),
  stripeEventId: z.string().trim().min(1).max(256),
});

export const operationSchema = z.discriminatedUnion("action", [
  createFakeCheckoutOperationSchema,
  createPendingCheckoutOperationSchema,
  createManualDonationOperationSchema,
  updateDonationThankYouOperationSchema,
  attachStripeSessionOperationSchema,
  refundOperationSchema,
  stripeDonationCompletedOperationSchema,
  stripeDonationExpiredOperationSchema,
  stripeDonationRefundedOperationSchema,
]);

export interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

export interface DonationRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountCents: number;
  readonly anonymous: number;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly contactId: string | null;
  readonly createdAt: string;
  readonly expiredAt: string | null;
  readonly feeCents: number;
  readonly id: string;
  readonly marketingConsent: number;
  readonly patronId: string | null;
  readonly paymentMethod: string;
  readonly paymentReference: string;
  readonly providerPaymentId: string;
  readonly providerSessionId: string;
  readonly refundRequested: number;
  readonly status: "expired" | "paid" | "pending" | "refunded";
  readonly thankYouSentAt: string | null;
  readonly tributeName: string;
  readonly tributeNotifyEmail: string;
  readonly tributeType: string;
  readonly updatedAt: string;
}

export interface PatronRow {
  readonly [column: string]: SqlStorageValue;
  readonly donationCount: number;
  readonly email: string;
  readonly firstDonatedAt: string;
  readonly id: string;
  readonly lastDonatedAt: string;
  readonly name: string;
  readonly totalDonatedCents: number;
}

export const donationSelect = `SELECT d.id,
  CASE WHEN de.donation_id IS NOT NULL AND d.status = 'pending' THEN 'expired' ELSE d.status END AS status,
  de.expired_at AS expiredAt, d.amount_cents AS amountCents,
  d.fee_cents AS feeCents,
  COALESCE(d.payment_method, 'stripe') AS paymentMethod,
  COALESCE(d.payment_reference, '') AS paymentReference,
  d.thank_you_sent_at AS thankYouSentAt,
  d.tribute_type AS tributeType, d.tribute_name AS tributeName,
  d.tribute_notify_email AS tributeNotifyEmail, d.anonymous,
  d.marketing_consent AS marketingConsent,
  d.buyer_name AS buyerName, d.buyer_email AS buyerEmail,
  d.patron_id AS patronId, d.provider_session_id AS providerSessionId,
  d.provider_payment_id AS providerPaymentId,
  d.contact_id AS contactId,
  EXISTS (SELECT 1 FROM payment_attempts pa
    WHERE pa.payment_type = 'donation'
      AND pa.resource_id = d.id
      AND pa.refund_requested_at IS NOT NULL) AS refundRequested,
  d.created_at AS createdAt, d.updated_at AS updatedAt
  FROM donations d LEFT JOIN donation_expirations de ON de.donation_id = d.id`;
