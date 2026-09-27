import type { SqlStorageValue } from "@cloudflare/workers-types";
import type { PlatformStripeReconciliationCursor } from "@choir/contracts";
import type { LocalPaymentCandidate } from "@choir/domain";
import { linkPaidTicketPurchaseContact } from "./commerceContacts";

const candidateQuery = `SELECT
  pa.id AS paymentAttemptId,
  pa.payment_type AS paymentType,
  pa.resource_id AS resourceId,
  pa.provider_payment_id AS providerPaymentId,
  pa.provider_session_id AS providerSessionId,
  pa.checkout_request_id AS checkoutRequestId,
  p.checkout_request_id AS resourceCheckoutRequestId,
  pa.amount_cents AS amountCents,
  pa.status AS paymentAttemptStatus,
  p.status AS resourceStatus,
  p.currency AS currency,
  pa.refund_requested_at AS refundRequestedAt,
  COALESCE(pa.refunded_at, p.refunded_at) AS refundedAt,
  p.amount_paid_cents AS resourceAmountCents,
  p.provider_payment_id AS resourceProviderPaymentId,
  p.expires_at AS expiresAt,
  p.event_id AS eventId,
  p.quantity AS quantity,
  p.bundle_id AS bundleId,
  p.discount_code_id AS discountCodeId,
  (SELECT dcr.status FROM discount_code_redemptions dcr
   WHERE dcr.purchase_id = p.id LIMIT 1) AS discountRedemptionStatus,
  (SELECT dcr.discount_code_id FROM discount_code_redemptions dcr
   WHERE dcr.purchase_id = p.id LIMIT 1) AS redemptionDiscountCodeId,
  pa.processor_fee_cents AS processorFeeCents,
  pa.processor_fee_reconciled_at AS processorFeeReconciledAt,
  pa.provider_balance_transaction_id AS providerBalanceTransactionId,
  pa.created_at AS createdAt
FROM payment_attempts pa {{index-hint}}
JOIN ticket_purchases p ON pa.payment_type IN ('ticket', 'bundle') AND pa.resource_id = p.id
WHERE pa.payment_type IN ('ticket', 'bundle')
  AND (pa.status IN ('paid', 'refunded', 'pending', 'expired') OR
       p.status IN ('paid', 'refunded', 'pending', 'expired'))
  AND pa.provider_payment_id NOT LIKE 'fake_%'
  AND (pa.provider_payment_id <> '' OR pa.provider_session_id GLOB 'cs_*')
  AND pa.amount_cents > 0
  AND (? IS NULL OR pa.created_at >= ?)
  AND pa.created_at <= ?
  {{pagination-filter}}
ORDER BY pa.created_at DESC, pa.id DESC
LIMIT ?`;

interface CandidateDbRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountCents: number;
  readonly bundleId: string | null;
  readonly checkoutRequestId: string;
  readonly createdAt: string;
  readonly currency: string | null;
  readonly discountCodeId: string | null;
  readonly discountRedemptionStatus: string | null;
  readonly eventId: string;
  readonly expiresAt: string | null;
  readonly paymentAttemptId: string;
  readonly paymentAttemptStatus: string;
  readonly paymentType: "ticket" | "bundle";
  readonly quantity: number;
  readonly processorFeeCents: number | null;
  readonly processorFeeReconciledAt: string | null;
  readonly providerBalanceTransactionId: string | null;
  readonly providerPaymentId: string;
  readonly providerSessionId: string;
  readonly refundRequestedAt: string | null;
  readonly redemptionDiscountCodeId: string | null;
  readonly refundedAt: string | null;
  readonly resourceAmountCents: number;
  readonly resourceCheckoutRequestId: string;
  readonly resourceProviderPaymentId: string;
  readonly resourceId: string;
  readonly resourceStatus: string;
}

interface CapacityQueryRow {
  readonly [column: string]: SqlStorageValue;
  readonly capacity: number | null;
}

interface QuantityQueryRow {
  readonly [column: string]: SqlStorageValue;
  readonly quantity: number;
}

interface BundleAllocationRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly quantity: number;
}

function discountFulfillmentBlockReason(
  storage: DurableObjectStorage,
  row: CandidateDbRow,
): string | null {
  const discountCodeId = row.discountCodeId;
  if (discountCodeId === null && row.discountRedemptionStatus !== null) {
    return "A discount redemption exists without a matching discount code on the purchase.";
  }
  if (discountCodeId !== null) {
    const redemption = row.discountRedemptionStatus;
    if (
      redemption === null ||
      row.redemptionDiscountCodeId !== discountCodeId ||
      (redemption !== "pending" && redemption !== "released")
    ) {
      return "The purchase discount reservation is missing or inconsistent; review the discount before fulfillment.";
    }
    if (redemption === "released") {
      const code = storage.sql
        .exec<{
          readonly [column: string]: SqlStorageValue;
          readonly redemptionLimit: number | null;
        }>(
          "SELECT redemption_limit AS redemptionLimit FROM discount_codes WHERE id = ? LIMIT 1",
          discountCodeId,
        )
        .toArray()
        .at(0);
      if (!code) {
        return "The discount code for this purchase no longer exists; review the discount before fulfillment.";
      }
      if (code.redemptionLimit !== null) {
        const otherRedemptions = storage.sql
          .exec<QuantityQueryRow>(
            `SELECT COUNT(*) AS quantity FROM discount_code_redemptions
             WHERE discount_code_id = ? AND purchase_id <> ? AND status IN ('pending', 'confirmed')`,
            discountCodeId,
            row.resourceId,
          )
          .one().quantity;
        if (otherRedemptions >= code.redemptionLimit) {
          return "The discount code has reached its redemption limit since this reservation was released; review the purchase manually.";
        }
      }
    }
  }
  return null;
}

function eventCapacityBlockReason(
  storage: DurableObjectStorage,
  row: CandidateDbRow,
  now: string,
): string | null {
  const allocations = row.bundleId
    ? storage.sql
        .exec<BundleAllocationRow>(
          `SELECT event_id AS eventId, quantity FROM ticket_bundle_allocations
           WHERE purchase_id = ? ORDER BY event_id`,
          row.resourceId,
        )
        .toArray()
    : [{ eventId: row.eventId, quantity: row.quantity }];
  if (allocations.length === 0) {
    return "The ticket purchase has no event allocation; review the order before fulfillment.";
  }

  for (const allocation of allocations) {
    const event = storage.sql
      .exec<CapacityQueryRow>(
        "SELECT ticket_capacity AS capacity FROM events WHERE id = ? LIMIT 1",
        allocation.eventId,
      )
      .toArray()
      .at(0);
    if (!event) {
      return "A performance attached to this purchase no longer exists; review the order before fulfillment.";
    }
    if (event.capacity !== null) {
      const committedQuantity = storage.sql
        .exec<QuantityQueryRow>(
          `SELECT
            COALESCE((SELECT SUM(quantity) FROM ticket_purchases
              WHERE event_id = ? AND bundle_id IS NULL AND id <> ?
                AND (status = 'paid' OR (status = 'pending' AND
                  (expires_at IS NULL OR expires_at = '' OR expires_at >= ?)))), 0) +
            COALESCE((SELECT SUM(p.quantity) FROM ticket_bundle_allocations a
              JOIN ticket_purchases p ON p.id = a.purchase_id
              WHERE a.event_id = ? AND p.id <> ?
                AND (p.status = 'paid' OR (p.status = 'pending' AND
                  (p.expires_at IS NULL OR p.expires_at = '' OR p.expires_at >= ?)))), 0)
            AS quantity`,
          allocation.eventId,
          row.resourceId,
          now,
          allocation.eventId,
          row.resourceId,
          now,
        )
        .one().quantity;
      if (committedQuantity + allocation.quantity > event.capacity) {
        return "Performance capacity has been filled since this checkout reservation expired; review the order before issuing tickets.";
      }
    }
  }

  return null;
}

function bundleCapacityBlockReason(
  storage: DurableObjectStorage,
  row: CandidateDbRow,
  now: string,
): string | null {
  if (row.bundleId === null) return null;
  const bundle = storage.sql
    .exec<CapacityQueryRow>(
      "SELECT capacity FROM ticket_bundles WHERE id = ? LIMIT 1",
      row.bundleId,
    )
    .toArray()
    .at(0);
  if (!bundle) {
    return "The ticket bundle no longer exists; review the order before fulfillment.";
  }
  if (bundle.capacity === null) return null;
  const committedBundles = storage.sql
    .exec<QuantityQueryRow>(
      `SELECT COALESCE(SUM(quantity), 0) AS quantity FROM ticket_purchases
       WHERE bundle_id = ? AND id <> ? AND
         (status = 'paid' OR (status = 'pending' AND
           (expires_at IS NULL OR expires_at = '' OR expires_at >= ?)))`,
      row.bundleId,
      row.resourceId,
      now,
    )
    .one().quantity;
  return committedBundles + row.quantity > bundle.capacity
    ? "Bundle capacity has been filled since this checkout reservation expired; review the order before issuing tickets."
    : null;
}

function ticketFulfillmentBlockReason(
  storage: DurableObjectStorage,
  row: CandidateDbRow,
  now: string,
): string | null {
  return (
    discountFulfillmentBlockReason(storage, row) ??
    eventCapacityBlockReason(storage, row, now) ??
    bundleCapacityBlockReason(storage, row, now)
  );
}

interface CandidateListInput {
  readonly cursor?: PlatformStripeReconciliationCursor | undefined;
  readonly limit?: number | null | undefined;
  readonly organizationId: string;
  readonly paymentAttemptIds?: readonly string[] | undefined;
  readonly providerPaymentIds?: readonly string[] | undefined;
  readonly resourceIds?: readonly string[] | undefined;
  readonly snapshotAt?: string | undefined;
  readonly since?: string | null | undefined;
}

function requestedCandidateIds(input: CandidateListInput): readonly string[] | undefined {
  return input.paymentAttemptIds ?? input.resourceIds ?? input.providerPaymentIds;
}

function readCandidateRows(
  storage: DurableObjectStorage,
  input: CandidateListInput,
  limit: number,
  snapshotAt: string,
  requestedIds: readonly string[] | undefined,
): CandidateDbRow[] {
  const queryParameters: SqlStorageValue[] = [input.since ?? null, input.since ?? null, snapshotAt];
  let paginationFilter = "";
  if (requestedIds !== undefined) {
    const selectionColumn =
      input.paymentAttemptIds !== undefined
        ? "pa.id"
        : input.resourceIds !== undefined
          ? "pa.resource_id"
          : "pa.provider_payment_id";
    paginationFilter = `AND ${selectionColumn} IN (${requestedIds.map(() => "?").join(", ")})`;
    queryParameters.push(...requestedIds);
  } else if (input.cursor !== undefined) {
    paginationFilter = `AND (pa.created_at, pa.id) < (?, ?)`;
    queryParameters.push(input.cursor.createdAt, input.cursor.paymentAttemptId);
  }
  queryParameters.push(limit + 1);
  return storage.sql
    .exec<CandidateDbRow>(
      candidateQuery
        .replace(
          "{{index-hint}}",
          requestedIds === undefined
            ? "INDEXED BY payment_attempts_stripe_reconciliation_page"
            : "",
        )
        .replace("{{pagination-filter}}", paginationFilter),
      ...queryParameters,
    )
    .toArray();
}

function reconciliationCandidateFromRow(
  storage: DurableObjectStorage,
  row: CandidateDbRow,
  organizationId: string,
  now: string,
): LocalPaymentCandidate {
  return {
    amountCents: row.amountCents,
    checkoutRequestId: row.checkoutRequestId,
    resourceCheckoutRequestId: row.resourceCheckoutRequestId,
    createdAt: row.createdAt,
    currency: row.currency,
    paymentAttemptId: row.paymentAttemptId,
    paymentAttemptStatus: row.paymentAttemptStatus,
    paymentType: row.paymentType,
    processorFeeCents: row.processorFeeCents,
    processorFeeReconciledAt: row.processorFeeReconciledAt,
    providerBalanceTransactionId: row.providerBalanceTransactionId,
    discountCodeId: row.discountCodeId,
    providerPaymentId: row.providerPaymentId,
    providerSessionId: row.providerSessionId,
    organizationId,
    refundRequestedAt: row.refundRequestedAt,
    refundedAt: row.refundedAt,
    resourceId: row.resourceId,
    resourceAmountCents: row.resourceAmountCents,
    resourceProviderPaymentId: row.resourceProviderPaymentId,
    resourceStatus: row.resourceStatus,
    fulfillmentBlockReason:
      row.resourceStatus === "pending" || row.resourceStatus === "expired"
        ? ticketFulfillmentBlockReason(storage, row, now)
        : null,
  };
}

export function listStripePaymentReconciliationCandidatesInStore(
  storage: DurableObjectStorage,
  input: CandidateListInput,
): {
  readonly candidates: readonly LocalPaymentCandidate[];
  readonly hasMore: boolean;
  readonly nextCursor: PlatformStripeReconciliationCursor | null;
  readonly snapshotAt: string;
} {
  const snapshotAt = input.snapshotAt ?? new Date().toISOString();
  const actualOrganizationId = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;

  if (actualOrganizationId !== input.organizationId) {
    return { candidates: [], hasMore: false, nextCursor: null, snapshotAt };
  }

  const requestedIds = requestedCandidateIds(input);
  if (requestedIds && (requestedIds.length === 0 || requestedIds.length > 200)) {
    return { candidates: [], hasMore: false, nextCursor: null, snapshotAt };
  }
  const limit = Math.min(Math.max(requestedIds?.length ?? input.limit ?? 50, 1), 200);
  const rows = readCandidateRows(storage, input, limit, snapshotAt, requestedIds);

  const hasMore = requestedIds === undefined && rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const now = new Date().toISOString();
  const candidates: LocalPaymentCandidate[] = pageRows.map((row) =>
    reconciliationCandidateFromRow(storage, row, input.organizationId, now),
  );

  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow
      ? { createdAt: lastRow.createdAt, paymentAttemptId: lastRow.paymentAttemptId }
      : null;
  return { candidates, hasMore, nextCursor, snapshotAt };
}

export interface ApplyHistoricalStripeReconciliationInput {
  readonly actions: readonly ("mark_paid" | "mark_refunded" | "backfill_fee")[];
  readonly adminUserId: string;
  readonly candidate: LocalPaymentCandidate;
  readonly organizationId: string;
  readonly providerPaymentId: string;
  readonly reason: string;
  readonly stripeSnapshot: {
    readonly amountChargedCents: number;
    readonly amountCapturedCents: number | null;
    readonly amountReceivedCents: number | null;
    readonly amountRefundedCents: number;
    readonly chargeCaptured: boolean | null;
    readonly chargeStatus: string | null;
    readonly checkoutSessionAmountCents: number | null;
    readonly checkoutSessionCurrency: string | null;
    readonly checkoutSessionId: string | null;
    readonly checkoutSessionMode: string | null;
    readonly checkoutSessionOrganizationId: string | null;
    readonly checkoutSessionPaymentStatus: string | null;
    readonly checkoutSessionPaymentType: string | null;
    readonly checkoutSessionPurchaseId: string | null;
    readonly checkoutSessionRequestId: string | null;
    readonly checkoutSessionStatus: string | null;
    readonly currency: string | null;
    readonly fullyRefunded: boolean;
    readonly paymentIntentId: string | null;
    readonly paymentIntentStatus: string | null;
    readonly processorFeeCents: number | null;
    readonly providerBalanceTransactionId: string | null;
    readonly providerPaymentId: string;
    readonly refundCompletedAt: string | null;
  };
}

export interface ApplyHistoricalStripeReconciliationResult {
  readonly actionsApplied: readonly ("mark_paid" | "mark_refunded" | "backfill_fee")[];
  readonly message?: string;
  readonly status: "applied" | "skipped" | "failed";
}

interface ReconciliationPurchaseRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountPaidCents: number;
  readonly bundleId: string | null;
  readonly id: string;
  readonly status: string;
}

class StripeReconciliationStateChangedError extends Error {
  constructor() {
    super("The local payment changed during reconciliation.");
    this.name = "StripeReconciliationStateChangedError";
  }
}

function reconciliationCandidateByIdentity(
  storage: DurableObjectStorage,
  candidate: LocalPaymentCandidate,
): CandidateDbRow | undefined {
  return storage.sql
    .exec<CandidateDbRow>(
      `SELECT
        pa.id AS paymentAttemptId, pa.payment_type AS paymentType,
        pa.resource_id AS resourceId, pa.provider_payment_id AS providerPaymentId,
        pa.provider_session_id AS providerSessionId,
        pa.checkout_request_id AS checkoutRequestId, pa.amount_cents AS amountCents,
        p.checkout_request_id AS resourceCheckoutRequestId,
        pa.status AS paymentAttemptStatus, p.status AS resourceStatus,
        p.currency AS currency, pa.refund_requested_at AS refundRequestedAt,
        COALESCE(pa.refunded_at, p.refunded_at) AS refundedAt,
        p.amount_paid_cents AS resourceAmountCents,
        p.provider_payment_id AS resourceProviderPaymentId,
        p.expires_at AS expiresAt, p.event_id AS eventId, p.quantity AS quantity,
        p.bundle_id AS bundleId, p.discount_code_id AS discountCodeId,
        (SELECT dcr.status FROM discount_code_redemptions dcr
         WHERE dcr.purchase_id = p.id LIMIT 1) AS discountRedemptionStatus,
        (SELECT dcr.discount_code_id FROM discount_code_redemptions dcr
         WHERE dcr.purchase_id = p.id LIMIT 1) AS redemptionDiscountCodeId,
        pa.processor_fee_cents AS processorFeeCents,
        pa.processor_fee_reconciled_at AS processorFeeReconciledAt,
        pa.provider_balance_transaction_id AS providerBalanceTransactionId,
        pa.created_at AS createdAt
       FROM payment_attempts pa
       JOIN ticket_purchases p ON pa.resource_id = p.id
       WHERE pa.id = ? AND p.id = ?
       LIMIT 1`,
      candidate.paymentAttemptId,
      candidate.resourceId,
    )
    .toArray()
    .at(0);
}

function paidCheckoutSessionMatches(
  candidate: LocalPaymentCandidate,
  snapshot: ApplyHistoricalStripeReconciliationInput["stripeSnapshot"],
  expectedCurrency: string,
): boolean {
  if (candidate.providerPaymentId !== "") {
    return snapshot.providerPaymentId === candidate.providerPaymentId;
  }
  return [
    snapshot.checkoutSessionId === candidate.providerSessionId,
    snapshot.checkoutSessionOrganizationId === candidate.organizationId,
    snapshot.checkoutSessionPurchaseId === candidate.resourceId,
    snapshot.checkoutSessionRequestId === candidate.checkoutRequestId,
    snapshot.checkoutSessionPaymentType === candidate.paymentType,
    snapshot.checkoutSessionMode === "payment",
    snapshot.checkoutSessionStatus === "complete",
    snapshot.checkoutSessionPaymentStatus === "paid",
    snapshot.checkoutSessionAmountCents === candidate.amountCents,
    snapshot.checkoutSessionCurrency?.toLowerCase() === expectedCurrency,
  ].every(Boolean);
}

function paidReconciliationSnapshotMatches(
  candidate: LocalPaymentCandidate,
  snapshot: ApplyHistoricalStripeReconciliationInput["stripeSnapshot"],
  expectedProviderPaymentId: string,
): boolean {
  const expectedCurrency = candidate.currency?.toLowerCase() ?? "usd";
  const paymentIdentityMatches = [
    snapshot.providerPaymentId !== "",
    snapshot.providerPaymentId === expectedProviderPaymentId,
    candidate.providerPaymentId === "" ||
      snapshot.providerPaymentId === candidate.providerPaymentId,
    snapshot.amountChargedCents === candidate.amountCents,
    snapshot.amountRefundedCents === 0,
    !snapshot.fullyRefunded,
    snapshot.currency?.toLowerCase() === expectedCurrency,
  ].every(Boolean);
  const successfulCaptureMatches = [
    snapshot.amountCapturedCents === candidate.amountCents,
    snapshot.chargeCaptured === true,
    snapshot.chargeStatus === "succeeded",
    snapshot.paymentIntentId === snapshot.providerPaymentId,
    snapshot.paymentIntentStatus === "succeeded",
    snapshot.amountReceivedCents === candidate.amountCents,
  ].every(Boolean);
  if (
    !paymentIdentityMatches ||
    !successfulCaptureMatches ||
    !paidCheckoutSessionMatches(candidate, snapshot, expectedCurrency)
  ) {
    return false;
  }
  return true;
}

function localTicketPaymentMatches(row: CandidateDbRow, candidate: LocalPaymentCandidate): boolean {
  return [
    row.providerPaymentId === candidate.providerPaymentId,
    row.resourceProviderPaymentId === candidate.providerPaymentId,
    row.checkoutRequestId === candidate.checkoutRequestId,
    row.resourceCheckoutRequestId === candidate.resourceCheckoutRequestId,
    row.providerSessionId === candidate.providerSessionId,
    row.paymentType === candidate.paymentType,
    row.amountCents === candidate.amountCents,
    row.resourceAmountCents === candidate.amountCents,
    row.currency?.toLowerCase() === (candidate.currency?.toLowerCase() ?? "usd"),
    row.paymentAttemptStatus === candidate.paymentAttemptStatus,
    row.resourceStatus === candidate.resourceStatus,
    row.paymentAttemptStatus === "pending" || row.paymentAttemptStatus === "expired",
    row.paymentAttemptStatus === row.resourceStatus,
  ].every(Boolean);
}

function applyPaidTicketTransition(
  storage: DurableObjectStorage,
  input: ApplyHistoricalStripeReconciliationInput,
  occurredAt: string,
): { readonly applied: boolean; readonly message?: string | undefined } {
  if (
    !paidReconciliationSnapshotMatches(
      input.candidate,
      input.stripeSnapshot,
      input.providerPaymentId,
    )
  ) {
    return {
      applied: false,
      message: "Stripe no longer confirms a fully captured payment matching this ticket amount.",
    };
  }
  const row = reconciliationCandidateByIdentity(storage, input.candidate);
  if (!row) {
    return {
      applied: false,
      message: "The selected local ticket payment was not found; refresh the preview.",
    };
  }
  if (!localTicketPaymentMatches(row, input.candidate)) {
    return {
      applied: false,
      message:
        "The local purchase or payment attempt changed after preview; refresh and review it again.",
    };
  }
  if (row.refundRequestedAt !== null || row.refundedAt !== null) {
    return {
      applied: false,
      message: "Refund activity appeared after preview; review the payment manually.",
    };
  }
  const blocked = ticketFulfillmentBlockReason(storage, row, occurredAt);
  if (blocked) return { applied: false, message: blocked };

  const purchaseTransition = storage.sql
    .exec<{ readonly id: string }>(
      `UPDATE ticket_purchases
       SET status = 'paid', provider_payment_id = ?, fulfilled_at = COALESCE(fulfilled_at, ?),
           expired_at = NULL, expires_at = NULL, updated_at = ?
       WHERE id = ? AND provider_payment_id = ? AND provider_session_id = ?
         AND status IN ('pending', 'expired')
       RETURNING id`,
      input.providerPaymentId,
      occurredAt,
      occurredAt,
      row.resourceId,
      input.candidate.providerPaymentId,
      row.providerSessionId,
    )
    .toArray();
  if (purchaseTransition.length !== 1) throw new StripeReconciliationStateChangedError();

  const attemptTransition = storage.sql
    .exec<{ readonly id: string }>(
      `UPDATE payment_attempts
       SET status = 'paid', provider_payment_id = ?, expired_at = NULL, updated_at = ?
       WHERE id = ? AND resource_id = ? AND provider_payment_id = ?
         AND provider_session_id = ? AND status IN ('pending', 'expired')
       RETURNING id`,
      input.providerPaymentId,
      occurredAt,
      input.candidate.paymentAttemptId,
      row.resourceId,
      input.candidate.providerPaymentId,
      row.providerSessionId,
    )
    .toArray();
  if (attemptTransition.length !== 1) throw new StripeReconciliationStateChangedError();

  if (row.discountCodeId !== null) {
    const redemptionTransition = storage.sql
      .exec<{ readonly id: string }>(
        `UPDATE discount_code_redemptions
         SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, ?),
             released_at = NULL, updated_at = ?
         WHERE purchase_id = ? AND discount_code_id = ? AND status IN ('pending', 'released')
         RETURNING id`,
        occurredAt,
        occurredAt,
        row.resourceId,
        row.discountCodeId,
      )
      .toArray();
    if (redemptionTransition.length !== 1) throw new StripeReconciliationStateChangedError();
    storage.sql.exec(
      `UPDATE discount_codes SET first_redeemed_at = COALESCE(first_redeemed_at, ?), updated_at = ?
       WHERE id = ?`,
      occurredAt,
      occurredAt,
      row.discountCodeId,
    );
  }

  return { applied: true };
}

interface ReconciliationAttemptRow {
  readonly [column: string]: SqlStorageValue;
  readonly id: string;
  readonly processorFeeCents: number | null;
  readonly providerBalanceTransactionId: string | null;
  readonly status: string;
}

function applyRefundTransition(
  storage: DurableObjectStorage,
  purchases: readonly ReconciliationPurchaseRow[],
  attempts: readonly ReconciliationAttemptRow[],
  refundTimestamp: string,
  occurredAt: string,
): { readonly attemptUpdated: boolean; readonly purchaseUpdated: boolean } {
  let purchaseUpdated = false;
  for (const purchase of purchases) {
    if (purchase.status === "paid") {
      storage.sql.exec(
        `UPDATE ticket_purchases
         SET status = 'refunded', refunded_at = ?, updated_at = ?
         WHERE id = ? AND status = 'paid'`,
        refundTimestamp,
        occurredAt,
        purchase.id,
      );
      purchaseUpdated = true;
    }
  }

  let attemptUpdated = false;
  for (const attempt of attempts) {
    if (attempt.status !== "refunded") {
      storage.sql.exec(
        `UPDATE payment_attempts
         SET status = 'refunded', refunded_at = ?, updated_at = ?
         WHERE id = ? AND status <> 'refunded'`,
        refundTimestamp,
        occurredAt,
        attempt.id,
      );
      attemptUpdated = true;
    }
  }

  return { attemptUpdated, purchaseUpdated };
}

function applyFeeBackfill(
  storage: DurableObjectStorage,
  attempts: readonly ReconciliationAttemptRow[],
  snapshot: ApplyHistoricalStripeReconciliationInput["stripeSnapshot"],
  occurredAt: string,
): boolean {
  if (snapshot.processorFeeCents === null) return false;
  let feeUpdated = false;
  for (const attempt of attempts) {
    if (
      attempt.processorFeeCents === null ||
      (attempt.providerBalanceTransactionId === null &&
        snapshot.providerBalanceTransactionId !== null)
    ) {
      storage.sql.exec(
        `UPDATE payment_attempts
         SET processor_fee_cents = COALESCE(processor_fee_cents, ?),
             provider_balance_transaction_id = COALESCE(provider_balance_transaction_id, ?),
             processor_fee_reconciled_at = COALESCE(processor_fee_reconciled_at, ?),
             updated_at = ?
         WHERE id = ?`,
        snapshot.processorFeeCents,
        snapshot.providerBalanceTransactionId,
        occurredAt,
        occurredAt,
        attempt.id,
      );
      feeUpdated = true;
    }
  }
  return feeUpdated;
}

function writeReconciliationAudit(
  storage: DurableObjectStorage,
  input: ApplyHistoricalStripeReconciliationInput,
  purchases: readonly ReconciliationPurchaseRow[],
  attempts: readonly ReconciliationAttemptRow[],
  actionsApplied: readonly ("mark_paid" | "mark_refunded" | "backfill_fee")[],
  changes: readonly string[],
  occurredAt: string,
): void {
  const primaryPurchase = purchases[0];
  const auditSummary = {
    amountChargedCents: input.stripeSnapshot.amountChargedCents,
    amountRefundedCents: input.stripeSnapshot.amountRefundedCents,
    changes,
    newResourceStatus: input.actions.includes("mark_refunded")
      ? "refunded"
      : input.actions.includes("mark_paid")
        ? "paid"
        : (primaryPurchase?.status ?? "unknown"),
    paymentType: primaryPurchase?.bundleId ? "bundle" : "ticket",
    previousResourceStatus: primaryPurchase?.status ?? "unknown",
    processorFeeCents: input.stripeSnapshot.processorFeeCents,
    providerBalanceTransactionId: input.stripeSnapshot.providerBalanceTransactionId,
    providerPaymentId: input.providerPaymentId,
    paymentAttemptId: input.candidate.paymentAttemptId,
    reason: input.reason,
    resourceId: primaryPurchase?.id ?? attempts[0]?.id,
    source: "stripe_historical_reconciliation",
    stripeRefundCompletedAt: input.stripeSnapshot.refundCompletedAt,
  };

  storage.sql.exec(
    `INSERT OR IGNORE INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
     VALUES (?, 'platform_administrator', ?, 'payment.stripe_history.reconciled', 'payment', ?, ?, ?, ?)`,
    `stripe-history-reconciled:${input.providerPaymentId}:${[...actionsApplied].sort().join("+")}`,
    input.adminUserId,
    input.providerPaymentId,
    crypto.randomUUID(),
    JSON.stringify(auditSummary),
    occurredAt,
  );
}

export function applyHistoricalStripeReconciliationInStore(
  storage: DurableObjectStorage,
  input: ApplyHistoricalStripeReconciliationInput,
): ApplyHistoricalStripeReconciliationResult {
  const actualOrganizationId = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;

  if (actualOrganizationId !== input.organizationId) {
    return {
      actionsApplied: [],
      message: "Organization identity conflict.",
      status: "failed",
    };
  }
  if (input.candidate.organizationId !== actualOrganizationId) {
    return {
      actionsApplied: [],
      message: "The selected payment candidate belongs to a different Organization.",
      status: "failed",
    };
  }

  const existingPurchases = storage.sql
    .exec<ReconciliationPurchaseRow>(
      `SELECT id, status, amount_paid_cents AS amountPaidCents, bundle_id AS bundleId
       FROM ticket_purchases WHERE id = ?`,
      input.candidate.resourceId,
    )
    .toArray();

  const existingAttempts = storage.sql
    .exec<ReconciliationAttemptRow>(
      `SELECT id, status, processor_fee_cents AS processorFeeCents,
        provider_balance_transaction_id AS providerBalanceTransactionId
       FROM payment_attempts WHERE id = ? AND resource_id = ?`,
      input.candidate.paymentAttemptId,
      input.candidate.resourceId,
    )
    .toArray();

  if (existingPurchases.length === 0 && existingAttempts.length === 0) {
    return {
      actionsApplied: [],
      message: "No payment records found for provider payment ID.",
      status: "failed",
    };
  }

  const occurredAt = new Date().toISOString();
  const refundTimestamp = input.stripeSnapshot.refundCompletedAt ?? occurredAt;
  const actionsApplied: ("mark_paid" | "mark_refunded" | "backfill_fee")[] = [];
  const changes: string[] = [];
  let rejectionMessage: string | undefined;

  try {
    storage.transactionSync(() => {
      if (input.actions.includes("mark_paid")) {
        const transition = applyPaidTicketTransition(storage, input, occurredAt);
        if (!transition.applied) {
          rejectionMessage = transition.message ?? "Ticket fulfillment requires manual review.";
          return;
        }
        actionsApplied.push("mark_paid");
        changes.push("resource_status", "payment_attempt_status");
        if (input.candidate.discountCodeId) changes.push("discount_redemption_status");
      }

      if (input.actions.includes("mark_refunded")) {
        const { attemptUpdated, purchaseUpdated } = applyRefundTransition(
          storage,
          existingPurchases,
          existingAttempts,
          refundTimestamp,
          occurredAt,
        );
        if (purchaseUpdated || attemptUpdated) {
          actionsApplied.push("mark_refunded");
          if (purchaseUpdated) changes.push("resource_status");
          if (attemptUpdated) changes.push("payment_attempt_status");
        }
      }

      if (input.actions.includes("backfill_fee")) {
        const feeUpdated = applyFeeBackfill(
          storage,
          existingAttempts,
          input.stripeSnapshot,
          occurredAt,
        );
        if (feeUpdated) {
          actionsApplied.push("backfill_fee");
          changes.push("processor_fee", "balance_transaction");
        }
      }

      if (actionsApplied.length > 0) {
        writeReconciliationAudit(
          storage,
          input,
          existingPurchases,
          existingAttempts,
          actionsApplied,
          changes,
          occurredAt,
        );
      }
    });
  } catch (error: unknown) {
    if (error instanceof StripeReconciliationStateChangedError) {
      return {
        actionsApplied: [],
        message:
          "The local payment changed during reconciliation; refresh the preview and review it again.",
        status: "skipped",
      };
    }
    throw error;
  }

  if (rejectionMessage) {
    return { actionsApplied: [], message: rejectionMessage, status: "skipped" };
  }

  if (actionsApplied.includes("mark_paid")) {
    linkPaidTicketPurchaseContact(storage, input.candidate.resourceId);
  }

  return {
    actionsApplied,
    status: actionsApplied.length > 0 ? "applied" : "skipped",
  };
}
