import { describe, expect, it } from "vitest";

import { localScheduleInputValue, requestedScheduleValue, slotUtcValue } from "./utils";

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
});
