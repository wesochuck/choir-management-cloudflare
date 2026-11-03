import { describe, expect, it } from "vitest";

import { formatEventDate, formatEventShortDate } from "./rsvpDeclineNotifications";

describe("rsvpDeclineNotifications helpers", () => {
  it("formats short event dates respecting the organization timezone", () => {
    // 2026-11-03T01:30:00Z is Nov 2 in New York and Nov 3 in London
    const isoString = "2026-11-03T01:30:00.000Z";

    expect(formatEventShortDate(isoString, "America/New_York")).toBe("Nov 2");
    expect(formatEventShortDate(isoString, "Europe/London")).toBe("Nov 3");
  });

  it("returns null for invalid dates in formatEventShortDate", () => {
    expect(formatEventShortDate("not-a-date", "America/New_York")).toBeNull();
    expect(formatEventShortDate("", "America/New_York")).toBeNull();
  });

  it("formats full event dates with time and timezone", () => {
    const isoString = "2026-11-03T00:30:00.000Z";
    const formatted = formatEventDate(isoString, "America/New_York");

    expect(formatted).toContain("Monday, November 2, 2026");
    expect(formatted).toContain("7:30 PM");
  });
});
