import {
  donationRecordSchema,
  organizationTicketOrderSchema,
  type DonationRecord,
  type OrganizationTicketOrder,
} from "@choir/contracts";
import { describe, expect, it } from "vitest";
import {
  commerceRowGrossAmount,
  commerceRowNetProceeds,
  commerceRowProcessorFee,
  commerceRowRefundAmount,
  type CommerceRow,
} from "./reportHelpers";

function mockTicketOrder(
  overrides: Partial<OrganizationTicketOrder> = {},
): OrganizationTicketOrder {
  return organizationTicketOrderSchema.parse({
    amountPaidCents: 5180,
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
    eventTitle: "Fall Concert",
    feeCents: 180,
    id: "22222222-2222-4222-8222-222222222222",
    includedEvents: [],
    location: "Hall",
    marketingOptIn: false,
    originalSubtotalCents: 5000,
    originalUnitPriceCents: 5000,
    processorFeeCents: 175,
    processorFeeReconciledAt: "2026-09-01T12:01:00Z",
    providerBalanceTransactionId: "txn_123",
    providerPaymentId: "pi_123",
    providerSessionId: "cs_123",
    quantity: 1,
    refundRequested: false,
    refundedAt: null,
    status: "paid",
    timezone: "America/New_York",
    unitPriceCents: 5000,
    updatedAt: "2026-09-01T12:01:00Z",
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
    id: "44444444-4444-4444-8444-444444444444",
    marketingConsent: false,
    marketingOptIn: false,
    patronId: null,
    refundRequested: false,
    refundedAt: null,
    status: "paid",
    tributeName: "",
    tributeNotifyEmail: "",
    tributeType: "none",
    updatedAt: "2026-09-01T12:00:00Z",
    ...overrides,
  });
}

describe("Commerce report helpers", () => {
  it("calculates gross, refund, processor fee, and net proceeds for paid Stripe ticket", () => {
    const ticket = mockTicketOrder({
      amountPaidCents: 5180,
      feeCents: 180,
      processorFeeCents: 175,
      status: "paid",
    });
    const row: CommerceRow = { kind: "ticket", record: ticket };

    expect(commerceRowGrossAmount(row)).toBe(5180);
    expect(commerceRowRefundAmount(row)).toBe(0);
    expect(commerceRowProcessorFee(row)).toBe(175);
    expect(commerceRowNetProceeds(row)).toBe(5180 - 0 - 175); // 5005
  });

  it("calculates gross, refund, processor fee, and negative net proceeds for refunded Stripe ticket", () => {
    const ticket = mockTicketOrder({
      amountPaidCents: 5180,
      feeCents: 180,
      processorFeeCents: 175,
      refundedAt: "2026-09-02T12:00:00Z",
      status: "refunded",
    });
    const row: CommerceRow = { kind: "ticket", record: ticket };

    expect(commerceRowGrossAmount(row)).toBe(5180);
    expect(commerceRowRefundAmount(row)).toBe(5180);
    expect(commerceRowProcessorFee(row)).toBe(175);
    // Negative net proceeds equals the retained Stripe fee
    expect(commerceRowNetProceeds(row)).toBe(-175);
  });

  it("returns null for unreconciled processor fee and net proceeds", () => {
    const ticket = mockTicketOrder({
      amountPaidCents: 3000,
      processorFeeCents: null,
      processorFeeReconciledAt: null,
      providerBalanceTransactionId: null,
      status: "paid",
    });
    const row: CommerceRow = { kind: "ticket", record: ticket };

    expect(commerceRowGrossAmount(row)).toBe(3000);
    expect(commerceRowRefundAmount(row)).toBe(0);
    expect(commerceRowProcessorFee(row)).toBeNull();
    expect(commerceRowNetProceeds(row)).toBeNull();
  });

  it("calculates gross, refund, processor fee, and net proceeds for paid Stripe donation", () => {
    const donation = mockDonation({
      amountCents: 10000,
      feeCents: 320,
      paymentMethod: "stripe",
      processorFeeCents: 320,
      status: "paid",
    });
    const row: CommerceRow = { kind: "donation", record: donation };

    expect(commerceRowGrossAmount(row)).toBe(10320);
    expect(commerceRowRefundAmount(row)).toBe(0);
    expect(commerceRowProcessorFee(row)).toBe(320);
    expect(commerceRowNetProceeds(row)).toBe(10000); // 10320 - 0 - 320
  });

  it("calculates negative net proceeds equal to retained Stripe fee for refunded Stripe donation", () => {
    const donation = mockDonation({
      amountCents: 10000,
      feeCents: 320,
      paymentMethod: "stripe",
      processorFeeCents: 320,
      status: "refunded",
    });
    const row: CommerceRow = { kind: "donation", record: donation };

    expect(commerceRowGrossAmount(row)).toBe(10320);
    expect(commerceRowRefundAmount(row)).toBe(10320);
    expect(commerceRowProcessorFee(row)).toBe(320);
    // Fully refunded Stripe donation nets negative amount equal to the retained fee
    expect(commerceRowNetProceeds(row)).toBe(-320);
  });

  it("returns null processor fee and net proceeds for unreconciled Stripe donation", () => {
    const donation = mockDonation({
      amountCents: 10000,
      feeCents: 320,
      paymentMethod: "stripe",
      processorFeeCents: null,
      status: "paid",
    });
    const row: CommerceRow = { kind: "donation", record: donation };

    expect(commerceRowGrossAmount(row)).toBe(10320);
    expect(commerceRowRefundAmount(row)).toBe(0);
    expect(commerceRowProcessorFee(row)).toBeNull();
    expect(commerceRowNetProceeds(row)).toBeNull();
  });

  it("handles non-Stripe donation rows without processor fees", () => {
    const donation = mockDonation({
      amountCents: 10000,
      feeCents: 0,
      paymentMethod: "check",
      status: "paid",
    });
    const row: CommerceRow = { kind: "donation", record: donation };

    expect(commerceRowGrossAmount(row)).toBe(10000);
    expect(commerceRowRefundAmount(row)).toBe(0);
    expect(commerceRowProcessorFee(row)).toBe(0);
    expect(commerceRowNetProceeds(row)).toBe(10000);
  });
});
