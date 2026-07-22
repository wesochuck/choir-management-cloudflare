import { describe, expect, it } from "vitest";

import {
  canTransitionTicketPurchase,
  remainingTicketCapacity,
  ticketProcessingFeeCents,
  ticketUnitPriceCents,
} from "./ticketing";

describe("ticketing rules", () => {
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
    expect(ticketProcessingFeeCents(2_000, 2)).toBe(146);
    expect(ticketProcessingFeeCents(0, 2)).toBe(0);
    expect(remainingTicketCapacity(100, 37)).toBe(63);
    expect(remainingTicketCapacity(10, 12)).toBe(0);
    expect(remainingTicketCapacity(null, 12)).toBeNull();
  });

  it("permits only forward checkout transitions", () => {
    expect(canTransitionTicketPurchase("pending", "paid")).toBe(true);
    expect(canTransitionTicketPurchase("pending", "expired")).toBe(true);
    expect(canTransitionTicketPurchase("paid", "refunded")).toBe(true);
    expect(canTransitionTicketPurchase("refunded", "paid")).toBe(false);
    expect(canTransitionTicketPurchase("expired", "paid")).toBe(false);
  });
});
