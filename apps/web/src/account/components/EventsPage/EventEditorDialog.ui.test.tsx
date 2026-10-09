import type { OrganizationEventRequest } from "@choir/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventEditorDialog } from "./dialogs";
import type { EventsState } from "./types";
import { emptyEvent } from "./utils";

const readyState: EventsState = {
  events: [],
  rsvpExpiryEnabled: false,
  rsvpFollowUpEnabled: false,
  rsvpFollowUpLeadHours: 48,
  status: "ready",
  timezone: "America/New_York",
  venues: [],
};

describe("EventEditorDialog public graphic upload and preview", () => {
  it("renders the dropzone and updates preview when valid image is selected", async () => {
    const user = userEvent.setup();
    const setEvent = vi.fn();
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
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={setGraphicFile}
        state={readyState}
      />,
    );

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

  it("shows an error when non-supported image type is chosen", () => {
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
        state={readyState}
      />,
    );

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
        state={readyState}
      />,
    );

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

  it("shows saved graphic preview and allows removing saved graphic", () => {
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
        state={readyState}
      />,
    );

    expect(screen.getByAltText("Public graphic preview")).toHaveAttribute(
      "src",
      "/api/organization/files/saved-file-123",
    );

    const removeSavedButton = screen.getByRole("button", { name: "Remove saved image" });
    fireEvent.click(removeSavedButton);

    expect(setEvent).toHaveBeenCalled();
  });

  it("warns admin when ticket sales are enabled for a past event and clears warning for future date", () => {
    const pastPerformance: OrganizationEventRequest = {
      ...emptyEvent,
      isTicketingEnabled: true,
      publishOnWebsite: true,
      type: "Performance",
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
        state={readyState}
      />,
    );

    expect(
      screen.getByText(/This performance date has already passed. Ticket sales will remain closed/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Ticket sales are currently closed for this link because the event date has passed/,
      ),
    ).toBeInTheDocument();

    // Rerender with future date
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
        state={readyState}
      />,
    );

    expect(screen.queryByText(/This performance date has already passed/)).not.toBeInTheDocument();
  });

  it("warns admin when ticketing is enabled but event is not published on public website", () => {
    const unpublishedPerformance: OrganizationEventRequest = {
      ...emptyEvent,
      isTicketingEnabled: true,
      publishOnWebsite: false,
      type: "Performance",
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
        state={readyState}
      />,
    );

    expect(
      screen.getByText(/This event will not appear on the public concert schedule/),
    ).toBeInTheDocument();
  });
});
