import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SingerEvent } from "@choir/contracts";

import { AuthApiError, getMySchedule, setMyEventRsvp } from "../auth/api";
import { MySchedule } from "./MySchedule";

vi.mock("./CalendarSubscription", () => ({
  CalendarSubscription: () => null,
}));

vi.mock("./OrganizationMfaPrompt", () => ({
  OrganizationMfaPrompt: () => null,
}));

vi.mock("../auth/api", () => ({
  AuthApiError: class AuthApiError extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
      this.name = "AuthApiError";
    }
  },
  getMySchedule: vi.fn(),
  setMyEventRsvp: vi.fn(),
}));

function createSampleEvent(overrides: Partial<SingerEvent> = {}): SingerEvent {
  return {
    attendanceWarning: null,
    callTime: "18:00",
    details: "",
    directRsvp: "Pending",
    durationMinutes: 90,
    featuredAssignments: [],
    id: "00000000-0000-4000-8000-000000000001",
    inheritedFromParent: false,
    location: "Main Hall",
    practice: { sourceEventId: null, status: "not_published", trackCount: 0 },
    resolvedRsvp: "Pending",
    rsvpDeadlineAt: null,
    rsvpDeadlineDate: null,
    rsvpDeadlinePassed: false,
    rsvpNote: "",
    rsvpSelfServiceOpen: true,
    seating: { status: "not_published" },
    setList: [],
    startsAt: "2026-08-20T23:00:00.000Z",
    title: "Summer Concert",
    type: "Performance",
    venueAddress: "",
    venueName: "",
    ...overrides,
  };
}

describe("MySchedule RSVP pending state (#196)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows immediate 'Saving…' feedback on clicked button and disables controls while saving", async () => {
    const user = userEvent.setup();
    const event = createSampleEvent({ resolvedRsvp: "Pending" });

    vi.mocked(getMySchedule).mockResolvedValueOnce({
      events: [event],
      profileId: "00000000-0000-4000-8000-000000000001",
      requestId: "req-test-1",
      timezone: "America/New_York",
    });

    let resolveRsvp!: (value: Awaited<ReturnType<typeof setMyEventRsvp>>) => void;
    const rsvpPromise = new Promise<Awaited<ReturnType<typeof setMyEventRsvp>>>((resolve) => {
      resolveRsvp = resolve;
    });
    vi.mocked(setMyEventRsvp).mockReturnValueOnce(rsvpPromise);

    render(<MySchedule enabled />);

    const yesButton = await screen.findByRole("button", { name: "Yes" });
    const noButton = screen.getByRole("button", { name: "No" });
    expect(yesButton).not.toBeDisabled();
    expect(noButton).not.toBeDisabled();

    await user.click(yesButton);

    // Immediately after click, yesButton should show "Saving…" and be disabled along with noButton
    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "No" })).toBeDisabled();
    expect(screen.getByText("Saving your RSVP…")).toBeInTheDocument();

    // Prepare updated schedule on completion
    vi.mocked(getMySchedule).mockResolvedValueOnce({
      events: [{ ...event, resolvedRsvp: "Yes", directRsvp: "Yes" }],
      profileId: "00000000-0000-4000-8000-000000000001",
      requestId: "req-test-2",
      timezone: "America/New_York",
    });

    resolveRsvp({
      eventId: event.id,
      profileId: "profile-1",
      rsvp: "Yes",
      rsvpNote: "",
      updatedAt: "2026-08-20T23:00:00.000Z",
    });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Your RSVP was updated.");
    });
    expect(screen.getByRole("button", { name: "Yes" })).not.toBeDisabled();
  });

  it("retains previous selection and displays alert notice on RSVP error", async () => {
    const user = userEvent.setup();
    const event = createSampleEvent({ resolvedRsvp: "Pending" });

    vi.mocked(getMySchedule).mockResolvedValueOnce({
      events: [event],
      profileId: "00000000-0000-4000-8000-000000000001",
      requestId: "req-test-1",
      timezone: "America/New_York",
    });

    vi.mocked(setMyEventRsvp).mockRejectedValueOnce(
      new AuthApiError("RSVP deadline has passed", 400, "DEADLINE_PASSED"),
    );

    render(<MySchedule enabled />);

    const yesButton = await screen.findByRole("button", { name: "Yes" });
    await user.click(yesButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("RSVP deadline has passed");
    });

    expect(screen.getByRole("button", { name: "Yes" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "No" })).not.toBeDisabled();
  });

  it("renders event type and date with accessible spacing (#177)", async () => {
    const event = createSampleEvent({ type: "Rehearsal" });
    vi.mocked(getMySchedule).mockResolvedValueOnce({
      events: [event],
      profileId: "00000000-0000-4000-8000-000000000001",
      requestId: "req-test-1",
      timezone: "America/New_York",
    });

    render(<MySchedule enabled />);

    const dateParagraph = await screen.findByText("Rehearsal");
    const parentP = dateParagraph.closest("p");
    expect(parentP).not.toBeNull();
    expect(parentP?.textContent).toMatch(/Rehearsal\s+•\s+/);
  });
});

describe("MySchedule event details and seating link (#192)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders expandable accordion revealing call time, duration, venue notes, directions, and attire", async () => {
    const event = createSampleEvent({
      callTime: "17:15",
      details: "Concert black attire. Enter through stage door B.",
      durationMinutes: 120,
      venueAddress: "123 Symphony Way",
      venueName: "Symphony Hall",
    });

    vi.mocked(getMySchedule).mockResolvedValueOnce({
      events: [event],
      profileId: "00000000-0000-4000-8000-000000000001",
      requestId: "req-test-1",
      timezone: "America/New_York",
    });

    render(<MySchedule enabled />);

    await waitFor(() => {
      expect(screen.getByText("Summer Concert")).toBeInTheDocument();
    });

    // Accordion toggle summary is present
    const summary = screen.getByText("Event details");
    expect(summary).toBeInTheDocument();

    // Accordion contents
    expect(screen.getByText("Call time:")).toBeInTheDocument();
    expect(screen.getByText("17:15")).toBeInTheDocument();
    expect(screen.getByText("Duration:")).toBeInTheDocument();
    expect(screen.getByText("120 minutes")).toBeInTheDocument();
    expect(screen.getByText("Venue & directions:")).toBeInTheDocument();
    expect(screen.getByText(/Symphony Hall — 123 Symphony Way/)).toBeInTheDocument();
    expect(screen.getByText("Notes & attire:")).toBeInTheDocument();
    expect(
      screen.getByText("Concert black attire. Enter through stage door B."),
    ).toBeInTheDocument();
  });

  it("displays seating link when seating chart is published for a performance", async () => {
    const event = createSampleEvent({
      id: "event-perf-1",
      seating: { status: "available" },
      type: "Performance",
    });

    vi.mocked(getMySchedule).mockResolvedValueOnce({
      events: [event],
      profileId: "00000000-0000-4000-8000-000000000001",
      requestId: "req-test-1",
      timezone: "America/New_York",
    });

    const navigate = vi.fn();
    render(<MySchedule enabled navigate={navigate} />);

    await waitFor(() => {
      expect(screen.getByText("Summer Concert")).toBeInTheDocument();
    });

    const seatingLink = screen.getByRole("link", { name: "View assigned seat" });
    expect(seatingLink).toBeInTheDocument();
    expect(seatingLink).toHaveAttribute("href", "/seating/event-perf-1");
  });

  it("does not display seating link when seating is not published or for rehearsal", async () => {
    const perfEvent = createSampleEvent({
      id: "event-perf-2",
      seating: { status: "not_published" },
      title: "Unpublished Seating Performance",
      type: "Performance",
    });
    const rehearsalEvent = createSampleEvent({
      id: "event-rehearsal-1",
      seating: { status: "available" },
      title: "Weekly Rehearsal",
      type: "Rehearsal",
    });

    vi.mocked(getMySchedule).mockResolvedValueOnce({
      events: [perfEvent, rehearsalEvent],
      profileId: "00000000-0000-4000-8000-000000000001",
      requestId: "req-test-1",
      timezone: "America/New_York",
    });

    render(<MySchedule enabled />);

    await waitFor(() => {
      expect(screen.getByText("Unpublished Seating Performance")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("link", { name: /View assigned seat|Seat not assigned/i }),
    ).not.toBeInTheDocument();
  });

  it("auto-opens accordion when eventId query param matches", async () => {
    const event = createSampleEvent({
      id: "target-event-123",
      title: "Featured Performance",
    });

    vi.mocked(getMySchedule).mockResolvedValueOnce({
      events: [event],
      profileId: "00000000-0000-4000-8000-000000000001",
      requestId: "req-test-1",
      timezone: "America/New_York",
    });

    window.history.pushState({}, "", "/schedule?eventId=target-event-123");

    try {
      render(<MySchedule enabled />);

      await waitFor(() => {
        expect(screen.getByText("Featured Performance")).toBeInTheDocument();
      });

      const detailsElement = screen.getByText("Event details").closest("details");
      expect(detailsElement).toHaveAttribute("open");
    } finally {
      window.history.pushState({}, "", "/schedule");
    }
  });
});
