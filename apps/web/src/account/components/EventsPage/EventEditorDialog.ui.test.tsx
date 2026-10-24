import type {
  OrganizationEventRequest,
  OrganizationProfile,
  OrganizationRosterConfiguration,
  OrganizationVenue,
} from "@choir/contracts";
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

vi.mock("../../../api", async (importOriginal) => {
  const actual = await importOriginal();
  if (typeof actual !== "object" || actual === null) throw new Error("Unexpected api shape");
  return {
    ...actual,
    getOrganizationRosterConfiguration: vi.fn(),
    listOrganizationProfiles: vi.fn(),
  };
});

import { createOrganizationVenue, listOrganizationVenues } from "../../../auth/api";
import { getOrganizationRosterConfiguration, listOrganizationProfiles } from "../../../api";

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

const defaultRosterConfiguration: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rehearsalAttendanceReportsEnabled: true,
  rosterStructure: "sections_only",
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [{ code: "S", color: "#123456", name: "Soprano", trackOnly: false }],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [{ fullName: "Soprano", label: "S", sectionCode: "S" }],
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
  vi.mocked(getOrganizationRosterConfiguration).mockReset();
  vi.mocked(getOrganizationRosterConfiguration).mockResolvedValue(defaultRosterConfiguration);
  vi.mocked(listOrganizationProfiles).mockReset();
  vi.mocked(listOrganizationProfiles).mockResolvedValue([]);
});

describe("EventEditorDialog section layout", () => {
  it("links ticket sales to public visibility and preserves visibility when ticketing is turned off", async () => {
    const user = userEvent.setup();
    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      type: "Performance",
      title: "Concert",
      venueId: venueHall.id,
    };
    const setEvent = (change: SetStateAction<OrganizationEventRequest>) => {
      draft = typeof change === "function" ? change(draft) : change;
    };
    const editor = () => (
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />
    );
    const { rerender } = render(editor());
    await switchToSection(/Ticket sales/);
    await user.click(screen.getByLabelText("Enable ticket sales"));
    expect(draft).toMatchObject({ isTicketingEnabled: true, publishOnWebsite: true });
    rerender(editor());
    await switchToSection(/Public content/);
    const visibility = screen.getByLabelText("Publish on public website");
    expect(visibility).toBeChecked();
    expect(visibility).toBeDisabled();
    await switchToSection(/Ticket sales/);
    await user.click(screen.getByLabelText("Enable ticket sales"));
    expect(draft).toMatchObject({ isTicketingEnabled: false, publishOnWebsite: true });
    rerender(editor());
    await switchToSection(/Public content/);
    const editableVisibility = screen.getByLabelText("Publish on public website");
    expect(editableVisibility).toBeEnabled();
    await user.click(editableVisibility);
    expect(draft.publishOnWebsite).toBe(false);
  });

  it("inserts an editable link into public performance details", async () => {
    const user = userEvent.setup();
    let draft: OrganizationEventRequest = { ...emptyEvent, type: "Performance", title: "Concert" };
    const setEvent = (change: SetStateAction<OrganizationEventRequest>) => {
      draft = typeof change === "function" ? change(draft) : change;
    };
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={readyState}
      />,
    );
    await switchToSection(/Public content/);
    await user.click(screen.getByRole("button", { name: "Insert link" }));
    const dialog = screen.getByRole("dialog", { name: "Insert link" });
    await user.type(within(dialog).getByLabelText("Link text"), "Read the program");
    await user.type(within(dialog).getByLabelText("Link address"), "https://example.org/program");
    await user.click(within(dialog).getByRole("button", { name: "Apply link" }));
    expect(draft.publicDetails).toBe(
      '[Read the program](https://example.org/program){target="_self"}',
    );
  });

  it.each(["18:30", ""])(
    "allows the optional doors-open time to be set to %s",
    async (doorsOpenTime) => {
      let draft: OrganizationEventRequest = {
        ...emptyEvent,
        title: "Concert",
        type: "Performance",
        venueId: venueHall.id,
        doorsOpenTime: "17:30",
      };
      const setEvent = (change: SetStateAction<OrganizationEventRequest>) => {
        draft = typeof change === "function" ? change(draft) : change;
      };
      render(
        <EventEditorDialog
          busy={false}
          dialogOpen
          editingId={null}
          error={null}
          event={draft}
          eventStart="2027-11-15T19:00"
          graphicFile={null}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={setEvent}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />,
      );
      await switchToSection(/Schedule & venue/);
      const input = screen.getByLabelText("Doors open time (optional)");
      expect(input).toHaveValue("17:30");
      expect(input).not.toBeRequired();
      fireEvent.change(input, { target: { value: doorsOpenTime } });
      expect(draft.doorsOpenTime).toBe(doorsOpenTime);
      expect(draft.callTime).toBe(emptyEvent.callTime);
    },
  );

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

  it("attributes unsaved edits to sections, preserves markers across navigation, and clears reverted edits", async () => {
    const user = userEvent.setup();
    const baseline = {
      ...emptyEvent,
      type: "Performance" as const,
      title: "Concert",
      venueId: venueHall.id,
    };
    const editor = (event: OrganizationEventRequest, graphicFile: File | null = null) => (
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId="event-1"
        error={null}
        event={event}
        eventStart="2026-11-15T15:00"
        graphicFile={graphicFile}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />
    );
    const { rerender } = render(editor(baseline));
    const basics = screen.getByRole("tab", { name: /Basics/ });
    const schedule = screen.getByRole("tab", { name: /Schedule & venue/ });
    const publicTab = screen.getByRole("tab", { name: /Public content/ });
    expect(basics).not.toHaveAccessibleDescription();
    rerender(editor({ ...baseline, title: "Edited concert" }));
    expect(basics).toHaveAccessibleDescription("Unsaved");
    expect(schedule).not.toHaveAccessibleDescription();
    await user.click(schedule);
    expect(schedule).toHaveAttribute("aria-selected", "true");
    expect(schedule).not.toHaveAccessibleDescription();
    expect(basics).toHaveAccessibleDescription("Unsaved");
    expect(screen.getByRole("option", { name: /01 Basics — Unsaved changes/ })).toBeInTheDocument();
    rerender(editor({ ...baseline, publicDetails: "Public draft" }));
    expect(basics).not.toHaveAccessibleDescription();
    expect(publicTab).toHaveAccessibleDescription("Unsaved");
    rerender(editor(baseline, new File(["graphic"], "poster.png", { type: "image/png" })));
    expect(publicTab).toHaveAccessibleDescription("Unsaved");
    rerender(editor(baseline));
    expect(publicTab).not.toHaveAccessibleDescription();
    expect(screen.queryByText("Unsaved", { exact: true })).not.toBeInTheDocument();
  });

  it("marks ticket price drafts even before they produce a changed event value", async () => {
    const user = userEvent.setup();
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId="event-1"
        error={null}
        event={{
          ...emptyEvent,
          type: "Performance",
          title: "Concert",
          isTicketingEnabled: true,
          venueId: venueHall.id,
        }}
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
    await switchToSection(/Ticket sales/);
    const price = screen.getByLabelText("Advance price (USD)");
    const original = price instanceof HTMLInputElement ? price.value : "";
    await user.clear(price);
    await user.type(price, "12.34");
    expect(screen.getByRole("tab", { name: /Ticket sales/ })).toHaveAccessibleDescription(
      "Unsaved",
    );
    await switchToSection(/Schedule & venue/);
    expect(screen.getByRole("tab", { name: /Schedule & venue/ })).not.toHaveAccessibleDescription();
    expect(screen.getByRole("tab", { name: /Ticket sales/ })).toHaveAccessibleDescription(
      "Unsaved",
    );
    await switchToSection(/Ticket sales/);
    await user.clear(screen.getByLabelText("Advance price (USD)"));
    await user.type(screen.getByLabelText("Advance price (USD)"), original);
    expect(screen.getByRole("tab", { name: /Ticket sales/ })).not.toHaveAccessibleDescription();
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
    // Switch to schedule to make venue field visible, then attempt advance via footer.
    await switchToSection(/Schedule & venue/);
    const saveButton = screen.getByRole("button", {
      name: /Next: Public content|Create event/,
    });
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

  it("shows linked public visibility for a legacy ticket-enabled Performance", async () => {
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
      screen.getByText(/Enabling ticket sales also enables public website visibility/),
    ).toBeInTheDocument();
    await switchToSection(/Public content/);
    expect(screen.getByLabelText("Publish on public website")).toBeChecked();
    expect(screen.getByLabelText("Publish on public website")).toBeDisabled();
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

    // Click primary action button
    const saveButton = screen.getByRole("button", {
      name: /Next: Public content|Create event/,
    });
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

describe("EventEditorDialog Other event RSVP and reminders layout", () => {
  it("renders RSVPs & reminders section for Other events with optional badge and correct panels", async () => {
    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      type: "Other",
      title: "Social Gathering",
      venueId: venueHall.id,
      otherEventRsvpMode: "off",
    };
    const setEvent = vi.fn((change: SetStateAction<OrganizationEventRequest>) => {
      draft = typeof change === "function" ? change(draft) : change;
    });

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    expect(screen.getByRole("tab", { name: /Basics/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Schedule & venue/ })).toBeInTheDocument();
    const rsvpTab = screen.getByRole("tab", { name: /RSVPs & reminders/ });
    expect(rsvpTab).toBeInTheDocument();
    expect(rsvpTab).toHaveTextContent("Optional");
    expect(screen.queryByRole("tab", { name: /Ticket sales/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Public content/ })).not.toBeInTheDocument();

    await switchToSection(/RSVPs & reminders/);
    expect(
      await screen.findByRole("heading", { level: 3, name: "RSVPs & reminders" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("RSVP mode")).toBeInTheDocument();
    expect(screen.getByLabelText(/Everyone/)).toBeInTheDocument();
  });

  it("updates RSVP mode, staffing goal, and reminder emails for Other events", async () => {
    const user = userEvent.setup();
    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      type: "Other",
      title: "Choir Banquet",
      venueId: venueHall.id,
      otherEventRsvpMode: "off",
    };
    const setEvent = (change: SetStateAction<OrganizationEventRequest>) => {
      draft = typeof change === "function" ? change(draft) : change;
    };

    const { rerender } = render(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    await switchToSection(/RSVPs & reminders/);
    expect(screen.queryByLabelText("Minimum staffing goal")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("RSVP mode"), "optional");
    expect(draft.otherEventRsvpMode).toBe("optional");

    rerender(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    const staffingGoal = screen.getByLabelText("Minimum staffing goal");
    expect(staffingGoal).toBeInTheDocument();
    await user.type(staffingGoal, "10");
    expect(draft.otherEventStaffingGoal).toBe(10);

    await user.selectOptions(screen.getByLabelText("RSVP mode"), "response_requested");
    expect(draft.otherEventRsvpMode).toBe("response_requested");

    rerender(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    expect(screen.getByText("Automated RSVP reminder email")).toBeInTheDocument();
    const eventSetting = screen.getByLabelText("Event setting");
    expect(eventSetting).toBeInTheDocument();
    await user.selectOptions(eventSetting, "enabled");
    expect(draft.rsvpFollowUpMode).toBe("enabled");
  });

  it("hides Ticket sales and Public content and allows switching to RSVPs & reminders when event type is changed to Other", async () => {
    const user = userEvent.setup();
    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      type: "Performance",
      title: "Concert",
      venueId: venueHall.id,
      isTicketingEnabled: true,
    };
    const setEvent = (change: SetStateAction<OrganizationEventRequest>) => {
      draft = typeof change === "function" ? change(draft) : change;
    };

    const { rerender } = render(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    expect(screen.getByRole("tab", { name: /Ticket sales/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Public content/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Type *"), "Other");
    expect(draft.type).toBe("Other");

    rerender(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    expect(screen.queryByRole("tab", { name: /Ticket sales/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Public content/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /RSVPs & reminders/ })).toBeInTheDocument();

    await switchToSection(/RSVPs & reminders/);
    expect(
      await screen.findByRole("heading", { level: 3, name: "RSVPs & reminders" }),
    ).toBeInTheDocument();
  });
});

describe("EventEditorDialog progressive Next / Create event button flow", () => {
  it("renders Next: Schedule & venue on Basics tab and blocks advance when title is empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={{ ...emptyEvent, title: "", type: "Other" }}
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

    const nextButton = screen.getByRole("button", { name: "Next: Schedule & venue" });
    expect(nextButton).toBeInTheDocument();

    await user.click(nextButton);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /Basics/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Enter an event title.")).toBeInTheDocument();
  });

  it("advances to Schedule & venue on valid title, then switches to Create event once date and venue are filled", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      title: "Community Potluck",
      type: "Other",
      venueId: null,
    };
    let eventStart = "";
    const setEvent = (change: SetStateAction<OrganizationEventRequest>) => {
      draft = typeof change === "function" ? change(draft) : change;
    };

    const { rerender } = render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={draft}
        eventStart={eventStart}
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        setEvent={setEvent}
        setEventStart={(val) => {
          eventStart = val;
        }}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    // On Basics with Title entered, primary button still says Next: Schedule & venue
    const nextToSchedule = screen.getByRole("button", { name: "Next: Schedule & venue" });
    await user.click(nextToSchedule);

    expect(screen.getByRole("tab", { name: /Schedule & venue/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // On Schedule with date and venue missing, next visible section is RSVPs & reminders
    expect(screen.getByRole("button", { name: "Next: RSVPs & reminders" })).toBeInTheDocument();

    // Now fill date and venue
    draft = { ...draft, venueId: venueHall.id };
    eventStart = "2026-11-20T18:00";

    rerender(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={draft}
        eventStart={eventStart}
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        setEvent={setEvent}
        setEventStart={(val) => {
          eventStart = val;
        }}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    // All required fields for Other event are now complete: button switches to Create event!
    const createButton = screen.getByRole("button", { name: "Create event" });
    expect(createButton).toBeInTheDocument();

    await user.click(createButton);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Community Potluck",
        venueId: venueHall.id,
      }),
    );
  });

  it("steps through Basics -> Schedule -> RSVPs for Performance events before showing Create event", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      title: "Symphony No. 5",
      type: "Performance",
      venueId: venueHall.id,
      rsvpDeadlineDate: null,
    };
    const eventStart = "2026-12-15T19:30";

    const { rerender } = render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={draft}
        eventStart={eventStart}
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        setEvent={(change) => {
          draft = typeof change === "function" ? change(draft) : change;
        }}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    // On Basics: next is Schedule & venue
    await user.click(screen.getByRole("button", { name: "Next: Schedule & venue" }));
    expect(screen.getByRole("tab", { name: /Schedule & venue/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // On Schedule: next is RSVPs & reminders (because RSVP deadline is required for Performance)
    await user.click(screen.getByRole("button", { name: "Next: RSVPs & reminders" }));
    expect(screen.getByRole("tab", { name: /RSVPs & reminders/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // On RSVPs & reminders without deadline: button indicates Next: Ticket sales
    expect(screen.getByRole("button", { name: "Next: Ticket sales" })).toBeInTheDocument();

    // Fill the RSVP deadline
    draft = { ...draft, rsvpDeadlineDate: "2026-12-01" };
    rerender(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={draft}
        eventStart={eventStart}
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        setEvent={(change) => {
          draft = typeof change === "function" ? change(draft) : change;
        }}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    // Now all required fields for Performance are complete: switches to Create event!
    expect(screen.getByRole("button", { name: "Create event" })).toBeInTheDocument();
  });

  it("always shows Save event when editing an existing event", () => {
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="event-existing-1"
        error={null}
        event={{
          ...emptyEvent,
          title: "Existing Concert",
          type: "Performance",
          venueId: venueHall.id,
        }}
        eventStart="2026-12-15T19:30"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    expect(screen.getByRole("button", { name: "Save event" })).toBeInTheDocument();
  });
});

const sampleActiveProfiles: readonly OrganizationProfile[] = [
  {
    bounceReason: "",
    createdAt: "2026-01-01T00:00:00Z",
    displayName: "Alice Smith",
    doNotEmail: false,
    email: "alice@example.com",
    globalStatus: "Active",
    hidden: false,
    id: "11111111-1111-4111-8111-111111111111",
    isSectionLeader: false,
    lastBounceAt: "",
    notes: "",
    onBreakInactiveAt: null,
    phone: "",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveAdminNotifications: false,
    receiveAttendanceReports: true,
    receiveFinancialAlerts: false,
    receiveOtherEventReminders: true,
    receivePerformanceReminders: true,
    receiveRehearsalReminders: true,
    receiveRsvpDeclineNotices: false,
    showEmailInDirectory: true,
    showInDirectory: true,
    showPhoneInDirectory: true,
    statusChangedAt: "2026-01-01T00:00:00Z",
    statusChangeReason: "",
    statusIsManual: false,
    updatedAt: "2026-01-01T00:00:00Z",
    voicePart: "Soprano",
  },
  {
    bounceReason: "",
    createdAt: "2026-01-01T00:00:00Z",
    displayName: "Bob Jones",
    doNotEmail: false,
    email: "bob@example.com",
    globalStatus: "Active",
    hidden: false,
    id: "22222222-2222-4222-8222-222222222222",
    isSectionLeader: false,
    lastBounceAt: "",
    notes: "",
    onBreakInactiveAt: null,
    phone: "",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveAdminNotifications: false,
    receiveAttendanceReports: true,
    receiveFinancialAlerts: false,
    receiveOtherEventReminders: true,
    receivePerformanceReminders: true,
    receiveRehearsalReminders: true,
    receiveRsvpDeclineNotices: false,
    showEmailInDirectory: true,
    showInDirectory: true,
    showPhoneInDirectory: true,
    statusChangedAt: "2026-01-01T00:00:00Z",
    statusChangeReason: "",
    statusIsManual: false,
    updatedAt: "2026-01-01T00:00:00Z",
    voicePart: "Bass",
  },
  {
    bounceReason: "",
    createdAt: "2026-01-01T00:00:00Z",
    displayName: "Charlie Brown",
    doNotEmail: false,
    email: "charlie@example.com",
    globalStatus: "Active",
    hidden: false,
    id: "33333333-3333-4333-8333-333333333333",
    isSectionLeader: false,
    lastBounceAt: "",
    notes: "",
    onBreakInactiveAt: null,
    phone: "",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveAdminNotifications: false,
    receiveAttendanceReports: true,
    receiveFinancialAlerts: false,
    receiveOtherEventReminders: true,
    receivePerformanceReminders: true,
    receiveRehearsalReminders: true,
    receiveRsvpDeclineNotices: false,
    showEmailInDirectory: true,
    showInDirectory: true,
    showPhoneInDirectory: true,
    statusChangedAt: "2026-01-01T00:00:00Z",
    statusChangeReason: "",
    statusIsManual: false,
    updatedAt: "2026-01-01T00:00:00Z",
    voicePart: "Tenor",
  },
  {
    bounceReason: "",
    createdAt: "2026-01-01T00:00:00Z",
    displayName: "Inactive Singer",
    doNotEmail: false,
    email: "inactive@example.com",
    globalStatus: "Inactive",
    hidden: false,
    id: "44444444-4444-4444-8444-444444444444",
    isSectionLeader: false,
    lastBounceAt: "",
    notes: "",
    onBreakInactiveAt: null,
    phone: "",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveAdminNotifications: false,
    receiveAttendanceReports: true,
    receiveFinancialAlerts: false,
    receiveOtherEventReminders: true,
    receivePerformanceReminders: true,
    receiveRehearsalReminders: true,
    receiveRsvpDeclineNotices: false,
    showEmailInDirectory: true,
    showInDirectory: true,
    showPhoneInDirectory: true,
    statusChangedAt: "2026-01-01T00:00:00Z",
    statusChangeReason: "",
    statusIsManual: false,
    updatedAt: "2026-01-01T00:00:00Z",
    voicePart: "Alto",
  },
];

describe("EventEditorDialog Targeted Audience member combobox and chips", () => {
  it("allows searching and selecting members into chips, removing chips, and clearing all chips", async () => {
    vi.mocked(listOrganizationProfiles).mockResolvedValue([...sampleActiveProfiles]);
    const user = userEvent.setup();
    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      otherEventAudience: {
        profileIds: [],
        type: "targeted",
        voiceParts: [],
      },
      title: "Committee Meeting",
      type: "Other",
      venueId: venueHall.id,
    };

    const Harness = () => {
      const setEvent = (change: SetStateAction<OrganizationEventRequest>) => {
        draft = typeof change === "function" ? change(draft) : change;
      };
      return (
        <EventEditorDialog
          busy={false}
          dialogOpen={true}
          editingId={null}
          error={null}
          event={draft}
          eventStart="2026-11-20T18:00"
          graphicFile={null}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={setEvent}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />
      );
    };

    const { rerender } = render(<Harness />);
    await switchToSection(/RSVPs & reminders/);

    const combobox = await screen.findByRole("combobox", { name: "Search specific members" });
    expect(combobox).toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "0 members selected in targeted audience",
    );

    // Search for Alice Smith
    await user.click(combobox);
    await user.type(combobox, "Alice");

    const aliceOption = await screen.findByRole("option", { name: /Alice Smith/ });
    expect(aliceOption).toBeInTheDocument();
    expect(aliceOption).toHaveTextContent("Soprano");
    await user.click(aliceOption);

    rerender(<Harness />);

    // Alice should be added as a chip and combobox input should be cleared
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(combobox).toHaveValue("");
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "1 member selected in targeted audience",
    );

    // Clear all should NOT be visible with only 1 chip
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();

    // Search and add Bob Jones
    await user.click(combobox);
    await user.type(combobox, "Bob");

    const bobOption = await screen.findByRole("option", { name: /Bob Jones/ });
    await user.click(bobOption);

    rerender(<Harness />);

    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "2 members selected in targeted audience",
    );

    // Clear all should be visible with multiple chips
    const clearAllBtn = screen.getByRole("button", { name: "Clear all" });
    expect(clearAllBtn).toBeInTheDocument();

    // Remove Alice Smith via individual chip remove button
    const removeAliceBtn = screen.getByRole("button", { name: "Remove Alice Smith" });
    await user.click(removeAliceBtn);

    rerender(<Harness />);

    expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "1 member selected in targeted audience",
    );
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();

    // Add Charlie Brown
    await user.click(combobox);
    await user.type(combobox, "Charlie");
    const charlieOption = await screen.findByRole("option", { name: /Charlie Brown/ });
    await user.click(charlieOption);

    rerender(<Harness />);

    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expect(screen.getByText("Charlie Brown")).toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "2 members selected in targeted audience",
    );

    // Click Clear all to remove all chips
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    rerender(<Harness />);

    expect(screen.queryByText("Bob Jones")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie Brown")).not.toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "0 members selected in targeted audience",
    );
  });

  it("excludes already selected members from autocomplete options", async () => {
    vi.mocked(listOrganizationProfiles).mockResolvedValue([...sampleActiveProfiles]);
    const user = userEvent.setup();
    const draft: OrganizationEventRequest = {
      ...emptyEvent,
      otherEventAudience: {
        profileIds: ["11111111-1111-4111-8111-111111111111"], // Alice Smith
        type: "targeted",
        voiceParts: [],
      },
      title: "Committee Meeting",
      type: "Other",
      venueId: venueHall.id,
    };

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={draft}
        eventStart="2026-11-20T18:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );
    await switchToSection(/RSVPs & reminders/);

    const combobox = await screen.findByRole("combobox", { name: "Search specific members" });
    // Alice is already a chip
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();

    // Focus combobox and trigger listbox via Down Arrow
    await user.click(combobox);
    await user.keyboard("{ArrowDown}");

    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeInTheDocument();

    // Bob and Charlie should be in the listbox options, but NOT Alice
    const options = screen.getAllByRole("option");
    const optionLabels = options.map((opt) => opt.textContent);
    expect(optionLabels.some((label) => label.includes("Bob Jones"))).toBe(true);
    expect(optionLabels.some((label) => label.includes("Charlie Brown"))).toBe(true);
    expect(optionLabels.some((label) => label.includes("Alice Smith"))).toBe(false);
  });

  it("deduplicates audience counter when member is covered by both voice part and specific selection", async () => {
    vi.mocked(listOrganizationProfiles).mockResolvedValue([...sampleActiveProfiles]);
    const user = userEvent.setup();
    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      otherEventAudience: {
        profileIds: [],
        type: "targeted",
        voiceParts: ["Soprano"],
      },
      title: "Soprano Sectional",
      type: "Other",
      venueId: venueHall.id,
    };

    const Harness = () => {
      const setEvent = (change: SetStateAction<OrganizationEventRequest>) => {
        draft = typeof change === "function" ? change(draft) : change;
      };
      return (
        <EventEditorDialog
          busy={false}
          dialogOpen={true}
          editingId={null}
          error={null}
          event={draft}
          eventStart="2026-11-20T18:00"
          graphicFile={null}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={setEvent}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />
      );
    };

    const { rerender } = render(<Harness />);
    await switchToSection(/RSVPs & reminders/);

    const combobox = await screen.findByRole("combobox", { name: "Search specific members" });

    // Since Soprano is checked, Alice (Soprano) is already counted
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "1 member selected in targeted audience",
    );

    // Add Alice Smith as a specific member as well
    await user.click(combobox);
    await user.type(combobox, "Alice");
    const aliceOption = await screen.findByRole("option", { name: /Alice Smith/ });
    await user.click(aliceOption);

    rerender(<Harness />);

    // Count remains 1 because Alice was already counted via Soprano
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "1 member selected in targeted audience",
    );

    // Add Bob Jones (Bass)
    await user.click(combobox);
    await user.type(combobox, "Bob");
    const bobOption = await screen.findByRole("option", { name: /Bob Jones/ });
    await user.click(bobOption);

    rerender(<Harness />);

    // Count increases to 2
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "2 members selected in targeted audience",
    );
  });
});
