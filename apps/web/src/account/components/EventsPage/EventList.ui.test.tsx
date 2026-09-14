import type { OrganizationEvent, OrganizationVenue } from "@choir/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventList } from "./shared";

function mockEvent(
  id: string,
  title: string,
  startsAt: string,
  options: {
    readonly isCanceled?: boolean;
    readonly location?: string;
    readonly publishOnWebsite?: boolean;
    readonly type?: "Performance" | "Rehearsal";
    readonly venueId?: string | null;
  } = {},
): OrganizationEvent {
  return {
    advancePriceCents: 0,
    callTime: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    dayOfPriceCents: 0,
    details: "",
    doorsOpenTime: "",
    durationMinutes: 120,
    id,
    isCanceled: options.isCanceled ?? false,
    isTicketingEnabled: false,
    location: options.location ?? "Main Sanctuary",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: options.publishOnWebsite ?? false,
    rsvpDeadlineAt: null,
    rsvpDeadlineDate: null,
    rsvpDeadlinePassed: false,
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    rsvpSelfServiceOpen: false,
    setList: [],
    setListApproved: false,
    startsAt,
    ticketCapacity: null,
    title,
    type: options.type ?? "Rehearsal",
    updatedAt: "2026-08-01T00:00:00.000Z",
    venueId: options.venueId ?? null,
  };
}

const mockVenues: readonly OrganizationVenue[] = [
  {
    address: "123 Main St",
    createdAt: "2026-08-01T00:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
    name: "Alpha Hall",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    address: "456 Oak St",
    createdAt: "2026-08-01T00:00:00.000Z",
    id: "22222222-2222-4222-8222-222222222222",
    name: "Zeta Center",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
];

function getTableRowTitles(): string[] {
  const table = document.querySelector("table.data-table");
  if (!table) return [];
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  return rows.map((row) => {
    const titleStrong = row.querySelector("td strong");
    return titleStrong ? titleStrong.textContent.trim() : "";
  });
}

describe("EventList table sorting", () => {
  const eventFarFuture = mockEvent("e1", "Singing the 70s", "2027-06-13T19:00:00.000Z", {
    type: "Performance",
    publishOnWebsite: true,
    venueId: "22222222-2222-4222-8222-222222222222",
  });
  const eventNearest = mockEvent("e2", "Upcoming Rehearsal", "2026-09-20T18:30:00.000Z", {
    type: "Rehearsal",
    publishOnWebsite: false,
    venueId: "11111111-1111-4111-8111-111111111111",
  });
  const eventMidFuture = mockEvent("e3", "Earth and Sky and Sea", "2026-11-15T15:00:00.000Z", {
    type: "Performance",
    publishOnWebsite: true,
    location: "Beta Chapel",
  });

  const allEvents = [eventFarFuture, eventNearest, eventMidFuture];

  it("defaults to sorting events chronologically ascending by date, placing nearest event at the top", () => {
    render(
      <EventList
        events={allEvents}
        filteredEvents={allEvents}
        onArchive={vi.fn()}
        onCancel={vi.fn()}
        onClone={vi.fn()}
        onEdit={vi.fn()}
        timezone="America/New_York"
        venues={mockVenues}
      />,
    );

    const dateHeader = screen.getByRole("button", { name: "Sort by Date" }).closest("th");
    expect(dateHeader).toHaveAttribute("aria-sort", "ascending");

    const titles = getTableRowTitles();
    expect(titles).toEqual(["Upcoming Rehearsal", "Earth and Sky and Sea", "Singing the 70s"]);
  });

  it("toggles date sort to descending and back to default when clicking the Date column header", async () => {
    const user = userEvent.setup();
    render(
      <EventList
        events={allEvents}
        filteredEvents={allEvents}
        onArchive={vi.fn()}
        onCancel={vi.fn()}
        onClone={vi.fn()}
        onEdit={vi.fn()}
        timezone="America/New_York"
        venues={mockVenues}
      />,
    );

    const sortDateButton = screen.getByRole("button", { name: "Sort by Date" });

    // Click 1: toggle to descending
    await user.click(sortDateButton);
    expect(sortDateButton.closest("th")).toHaveAttribute("aria-sort", "descending");
    expect(getTableRowTitles()).toEqual([
      "Singing the 70s",
      "Earth and Sky and Sea",
      "Upcoming Rehearsal",
    ]);

    // Click 2: toggle to null (default order)
    await user.click(sortDateButton);
    expect(sortDateButton.closest("th")).toHaveAttribute("aria-sort", "none");
    expect(getTableRowTitles()).toEqual([
      "Upcoming Rehearsal",
      "Earth and Sky and Sea",
      "Singing the 70s",
    ]);
  });

  it("sorts events alphabetically by title when clicking the Event column header", async () => {
    const user = userEvent.setup();
    render(
      <EventList
        events={allEvents}
        filteredEvents={allEvents}
        onArchive={vi.fn()}
        onCancel={vi.fn()}
        onClone={vi.fn()}
        onEdit={vi.fn()}
        timezone="America/New_York"
        venues={mockVenues}
      />,
    );

    const sortEventButton = screen.getByRole("button", { name: "Sort by Event" });
    await user.click(sortEventButton);

    expect(sortEventButton.closest("th")).toHaveAttribute("aria-sort", "ascending");
    expect(getTableRowTitles()).toEqual([
      "Earth and Sky and Sea",
      "Singing the 70s",
      "Upcoming Rehearsal",
    ]);

    await user.click(sortEventButton);
    expect(sortEventButton.closest("th")).toHaveAttribute("aria-sort", "descending");
    expect(getTableRowTitles()).toEqual([
      "Upcoming Rehearsal",
      "Singing the 70s",
      "Earth and Sky and Sea",
    ]);
  });

  it("sorts events by venue name when clicking the Venue column header", async () => {
    const user = userEvent.setup();
    render(
      <EventList
        events={allEvents}
        filteredEvents={allEvents}
        onArchive={vi.fn()}
        onCancel={vi.fn()}
        onClone={vi.fn()}
        onEdit={vi.fn()}
        timezone="America/New_York"
        venues={mockVenues}
      />,
    );

    const sortVenueButton = screen.getByRole("button", { name: "Sort by Venue" });
    await user.click(sortVenueButton);

    // Alpha Hall (Upcoming Rehearsal) < Beta Chapel (Earth and Sky and Sea) < Zeta Center (Singing the 70s)
    expect(sortVenueButton.closest("th")).toHaveAttribute("aria-sort", "ascending");
    expect(getTableRowTitles()).toEqual([
      "Upcoming Rehearsal",
      "Earth and Sky and Sea",
      "Singing the 70s",
    ]);

    await user.click(sortVenueButton);
    expect(sortVenueButton.closest("th")).toHaveAttribute("aria-sort", "descending");
    expect(getTableRowTitles()).toEqual([
      "Singing the 70s",
      "Earth and Sky and Sea",
      "Upcoming Rehearsal",
    ]);
  });

  it("sorts events by visibility when clicking the Visibility column header", async () => {
    const user = userEvent.setup();
    render(
      <EventList
        events={allEvents}
        filteredEvents={allEvents}
        onArchive={vi.fn()}
        onCancel={vi.fn()}
        onClone={vi.fn()}
        onEdit={vi.fn()}
        timezone="America/New_York"
        venues={mockVenues}
      />,
    );

    const sortVisibilityButton = screen.getByRole("button", { name: "Sort by Visibility" });
    await user.click(sortVisibilityButton);

    // Internal ("Upcoming Rehearsal") < Published ("Singing the 70s", "Earth and Sky and Sea")
    expect(sortVisibilityButton.closest("th")).toHaveAttribute("aria-sort", "ascending");
    const titles = getTableRowTitles();
    expect(titles[0]).toBe("Upcoming Rehearsal");

    await user.click(sortVisibilityButton);
    expect(sortVisibilityButton.closest("th")).toHaveAttribute("aria-sort", "descending");
    const descTitles = getTableRowTitles();
    expect(descTitles[2]).toBe("Upcoming Rehearsal");
  });
});
