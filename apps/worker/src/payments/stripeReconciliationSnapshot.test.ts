import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareStripePaymentToLocalCandidate } from "@choir/domain";
import {
  retrieveStripeCheckoutReconciliationSession,
  retrieveStripePaymentReconciliationSnapshot,
  StripeConnectError,
} from "./stripeConnect";

describe("retrieveStripePaymentReconciliationSnapshot", () => {
  const secretKey = "sk_test_mock";
  const connectedAccountId = "acct_test_mock";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses a paid PaymentIntent with expanded latest_charge and balance_transaction", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount: 5000,
          currency: "usd",
          id: "pi_123",
          latest_charge: {
            amount: 5000,
            amount_refunded: 0,
            balance_transaction: {
              currency: "usd",
              fee: 175,
              id: "txn_123",
              net: 4825,
            },
            currency: "usd",
            id: "ch_123",
            refunded: false,
            refunds: { data: [] },
          },
        }),
        { status: 200 },
      ),
    );

    const snapshot = await retrieveStripePaymentReconciliationSnapshot(
      secretKey,
      connectedAccountId,
      "pi_123",
    );

    expect(snapshot).toEqual({
      amountChargedCents: 5000,
      amountCapturedCents: null,
      amountReceivedCents: null,
      amountRefundedCents: 0,
      chargeCaptured: null,
      chargeId: "ch_123",
      chargeStatus: null,
      currency: "usd",
      fullyRefunded: false,
      paymentIntentId: "pi_123",
      paymentIntentStatus: null,
      processorFeeCents: 175,
      providerBalanceTransactionId: "txn_123",
      providerPaymentId: "pi_123",
      refundCompletedAt: null,
    });
  });

  it("parses a paid Charge directly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount: 7500,
          amount_refunded: 0,
          balance_transaction: {
            currency: "usd",
            fee: 248,
            id: "txn_456",
            net: 7252,
          },
          currency: "usd",
          id: "ch_456",
          refunded: false,
          refunds: { data: [] },
        }),
        { status: 200 },
      ),
    );

    const snapshot = await retrieveStripePaymentReconciliationSnapshot(
      secretKey,
      connectedAccountId,
      "ch_456",
    );

    expect(snapshot).toEqual({
      amountChargedCents: 7500,
      amountCapturedCents: null,
      amountReceivedCents: null,
      amountRefundedCents: 0,
      chargeCaptured: null,
      chargeId: "ch_456",
      chargeStatus: null,
      currency: "usd",
      fullyRefunded: false,
      paymentIntentId: null,
      paymentIntentStatus: null,
      processorFeeCents: 248,
      providerBalanceTransactionId: "txn_456",
      providerPaymentId: "ch_456",
      refundCompletedAt: null,
    });
  });

  it("parses a fully refunded charge with refund timestamp", async () => {
    const refundEpochSeconds = 1770000000;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount: 5000,
          currency: "usd",
          id: "pi_refunded",
          latest_charge: {
            amount: 5000,
            amount_refunded: 5000,
            balance_transaction: {
              currency: "usd",
              fee: 175,
              id: "txn_ref",
              net: 4825,
            },
            currency: "usd",
            id: "ch_ref",
            refunded: true,
            refunds: {
              data: [
                {
                  amount: 5000,
                  created: refundEpochSeconds,
                  id: "re_123",
                  status: "succeeded",
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const snapshot = await retrieveStripePaymentReconciliationSnapshot(
      secretKey,
      connectedAccountId,
      "pi_refunded",
    );

    expect(snapshot.fullyRefunded).toBe(true);
    expect(snapshot.amountRefundedCents).toBe(5000);
    expect(snapshot.amountChargedCents).toBe(5000);
    expect(snapshot.refundCompletedAt).toBe(new Date(refundEpochSeconds * 1000).toISOString());
    expect(snapshot.processorFeeCents).toBe(175);
    expect(snapshot.providerBalanceTransactionId).toBe("txn_ref");
  });

  it("prefers the succeeded refund timestamp over a newer failed refund", async () => {
    const succeededEpochSeconds = 1770000000;
    const failedEpochSeconds = 1770003600;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount: 5000,
          currency: "usd",
          id: "pi_refunded_status",
          latest_charge: {
            amount: 5000,
            amount_refunded: 5000,
            balance_transaction: {
              currency: "usd",
              fee: 175,
              id: "txn_ref_status",
              net: 4825,
            },
            currency: "usd",
            id: "ch_ref_status",
            refunded: true,
            refunds: {
              data: [
                {
                  amount: 5000,
                  created: succeededEpochSeconds,
                  id: "re_ok",
                  status: "succeeded",
                },
                {
                  amount: 5000,
                  created: failedEpochSeconds,
                  id: "re_failed",
                  status: "failed",
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const snapshot = await retrieveStripePaymentReconciliationSnapshot(
      secretKey,
      connectedAccountId,
      "pi_refunded_status",
    );

    expect(snapshot.fullyRefunded).toBe(true);
    expect(snapshot.refundCompletedAt).toBe(new Date(succeededEpochSeconds * 1000).toISOString());
  });

  it("parses a partially refunded charge", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount: 5000,
          amount_refunded: 2500,
          balance_transaction: {
            currency: "usd",
            fee: 175,
            id: "txn_part",
            net: 4825,
          },
          currency: "usd",
          id: "ch_part",
          refunded: false,
          refunds: {
            data: [
              {
                amount: 2500,
                created: 1770001000,
                id: "re_part",
                status: "succeeded",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );

    const snapshot = await retrieveStripePaymentReconciliationSnapshot(
      secretKey,
      connectedAccountId,
      "ch_part",
    );

    expect(snapshot.fullyRefunded).toBe(false);
    expect(snapshot.amountRefundedCents).toBe(2500);
    expect(snapshot.amountChargedCents).toBe(5000);
  });

  it("handles missing Balance Transaction gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount: 3000,
          amount_refunded: 0,
          balance_transaction: null,
          currency: "usd",
          id: "ch_nobal",
          refunded: false,
          refunds: { data: [] },
        }),
        { status: 200 },
      ),
    );

    const snapshot = await retrieveStripePaymentReconciliationSnapshot(
      secretKey,
      connectedAccountId,
      "ch_nobal",
    );

    expect(snapshot.processorFeeCents).toBeNull();
    expect(snapshot.providerBalanceTransactionId).toBeNull();
    expect(snapshot.amountChargedCents).toBe(3000);
  });

  it("handles unexpanded string Balance Transaction by fetching it", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            amount: 4000,
            amount_refunded: 0,
            balance_transaction: "txn_string_id",
            currency: "usd",
            id: "ch_strbal",
            refunded: false,
            refunds: { data: [] },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            currency: "usd",
            fee: 146,
            id: "txn_string_id",
            net: 3854,
          }),
          { status: 200 },
        ),
      );

    const snapshot = await retrieveStripePaymentReconciliationSnapshot(
      secretKey,
      connectedAccountId,
      "ch_strbal",
    );

    expect(snapshot.processorFeeCents).toBe(146);
    expect(snapshot.providerBalanceTransactionId).toBe("txn_string_id");
  });

  it("propagates StripeConnectError on 404 payment not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "resource_missing",
            message: "No such payment_intent: pi_missing",
            type: "invalid_request_error",
          },
        }),
        { status: 404 },
      ),
    );

    await expect(
      retrieveStripePaymentReconciliationSnapshot(secretKey, connectedAccountId, "pi_missing"),
    ).rejects.toThrow(StripeConnectError);
  });

  it("preserves Charge lookup identity when the Charge has an associated PaymentIntent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount: 134,
          amount_captured: 134,
          amount_refunded: 134,
          balance_transaction: {
            currency: "usd",
            fee: 34,
            id: "txn_review",
            net: 100,
          },
          captured: true,
          currency: "usd",
          id: "ch_review",
          payment_intent: "pi_review",
          refunds: { data: [] },
          status: "succeeded",
        }),
        { status: 200 },
      ),
    );

    const snapshot = await retrieveStripePaymentReconciliationSnapshot(
      secretKey,
      connectedAccountId,
      "ch_review",
    );
    const comparison = compareStripePaymentToLocalCandidate(
      {
        amountCents: 134,
        checkoutRequestId: "request_review",
        createdAt: "2026-09-22T00:00:00.000Z",
        currency: "usd",
        paymentAttemptId: "attempt_review",
        paymentAttemptStatus: "paid",
        paymentType: "ticket",
        processorFeeCents: null,
        processorFeeReconciledAt: null,
        providerBalanceTransactionId: null,
        providerPaymentId: "ch_review",
        providerSessionId: "cs_review",
        refundRequestedAt: null,
        refundedAt: null,
        resourceId: "ticket_review",
        resourceStatus: "paid",
      },
      snapshot,
    );

    expect(snapshot.providerPaymentId).toBe("ch_review");
    expect(snapshot.paymentIntentId).toBe("pi_review");
    expect(comparison).toMatchObject({
      classification: "refund_and_fee_mismatch",
      proposedActions: ["mark_refunded", "backfill_fee"],
      safeToApply: true,
    });
  });
});

describe("retrieveStripeCheckoutReconciliationSession", () => {
  it("retrieves the session inside the supplied connected account", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          amount_total: 134,
          currency: "usd",
          id: "cs_session_test",
          metadata: {
            checkout_request_id: "request_test",
            organization_id: "org_test",
            payment_type: "ticket",
            purchase_id: "purchase_test",
          },
          mode: "payment",
          payment_intent: { id: "pi_session_test" },
          payment_status: "paid",
          status: "complete",
        }),
        { status: 200 },
      ),
    );

    const session = await retrieveStripeCheckoutReconciliationSession(
      "sk_test_mock",
      "acct_connected_test",
      "cs_session_test",
    );

    expect(session).toMatchObject({
      amountTotalCents: 134,
      currency: "usd",
      id: "cs_session_test",
      mode: "payment",
      paymentIntentId: "pi_session_test",
      paymentStatus: "paid",
      status: "complete",
    });
    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const requestHeaders = requestInit?.headers;
    if (!(requestHeaders instanceof Headers)) {
      throw new Error("Expected Stripe request headers");
    }
    expect(requestHeaders.get("stripe-account")).toBe("acct_connected_test");
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://api.stripe.com/v1/checkout/sessions/cs_session_test",
    );
  });
});
