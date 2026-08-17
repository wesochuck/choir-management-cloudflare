import { describe, expect, it } from "vitest";

import {
  localScheduleInputValue,
  requestedScheduleValue,
  requestedSlotState,
  slotUtcValue,
} from "./utils";

describe("audition scheduling timezone helpers", () => {
  const timezone = "America/New_York";

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
