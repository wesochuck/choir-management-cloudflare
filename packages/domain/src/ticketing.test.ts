import { describe, expect, it } from "vitest";

import {
  calculatePaymentFinancialSummary,
  canTransitionTicketPurchase,
  isValidTicketDiscountValue,
  normalizeDiscountCode,
  remainingTicketCapacity,
  renderTicketWillCallCsv,
  ticketWillCallFilename,
  ticketCheckoutLineItems,
  ticketProcessingFeeCents,
  ticketOrderQuote,
  transactionProcessingFeeCents,
  ticketUnitPriceCents,
} from "./ticketing";

describe("ticketing rules", () => {
  it("describes customer-paid ticket and bundle processing fees and omits zero-fee rows", () => {
    const ticket = ticketCheckoutLineItems({
      discountedSubtotalCents: 2_500,
      feeCents: 106,
      productName: "Spring Concert ticket",
    });
    expect(ticket).toEqual([
      { productName: "Spring Concert ticket", quantity: 1, unitAmountCents: 2_500 },
      {
        productName: "Processing fee",
        productDescription: "Covers payment processing costs",
        quantity: 1,
        unitAmountCents: 106,
      },
    ]);
    expect(
      ticketCheckoutLineItems({
        discountedSubtotalCents: 6_000,
        feeCents: 204,
        productName: "Season bundle",
      }),
    ).toEqual([
      { productName: "Season bundle", quantity: 1, unitAmountCents: 6_000 },
      {
        productName: "Processing fee",
        productDescription: "Covers payment processing costs",
        quantity: 1,
        unitAmountCents: 204,
      },
    ]);
    expect(
      ticketCheckoutLineItems({
        discountedSubtotalCents: 2_500,
        feeCents: 0,
        productName: "Spring Concert ticket",
      }),
    ).toEqual([{ productName: "Spring Concert ticket", quantity: 1, unitAmountCents: 2_500 }]);
  });

  it("normalizes discount codes and validates whole percentage values", () => {
    expect(normalizeDiscountCode("  spring-25 ")).toBe("SPRING-25");
    expect(isValidTicketDiscountValue("percentage", 1)).toBe(true);
    expect(isValidTicketDiscountValue("percentage", 100)).toBe(true);
    expect(isValidTicketDiscountValue("percentage", 0)).toBe(false);
    expect(isValidTicketDiscountValue("percentage", 25.5)).toBe(false);
    expect(isValidTicketDiscountValue("fixed", 0)).toBe(true);
    expect(isValidTicketDiscountValue("fixed", -1)).toBe(false);
  });

  it("calculates fixed per-unit and percentage discounts with fees after discount", () => {
    expect(
      ticketOrderQuote({
        discountType: "fixed",
        discountValue: 200,
        quantity: 3,
        unitPriceCents: 1_000,
      }),
    ).toMatchObject({
      discountAmountCents: 600,
      discountedSubtotalCents: 2_400,
      feeCents: 103,
      originalSubtotalCents: 3_000,
      totalCents: 2_503,
    });
    expect(
      ticketOrderQuote({
        discountType: "percentage",
        discountValue: 100,
        quantity: 2,
        unitPriceCents: 1_000,
      }),
    ).toMatchObject({
      discountAmountCents: 2_000,
      discountedSubtotalCents: 0,
      feeCents: 0,
      totalCents: 0,
    });
  });

  it("uses the Organization-local show date for day-of pricing", () => {
    const common = {
      advancePriceCents: 2_000,
      dayOfPriceCents: 2_500,
      startsAt: "2026-12-20T23:00:00.000Z",
      timezone: "America/New_York",
    };
    expect(ticketUnitPriceCents({ ...common, now: new Date("2026-12-20T04:30:00.000Z") })).toBe(
      2_000,
    );
    expect(ticketUnitPriceCents({ ...common, now: new Date("2026-12-20T15:00:00.000Z") })).toBe(
      2_500,
    );
  });

  it("calculates the displayed processing fee and bounded remaining capacity", () => {
    expect(ticketProcessingFeeCents(2_000, 2)).toBe(150);
    expect(transactionProcessingFeeCents(2_000, { fixedCents: 25, percentage: 5 })).toBe(132);
    expect(transactionProcessingFeeCents(100)).toBe(34);
    expect(transactionProcessingFeeCents(2_500)).toBe(106);
    expect(transactionProcessingFeeCents(5_000)).toBe(180);
    expect(ticketProcessingFeeCents(0, 2)).toBe(0);
    for (const baseAmountCents of [1, 100, 999, 2_500, 5_000, 10_000]) {
      const feeCents = transactionProcessingFeeCents(baseAmountCents);
      const chargeCents = baseAmountCents + feeCents;
      const providerFeeCents = Math.round(chargeCents * 0.029) + 30;
      expect(chargeCents - providerFeeCents).toBeGreaterThanOrEqual(baseAmountCents);
      if (feeCents > 0) {
        const previousChargeCents = chargeCents - 1;
        const previousProviderFeeCents = Math.round(previousChargeCents * 0.029) + 30;
        expect(previousChargeCents - previousProviderFeeCents).toBeLessThan(baseAmountCents);
      }
    }
    expect(remainingTicketCapacity(100, 37)).toBe(63);
    expect(remainingTicketCapacity(10, 12)).toBe(0);
    expect(remainingTicketCapacity(null, 12)).toBeNull();
  });

  it("permits only forward checkout transitions", () => {
    expect(canTransitionTicketPurchase("pending", "paid")).toBe(true);
    expect(canTransitionTicketPurchase("pending", "expired")).toBe(true);
    expect(canTransitionTicketPurchase("expired", "paid")).toBe(true);
    expect(canTransitionTicketPurchase("paid", "refunded")).toBe(true);
    expect(canTransitionTicketPurchase("refunded", "paid")).toBe(false);
  });

  it("renders stable last-name-sorted will-call CSV without spreadsheet formulas", () => {
    const csv = renderTicketWillCallCsv([
      {
        amountPaidCents: 5000,
        buyerEmail: "=IMPORTXML(example.test)",
        buyerName: "=Danger Adams",
        createdAt: "2026-07-22T00:00:00.000Z",
        id: "order-b",
        quantity: 2,
        status: "paid",
      },
      {
        amountPaidCents: 2500,
        buyerEmail: "zoe@example.test",
        buyerName: "Zoe Baker",
        createdAt: "2026-07-21T00:00:00.000Z",
        id: "order-a",
        quantity: 1,
        status: "paid",
      },
    ]);
    expect(csv).toContain('"\'=IMPORTXML(example.test)"');
    expect(csv).toContain('"\'=Danger Adams"');
    expect(csv.indexOf("=Danger Adams")).toBeLessThan(csv.indexOf("Zoe Baker"));
    expect(ticketWillCallFilename("Winter Concert!", "event-id")).toBe(
      "will-call-winter-concert.csv",
    );
  });

  describe("calculatePaymentFinancialSummary", () => {
    it("summarizes a paid Stripe order with reconciled processor fee", () => {
      const summary = calculatePaymentFinancialSummary([
        {
          amountPaidCents: 10_300,
          checkoutMode: "stripe",
          feeCents: 300,
          processorFeeCents: 320,
          status: "paid",
        },
      ]);
      expect(summary).toEqual({
        customerFeeCents: 300,
        grossChargedCents: 10_300,
        netProceedsCents: 9_980,
        processorFeeCents: 320,
        refundCents: 0,
        unreconciledProcessorFeeCount: 0,
      });
    });

    it("summarizes a fully refunded Stripe order showing negative net equal to retained Stripe fee", () => {
      // Amount charged: $103.00, customer fee: $3.00, Stripe fee: $3.20, refunded: $103.00
      const summary = calculatePaymentFinancialSummary([
        {
          amountPaidCents: 10_300,
          checkoutMode: "stripe",
          feeCents: 300,
          processorFeeCents: 320,
          status: "refunded",
        },
      ]);
      expect(summary).toEqual({
        customerFeeCents: 300,
        grossChargedCents: 10_300,
        netProceedsCents: -320,
        processorFeeCents: 320,
        refundCents: 10_300,
        unreconciledProcessorFeeCount: 0,
      });
    });

    it("summarizes a mixture of paid and refunded Stripe orders", () => {
      const summary = calculatePaymentFinancialSummary([
        {
          amountPaidCents: 10_300,
          checkoutMode: "stripe",
          feeCents: 300,
          processorFeeCents: 320,
          status: "paid",
        },
        {
          amountPaidCents: 5_150,
          checkoutMode: "stripe",
          feeCents: 150,
          processorFeeCents: 180,
          status: "refunded",
        },
      ]);
      expect(summary).toEqual({
        customerFeeCents: 450,
        grossChargedCents: 15_450,
        netProceedsCents: 10_300 - 0 - 320 + (5_150 - 5_150 - 180), // 9980 - 180 = 9800
        processorFeeCents: 500,
        refundCents: 5_150,
        unreconciledProcessorFeeCount: 0,
      });
    });

    it("withholds net proceeds when unreconciled Stripe fee is pending", () => {
      const summary = calculatePaymentFinancialSummary([
        {
          amountPaidCents: 10_300,
          checkoutMode: "stripe",
          feeCents: 300,
          processorFeeCents: null,
          status: "paid",
        },
      ]);
      expect(summary.unreconciledProcessorFeeCount).toBe(1);
      expect(summary.netProceedsCents).toBeNull();
      expect(summary.grossChargedCents).toBe(10_300);
      expect(summary.customerFeeCents).toBe(300);
    });

    it("does not add artificial Stripe fee or mark unreconciled for fake and free checkouts", () => {
      const summary = calculatePaymentFinancialSummary([
        {
          amountPaidCents: 2_500,
          checkoutMode: "fake",
          feeCents: 100,
          processorFeeCents: null,
          status: "paid",
        },
        {
          amountPaidCents: 0,
          checkoutMode: "free",
          feeCents: 0,
          processorFeeCents: null,
          status: "paid",
        },
      ]);
      expect(summary).toEqual({
        customerFeeCents: 100,
        grossChargedCents: 2_500,
        netProceedsCents: 2_500,
        processorFeeCents: 0,
        refundCents: 0,
        unreconciledProcessorFeeCount: 0,
      });
    });

    it("ignores pending and expired orders in financial totals", () => {
      const summary = calculatePaymentFinancialSummary([
        {
          amountPaidCents: 5_000,
          checkoutMode: "stripe",
          feeCents: 150,
          processorFeeCents: null,
          status: "pending",
        },
        {
          amountPaidCents: 5_000,
          checkoutMode: "stripe",
          feeCents: 150,
          processorFeeCents: null,
          status: "expired",
        },
        {
          amountPaidCents: 5_000,
          checkoutMode: "stripe",
          feeCents: 150,
          processorFeeCents: 175,
          status: "paid",
        },
      ]);
      expect(summary).toEqual({
        customerFeeCents: 150,
        grossChargedCents: 5_000,
        netProceedsCents: 4_825,
        processorFeeCents: 175,
        refundCents: 0,
        unreconciledProcessorFeeCount: 0,
      });
    });
  });
});
