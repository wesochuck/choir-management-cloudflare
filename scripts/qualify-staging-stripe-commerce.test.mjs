import { describe, expect, it } from "vitest";

import {
  commerceBoundaryResponsesSafe,
  normalizeQualificationStatus,
  parseStripeConnectStatus,
  safeStripeCommerceQualificationSummary,
  stripeCommerceQualificationPlan,
  ticketReceiptMatches,
} from "./qualify-staging-stripe-commerce.mjs";

describe("staging Stripe sandbox commercial qualification helpers", () => {
  it("describes a complete commercial flow and cleanup plan", () => {
    const plan = stripeCommerceQualificationPlan().join(" ");
    expect(plan).toContain("Accounts v2 Stripe Connect readiness");
    expect(plan).toContain("ticket-enabled Performance");
    expect(plan).toContain("canonical signed ticket receipt");
    expect(plan).toContain("ticket-confirmation resend");
    expect(plan).toContain("wrong Organization host");
    expect(plan).toContain("refund the ticket order");
    expect(plan).toContain("donation checkout with tribute details");
    expect(plan).toContain("season dues");
    expect(plan).toContain("Stripe v1 and v2 webhook endpoints reject invalid signatures");
    expect(plan).toContain("archive the qualification Performance");
  });

  it("normalizes qualification statuses cleanly", () => {
    expect(normalizeQualificationStatus("passed")).toBe("passed");
    expect(normalizeQualificationStatus(true)).toBe("passed");
    expect(normalizeQualificationStatus("skipped")).toBe("skipped");
    expect(normalizeQualificationStatus("failed")).toBe("failed");
    expect(normalizeQualificationStatus(false)).toBe("failed");
    expect(normalizeQualificationStatus("not_run")).toBe("not_run");
    expect(normalizeQualificationStatus(undefined)).toBe("not_run");
  });

  describe("parseStripeConnectStatus", () => {
    it("identifies unconnected accounts", () => {
      expect(parseStripeConnectStatus(null).state).toBe("unconnected");
      expect(parseStripeConnectStatus({}).state).toBe("unconnected");
      expect(parseStripeConnectStatus({ platformConfigured: false }).state).toBe("unconnected");
      expect(
        parseStripeConnectStatus({ stripe: { accountId: null, status: "not_started" } }).state,
      ).toBe("unconnected");
    });

    it("identifies pending onboarding accounts", () => {
      const pending = parseStripeConnectStatus({
        platformConfigured: true,
        stripe: {
          accountId: "acct_12345",
          chargesEnabled: false,
          detailsSubmitted: false,
          payoutsEnabled: false,
          requirementsDue: ["individual.verification.document"],
          status: "onboarding",
        },
      });
      expect(pending.state).toBe("pending_onboarding");
      expect(pending.accountId).toBe("acct_12345");
      expect(pending.requirementsDue).toHaveLength(1);
    });

    it("identifies restricted accounts", () => {
      const restricted = parseStripeConnectStatus({
        platformConfigured: true,
        stripe: {
          accountId: "acct_restricted",
          chargesEnabled: false,
          detailsSubmitted: true,
          payoutsEnabled: true,
          requirementsDue: [],
          status: "restricted",
        },
      });
      expect(restricted.state).toBe("restricted");
    });

    it("requires chargesEnabled, payoutsEnabled, and 0 requirements due for ready state", () => {
      const notQuiteReady = parseStripeConnectStatus({
        platformConfigured: true,
        stripe: {
          accountId: "acct_almost",
          chargesEnabled: false,
          detailsSubmitted: true,
          payoutsEnabled: true,
          requirementsDue: [],
          status: "ready",
        },
      });
      expect(notQuiteReady.state).toBe("restricted");

      const ready = parseStripeConnectStatus({
        platformConfigured: true,
        stripe: {
          accountId: "acct_ready123",
          chargesEnabled: true,
          detailsSubmitted: true,
          payoutsEnabled: true,
          requirementsCurrentlyDue: [],
          status: "ready",
        },
      });
      expect(ready.state).toBe("ready");
      expect(ready.chargesEnabled).toBe(true);
      expect(ready.payoutsEnabled).toBe(true);
    });
  });

  it("verifies matching ticket receipt payloads", () => {
    expect(
      ticketReceiptMatches({ eventId: "ev-1", id: "pur-1", status: "paid" }, "ev-1", "pur-1"),
    ).toBe(true);
    expect(
      ticketReceiptMatches(
        { eventId: "ev-1", id: "pur-1", scanToken: "tok-1", status: "paid" },
        "ev-1",
        "pur-1",
      ),
    ).toBe(true);
    expect(
      ticketReceiptMatches(
        { eventId: "ev-1", id: "pur-1", scanToken: null, status: "paid" },
        "ev-1",
        "pur-1",
      ),
    ).toBe(false);
    expect(
      ticketReceiptMatches(
        { eventId: "ev-1", id: "pur-1", scanToken: null, status: "pending" },
        "ev-1",
        "pur-1",
        "pending",
      ),
    ).toBe(true);
    expect(
      ticketReceiptMatches(
        { eventId: "ev-1", id: "pur-1", scanToken: "invalid-token", status: "pending" },
        "ev-1",
        "pur-1",
        "pending",
      ),
    ).toBe(false);
    expect(
      ticketReceiptMatches({ eventId: "ev-1", id: "pur-2", status: "paid" }, "ev-1", "pur-1"),
    ).toBe(false);
    expect(
      ticketReceiptMatches({ eventId: "ev-1", id: "pur-1", status: "pending" }, "ev-1", "pur-1"),
    ).toBe(false);
  });

  it("verifies cross-organization boundary safety for 401, 403, and 404 responses", () => {
    expect(
      commerceBoundaryResponsesSafe([
        { response: { status: 401 } },
        { response: { status: 403 } },
        { response: { status: 404 } },
      ]),
    ).toBe(true);
    expect(
      commerceBoundaryResponsesSafe([
        { response: { status: 401 } },
        { response: { status: 200 } },
        { response: { status: 404 } },
      ]),
    ).toBe(false);
    expect(commerceBoundaryResponsesSafe([{ status: 401 }, { status: 403 }, { status: 404 }])).toBe(
      true,
    );
  });

  it("formats safe qualification summary with tri-state status without leaking sensitive fields", () => {
    const summary = safeStripeCommerceQualificationSummary({
      accountState: "ready",
      cleanupCompleted: "passed",
      crossOrganizationRejected: "passed",
      donationsQualified: "passed",
      duesQualified: "passed",
      eventId: "00000000-0000-4000-8000-000000000001",
      purchaseId: "00000000-0000-4000-8000-000000000002",
      receiptAccessible: "passed",
      refundCompleted: "passed",
      resendCompleted: "passed",
      stripeAccountReady: "passed",
      ticketingQualified: "passed",
      webhookRejectedInvalidSignature: "passed",
    });
    expect(summary).toEqual({
      accountState: "ready",
      cleanupCompleted: "passed",
      crossOrganizationRejected: "passed",
      donationsQualified: "passed",
      duesQualified: "passed",
      eventId: "00000000-0000-4000-8000-000000000001",
      purchaseId: "00000000-0000-4000-8000-000000000002",
      receiptAccessible: "passed",
      refundCompleted: "passed",
      resendCompleted: "passed",
      stripeAccountReady: "passed",
      ticketingQualified: "passed",
      webhookRejectedInvalidSignature: "passed",
    });
  });

  it("distinguishes not_run and skipped from failed in qualification summary", () => {
    const summary = safeStripeCommerceQualificationSummary({
      accountState: "pending_onboarding",
      cleanupCompleted: "passed",
      stripeAccountReady: "failed",
      ticketingQualified: "skipped",
      // other fields omitted -> not_run
    });
    expect(summary.accountState).toBe("pending_onboarding");
    expect(summary.stripeAccountReady).toBe("failed");
    expect(summary.ticketingQualified).toBe("skipped");
    expect(summary.cleanupCompleted).toBe("passed");
    expect(summary.refundCompleted).toBe("not_run");
  });
});
