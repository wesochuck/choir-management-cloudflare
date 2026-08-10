import {
  duesCashPaymentRequestSchema,
  duesCheckoutRequestSchema,
  seasonCreateRequestSchema,
  seasonUpdateRequestSchema,
} from "@choir/contracts";
import { z } from "zod";

export const PENDING_DUES_EXPIRY_MS = 7 * 24 * 60 * 60 * 1_000;

const organizationContextSchema = z.object({
  organizationId: z.string().min(1).max(128),
});

export const seasonCreateOperationSchema = organizationContextSchema.extend({
  action: z.literal("create_season"),
  actorUserId: z.string().min(1).max(128),
  requestId: z.uuid(),
  season: seasonCreateRequestSchema,
  seasonId: z.uuid(),
});

export const seasonUpdateOperationSchema = organizationContextSchema.extend({
  action: z.literal("update_season"),
  actorUserId: z.string().min(1).max(128),
  requestId: z.uuid(),
  season: seasonUpdateRequestSchema,
  seasonId: z.uuid(),
});

export const seasonActivateOperationSchema = organizationContextSchema.extend({
  action: z.literal("activate_season"),
  actorUserId: z.string().min(1).max(128),
  requestId: z.uuid(),
  seasonId: z.uuid(),
});

export const seasonDeleteOperationSchema = organizationContextSchema.extend({
  action: z.literal("delete_season"),
  actorUserId: z.string().min(1).max(128),
  requestId: z.uuid(),
  seasonId: z.uuid(),
});

export const createDuesCheckoutOperationSchema = organizationContextSchema.extend({
  action: z.literal("create_dues_checkout"),
  checkout: duesCheckoutRequestSchema,
  requestId: z.uuid(),
  origin: z.string(),
  recipientEmail: z.email().optional(),
  providerSessionId: z.string().trim().min(1).max(256).optional(),
});

export const prepareDuesCheckoutOperationSchema = organizationContextSchema.extend({
  action: z.literal("prepare_dues_checkout"),
  checkout: duesCheckoutRequestSchema,
  requestId: z.uuid(),
  origin: z.string(),
  recipientEmail: z.email().optional(),
  providerSessionId: z.string().trim().min(1).max(256),
});

export const attachDuesSessionOperationSchema = organizationContextSchema.extend({
  action: z.literal("attach_dues_session"),
  providerSessionId: z.string().trim().min(1).max(256),
  requestId: z.uuid(),
});

export const refundOperationSchema = organizationContextSchema.extend({
  action: z.literal("refund_dues"),
  actorUserId: z.string().min(1).max(128),
  duesId: z.uuid(),
  requestId: z.uuid(),
});

export const cashPaymentOperationSchema = organizationContextSchema.extend({
  action: z.literal("mark_dues_cash_paid"),
  actorUserId: z.string().min(1).max(128),
  cashPayment: duesCashPaymentRequestSchema,
  requestId: z.uuid(),
});

const stripeDuesOperationSchema = organizationContextSchema.extend({
  checkoutRequestId: z.uuid().optional(),
  providerPaymentId: z.string().trim().max(256),
  providerSessionId: z.string().trim().min(1).max(256),
  stripeEventId: z.string().trim().min(1).max(256),
});
export const stripeDuesCompletedOperationSchema = stripeDuesOperationSchema.extend({
  action: z.literal("stripe_dues_completed"),
});
export const stripeDuesExpiredOperationSchema = stripeDuesOperationSchema.extend({
  action: z.literal("stripe_dues_expired"),
});
export const stripeDuesRefundedOperationSchema = organizationContextSchema.extend({
  action: z.literal("stripe_dues_refunded"),
  providerPaymentId: z.string().trim().min(1).max(256),
  stripeEventId: z.string().trim().min(1).max(256),
});

export const operationSchema = z.discriminatedUnion("action", [
  seasonCreateOperationSchema,
  seasonUpdateOperationSchema,
  seasonActivateOperationSchema,
  seasonDeleteOperationSchema,
  createDuesCheckoutOperationSchema,
  prepareDuesCheckoutOperationSchema,
  attachDuesSessionOperationSchema,
  refundOperationSchema,
  cashPaymentOperationSchema,
  stripeDuesCompletedOperationSchema,
  stripeDuesExpiredOperationSchema,
  stripeDuesRefundedOperationSchema,
]);

export interface SeasonRow {
  readonly [column: string]: SqlStorageValue;
  readonly createdAt: string;
  readonly duesAmountCents: number;
  readonly endsAt: string;
  readonly id: string;
  readonly isActive: number;
  readonly name: string;
  readonly startsAt: string;
  readonly updatedAt: string;
}

export interface DuesRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountCents: number;
  readonly createdAt: string;
  readonly feeCents: number;
  readonly id: string;
  readonly paidAt: string | null;
  readonly payerEmail: string;
  readonly payerName: string;
  readonly paymentMethod: "cash" | "online";
  readonly profileId: string;
  readonly providerPaymentId: string;
  readonly providerSessionId: string;
  readonly refundRequested: number;
  readonly seasonId: string;
  readonly status: "expired" | "paid" | "pending" | "refunded";
  readonly updatedAt: string;
}

export const seasonSelect = `SELECT s.id, s.name, s.starts_at AS startsAt, s.ends_at AS endsAt,
  s.dues_amount_cents AS duesAmountCents, s.is_active AS isActive,
  s.created_at AS createdAt, s.updated_at AS updatedAt
  FROM seasons s`;

export const duesSelect = `SELECT d.id, d.season_id AS seasonId, d.profile_id AS profileId,
  d.amount_cents AS amountCents, d.fee_cents AS feeCents,
  CASE WHEN de.dues_id IS NOT NULL AND d.status = 'pending' THEN 'expired' ELSE d.status END AS status,
  d.paid_at AS paidAt,
  d.payment_method AS paymentMethod,
  d.payer_email AS payerEmail,
  COALESCE(p.display_name, 'Member') AS payerName,
  d.provider_payment_id AS providerPaymentId,
  d.provider_session_id AS providerSessionId,
  EXISTS (SELECT 1 FROM payment_attempts pa
    WHERE pa.payment_type = 'dues'
      AND pa.provider_payment_id = d.provider_payment_id
      AND pa.refund_requested_at IS NOT NULL) AS refundRequested,
  d.created_at AS createdAt, d.updated_at AS updatedAt
  FROM dues d
  LEFT JOIN profiles p ON p.id = d.profile_id
  LEFT JOIN dues_expirations de ON de.dues_id = d.id`;
