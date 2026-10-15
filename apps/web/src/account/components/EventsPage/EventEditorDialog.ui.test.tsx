import type { OrganizationEventRequest, OrganizationVenue } from "@choir/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SetStateAction } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEditorDialog } from "./dialogs";
import type { EventsState } from "./types";
import { emptyEvent } from "./utils";

vi.mock("../../../auth/api", async (importOriginal) => {
  const actual = await importOriginal();
  if (typeof actual !== "object" || actual === null) throw new Error("Unexpected auth api shape");
  return {
    ...actual,
    createOrganizationVenue: vi.fn(),
    listOrganizationVenues: vi.fn(),
  };
});

import { createOrganizationVenue, listOrganizationVenues } from "../../../auth/api";

const readyState: Extract<EventsState, { status: "ready" }> = {
  events: [],
  rsvpExpiryEnabled: false,
  rsvpFollowUpEnabled: false,
  rsvpFollowUpLeadHours: 48,
  status: "ready",
  timezone: "America/New_York",
  venues: [],
};

const venueHall: OrganizationVenue = {
  address: "123 Main St",
  createdAt: "2026-01-01T00:00:00Z",
  id: "venue-1",
  name: "City Concert Hall",
  updatedAt: "2026-01-01T00:00:00Z",
};

const tbdVenue: OrganizationVenue = {
  address: "",
  createdAt: "2026-01-02T00:00:00Z",
  id: "venue-tbd",
  name: "TBD",
  updatedAt: "2026-01-02T00:00:00Z",
};

function stateWithVenues(venues: readonly OrganizationVenue[]): EventsState {
  return { ...readyState, venues };
}

async function switchToSection(label: RegExp | string): Promise<void> {
  const user = userEvent.setup();
  const tab = screen.getByRole("tab", { name: label });
  await user.click(tab);
}

beforeEach(() => {
  vi.mocked(createOrganizationVenue).mockReset();
  vi.mocked(listOrganizationVenues).mockReset();
  vi.mocked(listOrganizationVenues).mockResolvedValue([]);
});

describe("EventEditorDialog section layout", () => {
  it("renders five sections for Performances with required indicators", () => {
    const performance: OrganizationEventRequest = {
      ...emptyEvent,
      title: "Fall Concert",
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
        event={performance}
        eventStart="2026-11-15T15:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );
    expect(screen.getByRole("tab", { name: /Basics/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Schedule & venue/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /RSVPs & reminders/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Ticket sales/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Public content/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Event section")).toBeInTheDocument();
  });

  it("hides RSVP and ticket sections for Rehearsals", () => {
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={emptyEvent}
        eventStart="2026-11-15T15:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={readyState}
      />,
    );
    expect(screen.getByRole("tab", { name: /Basics/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Schedule & venue/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /RSVPs & reminders/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Ticket sales/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Public content/ })).toBeInTheDocument();
  });

  it("keeps drafts when switching sections via sidebar and mobile dropdown", async () => {
    const user = userEvent.setup();
    const setEvent = vi.fn();
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={{ ...emptyEvent, title: "Draft Title" }}
        eventStart="2026-11-15T15:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );
    expect(screen.getByDisplayValue("Draft Title")).toBeInTheDocument();
    await switchToSection(/Schedule & venue/);
    expect(screen.getByLabelText(/Venue \*/)).toBeInTheDocument();
    const mobileSelect = screen.getByLabelText("Event section");
    await user.selectOptions(mobileSelect, "public");
    expect(screen.getByRole("heading", { name: /Public content/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Public details")).toBeInTheDocument();
  });

  it("blocks save with missing venue and jumps to Schedule with first-invalid focus", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const withTitle: OrganizationEventRequest = {
      ...emptyEvent,
      title: "No Venue Concert",
      type: "Rehearsal",
      venueId: null,
    };
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={withTitle}
        eventStart="2026-11-15T15:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );
    // Switch to schedule to make venue field visible, then attempt save via footer.
    await switchToSection(/Schedule & venue/);
    const saveButton = screen.getByRole("button", { name: /Create event/ });
    await user.click(saveButton);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findAllByText(/Select a saved venue before saving/)).not.toHaveLength(0);
    expect(screen.getByRole("tab", { name: /Schedule & venue/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("EventEditorDialog venue requirement and TBD", () => {
  it("shows TBD helper when venue is missing and creates shared TBD without losing drafts", async () => {
    const user = userEvent.setup();
    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      title: "TBD Concert",
      type: "Rehearsal",
      venueId: null,
    };
    const setEvent = vi.fn((updater: SetStateAction<OrganizationEventRequest>) => {
      if (typeof updater === "function") {
        draft = updater(draft);
      } else {
        draft = updater;
      }
    });
    const onVenueCreated = vi.fn();
    vi.mocked(listOrganizationVenues).mockResolvedValue([]);
    vi.mocked(createOrganizationVenue).mockResolvedValue(tbdVenue);
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={draft}
        eventStart="2026-11-15T15:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onVenueCreated={onVenueCreated}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );
    await switchToSection(/Schedule & venue/);
    expect(screen.getByText(/Location not yet confirmed/)).toBeInTheDocument();
    const tbdButton = screen.getByRole("button", { name: /Create or select TBD/ });
    await user.click(tbdButton);
    expect(vi.mocked(createOrganizationVenue)).toHaveBeenCalledWith("TBD", "");
    // Wait for async state update.
    await screen.findByText(/Working|Create or select TBD/);
    expect(setEvent).toHaveBeenCalled();
    expect(onVenueCreated).toHaveBeenCalledWith(tbdVenue);
  });

  it("reuses existing TBD regardless of casing without duplicating", async () => {
    const user = userEvent.setup();
    const mixedCaseTbd: OrganizationVenue = { ...tbdVenue, name: "  tBd " };
    vi.mocked(listOrganizationVenues).mockResolvedValue([mixedCaseTbd]);
    vi.mocked(createOrganizationVenue).mockResolvedValue(mixedCaseTbd);
    const setEvent = vi.fn();
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={{ ...emptyEvent, title: "Reuse", type: "Rehearsal", venueId: null }}
        eventStart="2026-11-15T15:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall, mixedCaseTbd])}
      />,
    );
    await switchToSection(/Schedule & venue/);
    await user.click(screen.getByRole("button", { name: /Create or select TBD/ }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(vi.mocked(createOrganizationVenue)).not.toHaveBeenCalled();
    expect(setEvent).toHaveBeenCalled();
  });

  it("shows nonblocking TBD confirmation once TBD is selected", async () => {
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-tbd-1"
        error={null}
        event={{ ...emptyEvent, title: "TBD Selected", type: "Rehearsal", venueId: tbdVenue.id }}
        eventStart="2026-11-15T15:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall, tbdVenue])}
      />,
    );
    await switchToSection(/Schedule & venue/);
    expect(screen.getByText(/Venue to be confirmed/)).toBeInTheDocument();
    expect(screen.queryByText(/Select a saved venue before saving/)).not.toBeInTheDocument();
  });

  it("surfaces TBD creation failure without losing drafts", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrganizationVenues).mockResolvedValue([]);
    vi.mocked(createOrganizationVenue).mockRejectedValue(new Error("network"));
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={{ ...emptyEvent, title: "Keep Draft", type: "Rehearsal", venueId: null }}
        eventStart="2026-11-15T15:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );
    await switchToSection(/Schedule & venue/);
    await user.click(screen.getByRole("button", { name: /Create or select TBD/ }));
    expect(await screen.findByText(/could not be created/)).toBeInTheDocument();
    await switchToSection(/Basics/);
    expect(screen.getByDisplayValue("Keep Draft")).toBeInTheDocument();
  });
});

describe("EventEditorDialog public graphic upload and preview", () => {
  it("renders the dropzone and updates preview when valid image is selected", async () => {
    const user = userEvent.setup();
    const setGraphicFile = vi.fn();
    const mockCreateObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:preview-test");

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={emptyEvent}
        eventStart="2026-11-15T15:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={setGraphicFile}
        state={stateWithVenues([venueHall])}
      />,
    );
    await switchToSection(/Public content/);

    expect(screen.getByText("Public graphic")).toBeInTheDocument();
    expect(screen.getByText(/Drag and drop an image here/)).toBeInTheDocument();

    const fileInput = document.querySelector("#events-page-graphic");
    expect(fileInput).toBeInstanceOf(HTMLInputElement);
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Missing file input");
    }

    const validFile = new File(["dummy content"], "poster.png", { type: "image/png" });
    await user.upload(fileInput, validFile);

    expect(mockCreateObjectURL).toHaveBeenCalledWith(validFile);
    expect(setGraphicFile).toHaveBeenCalledWith(validFile);
    expect(screen.getByAltText("Public graphic preview")).toHaveAttribute(
      "src",
      "blob:preview-test",
    );

    mockCreateObjectURL.mockRestore();
  });

  it("shows an error when non-supported image type is chosen", async () => {
    const setGraphicFile = vi.fn();

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={emptyEvent}
        eventStart="2026-11-15T15:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={setGraphicFile}
        state={stateWithVenues([venueHall])}
      />,
    );
    await switchToSection(/Public content/);

    const fileInput = document.querySelector("#events-page-graphic");
    expect(fileInput).toBeInstanceOf(HTMLInputElement);
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Missing file input");
    }
    const invalidFile = new File(["gif content"], "animation.gif", { type: "image/gif" });
    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a PNG, JPG, or WebP image.");
    expect(setGraphicFile).not.toHaveBeenCalled();
  });

  it("shows an error when image exceeds 5MB", async () => {
    const user = userEvent.setup();
    const setGraphicFile = vi.fn();

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={emptyEvent}
        eventStart="2026-11-15T15:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={setGraphicFile}
        state={stateWithVenues([venueHall])}
      />,
    );
    await switchToSection(/Public content/);

    const fileInput = document.querySelector("#events-page-graphic");
    expect(fileInput).toBeInstanceOf(HTMLInputElement);
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Missing file input");
    }
    const largeFile = new File([new Uint8Array(6 * 1024 * 1024)], "giant.png", {
      type: "image/png",
    });
    await user.upload(fileInput, largeFile);

    expect(screen.getByRole("alert")).toHaveTextContent("Graphic file size must not exceed 5MB.");
    expect(setGraphicFile).not.toHaveBeenCalled();
  });

  it("shows saved graphic preview and allows removing saved graphic", async () => {
    const setEvent = vi.fn();
    const eventWithSavedGraphic: OrganizationEventRequest = {
      ...emptyEvent,
      publicGraphicFileId: "saved-file-123",
    };

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-123"
        error={null}
        event={eventWithSavedGraphic}
        eventStart="2026-11-15T15:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );
    await switchToSection(/Public content/);

    expect(screen.getByAltText("Public graphic preview")).toHaveAttribute(
      "src",
      "/api/organization/files/saved-file-123",
    );

    const removeSavedButton = screen.getByRole("button", { name: "Remove saved image" });
    fireEvent.click(removeSavedButton);

    expect(setEvent).toHaveBeenCalled();
  });

  it("warns admin when ticket sales are enabled for a past event and clears warning for future date", async () => {
    const pastPerformance: OrganizationEventRequest = {
      ...emptyEvent,
      isTicketingEnabled: true,
      publishOnWebsite: true,
      type: "Performance",
      venueId: venueHall.id,
      rsvpDeadlineDate: "2026-10-10",
    };

    const { rerender } = render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-past-1"
        error={null}
        event={pastPerformance}
        eventStart="2020-01-01T19:00"
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

    expect(
      screen.getByText(/This performance date has already passed. Ticket sales will remain closed/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Ticket sales are currently closed for this link because the event date has passed/,
      ),
    ).toBeInTheDocument();

    rerender(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-past-1"
        error={null}
        event={pastPerformance}
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

    expect(screen.queryByText(/This performance date has already passed/)).not.toBeInTheDocument();
  });

  it("warns admin when ticketing is enabled but event is not published on public website", async () => {
    const unpublishedPerformance: OrganizationEventRequest = {
      ...emptyEvent,
      isTicketingEnabled: true,
      publishOnWebsite: false,
      type: "Performance",
      venueId: venueHall.id,
      rsvpDeadlineDate: "2026-10-10",
    };

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-unpub-1"
        error={null}
        event={unpublishedPerformance}
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

    expect(
      screen.getByText(/This event will not appear on the public concert schedule/),
    ).toBeInTheDocument();
  });

  it("requires venue in Schedule section instead of publishing warning", async () => {
    const publishedWithoutVenue: OrganizationEventRequest = {
      ...emptyEvent,
      publishOnWebsite: true,
      type: "Rehearsal",
      venueId: null,
    };

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-novenue-1"
        error={null}
        event={publishedWithoutVenue}
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
    await switchToSection(/Schedule & venue/);
    expect(screen.getByText(/Location not yet confirmed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create or select TBD/ })).toBeInTheDocument();
  });

  it("shows TBD truthful notice for ticketed events instead of missing-venue warning", async () => {
    const ticketedWithTbd: OrganizationEventRequest = {
      ...emptyEvent,
      isTicketingEnabled: true,
      publishOnWebsite: false,
      type: "Performance",
      venueId: tbdVenue.id,
      rsvpDeadlineDate: "2026-10-10",
    };

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-ticket-tbd"
        error={null}
        event={ticketedWithTbd}
        eventStart="2028-12-01T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall, tbdVenue])}
      />,
    );
    await switchToSection(/Ticket sales/);
    expect(screen.getByText(/TBD venue:/)).toBeInTheDocument();
  });
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

describe("EventEditorDialog start date/time keyboard access and validation (#174)", () => {
  it("shows actionable validation alert and aria-invalid on empty start date & time", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={{ ...emptyEvent, title: "Valid Title", type: "Rehearsal", venueId: venueHall.id }}
        eventStart=""
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    await switchToSection(/Schedule & venue/);
    const startInput = screen.getByLabelText<HTMLInputElement>("Start date & time *");
    expect(startInput).toBeInTheDocument();
    expect(startInput).toHaveAttribute("type", "datetime-local");
    expect(startInput).not.toHaveAttribute("aria-invalid", "true");

    // Click Create event
    const saveButton = screen.getByRole("button", { name: /Create event/ });
    await user.click(saveButton);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(startInput).toHaveAttribute("aria-invalid", "true");
    expect(startInput).toHaveAttribute("aria-describedby", "events-page-start-error");
    expect(
      screen.getByText("Enter a valid start date and time.", {
        selector: "#events-page-start-error",
      }),
    ).toBeInTheDocument();
  });

  it("updates start date/time via keyboard input and clears validation alert", async () => {
    const setEventStart = vi.fn();

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={{ ...emptyEvent, title: "Valid Title", type: "Rehearsal", venueId: venueHall.id }}
        eventStart="2026-10-15T19:30"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={setEventStart}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    await switchToSection(/Schedule & venue/);
    const startInput = screen.getByLabelText<HTMLInputElement>("Start date & time *");
    expect(startInput.value).toBe("2026-10-15T19:30");

    fireEvent.change(startInput, { target: { value: "2026-10-16T20:00" } });
    expect(setEventStart).toHaveBeenCalledWith("2026-10-16T20:00");
  });

  describe("Open set list action in header", () => {
    const savedPerformance: OrganizationEventRequest = {
      ...emptyEvent,
      title: "Saved Gala",
      type: "Performance",
      venueId: venueHall.id,
    };

    it("renders Open set list button for saved Performances", () => {
      render(
        <EventEditorDialog
          busy={false}
          dialogOpen={true}
          editingId="perf-saved-1"
          error={null}
          event={savedPerformance}
          eventStart="2026-10-15T19:30"
          graphicFile={null}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={vi.fn()}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />,
      );

      expect(screen.getByRole("button", { name: "Open set list →" })).toBeInTheDocument();
    });

    it("omits Open set list button for new events, rehearsals, or when disabled", () => {
      const { rerender } = render(
        <EventEditorDialog
          busy={false}
          dialogOpen={true}
          editingId={null}
          error={null}
          event={savedPerformance}
          eventStart="2026-10-15T19:30"
          graphicFile={null}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={vi.fn()}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />,
      );
      expect(screen.queryByRole("button", { name: "Open set list →" })).not.toBeInTheDocument();

      rerender(
        <EventEditorDialog
          busy={false}
          dialogOpen={true}
          editingId="perf-saved-1"
          error={null}
          event={{ ...savedPerformance, type: "Rehearsal" }}
          eventStart="2026-10-15T19:30"
          graphicFile={null}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={vi.fn()}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />,
      );
      expect(screen.queryByRole("button", { name: "Open set list →" })).not.toBeInTheDocument();

      rerender(
        <EventEditorDialog
          busy={false}
          canManageSetLists={false}
          dialogOpen={true}
          editingId="perf-saved-1"
          error={null}
          event={savedPerformance}
          eventStart="2026-10-15T19:30"
          graphicFile={null}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={vi.fn()}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />,
      );
      expect(screen.queryByRole("button", { name: "Open set list →" })).not.toBeInTheDocument();
    });

    it("navigates immediately when pristine", () => {
      const navigate = vi.fn();
      render(
        <EventEditorDialog
          busy={false}
          dialogOpen={true}
          editingId="perf-saved-1"
          error={null}
          event={savedPerformance}
          eventStart="2026-10-15T19:30"
          graphicFile={null}
          navigate={navigate}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={vi.fn()}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Open set list →" }));
      expect(navigate).toHaveBeenCalledWith("/admin/setlists?eventId=perf-saved-1");
    });

    it("prompts before navigating when dirty, preserving draft on cancel", async () => {
      const navigate = vi.fn();
      const { rerender } = render(
        <EventEditorDialog
          busy={false}
          dialogOpen={true}
          editingId="perf-saved-1"
          error={null}
          event={savedPerformance}
          eventStart="2026-10-15T19:30"
          graphicFile={null}
          navigate={navigate}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={vi.fn()}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />,
      );

      // Make dirty by rerendering with modified event
      rerender(
        <EventEditorDialog
          busy={false}
          dialogOpen={true}
          editingId="perf-saved-1"
          error={null}
          event={{ ...savedPerformance, title: "Modified Title" }}
          eventStart="2026-10-15T19:30"
          graphicFile={null}
          navigate={navigate}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={vi.fn()}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Open set list →" }));
      expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();

      // Click Cancel
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await Promise.resolve();
      expect(navigate).not.toHaveBeenCalled();

      // Click Open set list again and confirm Discard
      fireEvent.click(screen.getByRole("button", { name: "Open set list →" }));
      expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      await Promise.resolve();

      expect(navigate).toHaveBeenCalledWith("/admin/setlists?eventId=perf-saved-1");
    });
  });
});
