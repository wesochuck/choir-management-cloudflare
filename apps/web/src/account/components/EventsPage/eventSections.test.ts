import { describe, expect, it } from "vitest";
import type { OrganizationEventRequest } from "@choir/contracts";
import {
  computeSectionErrors,
  firstInvalidSection,
  isSectionRequired,
  totalErrorCount,
  visibleEditorSections,
} from "./eventSections";
import type { EventsState } from "./types";
import { emptyEvent } from "./utils";

const venueId = "22222222-2222-4222-8222-222222222222";

const readyState: EventsState = {
  events: [],
  rsvpExpiryEnabled: false,
  rsvpFollowUpEnabled: false,
  rsvpFollowUpLeadHours: 48,
  status: "ready",
  timezone: "America/New_York",
  venues: [
    {
      address: "1 Hall Way",
      createdAt: "2026-01-01T00:00:00Z",
      id: venueId,
      name: "City Hall",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
};

function performance(overrides: Partial<OrganizationEventRequest> = {}): OrganizationEventRequest {
  return {
    ...emptyEvent,
    rsvpDeadlineDate: "2026-10-10",
    title: "Fall Concert",
    type: "Performance",
    venueId,
    ...overrides,
  };
}

describe("event section validation", () => {
  it("requires venue for both types without blocking reads", () => {
    const missing = computeSectionErrors({
      event: performance({ venueId: null }),
      eventStart: "2026-11-15T19:00",
      graphicError: null,
      state: readyState,
    });
    expect(missing.schedule.some((message) => message.includes("saved venue"))).toBe(true);

    const rehearsalMissing = computeSectionErrors({
      event: { ...emptyEvent, title: "Sectional", type: "Rehearsal", venueId: null },
      eventStart: "2026-11-16T19:00",
      graphicError: null,
      state: readyState,
    });
    expect(rehearsalMissing.schedule.length).toBeGreaterThan(0);
  });

  it("treats past RSVP deadline as warning-free validation (no missing error)", () => {
    // Past deadlines are surfaced via EventRsvpDeadlineNotice, not section errors.
    const errors = computeSectionErrors({
      event: performance({ rsvpDeadlineDate: "2020-01-01" }),
      eventStart: "2028-12-01T19:00",
      graphicError: null,
      state: readyState,
    });
    expect(errors.rsvp).toHaveLength(0);
  });

  it("requires RSVP deadline for Performances and hides RSVP for Rehearsals", () => {
    const missingDeadline = computeSectionErrors({
      event: performance({ rsvpDeadlineDate: null }),
      eventStart: "2028-12-01T19:00",
      graphicError: null,
      state: readyState,
    });
    expect(missingDeadline.rsvp.length).toBeGreaterThan(0);
    expect(visibleEditorSections("Rehearsal")).not.toContain("rsvp");
    expect(visibleEditorSections("Rehearsal")).not.toContain("tickets");
    expect(visibleEditorSections("Performance")).toContain("tickets");
    expect(isSectionRequired("rsvp", "Performance")).toBe(true);
    expect(isSectionRequired("rsvp", "Rehearsal")).toBe(false);
    expect(isSectionRequired("tickets", "Performance")).toBe(false);
  });

  it("jumps to first invalid visible section", () => {
    const errors = computeSectionErrors({
      event: { ...emptyEvent, title: "", type: "Rehearsal", venueId: null },
      eventStart: "",
      graphicError: null,
      state: readyState,
    });
    expect(firstInvalidSection(errors, visibleEditorSections("Rehearsal"))).toBe("basics");
    const withTitle = computeSectionErrors({
      event: { ...emptyEvent, title: "Has Title", type: "Rehearsal", venueId: null },
      eventStart: "2026-11-15T19:00",
      graphicError: null,
      state: readyState,
    });
    expect(firstInvalidSection(withTitle, visibleEditorSections("Rehearsal"))).toBe("schedule");
    expect(totalErrorCount(withTitle)).toBe(1);
  });
});
