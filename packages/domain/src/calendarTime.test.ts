import { describe, expect, it } from "vitest";
import {
  addDays,
  datePartInTimeZone,
  formatTime,
  isValidTimeZone,
  utcToZonedLocalDateTime,
  zonedLocalDateTimeToUtc,
} from "./calendarTime";

describe("isValidTimeZone", () => {
  it("returns true for valid timezones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
  });

  it("returns false for invalid timezones", () => {
    expect(isValidTimeZone("Not/A_Zone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("a".repeat(101))).toBe(false);
  });
});

describe("datePartInTimeZone", () => {
  it("returns the correct date part for a given timezone", () => {
    const date = new Date("2026-07-20T02:00:00.000Z");
    expect(datePartInTimeZone(date, "America/New_York")).toBe("2026-07-19");
    expect(datePartInTimeZone(date, "UTC")).toBe("2026-07-20");
    expect(datePartInTimeZone(date, "Asia/Tokyo")).toBe("2026-07-20");
  });
});

describe("utcToZonedLocalDateTime", () => {
  it("converts a valid UTC date string to a zoned local date time", () => {
    expect(utcToZonedLocalDateTime("2026-07-20T22:00:00.000Z", "America/New_York")).toBe(
      "2026-07-20T18:00",
    );
    expect(utcToZonedLocalDateTime("2026-12-20T23:00:00.000Z", "America/New_York")).toBe(
      "2026-12-20T18:00",
    );
  });

  it("handles the midnight edge case safely", () => {
    expect(utcToZonedLocalDateTime("2026-07-20T04:00:00.000Z", "America/New_York")).toBe(
      "2026-07-20T00:00",
    );
  });

  it("returns null for invalid dates or invalid timezones", () => {
    expect(utcToZonedLocalDateTime("not-a-date", "America/New_York")).toBeNull();
    expect(utcToZonedLocalDateTime("2026-07-20T22:00:00.000Z", "Not/A_Zone")).toBeNull();
  });
});

describe("addDays", () => {
  it("adds a positive number of days correctly", () => {
    const start = new Date("2026-07-20T12:00:00Z");
    const result = addDays(start, 5);
    expect(result.toISOString()).toBe("2026-07-25T12:00:00.000Z");
  });

  it("subtracts a negative number of days correctly", () => {
    const start = new Date("2026-07-20T12:00:00Z");
    const result = addDays(start, -3);
    expect(result.toISOString()).toBe("2026-07-17T12:00:00.000Z");
  });

  it("does not mutate the original date", () => {
    const start = new Date("2026-07-20T12:00:00Z");
    const result = addDays(start, 1);
    expect(start.toISOString()).toBe("2026-07-20T12:00:00.000Z");
    expect(result.toISOString()).toBe("2026-07-21T12:00:00.000Z");
  });
});

describe("formatTime", () => {
  it("formats the time portion correctly for a given timezone", () => {
    const date = new Date("2026-07-20T22:30:00Z");
    expect(formatTime(date, "America/New_York")).toBe("18:30");
    expect(formatTime(date, "Europe/London")).toBe("23:30");
  });

  it("handles the midnight edgecase safely", () => {
    const date = new Date("2026-07-20T04:00:00Z");
    expect(formatTime(date, "America/New_York")).toBe("00:00");
  });
});

describe("zonedLocalDateTimeToUtc", () => {
  it("converts a valid zoned local date time string to UTC", () => {
    expect(zonedLocalDateTimeToUtc("2026-07-20T18:00", "America/New_York")).toBe(
      "2026-07-20T22:00:00.000Z",
    );
    expect(zonedLocalDateTimeToUtc("2026-12-20T18:00", "America/New_York")).toBe(
      "2026-12-20T23:00:00.000Z",
    );
  });

  it("rejects invalid formats", () => {
    expect(zonedLocalDateTimeToUtc("2026-07-20 18:00", "America/New_York")).toBeNull();
    expect(zonedLocalDateTimeToUtc("2026-07-20", "America/New_York")).toBeNull();
  });

  it("rejects invalid timezones", () => {
    expect(zonedLocalDateTimeToUtc("2026-07-20T18:00", "Not/A_Zone")).toBeNull();
  });

  it("rejects nonexistent spring-forward times", () => {
    expect(zonedLocalDateTimeToUtc("2026-03-08T02:30", "America/New_York")).toBeNull();
  });

  it("resolves ambiguous fall-back times deterministically", () => {
    const result = zonedLocalDateTimeToUtc("2026-11-01T01:30", "America/New_York");
    expect(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]).toContain(result);
  });
});
