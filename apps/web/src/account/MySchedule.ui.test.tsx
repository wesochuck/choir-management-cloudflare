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
});
