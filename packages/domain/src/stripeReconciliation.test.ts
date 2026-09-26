import { describe, expect, it } from "vitest";
import {
  compareStripePaymentToLocalCandidate,
  type LocalPaymentCandidate,
  type StripePaymentSnapshot,
} from "./stripeReconciliation";

function createCandidate(overrides: Partial<LocalPaymentCandidate> = {}): LocalPaymentCandidate {
  return {
    amountCents: 5000,
    createdAt: "2026-01-15T12:00:00.000Z",
    currency: "usd",
    paymentAttemptId: "attempt-1",
    paymentAttemptStatus: "paid",
    paymentType: "ticket",
    processorFeeCents: 175,
    processorFeeReconciledAt: "2026-01-15T12:05:00.000Z",
    providerBalanceTransactionId: "txn_123",
    providerPaymentId: "pi_test_123",
    providerSessionId: "cs_test_123",
    refundRequestedAt: null,
    refundedAt: null,
    resourceId: "resource-1",
    resourceStatus: "paid",
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<StripePaymentSnapshot> = {}): StripePaymentSnapshot {
  return {
    amountChargedCents: 5000,
    amountRefundedCents: 0,
    chargeId: "ch_test_123",
    currency: "usd",
    fullyRefunded: false,
    processorFeeCents: 175,
    providerBalanceTransactionId: "txn_123",
    providerPaymentId: "pi_test_123",
    refundCompletedAt: null,
    ...overrides,
  };
}

describe("compareStripePaymentToLocalCandidate", () => {
  it("1. paid locally / paid in Stripe / fee matches -> matched", () => {
    const candidate = createCandidate();
    const snapshot = createSnapshot();

    const result = compareStripePaymentToLocalCandidate(candidate, snapshot);

    expect(result.classification).toBe("matched");
    expect(result.safeToApply).toBe(false);
    expect(result.proposedActions).toEqual([]);
    expect(result.manualReviewReason).toBeNull();
  });

  it("2. paid locally / fully refunded in Stripe -> repairable refund", () => {
    const candidate = createCandidate({
      paymentAttemptStatus: "paid",
      processorFeeCents: 175,
      providerBalanceTransactionId: "txn_123",
      resourceStatus: "paid",
    });
    const snapshot = createSnapshot({
      amountRefundedCents: 5000,
      fullyRefunded: true,
      refundCompletedAt: "2026-02-01T10:00:00.000Z",
    });

    const result = compareStripePaymentToLocalCandidate(candidate, snapshot);

    expect(result.classification).toBe("refund_status_mismatch");
    expect(result.safeToApply).toBe(true);
    expect(result.proposedActions).toEqual(["mark_refunded"]);
    expect(result.manualReviewReason).toBeNull();
  });

  it("3. refunded locally / fully refunded in Stripe -> matched", () => {
    const candidate = createCandidate({
      paymentAttemptStatus: "refunded",
      processorFeeCents: 175,
      providerBalanceTransactionId: "txn_123",
      refundedAt: "2026-02-01T10:00:00.000Z",
      resourceStatus: "refunded",
    });
    const snapshot = createSnapshot({
      amountRefundedCents: 5000,
      fullyRefunded: true,
      refundCompletedAt: "2026-02-01T10:00:00.000Z",
    });

    const result = compareStripePaymentToLocalCandidate(candidate, snapshot);

    expect(result.classification).toBe("matched");
    expect(result.safeToApply).toBe(false);
    expect(result.proposedActions).toEqual([]);
    expect(result.manualReviewReason).toBeNull();
  });

  it("4. paid locally / partial refund in Stripe -> manual review", () => {
    const candidate = createCandidate();
    const snapshot = createSnapshot({
      amountRefundedCents: 2500,
      fullyRefunded: false,
    });

    const result = compareStripePaymentToLocalCandidate(candidate, snapshot);

    expect(result.classification).toBe("partial_refund_manual_review");
    expect(result.safeToApply).toBe(false);
    expect(result.proposedActions).toEqual([]);
    expect(result.manualReviewReason).toContain("Partial refund");
  });

  it("5. amount mismatch -> manual review", () => {
    const candidate = createCandidate({ amountCents: 5000 });
    const snapshot = createSnapshot({ amountChargedCents: 7500 });

    const result = compareStripePaymentToLocalCandidate(candidate, snapshot);

    expect(result.classification).toBe("amount_mismatch_manual_review");
    expect(result.safeToApply).toBe(false);
    expect(result.proposedActions).toEqual([]);
    expect(result.manualReviewReason).toContain("Charged amount mismatch");
  });

  it("6. missing local fee -> fee backfill", () => {
    const candidate = createCandidate({
      processorFeeCents: null,
      processorFeeReconciledAt: null,
      providerBalanceTransactionId: null,
    });
    const snapshot = createSnapshot({
      processorFeeCents: 175,
      providerBalanceTransactionId: "txn_123",
    });

    const result = compareStripePaymentToLocalCandidate(candidate, snapshot);

    expect(result.classification).toBe("processor_fee_missing");
    expect(result.safeToApply).toBe(true);
    expect(result.proposedActions).toEqual(["backfill_fee"]);
    expect(result.manualReviewReason).toBeNull();
  });

  it("7. refund + missing fee -> both actions", () => {
    const candidate = createCandidate({
      paymentAttemptStatus: "paid",
      processorFeeCents: null,
      processorFeeReconciledAt: null,
      providerBalanceTransactionId: null,
      resourceStatus: "paid",
    });
    const snapshot = createSnapshot({
      amountRefundedCents: 5000,
      fullyRefunded: true,
      processorFeeCents: 175,
      providerBalanceTransactionId: "txn_123",
      refundCompletedAt: "2026-02-01T10:00:00.000Z",
    });

    const result = compareStripePaymentToLocalCandidate(candidate, snapshot);

    expect(result.classification).toBe("refund_and_fee_mismatch");
    expect(result.safeToApply).toBe(true);
    expect(result.proposedActions).toEqual(["mark_refunded", "backfill_fee"]);
    expect(result.manualReviewReason).toBeNull();
  });

  it("8. different existing non-null fee -> manual review", () => {
    const candidate = createCandidate({
      processorFeeCents: 200,
    });
    const snapshot = createSnapshot({
      processorFeeCents: 175,
    });

    const result = compareStripePaymentToLocalCandidate(candidate, snapshot);

    expect(result.classification).toBe("amount_mismatch_manual_review");
    expect(result.safeToApply).toBe(false);
    expect(result.proposedActions).toEqual([]);
    expect(result.manualReviewReason).toContain("differs from Stripe processor fee");
  });

  it("9. provider not found (404) -> manual review", () => {
    const candidate = createCandidate();

    const result = compareStripePaymentToLocalCandidate(candidate, null, {
      code: "resource_missing",
      status: 404,
    });

    expect(result.classification).toBe("provider_payment_missing");
    expect(result.safeToApply).toBe(false);
    expect(result.proposedActions).toEqual([]);
    expect(result.manualReviewReason).toContain("was not found");
  });

  it("provider lookup error (500) -> provider_lookup_failed", () => {
    const candidate = createCandidate();

    const result = compareStripePaymentToLocalCandidate(candidate, null, {
      message: "Stripe rate limit exceeded",
      status: 500,
    });

    expect(result.classification).toBe("provider_lookup_failed");
    expect(result.safeToApply).toBe(false);
    expect(result.proposedActions).toEqual([]);
    expect(result.manualReviewReason).toBe("Stripe rate limit exceeded");
  });

  it("currency mismatch -> manual review", () => {
    const candidate = createCandidate({ currency: "usd" });
    const snapshot = createSnapshot({ currency: "eur" });

    const result = compareStripePaymentToLocalCandidate(candidate, snapshot);

    expect(result.classification).toBe("amount_mismatch_manual_review");
    expect(result.safeToApply).toBe(false);
    expect(result.manualReviewReason).toContain("Currency mismatch");
  });

  it("local internal inconsistency (paid vs refunded) -> local_inconsistency", () => {
    const candidate = createCandidate({
      paymentAttemptStatus: "paid",
      resourceStatus: "refunded",
    });
    const snapshot = createSnapshot({
      amountRefundedCents: 5000,
      fullyRefunded: true,
    });

    const result = compareStripePaymentToLocalCandidate(candidate, snapshot);

    expect(result.classification).toBe("local_inconsistency");
    expect(result.safeToApply).toBe(false);
    expect(result.manualReviewReason).toContain("do not match");
  });
});
