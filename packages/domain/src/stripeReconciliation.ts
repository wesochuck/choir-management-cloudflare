export type StripeReconciliationClassification =
  | "matched"
  | "refund_status_mismatch"
  | "processor_fee_missing"
  | "balance_transaction_missing"
  | "refund_and_fee_mismatch"
  | "partial_refund_manual_review"
  | "amount_mismatch_manual_review"
  | "provider_payment_missing"
  | "provider_lookup_failed"
  | "local_inconsistency";

export type StripeReconciliationAction = "mark_refunded" | "backfill_fee";

export interface LocalPaymentCandidate {
  readonly amountCents: number;
  readonly createdAt: string;
  readonly currency: string | null;
  readonly paymentAttemptId: string;
  readonly paymentAttemptStatus: string;
  readonly paymentType: "ticket" | "bundle" | "donation" | "dues";
  readonly processorFeeCents: number | null;
  readonly processorFeeReconciledAt: string | null;
  readonly providerBalanceTransactionId: string | null;
  readonly providerPaymentId: string;
  readonly providerSessionId: string;
  readonly refundRequestedAt: string | null;
  readonly refundedAt: string | null;
  readonly resourceId: string;
  readonly resourceStatus: string;
}

export interface StripePaymentSnapshot {
  readonly amountChargedCents: number;
  readonly amountRefundedCents: number;
  readonly chargeId: string | null;
  readonly currency: string | null;
  readonly fullyRefunded: boolean;
  readonly processorFeeCents: number | null;
  readonly providerBalanceTransactionId: string | null;
  readonly providerPaymentId: string;
  readonly refundCompletedAt: string | null;
}

export interface ReconciliationLookupError {
  readonly code?: string;
  readonly message?: string;
  readonly status?: number;
}

export interface ReconciliationComparisonResult {
  readonly classification: StripeReconciliationClassification;
  readonly manualReviewReason: string | null;
  readonly proposedActions: readonly StripeReconciliationAction[];
  readonly safeToApply: boolean;
  readonly stripeStatus: string | null;
}

type StripeDisplayStatus = "refunded" | "partially_refunded" | "paid";

function lookupFailureResult(
  error: ReconciliationLookupError | null | undefined,
): ReconciliationComparisonResult {
  if (error?.status === 404 || error?.code === "resource_missing") {
    return {
      classification: "provider_payment_missing",
      manualReviewReason: "Payment record was not found in the connected Stripe account.",
      proposedActions: [],
      safeToApply: false,
      stripeStatus: "not_found",
    };
  }
  return {
    classification: "provider_lookup_failed",
    manualReviewReason: error?.message ?? "Error retrieving payment from Stripe.",
    proposedActions: [],
    safeToApply: false,
    stripeStatus: "error",
  };
}

function stripeDisplayStatus(snapshot: StripePaymentSnapshot): StripeDisplayStatus {
  if (snapshot.fullyRefunded) return "refunded";
  return snapshot.amountRefundedCents > 0 ? "partially_refunded" : "paid";
}

function amountReviewResult(
  candidate: LocalPaymentCandidate,
  snapshot: StripePaymentSnapshot,
  stripeStatus: StripeDisplayStatus,
): ReconciliationComparisonResult | null {
  const expectedCurrency = candidate.currency?.toLowerCase() ?? "usd";
  if (snapshot.currency && snapshot.currency.toLowerCase() !== expectedCurrency) {
    return {
      classification: "amount_mismatch_manual_review",
      manualReviewReason: `Currency mismatch: local record is ${expectedCurrency.toUpperCase()} but Stripe is ${snapshot.currency.toUpperCase()}.`,
      proposedActions: [],
      safeToApply: false,
      stripeStatus,
    };
  }

  if (snapshot.amountChargedCents !== candidate.amountCents) {
    return {
      classification: "amount_mismatch_manual_review",
      manualReviewReason: `Charged amount mismatch: local charged $${(candidate.amountCents / 100).toFixed(2)} but Stripe charged $${(snapshot.amountChargedCents / 100).toFixed(2)}.`,
      proposedActions: [],
      safeToApply: false,
      stripeStatus,
    };
  }

  return null;
}

function partialRefundResult(
  snapshot: StripePaymentSnapshot,
  stripeStatus: StripeDisplayStatus,
): ReconciliationComparisonResult | null {
  if (snapshot.fullyRefunded || snapshot.amountRefundedCents === 0) return null;
  return {
    classification: "partial_refund_manual_review",
    manualReviewReason: `Partial refund in Stripe ($${(snapshot.amountRefundedCents / 100).toFixed(2)} of $${(snapshot.amountChargedCents / 100).toFixed(2)} refunded). Choir Management only supports full refunds; manual review required.`,
    proposedActions: [],
    safeToApply: false,
    stripeStatus,
  };
}

type LocalReconciliationState = "paid" | "refunded" | "inconsistent";

function localReconciliationState(candidate: LocalPaymentCandidate): LocalReconciliationState {
  if (candidate.resourceStatus === "paid" && candidate.paymentAttemptStatus === "paid") {
    return "paid";
  }
  if (candidate.resourceStatus === "refunded" && candidate.paymentAttemptStatus === "refunded") {
    return "refunded";
  }
  return "inconsistent";
}

function feeConflictResult(
  candidate: LocalPaymentCandidate,
  snapshot: StripePaymentSnapshot,
  stripeStatus: StripeDisplayStatus,
): ReconciliationComparisonResult | null {
  if (
    candidate.processorFeeCents === null ||
    snapshot.processorFeeCents === null ||
    candidate.processorFeeCents === snapshot.processorFeeCents
  ) {
    return null;
  }
  return {
    classification: "amount_mismatch_manual_review",
    manualReviewReason: `Local processor fee ($${(candidate.processorFeeCents / 100).toFixed(2)}) differs from Stripe processor fee ($${(snapshot.processorFeeCents / 100).toFixed(2)}).`,
    proposedActions: [],
    safeToApply: false,
    stripeStatus,
  };
}

function feeBackfillResult(
  needsFee: boolean,
  stripeStatus: StripeDisplayStatus,
): ReconciliationComparisonResult {
  return {
    classification: needsFee ? "processor_fee_missing" : "balance_transaction_missing",
    manualReviewReason: null,
    proposedActions: ["backfill_fee"],
    safeToApply: true,
    stripeStatus,
  };
}

function repairResult(
  localState: LocalReconciliationState,
  fullyRefunded: boolean,
  feeActionNeeded: boolean,
  needsFee: boolean,
  stripeStatus: StripeDisplayStatus,
): ReconciliationComparisonResult {
  if (fullyRefunded && localState === "paid") {
    if (!feeActionNeeded) {
      return {
        classification: "refund_status_mismatch",
        manualReviewReason: null,
        proposedActions: ["mark_refunded"],
        safeToApply: true,
        stripeStatus,
      };
    }
    return {
      classification: "refund_and_fee_mismatch",
      manualReviewReason: null,
      proposedActions: ["mark_refunded", "backfill_fee"],
      safeToApply: true,
      stripeStatus,
    };
  }

  if (localState === "paid" || fullyRefunded) {
    if (feeActionNeeded) {
      return feeBackfillResult(needsFee, stripeStatus);
    }
    return {
      classification: "matched",
      manualReviewReason: null,
      proposedActions: [],
      safeToApply: false,
      stripeStatus,
    };
  }

  return {
    classification: "local_inconsistency",
    manualReviewReason:
      "Local record is marked Refunded, but Stripe record is Paid. Manual review required.",
    proposedActions: [],
    safeToApply: false,
    stripeStatus,
  };
}

export function compareStripePaymentToLocalCandidate(
  candidate: LocalPaymentCandidate,
  snapshot: StripePaymentSnapshot | null,
  error?: ReconciliationLookupError | null,
): ReconciliationComparisonResult {
  if (!snapshot || error) {
    return lookupFailureResult(error);
  }

  const stripeStatus = stripeDisplayStatus(snapshot);

  const amountReview = amountReviewResult(candidate, snapshot, stripeStatus);
  if (amountReview) return amountReview;

  const partialReview = partialRefundResult(snapshot, stripeStatus);
  if (partialReview) return partialReview;

  const localState = localReconciliationState(candidate);
  if (localState === "inconsistent") {
    return {
      classification: "local_inconsistency",
      manualReviewReason: `Local resource status ('${candidate.resourceStatus}') and payment attempt status ('${candidate.paymentAttemptStatus}') do not match.`,
      proposedActions: [],
      safeToApply: false,
      stripeStatus,
    };
  }

  const feeConflict = feeConflictResult(candidate, snapshot, stripeStatus);
  if (feeConflict) return feeConflict;

  const needsFee = candidate.processorFeeCents === null && snapshot.processorFeeCents !== null;
  const needsBalanceTxn =
    candidate.providerBalanceTransactionId === null &&
    snapshot.providerBalanceTransactionId !== null;

  return repairResult(
    localState,
    snapshot.fullyRefunded,
    needsFee || needsBalanceTxn,
    needsFee,
    stripeStatus,
  );
}
