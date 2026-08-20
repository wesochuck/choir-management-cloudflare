import { describe, expect, it } from "vitest";

import {
  commerceBoundaryResponsesSafe,
  safeStripeCommerceQualificationSummary,
  stripeCommerceQualificationPlan,
  ticketReceiptMatches,
} from "./qualify-staging-stripe-commerce.mjs";

describe("staging Stripe sandbox commercial qualification helpers", () => {
  it("describes a complete commercial flow and cleanup plan", () => {
    const plan = stripeCommerceQualificationPlan().join(" ");
    expect(plan).toContain("Stripe Connect account readiness");
    expect(plan).toContain("ticket-enabled Performance");
    expect(plan).toContain("canonical signed ticket receipt");
    expect(plan).toContain("ticket-confirmation resend");
    expect(plan).toContain("wrong Organization host");
    expect(plan).toContain("refund the ticket order");
    expect(plan).toContain("donation checkout with tribute details");
    expect(plan).toContain("season dues");
    expect(plan).toContain("Stripe webhook endpoint rejects invalid signatures");
    expect(plan).toContain("archive the qualification Performance");
  });

  it("verifies matching ticket receipt payloads", () => {
    expect(
      ticketReceiptMatches({ eventId: "ev-1", id: "pur-1", status: "paid" }, "ev-1", "pur-1"),
    ).toBe(true);
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

  it("formats safe qualification summary without leaking sensitive fields", () => {
    const summary = safeStripeCommerceQualificationSummary({
      cleanupCompleted: true,
      crossOrganizationRejected: true,
      donationsQualified: true,
      duesQualified: true,
      eventId: "00000000-0000-4000-8000-000000000001",
      purchaseId: "00000000-0000-4000-8000-000000000002",
      receiptAccessible: true,
      refundCompleted: true,
      resendCompleted: true,
      stripeAccountReady: true,
      ticketingQualified: true,
      webhookRejectedInvalidSignature: true,
    });
    expect(summary).toEqual({
      cleanupCompleted: true,
      crossOrganizationRejected: true,
      donationsQualified: true,
      duesQualified: true,
      eventId: "00000000-0000-4000-8000-000000000001",
      purchaseId: "00000000-0000-4000-8000-000000000002",
      receiptAccessible: true,
      refundCompleted: true,
      resendCompleted: true,
      stripeAccountReady: true,
      ticketingQualified: true,
      webhookRejectedInvalidSignature: true,
    });
  });
});
