import {
  discountCodeRequestSchema,
  ticketCheckoutQuoteRequestSchema,
  ticketBundleRequestSchema,
  ticketCheckoutRequestSchema,
} from "@choir/contracts";
import { z } from "zod";

const organizationContextSchema = z.object({
  organizationId: z.string().min(1).max(128),
});

export const createFakeCheckoutOperationSchema = organizationContextSchema.extend({
  action: z.literal("create_fake_checkout"),
  checkout: ticketCheckoutRequestSchema,
  purchaseId: z.uuid(),
  providerSessionId: z.string().min(1).max(256),
});

export const createPendingCheckoutOperationSchema = organizationContextSchema.extend({
  action: z.literal("create_stripe_pending"),
  checkout: ticketCheckoutRequestSchema,
  purchaseId: z.uuid(),
  providerSessionId: z.string().min(1).max(256),
});

export const quoteTicketCheckoutOperationSchema = organizationContextSchema.extend({
  action: z.literal("quote_ticket_checkout"),
  checkout: ticketCheckoutQuoteRequestSchema,
});

export const attachStripeSessionOperationSchema = organizationContextSchema.extend({
  action: z.literal("attach_stripe_session"),
  providerSessionId: z.string().min(1).max(256),
  purchaseId: z.uuid(),
});

export const refundOperationSchema = organizationContextSchema.extend({
  action: z.literal("refund_fake_purchase"),
  actorUserId: z.string().min(1).max(128),
  purchaseId: z.uuid(),
  requestId: z.uuid(),
});

const stripeTicketOperationSchema = organizationContextSchema.extend({
  checkoutRequestId: z.uuid().optional(),
  providerPaymentId: z.string().trim().max(256),
  providerSessionId: z.string().trim().min(1).max(256),
  stripeEventId: z.string().trim().min(1).max(256),
});

export const validateScanOperationSchema = organizationContextSchema.extend({
  action: z.literal("validate_ticket_scan"),
  actorUserId: z.string().min(1).max(128),
  eventId: z.uuid(),
  purchaseId: z.uuid(),
  requestId: z.uuid(),
  scanNonce: z.string().min(1).max(128),
});

export const issueScanCredentialOperationSchema = organizationContextSchema.extend({
  action: z.literal("issue_ticket_scan_credential"),
  purchaseId: z.uuid(),
  requestId: z.uuid(),
});

const bundleActorSchema = organizationContextSchema.extend({
  actorUserId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

export const upsertBundleOperationSchema = bundleActorSchema.extend({
  action: z.literal("upsert_ticket_bundle"),
  bundle: ticketBundleRequestSchema,
  bundleId: z.uuid(),
});

export const deleteBundleOperationSchema = bundleActorSchema.extend({
  action: z.literal("delete_ticket_bundle"),
  bundleId: z.uuid(),
});

export const ticketNotificationResultOperationSchema = organizationContextSchema.extend({
  action: z.literal("record_ticket_notification_result"),
  failureDetail: z.string().max(2_000),
  jobId: z.uuid(),
  providerMessageId: z.string().max(512).nullable(),
  status: z.enum(["failed", "sent", "suppressed"]),
});

export const resendConfirmationOperationSchema = bundleActorSchema.extend({
  action: z.literal("resend_ticket_confirmation"),
  purchaseId: z.uuid(),
  recipientEmail: z.email().optional(),
});

export const upsertDiscountCodeOperationSchema = bundleActorSchema.extend({
  allowCreate: z.boolean(),
  action: z.literal("upsert_discount_code"),
  code: discountCodeRequestSchema,
  codeId: z.uuid(),
});

export const deactivateDiscountCodeOperationSchema = bundleActorSchema.extend({
  action: z.literal("deactivate_discount_code"),
  codeId: z.uuid(),
});

export const stripeTicketCompletedOperationSchema = stripeTicketOperationSchema.extend({
  action: z.literal("stripe_ticket_completed"),
});
export const stripeTicketExpiredOperationSchema = stripeTicketOperationSchema.extend({
  action: z.literal("stripe_ticket_expired"),
});
export const stripeTicketRefundedOperationSchema = organizationContextSchema.extend({
  action: z.literal("stripe_ticket_refunded"),
  providerPaymentId: z.string().trim().min(1).max(256),
  stripeEventId: z.string().trim().min(1).max(256),
});

export const operationSchema = z.discriminatedUnion("action", [
  createFakeCheckoutOperationSchema,
  createPendingCheckoutOperationSchema,
  quoteTicketCheckoutOperationSchema,
  attachStripeSessionOperationSchema,
  refundOperationSchema,
  validateScanOperationSchema,
  issueScanCredentialOperationSchema,
  upsertBundleOperationSchema,
  deleteBundleOperationSchema,
  ticketNotificationResultOperationSchema,
  resendConfirmationOperationSchema,
  upsertDiscountCodeOperationSchema,
  deactivateDiscountCodeOperationSchema,
  stripeTicketCompletedOperationSchema,
  stripeTicketExpiredOperationSchema,
  stripeTicketRefundedOperationSchema,
]);

export interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
  readonly timezone: string;
}

export interface TicketEventRow {
  readonly [column: string]: SqlStorageValue;
  readonly advancePriceCents: number;
  readonly dayOfPriceCents: number;
  readonly isArchived: number;
  readonly isCanceled: number;
  readonly isTicketingEnabled: number;
  readonly publishOnWebsite: number;
  readonly startsAt: string;
  readonly ticketCapacity: number | null;
  readonly title: string;
  readonly type: string;
}

export interface TicketPurchaseRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountPaidCents: number;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly bundleId: string | null;
  readonly bundleTitle: string;
  readonly createdAt: string;
  readonly currency: "usd";
  readonly eventId: string;
  readonly eventStartsAt: string;
  readonly eventTitle: string;
  readonly discountAmountCents: number;
  readonly discountCode: string;
  readonly discountCodeId: string | null;
  readonly discountType: string;
  readonly discountValue: number;
  readonly discountedSubtotalCents: number;
  readonly feeCents: number;
  readonly id: string;
  readonly includedEventsJson: string;
  readonly marketingOptIn: number;
  readonly originalSubtotalCents: number;
  readonly originalUnitPriceCents: number;
  readonly providerPaymentId: string;
  readonly providerSessionId: string;
  readonly quantity: number;
  readonly refundRequested: number;
  readonly scanCredentialExpiresAt: number | null;
  readonly scanCredentialIssuedAt: number | null;
  readonly scanCredentialNonce: string | null;
  readonly status: "expired" | "paid" | "pending" | "refunded";
  readonly timezone: string;
  readonly unitPriceCents: number;
  readonly updatedAt: string;
}

export interface TicketBundleRow {
  readonly [column: string]: SqlStorageValue;
  readonly capacity: number | null;
  readonly createdAt: string;
  readonly id: string;
  readonly isActive: number;
  readonly priceCents: number;
  readonly saleEndAt: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface DiscountCodeRow {
  readonly [column: string]: SqlStorageValue;
  readonly active: number;
  readonly bundleId: string | null;
  readonly code: string;
  readonly createdAt: string;
  readonly deactivatedAt: string | null;
  readonly discountType: "fixed" | "percentage";
  readonly discountValue: number;
  readonly eventId: string | null;
  readonly firstRedeemedAt: string | null;
  readonly id: string;
  readonly itemTitle: string;
  readonly itemType: "performance" | "bundle";
  readonly originalRevenueCents: number;
  readonly pendingReservationCount: number;
  readonly redemptionCount: number;
  readonly redemptionLimit: number | null;
  readonly revenueCents: number;
  readonly updatedAt: string;
}

export const purchaseSelect = `SELECT id, event_id AS eventId, event_title AS eventTitle,
  event_starts_at AS eventStartsAt, event_timezone AS timezone,
  bundle_id AS bundleId, bundle_title AS bundleTitle,
  included_events_json AS includedEventsJson,
  buyer_name AS buyerName, buyer_email AS buyerEmail,
  quantity, unit_price_cents AS unitPriceCents, fee_cents AS feeCents,
  amount_paid_cents AS amountPaidCents, currency,
  discount_code_id AS discountCodeId, discount_code AS discountCode,
  discount_type AS discountType, discount_value AS discountValue,
  original_unit_price_cents AS originalUnitPriceCents,
  original_subtotal_cents AS originalSubtotalCents,
  discount_amount_cents AS discountAmountCents,
  discounted_subtotal_cents AS discountedSubtotalCents,
  provider_session_id AS providerSessionId, provider_payment_id AS providerPaymentId,
  status, marketing_opt_in AS marketingOptIn,
  EXISTS (SELECT 1 FROM payment_attempts pa
    WHERE pa.payment_type IN ('ticket', 'bundle')
      AND pa.resource_id = ticket_purchases.id
      AND pa.refund_requested_at IS NOT NULL) AS refundRequested,
  created_at AS createdAt, updated_at AS updatedAt,
  scan_credential_nonce AS scanCredentialNonce,
  scan_credential_issued_at AS scanCredentialIssuedAt,
  scan_credential_expires_at AS scanCredentialExpiresAt
  FROM ticket_purchases`;
