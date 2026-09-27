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
  | "local_inconsistency"
  | "ticket_payment_status_mismatch"
  | "ticket_payment_not_captured_manual_review"
  | "ticket_fulfillment_manual_review";

export type StripeReconciliationAction = "mark_paid" | "mark_refunded" | "backfill_fee";

export interface LocalPaymentCandidate {
  readonly amountCents: number;
  readonly checkoutRequestId?: string | undefined;
  readonly resourceCheckoutRequestId?: string | undefined;
  readonly createdAt: string;
  readonly currency: string | null;
  readonly discountCodeId?: string | null | undefined;
  readonly paymentAttemptId: string;
  readonly paymentAttemptStatus: string;
  readonly paymentType: "ticket" | "bundle" | "donation" | "dues";
  readonly processorFeeCents: number | null;
  readonly processorFeeReconciledAt: string | null;
  readonly providerBalanceTransactionId: string | null;
  readonly providerPaymentId: string;
  readonly providerSessionId: string;
  readonly organizationId?: string | undefined;
  readonly refundRequestedAt: string | null;
  readonly refundedAt: string | null;
  readonly resourceId: string;
  readonly resourceStatus: string;
  readonly resourceAmountCents?: number | undefined;
  readonly resourceProviderPaymentId?: string | undefined;
  readonly fulfillmentBlockReason?: string | null | undefined;
}

export interface StripePaymentSnapshot {
  readonly amountChargedCents: number;
  readonly amountRefundedCents: number;
  readonly amountCapturedCents?: number | null | undefined;
  readonly amountReceivedCents?: number | null | undefined;
  readonly chargeId: string | null;
  readonly chargeCaptured?: boolean | null | undefined;
  readonly chargeStatus?: string | null | undefined;
  readonly currency: string | null;
  readonly fullyRefunded: boolean;
  readonly processorFeeCents: number | null;
  readonly providerBalanceTransactionId: string | null;
  readonly providerPaymentId: string;
  readonly paymentIntentStatus?: string | null | undefined;
  readonly paymentIntentId?: string | null | undefined;
  readonly refundCompletedAt: string | null;
  readonly checkoutSessionId?: string | null | undefined;
  readonly checkoutSessionOrganizationId?: string | null | undefined;
  readonly checkoutSessionPurchaseId?: string | null | undefined;
  readonly checkoutSessionRequestId?: string | null | undefined;
  readonly checkoutSessionPaymentType?: string | null | undefined;
  readonly checkoutSessionStatus?: string | null | undefined;
  readonly checkoutSessionPaymentStatus?: string | null | undefined;
  readonly checkoutSessionAmountCents?: number | null | undefined;
  readonly checkoutSessionCurrency?: string | null | undefined;
  readonly checkoutSessionMode?: string | null | undefined;
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

type StripeDisplayStatus = string;

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
  if (snapshot.amountRefundedCents > 0) return "partially_refunded";
  return (
    snapshot.paymentIntentStatus ??
    snapshot.chargeStatus ??
    snapshot.checkoutSessionPaymentStatus ??
    "unknown"
  );
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

type LocalReconciliationState = "paid" | "refunded" | "pending" | "expired" | "inconsistent";

function localReconciliationState(candidate: LocalPaymentCandidate): LocalReconciliationState {
  if (candidate.resourceStatus === "paid" && candidate.paymentAttemptStatus === "paid") {
    return "paid";
  }
  if (candidate.resourceStatus === "refunded" && candidate.paymentAttemptStatus === "refunded") {
    return "refunded";
  }
  if (candidate.resourceStatus === "pending" && candidate.paymentAttemptStatus === "pending") {
    return "pending";
  }
  if (candidate.resourceStatus === "expired" && candidate.paymentAttemptStatus === "expired") {
    return "expired";
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

function paymentIdentityMatches(
  candidate: LocalPaymentCandidate,
  snapshot: StripePaymentSnapshot,
): boolean {
  if (candidate.providerPaymentId !== "") {
    return [
      snapshot.providerPaymentId === candidate.providerPaymentId &&
        (candidate.resourceProviderPaymentId === undefined ||
          candidate.resourceProviderPaymentId === candidate.providerPaymentId),
    ].every(Boolean);
  }
  const paymentIntentMatches =
    snapshot.providerPaymentId.startsWith("pi_") &&
    snapshot.paymentIntentId === snapshot.providerPaymentId;
  const noPaymentIntent = snapshot.providerPaymentId === "" && snapshot.paymentIntentId === null;
  return [
    candidate.organizationId !== undefined,
    candidate.checkoutRequestId !== undefined,
    candidate.resourceCheckoutRequestId === undefined ||
      candidate.resourceCheckoutRequestId === candidate.checkoutRequestId,
    paymentIntentMatches || noPaymentIntent,
    snapshot.checkoutSessionId === candidate.providerSessionId,
    snapshot.checkoutSessionOrganizationId === candidate.organizationId,
    snapshot.checkoutSessionPurchaseId === candidate.resourceId,
    snapshot.checkoutSessionRequestId === candidate.checkoutRequestId,
    snapshot.checkoutSessionPaymentType === candidate.paymentType,
    snapshot.checkoutSessionMode === "payment",
  ].every(Boolean);
}

function capturedPaymentIsAuthoritative(
  candidate: LocalPaymentCandidate,
  snapshot: StripePaymentSnapshot,
): boolean {
  if (!paymentIdentityMatches(candidate, snapshot)) return false;
  const paymentIntentCaptured = [
    snapshot.paymentIntentId?.startsWith("pi_") === true,
    snapshot.paymentIntentId === snapshot.providerPaymentId,
    snapshot.paymentIntentStatus === "succeeded",
    snapshot.amountReceivedCents === candidate.amountCents,
    snapshot.currency?.toLowerCase() === (candidate.currency?.toLowerCase() ?? "usd"),
    snapshot.amountCapturedCents === candidate.amountCents,
    snapshot.chargeCaptured === true,
    snapshot.chargeStatus === "succeeded",
  ].every(Boolean);
  if (!paymentIntentCaptured) return false;
  const expectedCurrency = candidate.currency?.toLowerCase() ?? "usd";

  if (candidate.providerPaymentId === "") {
    return [
      snapshot.checkoutSessionStatus === "complete" &&
        snapshot.checkoutSessionPaymentStatus === "paid" &&
        snapshot.checkoutSessionAmountCents === candidate.amountCents &&
        snapshot.checkoutSessionCurrency?.toLowerCase() === expectedCurrency,
    ].every(Boolean);
  }
  return true;
}

function comparePendingTicketPayment(
  candidate: LocalPaymentCandidate,
  snapshot: StripePaymentSnapshot,
  localState: LocalReconciliationState,
  stripeStatus: StripeDisplayStatus,
): ReconciliationComparisonResult | null {
  if (localState !== "pending" && localState !== "expired") return null;
  if (candidate.paymentType !== "ticket" && candidate.paymentType !== "bundle") {
    return {
      classification: "local_inconsistency",
      manualReviewReason:
        "Only ticket and bundle purchases can be fulfilled by this reconciliation process.",
      proposedActions: [],
      safeToApply: false,
      stripeStatus,
    };
  }
  if (candidate.refundRequestedAt !== null || candidate.refundedAt !== null) {
    return {
      classification: "ticket_payment_not_captured_manual_review",
      manualReviewReason:
        "The local payment has refund activity recorded and requires manual review before ticket fulfillment.",
      proposedActions: [],
      safeToApply: false,
      stripeStatus,
    };
  }
  if (snapshot.fullyRefunded || snapshot.amountRefundedCents > 0) {
    return {
      classification: "ticket_payment_not_captured_manual_review",
      manualReviewReason:
        "Stripe reports a refund for this payment, so ticket fulfillment requires manual review.",
      proposedActions: [],
      safeToApply: false,
      stripeStatus,
    };
  }
  if (!capturedPaymentIsAuthoritative(candidate, snapshot)) {
    return {
      classification: "ticket_payment_not_captured_manual_review",
      manualReviewReason:
        "Stripe does not confirm a fully captured successful payment for the exact ticket amount.",
      proposedActions: [],
      safeToApply: false,
      stripeStatus,
    };
  }
  if (candidate.fulfillmentBlockReason) {
    return {
      classification: "ticket_fulfillment_manual_review",
      manualReviewReason: candidate.fulfillmentBlockReason,
      proposedActions: [],
      safeToApply: false,
      stripeStatus,
    };
  }

  const actions: StripeReconciliationAction[] = ["mark_paid"];
  const needsFeeEvidence =
    candidate.processorFeeCents === null ||
    (candidate.providerBalanceTransactionId === null &&
      snapshot.providerBalanceTransactionId !== null);
  if (snapshot.processorFeeCents !== null && needsFeeEvidence) actions.push("backfill_fee");
  return {
    classification: "ticket_payment_status_mismatch",
    manualReviewReason: null,
    proposedActions: actions,
    safeToApply: true,
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
  if (!candidateIdentityConsistent(candidate, snapshot)) {
    return {
      classification: "local_inconsistency",
      manualReviewReason:
        "The local ticket purchase, payment attempt, and Stripe payment identity or amount do not agree.",
      proposedActions: [],
      safeToApply: false,
      stripeStatus,
    };
  }

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

  const pendingPaymentResult = comparePendingTicketPayment(
    candidate,
    snapshot,
    localState,
    stripeStatus,
  );
  if (pendingPaymentResult) return pendingPaymentResult;

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

function candidateIdentityConsistent(
  candidate: LocalPaymentCandidate,
  snapshot: StripePaymentSnapshot,
): boolean {
  return (
    paymentIdentityMatches(candidate, snapshot) &&
    (candidate.resourceProviderPaymentId === undefined ||
      candidate.resourceProviderPaymentId === candidate.providerPaymentId) &&
    (candidate.resourceCheckoutRequestId === undefined ||
      candidate.resourceCheckoutRequestId === candidate.checkoutRequestId) &&
    (candidate.resourceAmountCents === undefined ||
      candidate.resourceAmountCents === candidate.amountCents)
  );
}
