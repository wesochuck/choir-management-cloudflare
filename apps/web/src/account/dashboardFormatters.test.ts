import { describe, expect, it } from "vitest";

import {
  formatCallTime,
  formatEventDateTile,
  formatEventTimeRange,
  formatRsvpDeadline,
} from "./dashboardFormatters";

describe("dashboardFormatters", () => {
  describe("formatEventDateTile", () => {
    it("formats weekday, month, day, and year in the target timezone", () => {
      // 2026-10-15T23:30:00Z is 7:30 PM EDT on Oct 15, 2026
      const tile = formatEventDateTile("2026-10-15T23:30:00Z", "America/New_York");
      expect(tile.weekday).toBe("Thu");
      expect(tile.month).toBe("Oct");
      expect(tile.day).toBe("15");
      expect(tile.year).toBe("2026");
      expect(tile.fullLabel).toBe("Thursday, October 15, 2026");
    });

    it("handles daylight saving transitions and day boundary offsets", () => {
      // 2026-11-01T03:30:00Z is 11:30 PM EDT on Oct 31, 2026 in New York
      const tile = formatEventDateTile("2026-11-01T03:30:00Z", "America/New_York");
      expect(tile.weekday).toBe("Sat");
      expect(tile.month).toBe("Oct");
      expect(tile.day).toBe("31");
      expect(tile.year).toBe("2026");
    });
  });

  describe("formatEventTimeRange", () => {
    it("formats 12-hour AM/PM start and end time with duration", () => {
      // 7:00 PM to 9:00 PM in America/New_York (UTC-4) -> 23:00Z to 01:00Z
      const formatted = formatEventTimeRange("2026-10-15T23:00:00Z", 120, "America/New_York");
      expect(formatted).toBe("7:00 PM – 9:00 PM");
    });

    it("formats start time only when duration is missing or zero", () => {
      const formattedNoDuration = formatEventTimeRange(
        "2026-10-15T23:00:00Z",
        null,
        "America/New_York",
      );
      expect(formattedNoDuration).toBe("7:00 PM");

      const formattedZeroDuration = formatEventTimeRange(
        "2026-10-15T23:00:00Z",
        0,
        "America/New_York",
      );
      expect(formattedZeroDuration).toBe("7:00 PM");
    });

    it("handles noon and midnight correctly", () => {
      // 12:00 PM noon in UTC
      expect(formatEventTimeRange("2026-10-15T12:00:00Z", 60, "UTC")).toBe("12:00 PM – 1:00 PM");

      // 12:00 AM midnight in UTC
      expect(formatEventTimeRange("2026-10-15T00:00:00Z", 30, "UTC")).toBe("12:00 AM – 12:30 AM");
    });

    it("appends (next day) when duration crosses midnight in the event timezone", () => {
      // Starts at 11:00 PM EDT (03:00Z next day), duration 180 min (ends at 2:00 AM EDT)
      const formatted = formatEventTimeRange("2026-10-16T03:00:00Z", 180, "America/New_York");
      expect(formatted).toBe("11:00 PM – 2:00 AM (next day)");
    });
  });

  describe("formatCallTime", () => {
    it("converts 24-hour wall-clock times to 12-hour AM/PM", () => {
      expect(formatCallTime("18:45")).toBe("6:45 PM");
      expect(formatCallTime("09:15")).toBe("9:15 AM");
      expect(formatCallTime("9:05")).toBe("9:05 AM");
      expect(formatCallTime("12:00")).toBe("12:00 PM");
      expect(formatCallTime("00:00")).toBe("12:00 AM");
      expect(formatCallTime("0:30")).toBe("12:30 AM");
    });

    it("returns null for empty, null, or invalid strings", () => {
      expect(formatCallTime(null)).toBeNull();
      expect(formatCallTime(undefined)).toBeNull();
      expect(formatCallTime("")).toBeNull();
      expect(formatCallTime("invalid")).toBeNull();
      expect(formatCallTime("25:00")).toBeNull();
      expect(formatCallTime("12:60")).toBeNull();
    });
  });

  describe("formatRsvpDeadline", () => {
    it("formats YYYY-MM-DD date strings without shifting timezone", () => {
      expect(formatRsvpDeadline("2026-10-20")).toBe("Oct 20, 2026");
      expect(formatRsvpDeadline("2026-01-05")).toBe("Jan 5, 2026");
    });

    it("returns null for empty or null dates", () => {
      expect(formatRsvpDeadline(null)).toBeNull();
      expect(formatRsvpDeadline(undefined)).toBeNull();
      expect(formatRsvpDeadline("")).toBeNull();
    });
  });
});
