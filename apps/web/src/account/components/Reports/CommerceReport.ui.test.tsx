import {
  type DonationRecord,
  donationRecordSchema,
  organizationTicketOrderSchema,
  type OrganizationTicketOrder,
} from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { CommerceReport } from "./CommerceReport";

function mockTicketOrder(
  overrides: Partial<OrganizationTicketOrder> = {},
): OrganizationTicketOrder {
  return organizationTicketOrderSchema.parse({
    amountPaidCents: 5000,
    bundleId: null,
    bundleTitle: "",
    buyerEmail: "buyer@example.test",
    buyerName: "Ticket Buyer",
    checkoutMode: "stripe",
    createdAt: "2026-09-01T12:00:00Z",
    currency: "usd",
    discountAmountCents: 0,
    discountCode: null,
    discountType: null,
    discountValue: null,
    discountedSubtotalCents: 5000,
    eventId: "11111111-1111-4111-8111-111111111111",
    eventStartsAt: "2026-10-01T19:00:00Z",
    eventTitle: "Autumn Concert",
    feeCents: 150,
    id: "22222222-2222-4222-8222-222222222222",
    includedEvents: [],
    location: "Hall",
    marketingOptIn: false,
    originalSubtotalCents: 5000,
    originalUnitPriceCents: 5000,
    processorFeeCents: 175,
    processorFeeReconciledAt: "2026-09-01T12:05:00Z",
    providerBalanceTransactionId: "txn_test_123",
    providerPaymentId: "pi_test_123",
    providerSessionId: "cs_test_123",
    quantity: 1,
    refundRequested: false,
    status: "paid",
    timezone: "America/New_York",
    unitPriceCents: 5000,
    updatedAt: "2026-09-01T12:00:00Z",
    venueAddress: "",
    venueName: "Hall",
    ...overrides,
  });
}

function mockDonation(overrides: Partial<DonationRecord> = {}): DonationRecord {
  return donationRecordSchema.parse({
    amountCents: 10000,
    anonymous: false,
    buyerEmail: "donor@example.test",
    buyerName: "Generous Donor",
    createdAt: "2026-09-01T12:00:00Z",
    expiredAt: null,
    feeCents: 320,
    id: "33333333-3333-4333-8333-333333333333",
    marketingConsent: false,
    patronId: null,
    paymentMethod: "stripe",
    paymentReference: "pi_donation_123",
    processorFeeCents: 320,
    processorFeeReconciledAt: "2026-09-01T12:05:00Z",
    providerBalanceTransactionId: "txn_donation_123",
    refundRequested: false,
    status: "paid",
    thankYouSentAt: null,
    tributeName: "",
    tributeNotifyEmail: "",
    tributeType: "none",
    updatedAt: "2026-09-01T12:00:00Z",
    ...overrides,
  });
}

function getKpiCard(label: string): HTMLElement {
  const cards = screen.getAllByRole("generic").filter((el) => el.classList.contains("reports-kpi"));
  const match = cards.find((card) => within(card).queryByText(label) !== null);
  if (!match) {
    throw new Error(`Could not find KPI card with label: "${label}"`);
  }
  return match;
}

describe("CommerceReport financial reconciliation and donations", () => {
  it("includes reconciled Stripe donations and tickets in financial summary", () => {
    const ticket = mockTicketOrder({
      amountPaidCents: 5150,
      feeCents: 150,
      processorFeeCents: 175,
    });
    const donation = mockDonation({ amountCents: 10000, feeCents: 320, processorFeeCents: 320 });

    render(<CommerceReport donations={[donation]} state="ready" ticketOrders={[ticket]} />);

    // Gross charged: ticket ($51.50) + donation ($100.00 + $3.20 = $103.20) = $154.70
    expect(within(getKpiCard("Gross charged")).getByText("$154.70")).toBeInTheDocument();
    // Customer fees: 150 + 320 = 470 = $4.70
    expect(within(getKpiCard("Customer fees")).getByText("$4.70")).toBeInTheDocument();
    // Stripe fees: 175 + 320 = 495 = -$4.95
    expect(within(getKpiCard("Stripe fees")).getByText("-$4.95")).toBeInTheDocument();
    // Net proceeds: $154.70 - $0 - $4.95 = $149.75
    expect(within(getKpiCard("Net proceeds")).getByText("$149.75")).toBeInTheDocument();
  });

  it("calculates negative net proceeds for fully refunded Stripe donation", () => {
    const refundedDonation = mockDonation({
      amountCents: 5000,
      feeCents: 175,
      processorFeeCents: 175,
      status: "refunded",
    });

    render(<CommerceReport donations={[refundedDonation]} state="ready" ticketOrders={[]} />);

    // Gross charged: $51.75
    expect(within(getKpiCard("Gross charged")).getByText("$51.75")).toBeInTheDocument();
    // Refund: -$51.75
    expect(within(getKpiCard("Refunds")).getByText("-$51.75")).toBeInTheDocument();
    // Stripe fees: -$1.75
    expect(within(getKpiCard("Stripe fees")).getByText("-$1.75")).toBeInTheDocument();
    // Net proceeds: -$1.75 (negative equal to retained Stripe fee)
    expect(within(getKpiCard("Net proceeds")).getByText("-$1.75")).toBeInTheDocument();
  });

  it("prioritizes Pending for Stripe fees when mixed reconciled and unreconciled orders are present", () => {
    const reconciledTicket = mockTicketOrder({ processorFeeCents: 175, status: "paid" });
    const unreconciledDonation = mockDonation({
      paymentMethod: "stripe",
      processorFeeCents: null,
      status: "paid",
    });

    render(
      <CommerceReport
        donations={[unreconciledDonation]}
        state="ready"
        ticketOrders={[reconciledTicket]}
      />,
    );

    // Reconciled fee exists ($1.75), but unreconciled order must take precedence
    expect(within(getKpiCard("Stripe fees")).getByText("Pending")).toBeInTheDocument();
    expect(within(getKpiCard("Net proceeds")).getByText("Pending")).toBeInTheDocument();
  });
});
