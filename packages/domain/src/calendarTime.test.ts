import { describe, expect, it } from "vitest";
import { formatClockTime12Hour } from "./calendarTime";

describe("formatClockTime12Hour", () => {
  it("formats 24-hour HH:MM strings into 12-hour AM/PM times", () => {
    expect(formatClockTime12Hour("00:00")).toBe("12:00 AM");
    expect(formatClockTime12Hour("00:15")).toBe("12:15 AM");
    expect(formatClockTime12Hour("09:05")).toBe("9:05 AM");
    expect(formatClockTime12Hour("12:00")).toBe("12:00 PM");
    expect(formatClockTime12Hour("12:30")).toBe("12:30 PM");
    expect(formatClockTime12Hour("17:30")).toBe("5:30 PM");
    expect(formatClockTime12Hour("23:59")).toBe("11:59 PM");
    expect(formatClockTime12Hour("17:30:00")).toBe("5:30 PM");
  });

  it("returns empty string for blank inputs and preserves already-formatted or invalid values", () => {
    expect(formatClockTime12Hour("")).toBe("");
    expect(formatClockTime12Hour("   ")).toBe("");
    expect(formatClockTime12Hour(null)).toBe("");
    expect(formatClockTime12Hour(undefined)).toBe("");
    expect(formatClockTime12Hour("5:30 PM")).toBe("5:30 PM");
    expect(formatClockTime12Hour("25:00")).toBe("25:00");
  });
});
