import { describe, expect, it } from "vitest";

import {
  UPCOMING_PERFORMANCES_EMPTY_FALLBACK,
  filterUpcomingPerformances,
  formatUpcomingPerformancesList,
  replaceUpcomingPerformancesPlaceholder,
  shouldIncludeUnpublishedUpcomingPerformances,
  usesUpcomingPerformancesPlaceholder,
  type UpcomingPerformanceListItem,
} from "./upcomingPerformances";

const BASE_NOW_MS = Date.parse("2026-11-10T15:00:00.000Z");

function isoOffsetDays(days: number, hourOffset = 0): string {
  return new Date(BASE_NOW_MS + days * 86_400_000 + hourOffset * 3_600_000).toISOString();
}

function makeEvent(
  overrides: Partial<UpcomingPerformanceListItem> & { readonly id: string; readonly title: string },
): UpcomingPerformanceListItem {
  return {
    isArchived: false,
    isCanceled: false,
    isTicketingEnabled: false,
    location: "",
    publishOnWebsite: true,
    startsAt: isoOffsetDays(10),
    ticketSlug: null,
    type: "Performance",
    venueAddress: "",
    venueName: "",
    ...overrides,
  };
}

describe("upcomingPerformances domain logic", () => {
  it("detects and replaces upcoming performances placeholders without special regex expansion", () => {
    expect(usesUpcomingPerformancesPlaceholder("Upcoming:\n{{UPCOMING_PERFORMANCES}}")).toBe(true);
    expect(usesUpcomingPerformancesPlaceholder("{{upcoming_performances}}")).toBe(true);
    expect(usesUpcomingPerformancesPlaceholder("{UPCOMING_PERFORMANCES}")).toBe(false);
    expect(
      replaceUpcomingPerformancesPlaceholder(
        "Season lineup:\n\n{{upcoming_performances}}",
        "- **$5 Showcase**",
      ),
    ).toBe("Season lineup:\n\n- **$5 Showcase**");
  });

  it("includes unpublished performances only when the target audience is strictly Members", () => {
    expect(shouldIncludeUnpublishedUpcomingPerformances(["Members"])).toBe(true);
    expect(shouldIncludeUnpublishedUpcomingPerformances(["Contacts"])).toBe(false);
    expect(shouldIncludeUnpublishedUpcomingPerformances(["Members", "Contacts"])).toBe(false);
    expect(shouldIncludeUnpublishedUpcomingPerformances(["Ticket Buyers"])).toBe(false);
    expect(shouldIncludeUnpublishedUpcomingPerformances(["Donors"])).toBe(false);
    expect(shouldIncludeUnpublishedUpcomingPerformances([])).toBe(false);
  });

  it("filters out past, canceled, archived, and non-performance events and sorts chronologically", () => {
    const events: UpcomingPerformanceListItem[] = [
      makeEvent({ id: "past", title: "Past Concert", startsAt: isoOffsetDays(-1) }),
      makeEvent({ id: "canceled", title: "Canceled Concert", isCanceled: true }),
      makeEvent({ id: "archived", title: "Archived Concert", isArchived: true }),
      makeEvent({ id: "rehearsal", title: "Dress Rehearsal", type: "Rehearsal" }),
      makeEvent({ id: "other", title: "Fundraiser Gala", type: "Other" }),
      makeEvent({
        id: "internal",
        title: "School Run-out",
        publishOnWebsite: false,
        startsAt: isoOffsetDays(5),
      }),
      makeEvent({
        id: "ticketed-implicit",
        title: "Ticketed Gala",
        publishOnWebsite: false,
        isTicketingEnabled: true,
        startsAt: isoOffsetDays(15),
      }),
      makeEvent({
        id: "tie-b",
        title: "Beta Concert",
        startsAt: isoOffsetDays(7),
      }),
      makeEvent({
        id: "tie-a",
        title: "Alpha Concert",
        startsAt: isoOffsetDays(7),
      }),
    ];

    const externalVisible = filterUpcomingPerformances(events, {
      includeUnpublished: false,
      nowMs: BASE_NOW_MS,
    });
    expect(externalVisible.map((event) => event.id)).toEqual([
      "tie-a",
      "tie-b",
      "ticketed-implicit",
    ]);

    const memberVisible = filterUpcomingPerformances(events, {
      includeUnpublished: true,
      nowMs: BASE_NOW_MS,
    });
    expect(memberVisible.map((event) => event.id)).toEqual([
      "internal",
      "tie-a",
      "tie-b",
      "ticketed-implicit",
    ]);
  });

  it("formats bulleted blocks with timezone-aware date/time, venue/location fallback, and ticket links", () => {
    const formatted = formatUpcomingPerformancesList(
      [
        makeEvent({
          id: "perf-1",
          isTicketingEnabled: true,
          location: "Legacy Hall",
          startsAt: "2027-05-02T01:00:00.000Z",
          ticketSlug: "spring-concert",
          title: "Spring\nConcert",
          venueAddress: "12 Main St",
          venueName: "Community Hall",
        }),
        makeEvent({
          id: "perf-2",
          isTicketingEnabled: false,
          location: "Downtown Stage",
          startsAt: "2027-06-02T01:00:00.000Z",
          title: "Summer Showcase",
          venueAddress: "",
          venueName: "Downtown Stage",
        }),
        makeEvent({
          id: "perf-3",
          isTicketingEnabled: true,
          location: "",
          startsAt: "2027-07-02T01:00:00.000Z",
          ticketSlug: null,
          title: "TBD Venue Concert",
          venueAddress: "",
          venueName: "TBD",
        }),
      ],
      {
        canonicalOrigin: "https://alpha.example.test",
        timezone: "America/New_York",
      },
    );

    expect(formatted).toBe(
      [
        "- **Spring Concert**\n  - **Date and time:** Saturday, May 1, 2027 at 9:00 PM\n  - **Location:** Community Hall, 12 Main St\n  - **Tickets:** [Buy tickets](https://alpha.example.test/tickets/spring-concert)",
        "- **Summer Showcase**\n  - **Date and time:** Tuesday, June 1, 2027 at 9:00 PM\n  - **Location:** Downtown Stage",
        "- **TBD Venue Concert**\n  - **Date and time:** Thursday, July 1, 2027 at 9:00 PM\n  - **Location:** TBD\n  - **Tickets:** [Buy tickets](https://alpha.example.test/tickets/perf-3)",
      ].join("\n\n"),
    );
  });

  it("supports relative ticket links when requested and omits unsafe or missing origins", () => {
    const item = makeEvent({
      id: "perf-1",
      isTicketingEnabled: true,
      ticketSlug: "spring-concert",
      title: "Spring Concert",
    });

    expect(
      formatUpcomingPerformancesList([item], {
        allowRelativeLinks: true,
        canonicalOrigin: null,
        timezone: "UTC",
      }),
    ).toContain("- **Tickets:** [Buy tickets](/tickets/spring-concert)");

    expect(
      formatUpcomingPerformancesList([item], {
        allowRelativeLinks: false,
        canonicalOrigin: null,
        timezone: "UTC",
      }),
    ).not.toContain("Buy tickets");

    expect(
      formatUpcomingPerformancesList([item], {
        allowRelativeLinks: false,
        canonicalOrigin: "javascript:alert(1)",
        timezone: "UTC",
      }),
    ).not.toContain("Buy tickets");
  });

  it("returns the readable empty fallback when no performances remain", () => {
    expect(formatUpcomingPerformancesList([], { timezone: "UTC" })).toBe(
      UPCOMING_PERFORMANCES_EMPTY_FALLBACK,
    );
  });
});
