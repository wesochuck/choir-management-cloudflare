import { describe, expect, it } from "vitest";
import { prioritizeTicketedPerformances } from "./performanceOrdering";

describe("ticketed Performance priority", () => {
  it("promotes all ticketed Performances while preserving relative order in both groups", () => {
    const input = [
      { id: "free-near", isTicketingEnabled: false },
      { id: "ticket-near", isTicketingEnabled: true },
      { id: "free-later", isTicketingEnabled: false },
      { id: "ticket-later", isTicketingEnabled: true },
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
    "preserves ordering when all ticketing flags are %s",
    (isTicketingEnabled) => {
      const input = [
        { id: "first", isTicketingEnabled },
        { id: "second", isTicketingEnabled },
      ];
      expect(prioritizeTicketedPerformances(input)).toEqual(input);
    },
  );

  it("handles an empty schedule", () => {
    expect(prioritizeTicketedPerformances([])).toEqual([]);
  });
});
