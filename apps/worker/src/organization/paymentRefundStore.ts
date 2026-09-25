import { z } from "zod";
import {
  refundStripeTicketPurchases,
  type TicketRefundMutationResult,
} from "./ticketingStore/payments";
import { refundStripeDonation } from "./donation/stripeLifecycle";
import { refundStripeDues } from "./seasonStore/payments";

const paymentTypeSchema = z.enum(["ticket", "bundle", "donation", "dues"]);
const refundRequestSchema = z.object({
  action: z.literal("record_provider_refund_requested"),
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  paymentType: paymentTypeSchema,
  requestId: z.uuid(),
  resourceId: z.uuid(),
});

const reconcileProviderRefundSchema = z.object({
  action: z.literal("reconcile_provider_refund"),
  organizationId: z.string().min(1).max(128),
  providerPaymentId: z.string().min(1).max(256),
  providerSessionId: z.string().min(1).max(256).optional(),
  stripeEventId: z.string().min(1).max(256),
});

interface PaymentRefundTargetRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountCents: number;
  readonly attemptId: string;
  readonly paymentType: string;
  readonly providerPaymentId: string;
  readonly refundRequestedAt: string | null;
  readonly resourceId: string;
  readonly sharedMemberCount: number;
  readonly status: string;
}

function paymentAttemptForResource(
  storage: DurableObjectStorage,
  paymentType: string,
  resourceId: string,
): PaymentRefundTargetRow | undefined {
  return storage.sql
    .exec<PaymentRefundTargetRow>(
      `SELECT id AS attemptId, payment_type AS paymentType, resource_id AS resourceId,
        provider_payment_id AS providerPaymentId, amount_cents AS amountCents, status,
        refund_requested_at AS refundRequestedAt, 1 AS sharedMemberCount
       FROM payment_attempts
       WHERE payment_type = ? AND resource_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      paymentType,
      resourceId,
    )
    .toArray()
    .at(0);
}

function paymentAttemptForDuesMember(
  storage: DurableObjectStorage,
  duesId: string,
): PaymentRefundTargetRow | undefined {
  return storage.sql
    .exec<PaymentRefundTargetRow>(
      `SELECT pa.id AS attemptId, pa.payment_type AS paymentType,
        d.id AS resourceId, pa.provider_payment_id AS providerPaymentId,
        d.amount_cents + d.fee_cents AS amountCents, pa.status,
        pa.refund_requested_at AS refundRequestedAt,
        (SELECT COUNT(*) FROM dues sibling
         WHERE sibling.payment_method = 'online'
           AND sibling.status = 'paid'
           AND (
             (d.provider_payment_id <> '' AND sibling.provider_payment_id = d.provider_payment_id)
             OR (d.provider_session_id <> '' AND sibling.provider_session_id = d.provider_session_id)
           )) AS sharedMemberCount
       FROM dues d
       JOIN payment_attempts pa
         ON pa.payment_type = 'dues'
        AND (
          (d.provider_payment_id <> '' AND pa.provider_payment_id = d.provider_payment_id)
          OR (d.provider_session_id <> '' AND pa.provider_session_id = d.provider_session_id)
        )
       WHERE d.id = ? AND d.status = 'paid' AND d.payment_method = 'online'
         AND pa.status = 'paid'
       ORDER BY pa.created_at DESC LIMIT 1`,
      duesId,
    )
    .toArray()
    .at(0);
}

function paymentRefundTarget(
  storage: DurableObjectStorage,
  paymentType: string,
  resourceId: string,
): PaymentRefundTargetRow | undefined {
  if (paymentType === "dues") {
    return paymentAttemptForDuesMember(storage, resourceId) ?? undefined;
  }
  const direct = paymentAttemptForResource(storage, paymentType, resourceId);
  return direct;
}

export function readPaymentRefundTargetFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  paymentTypeInput: string | null,
  resourceId: string | null,
): Response {
  const paymentType = paymentTypeSchema.safeParse(paymentTypeInput);
  const resource = z.uuid().safeParse(resourceId);
  const actualOrganizationId = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (actualOrganizationId !== organizationId || !paymentType.success || !resource.success) {
    return Response.json({ code: "payment_refund_target_not_found" }, { status: 404 });
  }
  const target = paymentRefundTarget(storage, paymentType.data, resource.data);
  return target
    ? Response.json({
        amountCents: target.amountCents,
        paymentType: target.paymentType,
        providerPaymentId: target.providerPaymentId,
        refundRequested: target.refundRequestedAt !== null,
        resourceId: target.resourceId,
        sharedMemberCount: target.sharedMemberCount,
        status: target.status,
      })
    : Response.json({ code: "payment_refund_target_not_found" }, { status: 404 });
}

export function recordProviderRefundRequestedInStore(
  storage: DurableObjectStorage,
  input: unknown,
): Response {
  const request = refundRequestSchema.safeParse(input);
  if (!request.success) return Response.json({ code: "invalid_refund_request" }, { status: 400 });
  const organizationId = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (organizationId !== request.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const target = paymentRefundTarget(storage, request.data.paymentType, request.data.resourceId);
  if (!target) return Response.json({ code: "payment_refund_target_not_found" }, { status: 404 });
  if (target.status === "refunded") return Response.json({ requested: true, duplicate: true });
  if (target.status !== "paid")
    return Response.json({ code: "payment_not_refundable" }, { status: 409 });
  if (target.refundRequestedAt) return Response.json({ requested: true, duplicate: true });
  const occurredAt = new Date().toISOString();
  storage.sql.exec(
    `UPDATE payment_attempts
     SET refund_requested_at = ?, updated_at = ?
     WHERE id = ? AND status = 'paid' AND refund_requested_at IS NULL`,
    occurredAt,
    occurredAt,
    target.attemptId,
  );
  const auditId = `payment-refund-request:${request.data.requestId}`;
  storage.sql.exec(
    `INSERT OR IGNORE INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, 'payment.refund.requested',
      'payment', ?, ?, ?, ?)`,
    auditId,
    request.data.actorUserId,
    request.data.resourceId,
    request.data.requestId,
    JSON.stringify({ paymentType: request.data.paymentType, resourceId: request.data.resourceId }),
    occurredAt,
  );
  return Response.json({ requested: true });
}

function isStripeRefundAlreadyAudited(
  storage: DurableObjectStorage,
  stripeEventId: string,
): boolean {
  const existingAudit = storage.sql
    .exec(
      "SELECT id FROM audit_events WHERE id IN (?, ?, ?, ?) LIMIT 1",
      `stripe-refund:ticket:${stripeEventId}`,
      `stripe-refund:donation:${stripeEventId}`,
      `stripe-refund:dues:${stripeEventId}`,
      `stripe-refund:${stripeEventId}`,
    )
    .toArray();
  return existingAudit.length > 0;
}

function countMatchingRows(storage: DurableObjectStorage, query: string, param: string): number {
  const rows = storage.sql.exec<{ readonly count: number }>(query, param).toArray();
  return rows[0]?.count ?? 0;
}

function findMatchingRefundDomains(
  storage: DurableObjectStorage,
  providerPaymentId: string,
): ("ticket" | "donation" | "dues")[] {
  const matching: ("ticket" | "donation" | "dues")[] = [];

  const ticketCount =
    countMatchingRows(
      storage,
      "SELECT COUNT(*) AS count FROM ticket_purchases WHERE provider_payment_id = ?",
      providerPaymentId,
    ) +
    countMatchingRows(
      storage,
      "SELECT COUNT(*) AS count FROM payment_attempts WHERE provider_payment_id = ? AND payment_type IN ('ticket', 'bundle')",
      providerPaymentId,
    );
  if (ticketCount > 0) matching.push("ticket");

  const donationCount =
    countMatchingRows(
      storage,
      "SELECT COUNT(*) AS count FROM donations WHERE provider_payment_id = ?",
      providerPaymentId,
    ) +
    countMatchingRows(
      storage,
      "SELECT COUNT(*) AS count FROM payment_attempts WHERE provider_payment_id = ? AND payment_type = 'donation'",
      providerPaymentId,
    );
  if (donationCount > 0) matching.push("donation");

  const duesCount =
    countMatchingRows(
      storage,
      "SELECT COUNT(*) AS count FROM dues WHERE provider_payment_id = ?",
      providerPaymentId,
    ) +
    countMatchingRows(
      storage,
      "SELECT COUNT(*) AS count FROM payment_attempts WHERE provider_payment_id = ? AND payment_type = 'dues'",
      providerPaymentId,
    );
  if (duesCount > 0) matching.push("dues");

  return matching;
}

function dispatchDomainRefund(
  storage: DurableObjectStorage,
  domain: "ticket" | "donation" | "dues",
  organizationId: string,
  providerPaymentId: string,
  stripeEventId: string,
): TicketRefundMutationResult {
  if (domain === "ticket") {
    return refundStripeTicketPurchases(storage, {
      action: "stripe_ticket_refunded",
      organizationId,
      providerPaymentId,
      stripeEventId,
    });
  }
  if (domain === "donation") {
    return {
      response: refundStripeDonation(storage, {
        action: "stripe_donation_refunded",
        organizationId,
        providerPaymentId,
        stripeEventId,
      }),
      schedulerWorkQueued: false,
    };
  }
  return {
    response: refundStripeDues(storage, {
      action: "stripe_dues_refunded",
      organizationId,
      providerPaymentId,
      stripeEventId,
    }),
    schedulerWorkQueued: false,
  };
}

export function reconcileProviderRefundWithMetadataInStore(
  storage: DurableObjectStorage,
  input: unknown,
): TicketRefundMutationResult {
  const request = reconcileProviderRefundSchema.safeParse(input);
  if (!request.success) {
    return {
      response: Response.json({ code: "invalid_refund_request" }, { status: 400 }),
      schedulerWorkQueued: false,
    };
  }

  const organizationId = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (organizationId !== request.data.organizationId) {
    return {
      response: Response.json({ code: "organization_identity_conflict" }, { status: 409 }),
      schedulerWorkQueued: false,
    };
  }

  if (isStripeRefundAlreadyAudited(storage, request.data.stripeEventId)) {
    return {
      response: Response.json({ duplicate: true, refunded: 0 }),
      schedulerWorkQueued: false,
    };
  }

  const { providerPaymentId, stripeEventId } = request.data;
  const matchingDomains = findMatchingRefundDomains(storage, providerPaymentId);

  if (matchingDomains.length > 1) {
    return {
      response: Response.json({ code: "ambiguous_payment_refund" }, { status: 409 }),
      schedulerWorkQueued: false,
    };
  }
  const domain = matchingDomains[0];
  if (!domain) {
    return {
      response: Response.json({ code: "payment_not_found" }, { status: 404 }),
      schedulerWorkQueued: false,
    };
  }

  return dispatchDomainRefund(storage, domain, organizationId, providerPaymentId, stripeEventId);
}

export function reconcileProviderRefundInStore(
  storage: DurableObjectStorage,
  input: unknown,
): Response {
  return reconcileProviderRefundWithMetadataInStore(storage, input).response;
}

const reconcilePaymentProcessorFeeSchema = z.object({
  action: z.literal("reconcile_payment_processor_fee"),
  organizationId: z.string().min(1).max(128),
  processorFeeCents: z.number().int().nonnegative(),
  providerBalanceTransactionId: z.string().min(1).max(256).nullable().optional(),
  providerPaymentId: z.string().min(1).max(256),
});

export function reconcilePaymentProcessorFeeInStore(
  storage: DurableObjectStorage,
  input: unknown,
): Response {
  const request = reconcilePaymentProcessorFeeSchema.safeParse(input);
  if (!request.success) {
    return Response.json({ code: "invalid_reconcile_processor_fee_request" }, { status: 400 });
  }

  const organizationId = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (organizationId !== request.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }

  const matchingAttempts = storage.sql
    .exec<{
      readonly id: string;
      readonly processorFeeCents: number | null;
      readonly providerBalanceTransactionId: string | null;
    }>(
      `SELECT id, processor_fee_cents AS processorFeeCents,
        provider_balance_transaction_id AS providerBalanceTransactionId
       FROM payment_attempts
       WHERE provider_payment_id = ?`,
      request.data.providerPaymentId,
    )
    .toArray();

  if (matchingAttempts.length === 0) {
    return Response.json({ code: "payment_attempt_not_found" }, { status: 404 });
  }

  const allAlreadyReconciled = matchingAttempts.every(
    (attempt) =>
      attempt.processorFeeCents === request.data.processorFeeCents &&
      (request.data.providerBalanceTransactionId === undefined ||
        attempt.providerBalanceTransactionId === request.data.providerBalanceTransactionId),
  );

  if (allAlreadyReconciled) {
    return Response.json({ duplicate: true, reconciled: true });
  }

  const occurredAt = new Date().toISOString();
  storage.sql.exec(
    `UPDATE payment_attempts
     SET processor_fee_cents = ?,
         provider_balance_transaction_id = COALESCE(?, provider_balance_transaction_id),
         processor_fee_reconciled_at = COALESCE(processor_fee_reconciled_at, ?),
         updated_at = ?
     WHERE provider_payment_id = ?`,
    request.data.processorFeeCents,
    request.data.providerBalanceTransactionId ?? null,
    occurredAt,
    occurredAt,
    request.data.providerPaymentId,
  );

  storage.sql.exec(
    `INSERT OR IGNORE INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
     VALUES (?, 'provider', 'stripe', 'payment.processor_fee.reconciled', 'payment_attempt', ?, ?, ?, ?)`,
    `processor-fee-reconciled:${request.data.providerPaymentId}`,
    request.data.providerPaymentId,
    request.data.providerPaymentId,
    JSON.stringify({
      processorFeeCents: request.data.processorFeeCents,
      providerBalanceTransactionId: request.data.providerBalanceTransactionId ?? null,
      providerPaymentId: request.data.providerPaymentId,
    }),
    occurredAt,
  );

  return Response.json({ reconciled: true });
}

export function listUnreconciledPaymentAttempts(
  storage: DurableObjectStorage,
  limit = 50,
): readonly string[] {
  return storage.sql
    .exec<{ readonly providerPaymentId: string }>(
      `SELECT DISTINCT provider_payment_id AS providerPaymentId
       FROM payment_attempts
       WHERE status IN ('paid', 'refunded')
         AND processor_fee_cents IS NULL
         AND provider_payment_id NOT LIKE 'fake_%'
         AND provider_payment_id <> ''
       LIMIT ?`,
      limit,
    )
    .toArray()
    .map((row) => row.providerPaymentId);
}
