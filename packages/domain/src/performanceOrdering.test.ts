import { describe, expect, it } from "vitest";
import { prioritizeTicketedPerformances } from "./performanceOrdering";

describe("ticketed Performance priority", () => {
  it("sorts reverse-ordered groups chronologically with ticketed Performances first", () => {
    const input = [
      { id: "free-later", isTicketingEnabled: false, startsAt: "2026-12-12T19:00:00Z" },
      { id: "ticket-later", isTicketingEnabled: true, startsAt: "2026-12-13T19:00:00Z" },
      { id: "free-near", isTicketingEnabled: false, startsAt: "2026-11-21T19:00:00Z" },
      { id: "ticket-near", isTicketingEnabled: true, startsAt: "2026-12-01T19:00:00Z" },
    ];
    const original = [...input];
    expect(prioritizeTicketedPerformances(input).map(({ id }) => id)).toEqual([
      "ticket-near",
      "ticket-later",
      "free-near",
      "free-later",
    ]);
    expect(input).toEqual(original);
  });

  it.each([true, false])(
    "sorts chronologically when all ticketing flags are %s",
    (isTicketingEnabled) => {
      const input = [
        { id: "later", isTicketingEnabled, startsAt: "2026-12-01T19:00:00Z" },
        { id: "earlier", isTicketingEnabled, startsAt: "2026-11-01T19:00:00Z" },
      ];
      expect(prioritizeTicketedPerformances(input)).toEqual([input[1], input[0]]);
    },
  );

  it("compares instants across timezone offsets and preserves ties", () => {
    const input = [
      { id: "later", isTicketingEnabled: true, startsAt: "2026-12-01T18:00:00-05:00" },
      { id: "earlier", isTicketingEnabled: true, startsAt: "2026-12-01T20:00:00Z" },
      { id: "same-time", isTicketingEnabled: true, startsAt: "2026-12-01T15:00:00-05:00" },
    ];
    expect(prioritizeTicketedPerformances(input).map(({ id }) => id)).toEqual([
      "earlier",
      "same-time",
      "later",
    ]);
  });

  it("handles an empty schedule", () => {
    expect(prioritizeTicketedPerformances([])).toEqual([]);
  });
});
