import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SingerEvent } from "@choir/contracts";

import { AuthApiError, getMySchedule, getMemberPracticeLink, setMyEventRsvp } from "../auth/api";
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
  getMemberPracticeLink: vi.fn(),
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
  it.each([undefined, false, true])(
    "shows score downloads only when available (%s)",
    async (scoreAvailable) => {
      const event = createSampleEvent({
        setList: [
          {
            title: "Opening Song",
            pieceId: "score-piece",
            ...(scoreAvailable === undefined ? {} : { scoreAvailable }),
          },
          { title: "Song without score", pieceId: "empty-piece", scoreAvailable: false },
        ],
      });
      vi.mocked(getMySchedule).mockResolvedValueOnce({
        events: [event],
        profileId: "profile",
        requestId: "request",
        timezone: "America/New_York",
      });
      render(<MySchedule enabled />);
      await screen.findByText("Opening Song");
      expect(screen.queryAllByRole("link", { name: "Score (PDF)" })).toHaveLength(
        scoreAvailable ? 1 : 0,
      );
      expect(screen.queryAllByRole("link", { name: "Download score bundle (ZIP)" })).toHaveLength(
        scoreAvailable ? 1 : 0,
      );
    },
  );

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

  it("shows practice only when available and reports a link failure without losing the schedule", async () => {
    const event = createSampleEvent({
      practice: { status: "available", sourceEventId: "source-performance", trackCount: 2 },
    });
    vi.mocked(getMySchedule).mockResolvedValueOnce({
      events: [event],
      profileId: "profile",
      requestId: "request",
      timezone: "America/New_York",
    });
    vi.mocked(getMemberPracticeLink).mockRejectedValueOnce(new Error("unavailable"));
    render(<MySchedule enabled />);
    const practice = await screen.findByRole("button", { name: "Open practice player" });
    await userEvent.click(practice);
    expect(getMemberPracticeLink).toHaveBeenCalledWith("source-performance");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The practice player could not be opened.",
    );
    expect(practice).toBeEnabled();
    expect(screen.getByRole("button", { name: "Yes" })).toBeEnabled();
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

    expect(await screen.findByText("Rehearsal")).toBeVisible();
    expect(screen.getByLabelText(/August.*2026/)).toBeVisible();
  });
});

describe("MySchedule event details and seating link (#192)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows timing, venue, seating and notes without expanding event details", async () => {
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

    expect(screen.queryByText("Event details")).not.toBeInTheDocument();
    expect(screen.getByText("Arrive 5:15 PM")).toBeVisible();
    expect(screen.getByText("2 hours")).toBeVisible();
    expect(screen.getByText("Symphony Hall")).toBeVisible();
    expect(screen.getByText("123 Symphony Way")).toBeVisible();
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

  it("keeps event details visible when arriving through an event deep link", async () => {
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

      expect(screen.queryByText("Event details")).not.toBeInTheDocument();
      expect(screen.getByText(/Starts /)).toBeVisible();
    } finally {
      window.history.pushState({}, "", "/schedule");
    }
  });

  it("handles Other events with mode off as informational only", async () => {
    const offEvent = createSampleEvent({
      id: "other-off-1",
      otherEventRsvpMode: "off",
      title: "Board Meeting Info",
      type: "Other",
    });

    vi.mocked(getMySchedule).mockResolvedValueOnce({
      events: [offEvent],
      profileId: "00000000-0000-4000-8000-000000000001",
      requestId: "req-test-1",
      timezone: "America/New_York",
    });

    render(<MySchedule enabled />);

    await waitFor(() => {
      expect(screen.getByText("Board Meeting Info")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I can help" })).not.toBeInTheDocument();
    expect(screen.queryByText("Attending")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  it("handles Other event volunteering with 'I can help' and 'Withdraw' and tracks staffing goals", async () => {
    const user = userEvent.setup();
    const volunteerEvent = createSampleEvent({
      id: "other-vol-1",
      otherEventRsvpMode: "optional",
      resolvedRsvp: "Pending",
      title: "Gala Setup Helpers",
      type: "Other",
      volunteerCount: 3,
      volunteerGoal: 5,
    });

    vi.mocked(getMySchedule).mockResolvedValue({
      events: [volunteerEvent],
      profileId: "00000000-0000-4000-8000-000000000001",
      requestId: "req-test-1",
      timezone: "America/New_York",
    });
    vi.mocked(setMyEventRsvp).mockResolvedValueOnce({
      eventId: "other-vol-1",
      profileId: "00000000-0000-4000-8000-000000000001",
      rsvp: "Yes",
      rsvpNote: "",
      updatedAt: "2026-08-01T00:00:00Z",
    });

    render(<MySchedule enabled />);

    await waitFor(() => {
      expect(screen.getByText("Gala Setup Helpers")).toBeInTheDocument();
    });

    expect(screen.getByText("3 of 5 helpers committed — 2 more needed")).toBeInTheDocument();
    const helpButton = screen.getByRole("button", { name: "I can help" });
    expect(helpButton).toBeInTheDocument();

    await user.click(helpButton);
    expect(setMyEventRsvp).toHaveBeenCalledWith("other-vol-1", "Yes", "");
  });

  it("shows 'Minimum reached' progress and 'Withdraw' button when helper is committed", async () => {
    const committedEvent = createSampleEvent({
      id: "other-vol-2",
      otherEventRsvpMode: "optional",
      resolvedRsvp: "Yes",
      title: "Stage Crew",
      type: "Other",
      volunteerCount: 5,
      volunteerGoal: 5,
    });

    vi.mocked(getMySchedule).mockResolvedValueOnce({
      events: [committedEvent],
      profileId: "00000000-0000-4000-8000-000000000001",
      requestId: "req-test-1",
      timezone: "America/New_York",
    });

    render(<MySchedule enabled />);

    await waitFor(() => {
      expect(screen.getByText("Stage Crew")).toBeInTheDocument();
    });

    expect(screen.getByText("Minimum reached: 5 helpers committed")).toBeInTheDocument();
    expect(screen.getByText("Committed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
  });
});
