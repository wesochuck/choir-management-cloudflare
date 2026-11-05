import { describe, expect, it } from "vitest";

import {
  buildRsvpDeclineInboxBody,
  formatEventDate,
  formatEventShortDate,
} from "./rsvpDeclineNotifications";

describe("rsvpDeclineNotifications helpers", () => {
  it("builds inbox notice body with plain text without note", () => {
    const body = buildRsvpDeclineInboxBody({
      displayName: "Jane Doe",
      eventTitle: "Spring Rehearsal",
      formattedDate: "Monday, March 1, 2026, 7:00 PM",
      rsvpNote: null,
      voicePart: "Soprano",
    });
    expect(body).toBe(
      "Jane Doe (Soprano) declined Spring Rehearsal on Monday, March 1, 2026, 7:00 PM.",
    );
  });

  it("builds inbox notice body with shortened note preview when note is long", () => {
    const longNote =
      "I have a sudden conflicting business commitment out of town that requires travel and unfortunately prevents me from attending this week's scheduled dress rehearsal.";
    const body = buildRsvpDeclineInboxBody({
      displayName: "Jane Doe",
      eventTitle: "Spring Rehearsal",
      formattedDate: "Monday, March 1, 2026, 7:00 PM",
      rsvpNote: longNote,
      voicePart: "Soprano",
    });
    expect(body).toContain('Note: "');
    expect(body).toContain("...");
    expect(body.length).toBeLessThan(350);
  });

  it("collapses whitespace in note preview", () => {
    const body = buildRsvpDeclineInboxBody({
      displayName: "Jane Doe",
      eventTitle: "Spring Rehearsal",
      formattedDate: "Monday, March 1, 2026, 7:00 PM",
      rsvpNote: "Out of town\n\nwith family   vacation",
      voicePart: null,
    });
    expect(body).toBe(
      'Jane Doe (Voice part not assigned) declined Spring Rehearsal on Monday, March 1, 2026, 7:00 PM. Note: "Out of town with family vacation"',
    );
  });

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
