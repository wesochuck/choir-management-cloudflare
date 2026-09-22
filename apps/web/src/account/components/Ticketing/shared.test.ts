import { describe, expect, it } from "vitest";
import {
  buyerLastName,
  canRefundTicketOrder,
  findClosestEvent,
  money,
  ticketOrderStatusDisplay,
} from "./shared";

describe("findClosestEvent", () => {
  it("returns undefined for an empty list", () => {
    const emptyEvents: readonly { startsAt: string }[] = [];
    expect(findClosestEvent(emptyEvents)).toBeUndefined();
  });

  it("returns the single event when only one exists", () => {
    const event = { id: "evt-1", startsAt: "2026-09-21T19:30:00.000Z", title: "Autumn Concert" };
    expect(findClosestEvent([event])).toEqual(event);
  });

  it("selects the concert happening today when multiple concerts exist", () => {
    const relativeTo = new Date("2026-09-20T14:00:00.000Z");
    const pastConcert = {
      id: "evt-past",
      startsAt: "2026-08-15T19:00:00.000Z",
      title: "Summer Gala",
    };
    const todayConcert = {
      id: "evt-today",
      startsAt: "2026-09-20T19:30:00.000Z",
      title: "Singing the 70s",
    };
    const futureConcert = {
      id: "evt-future",
      startsAt: "2026-10-15T19:30:00.000Z",
      title: "Winter Festival",
    };

    const events = [futureConcert, pastConcert, todayConcert];
    expect(findClosestEvent(events, relativeTo)).toEqual(todayConcert);
  });

  it("selects the upcoming concert when closer than a past concert", () => {
    const relativeTo = new Date("2026-09-20T12:00:00.000Z");
    const pastConcert = {
      id: "evt-past",
      startsAt: "2026-09-10T19:00:00.000Z", // 10 days ago
      title: "Summer Gala",
    };
    const upcomingConcert = {
      id: "evt-upcoming",
      startsAt: "2026-09-22T19:00:00.000Z", // 2 days in future
      title: "Singing the 70s",
    };
    const distantFuture = {
      id: "evt-future",
      startsAt: "2026-12-20T19:00:00.000Z",
      title: "Holiday Concert",
    };

    expect(findClosestEvent([distantFuture, pastConcert, upcomingConcert], relativeTo)).toEqual(
      upcomingConcert,
    );
  });

  it("selects the closest past concert when all concerts are in the past", () => {
    const relativeTo = new Date("2026-09-20T12:00:00.000Z");
    const oldConcert = {
      id: "evt-old",
      startsAt: "2026-01-10T19:00:00.000Z",
      title: "Old Concert",
    };
    const recentConcert = {
      id: "evt-recent",
      startsAt: "2026-09-18T19:00:00.000Z", // 2 days ago
      title: "Recent Concert",
    };

    expect(findClosestEvent([oldConcert, recentConcert], relativeTo)).toEqual(recentConcert);
  });

  it("selects the closest future concert when all concerts are in the future", () => {
    const relativeTo = new Date("2026-09-20T12:00:00.000Z");
    const nearFuture = {
      id: "evt-near",
      startsAt: "2026-09-24T19:00:00.000Z", // 4 days away
      title: "Near Future Concert",
    };
    const farFuture = {
      id: "evt-far",
      startsAt: "2026-11-20T19:00:00.000Z",
      title: "Far Future Concert",
    };

    expect(findClosestEvent([farFuture, nearFuture], relativeTo)).toEqual(nearFuture);
  });

  it("prefers upcoming over past event in case of an exact tie", () => {
    const relativeTo = new Date("2026-09-20T12:00:00.000Z");
    const pastConcert = {
      id: "evt-past",
      startsAt: "2026-09-19T12:00:00.000Z", // 24 hours in past
      title: "Yesterday Concert",
    };
    const futureConcert = {
      id: "evt-future",
      startsAt: "2026-09-21T12:00:00.000Z", // 24 hours in future
      title: "Tomorrow Concert",
    };

    expect(findClosestEvent([pastConcert, futureConcert], relativeTo)).toEqual(futureConcert);
  });

  it("skips invalid dates safely", () => {
    const relativeTo = new Date("2026-09-20T12:00:00.000Z");
    const invalidEvent = {
      id: "evt-invalid",
      startsAt: "not-a-valid-date",
      title: "Invalid Date Concert",
    };
    const validEvent = {
      id: "evt-valid",
      startsAt: "2026-09-22T19:00:00.000Z",
      title: "Valid Concert",
    };

    expect(findClosestEvent([invalidEvent, validEvent], relativeTo)).toEqual(validEvent);
  });
});

describe("buyerLastName", () => {
  it("extracts last name correctly", () => {
    expect(buyerLastName("Jane Buyer")).toBe("Buyer");
    expect(buyerLastName("Cher")).toBe("Cher");
    expect(buyerLastName("  John   Middle   Doe  ")).toBe("Doe");
  });
});

describe("money", () => {
  it("formats cents into currency", () => {
    expect(money(1574)).toBe("$15.74");
    expect(money(0)).toBe("$0.00");
  });
});

describe("ticketOrderStatusDisplay and canRefundTicketOrder", () => {
  const baseOrder = {
    amountPaidCents: 2500,
    buyerEmail: "buyer@example.com",
    buyerName: "Jane Buyer",
    checkoutMode: "stripe" as const,
    createdAt: "2026-09-22T12:00:00.000Z",
    eventId: "evt-1",
    id: "ord-1",
    quantity: 2,
    refundRequested: false,
    status: "paid" as const,
  };

  it("displays Paid and permits refund for normal paid order", () => {
    const display = ticketOrderStatusDisplay(baseOrder);
    expect(display.label).toBe("Paid");
    expect(display.badgeClass).toBe("status-pill status-pill--success");
    expect(canRefundTicketOrder(baseOrder)).toBe(true);
  });

  it("displays Refund requested with warning styling and suppresses refund when refundRequested is true", () => {
    const requestedOrder = { ...baseOrder, refundRequested: true };
    const display = ticketOrderStatusDisplay(requestedOrder);
    expect(display.label).toBe("Refund requested");
    expect(display.badgeClass).toBe("status-pill status-pill--warning");
    expect(canRefundTicketOrder(requestedOrder)).toBe(false);
  });

  it("displays Refunded and suppresses refund when status is refunded", () => {
    const refundedOrder = { ...baseOrder, refundRequested: true, status: "refunded" as const };
    const display = ticketOrderStatusDisplay(refundedOrder);
    expect(display.label).toBe("Refunded");
    expect(display.badgeClass).toBe("status-pill status-pill--neutral");
    expect(canRefundTicketOrder(refundedOrder)).toBe(false);
  });

  it("preserves simulation indicator in display label", () => {
    const simOrder = { ...baseOrder, checkoutMode: "fake" as const };
    expect(ticketOrderStatusDisplay(simOrder).label).toBe("Paid (simulation)");

    const simRequested = { ...baseOrder, checkoutMode: "fake" as const, refundRequested: true };
    expect(ticketOrderStatusDisplay(simRequested).label).toBe("Refund requested (simulation)");
  });
});
