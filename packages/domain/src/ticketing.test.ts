import { describe, expect, it } from "vitest";

import {
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
});
