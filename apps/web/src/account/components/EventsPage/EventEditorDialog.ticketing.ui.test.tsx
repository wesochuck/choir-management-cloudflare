import type { OrganizationEventRequest } from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEditorDialog } from "./dialogs";
import {
  resetEventEditorMocks,
  stateWithVenues,
  switchToSection,
  venueHall,
} from "./EventEditorDialog/testHarness";
import { emptyEvent } from "./utils";

vi.mock("../../../auth/api", async (importOriginal) => {
  const actual = await importOriginal();
  if (typeof actual !== "object" || actual === null) throw new Error("Unexpected auth api shape");
  return {
    ...actual,
    createOrganizationVenue: vi.fn(),
    getOrganizationBranding: vi.fn(),
    getOrganizationProviderStatus: vi.fn(),
    listOrganizationCommunicationTemplates: vi.fn(),
    listOrganizationEventPromotionMessages: vi.fn(),
    listOrganizationVenues: vi.fn(),
  };
});

vi.mock("../../../api", async (importOriginal) => {
  const actual = await importOriginal();
  if (typeof actual !== "object" || actual === null) throw new Error("Unexpected api shape");
  return {
    ...actual,
    getOrganizationRosterConfiguration: vi.fn(),
    listOrganizationEventAttendance: vi.fn(),
    listOrganizationContactLists: vi.fn(),
    listOrganizationProfiles: vi.fn(),
    previewOrganizationCommunicationReach: vi.fn(),
  };
});

beforeEach(() => {
  resetEventEditorMocks();
});

describe("EventEditorDialog ticketing section and returnTo navigation", () => {
  it("renders ticket sales section with heading for Performance events", async () => {
    const performanceEvent: OrganizationEventRequest = {
      ...emptyEvent,
      isTicketingEnabled: true,
      type: "Performance",
      venueId: venueHall.id,
      rsvpDeadlineDate: "2026-10-10",
    };

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-perf-1"
        error={null}
        event={performanceEvent}
        eventStart="2028-12-01T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );
    await switchToSection(/Ticket sales/);

    const section = document.getElementById("event-editor-section-tickets");
    expect(section).toBeInTheDocument();
    expect(section).toHaveAttribute("data-section", "tickets");
    expect(screen.getByRole("heading", { level: 3, name: /Ticket sales/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Ticket capacity")).toBeInTheDocument();
    expect(screen.getByLabelText("Advance price (USD)")).toBeInTheDocument();
    expect(screen.getByLabelText("Day-of price (USD)")).toBeInTheDocument();
  });

  it("renders Back to Ticketing button when clean and returnTo points to ticketing", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const performanceEvent: OrganizationEventRequest = {
      ...emptyEvent,
      isTicketingEnabled: true,
      title: "Same Title",
      type: "Performance",
      venueId: venueHall.id,
      rsvpDeadlineDate: "2026-10-10",
    };

    // Render clean: event matches initial draft by using same title twice via key remount.
    // The dialog captures initialDraft on mount, so a freshly mounted clean dialog shows Back.
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-perf-1"
        error={null}
        event={performanceEvent}
        eventStart="2028-12-01T19:00"
        graphicFile={null}
        onClose={onClose}
        onSubmit={vi.fn()}
        returnTo="/admin/tickets?eventId=event-perf-1"
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    // Force clean by ensuring no dirty: initialDraft equals event on first mount.
    // The component's initialDraft is captured once, so this render is clean.
    const backButton = await screen.findByRole("button", { name: "Back to Ticketing" });
    expect(backButton).toBeInTheDocument();

    await user.click(backButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders save bar instead of Back to Ticketing when form has unsaved changes", () => {
    const initialEvent: OrganizationEventRequest = {
      ...emptyEvent,
      title: "Initial Title",
      type: "Performance",
      venueId: venueHall.id,
      rsvpDeadlineDate: "2026-10-10",
    };
    const modifiedEvent: OrganizationEventRequest = {
      ...initialEvent,
      title: "Changed Title",
    };

    const { rerender } = render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-perf-1"
        error={null}
        event={initialEvent}
        eventStart="2028-12-01T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        returnTo="/admin/tickets?eventId=event-perf-1"
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    // Initially clean, Back should be present. Then rerender with modified title to simulate dirty.
    // Note: initialDraft is captured once, so second render with different title becomes dirty.
    rerender(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-perf-1"
        error={null}
        event={modifiedEvent}
        eventStart="2028-12-01T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        returnTo="/admin/tickets?eventId=event-perf-1"
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    expect(screen.queryByRole("button", { name: "Back to Ticketing" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Save event" })).toBeInTheDocument();
  });

  it("selects Ticket Sales section when initialSection is tickets", () => {
    vi.useFakeTimers();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    const performanceEvent: OrganizationEventRequest = {
      ...emptyEvent,
      isTicketingEnabled: true,
      type: "Performance",
      venueId: venueHall.id,
      rsvpDeadlineDate: "2026-10-10",
    };

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-perf-1"
        error={null}
        event={performanceEvent}
        eventStart="2028-12-01T19:00"
        graphicFile={null}
        initialSection="tickets"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    vi.advanceTimersByTime(100);
    expect(screen.getByRole("tab", { name: /Ticket sales/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const capacityInput = document.getElementById("events-page-capacity");
    expect(document.activeElement).toBe(capacityInput);
    vi.useRealTimers();
  });

  it("exposes mobile Event section dropdown synchronized to sidebar state", async () => {
    const user = userEvent.setup();
    const performanceEvent: OrganizationEventRequest = {
      ...emptyEvent,
      title: "Mobile Sync",
      type: "Performance",
      venueId: venueHall.id,
      rsvpDeadlineDate: "2026-10-10",
    };
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={performanceEvent}
        eventStart="2028-12-01T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );
    const select = screen.getByLabelText("Event section");
    await user.selectOptions(select, "rsvp");
    expect(screen.getByRole("tab", { name: /RSVPs & reminders/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText(/Member RSVP deadline/)).toBeInTheDocument();
    const region = within(screen.getByRole("region", { name: /Event editor save bar/ }));
    expect(region.getByRole("button", { name: /Create event|Save event/ })).toBeInTheDocument();
  });
});
