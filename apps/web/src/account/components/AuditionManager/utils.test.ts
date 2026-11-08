import { describe, expect, it } from "vitest";

import {
  formatDate,
  localScheduleInputValue,
  requestedScheduleValue,
  requestedSlotState,
  slotUtcValue,
} from "./utils";

describe("audition scheduling timezone helpers", () => {
  const timezone = "America/New_York";

  it("formats audition dates in the Organization timezone instead of UTC or browser local time", () => {
    // 2026-12-13T20:00:00.000Z is 3:00 PM EST in America/New_York (8:00 PM in UTC)
    const formatted = formatDate("2026-12-13T20:00:00.000Z", timezone);
    expect(formatted).toMatch(/3:00(?::00)?\s*PM/);
    expect(formatted).not.toMatch(/8:00(?::00)?\s*PM/);
  });

  it.each([
    ["2026-03-08T06:30:00.000Z", /1:30(?::00)?\s*AM/],
    ["2026-03-08T07:30:00.000Z", /3:30(?::00)?\s*AM/],
    ["2026-11-01T05:30:00.000Z", /1:30(?::00)?\s*AM/],
    ["2026-11-01T06:30:00.000Z", /1:30(?::00)?\s*AM/],
  ])("formats %s across daylight-saving transitions", (instant, expected) => {
    expect(formatDate(instant, timezone)).toMatch(expected);
  });

  it("round-trips a datetime-local value through the Organization timezone", () => {
    const utc = slotUtcValue("2026-01-15", "14:30", timezone);

    expect(utc).toBe("2026-01-15T19:30:00.000Z");
    if (utc === null) throw new Error("Expected a valid UTC slot.");
    expect(localScheduleInputValue(utc, timezone)).toBe("2026-01-15T14:30");
    expect(requestedScheduleValue("2026-01-15T14:30", [utc], timezone)).toBe("2026-01-15T14:30");
  });

  it("does not shift a daylight-saving-time local value", () => {
    const utc = slotUtcValue("2026-07-15", "14:30", timezone);

    expect(utc).toBe("2026-07-15T18:30:00.000Z");
    if (utc === null) throw new Error("Expected a valid UTC slot.");
    expect(localScheduleInputValue(utc, timezone)).toBe("2026-07-15T14:30");
  });

  it("identifies passed and remaining requested audition times", () => {
    expect(
      requestedSlotState(
        ["2026-08-16T18:00:00.000Z", "2026-08-18T18:00:00.000Z"],
        Date.parse("2026-08-17T12:00:00.000Z"),
      ),
    ).toEqual({ passedCount: 1, remainingCount: 1 });
    expect(
      requestedSlotState(["2026-08-16T18:00:00.000Z"], Date.parse("2026-08-17T12:00:00.000Z")),
    ).toEqual({ passedCount: 1, remainingCount: 0 });
  });
});
