import { seasonSchema, type MemberDashboardResponse } from "@choir/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../auth/api";
import { DashboardView } from "./DashboardView";

describe("DashboardView", () => {
  const mockDashboard: MemberDashboardResponse = {
    activeSeason: null,
    activeSeasonState: "ready",
    bulletins: [],
    bulletinsState: "ready",
    events: [],
    modules: [],
    organizationName: "Test Chorus",
    performerLabel: "Singer",
    polls: [
      {
        expiresAt: "2026-11-01T00:00:00Z",
        id: "poll-uuid-1",
        linkToken: "token-secret-abc",
        title: "Spring Repertoire Survey",
      },
    ],
    pollsState: "ready",
    profile: {
      displayName: "Pat Singer",
      id: "profile-1",
      voicePart: "Tenor",
    },
    profileLinkRequired: false,
    requestId: "req-1",
    resources: [],
    resourcesState: "ready",
    timezone: "America/New_York",
  };

  it.each(["paid", null, "pending", "expired", "refunded"] as const)(
    "places dues appropriately and confirms payment only for status %s",
    async (duesStatus) => {
      vi.spyOn(authApi, "getMemberDashboard").mockResolvedValueOnce({
        ...mockDashboard,
        activeSeason: {
          duesStatus,
          season: seasonSchema.parse({
            id: "33333333-3333-4333-8333-333333333333",
            name: "Current season",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
            startsAt: "2026-09-01T00:00:00.000Z",
            endsAt: "2027-05-01T00:00:00.000Z",
            duesAmountCents: 2000,
            isActive: true,
          }),
        },
      });
      render(<DashboardView accessStatus="ready" enabled navigate={vi.fn()} />);
      await screen.findByText("Current season");
      const updates = screen.getByRole("complementary", { name: "Member updates" });
      const widgets = within(updates).getAllByRole("group");
      const dues = within(updates).getByRole("group", { name: "Season dues" });
      if (duesStatus === "paid") {
        expect(widgets.at(-1)).toBe(dues);
        expect(within(dues).getByText("Paid in full")).toBeVisible();
        expect(
          within(dues).getByText("Thank you! Your dues are paid for this season."),
        ).toBeVisible();
      } else {
        expect(widgets[0]).toBe(dues);
        expect(within(dues).queryByText("Paid in full")).not.toBeInTheDocument();
        expect(within(dues).queryByText(/Thank you/)).not.toBeInTheDocument();
      }
      expect(within(dues).getByRole("link", { name: "View dues details" })).toHaveAttribute(
        "href",
        "/dues",
      );
    },
  );

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("navigates to in-shell /member/polls/:id when active poll is clicked", async () => {
    vi.spyOn(authApi, "getMemberDashboard").mockResolvedValueOnce(mockDashboard);
    const navigate = vi.fn();

    render(<DashboardView accessStatus="ready" enabled={true} navigate={navigate} />);

    await waitFor(() => {
      expect(screen.getByText("Spring Repertoire Survey")).toBeInTheDocument();
    });

    const pollLink = screen.getByRole("link", { name: "Spring Repertoire Survey" });
    expect(pollLink).toHaveAttribute("href", "/member/polls/poll-uuid-1?token=token-secret-abc");

    fireEvent.click(pollLink);
    expect(navigate).toHaveBeenCalledWith("/member/polls/poll-uuid-1?token=token-secret-abc");
  });

  it.each([undefined, false, true])(
    "renders event information and only available score links (%s)",
    async (scoreAvailable) => {
      const dashboardWithEvent: MemberDashboardResponse = {
        ...mockDashboard,
        events: [
          {
            attendanceWarning: null,
            callTime: "18:45",
            details: "Main hall rehearsal",
            directRsvp: "Pending",
            durationMinutes: 120,
            featuredAssignments: [],
            id: "event-1111-2222-3333-444444444444",
            inheritedFromParent: false,
            location: "Symphony Hall - Room B",
            practice: {
              sourceEventId: "event-1111-2222-3333-444444444444",
              status: "available",
              trackCount: 4,
            },
            resolvedRsvp: "Pending",
            rsvpDeadlineAt: null,
            rsvpDeadlineDate: "2026-10-20",
            rsvpDeadlinePassed: false,
            rsvpNote: "",
            rsvpSelfServiceOpen: true,
            seating: {
              status: "not_published",
            },
            setList: [
              {
                pieceId: "score-piece",
                title: "Opening Song",
                ...(scoreAvailable === undefined ? {} : { scoreAvailable }),
              },
              { pieceId: "no-score-piece", title: "Song without score", scoreAvailable: false },
            ],
            startsAt: "2026-10-22T23:00:00Z", // 7:00 PM EDT
            title: "Fall Concert Rehearsal",
            type: "Rehearsal",
            venueAddress: "123 Symphony St",
            venueName: "Symphony Hall",
          },
        ],
      };

      vi.spyOn(authApi, "getMemberDashboard").mockResolvedValueOnce(dashboardWithEvent);
      const navigate = vi.fn();

      render(<DashboardView accessStatus="ready" enabled={true} navigate={navigate} />);

      await waitFor(() => {
        expect(screen.getByText("Fall Concert Rehearsal")).toBeInTheDocument();
      });

      expect(screen.queryAllByRole("link", { name: "Score (PDF)" })).toHaveLength(
        scoreAvailable ? 1 : 0,
      );
      expect(screen.queryAllByRole("link", { name: "Download all scores (ZIP)" })).toHaveLength(
        scoreAvailable ? 1 : 0,
      );
      // Date tile verification
      const dateTile = screen.getByLabelText("Thursday, October 22, 2026");
      expect(dateTile).toBeInTheDocument();
      expect(dateTile).toHaveTextContent("Thu");
      expect(dateTile).toHaveTextContent("22");
      expect(dateTile).toHaveTextContent("Oct");

      // Time range and details
      expect(screen.getByText("Starts 7:00 PM EDT")).toBeInTheDocument();
      expect(screen.getByText("Symphony Hall")).toBeInTheDocument();
      expect(screen.getByText("Arrive 6:45 PM")).toBeInTheDocument();
      expect(screen.getByText("RSVP by Oct 20, 2026")).toBeInTheDocument();
      expect(screen.getByText("Next up")).toBeInTheDocument();
    },
  );

  it("renders compact practice action with track count and voice part and opens practice player", async () => {
    const dashboardWithPractice: MemberDashboardResponse = {
      ...mockDashboard,
      events: [
        {
          attendanceWarning: null,
          callTime: "",
          details: "",
          directRsvp: "Yes",
          durationMinutes: 90,
          featuredAssignments: [],
          id: "event-practice-1234",
          inheritedFromParent: false,
          location: "Rehearsal Studio",
          practice: {
            sourceEventId: "event-practice-1234",
            status: "available",
            trackCount: 6,
          },
          resolvedRsvp: "Yes",
          rsvpDeadlineAt: null,
          rsvpDeadlineDate: null,
          rsvpDeadlinePassed: false,
          rsvpNote: "",
          rsvpSelfServiceOpen: true,
          seating: {
            status: "not_published",
          },
          setList: [],
          startsAt: "2026-10-25T18:00:00Z",
          title: "Sunday Rehearsal",
          type: "Rehearsal",
          venueAddress: "456 Main St",
          venueName: "Studio A",
        },
      ],
      profile: {
        displayName: "Pat Singer",
        id: "profile-1",
        voicePart: "Tenor 2",
      },
    };

    vi.spyOn(authApi, "getMemberDashboard").mockResolvedValueOnce(dashboardWithPractice);
    const mockPracticeLink = vi
      .spyOn(authApi, "getMemberPracticeLink")
      .mockResolvedValueOnce("https://test.chorus.app/practice/event-practice-1234");
    const assignSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        assign: assignSpy,
        hash: "",
        href: "http://localhost:3000/account",
        origin: "http://localhost:3000",
        search: "",
      },
    });

    try {
      render(<DashboardView accessStatus="ready" enabled={true} navigate={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Open practice player" })).toBeInTheDocument();
      });

      expect(screen.getByRole("button", { name: "Open practice player" })).toHaveAttribute(
        "title",
        "6 tracks available · Your part: Tenor 2",
      );

      const openPracticeButton = screen.getByRole("button", { name: "Open practice player" });
      fireEvent.click(openPracticeButton);

      await waitFor(() => {
        expect(mockPracticeLink).toHaveBeenCalledWith("event-practice-1234");
        expect(assignSpy).toHaveBeenCalledWith(
          "https://test.chorus.app/practice/event-practice-1234",
        );
      });
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("renders seating link when performance seating is available and omits practice strip when unavailable", async () => {
    const dashboardWithSeating: MemberDashboardResponse = {
      ...mockDashboard,
      events: [
        {
          attendanceWarning: null,
          callTime: "19:00",
          details: "",
          directRsvp: "Yes",
          durationMinutes: 120,
          featuredAssignments: [],
          id: "event-perf-5678",
          inheritedFromParent: false,
          location: "Grand Hall",
          practice: {
            sourceEventId: null,
            status: "not_published",
            trackCount: 0,
          },
          resolvedRsvp: "Yes",
          rsvpDeadlineAt: null,
          rsvpDeadlineDate: null,
          rsvpDeadlinePassed: false,
          rsvpNote: "",
          rsvpSelfServiceOpen: true,
          seating: {
            status: "available",
          },
          setList: [],
          startsAt: "2026-11-01T20:00:00Z",
          title: "Winter Gala Performance",
          type: "Performance",
          venueAddress: "789 Gala Blvd",
          venueName: "Grand Hall",
        },
      ],
    };

    vi.spyOn(authApi, "getMemberDashboard").mockResolvedValueOnce(dashboardWithSeating);
    const navigate = vi.fn();

    render(<DashboardView accessStatus="ready" enabled={true} navigate={navigate} />);

    await waitFor(() => {
      expect(screen.getByText("Winter Gala Performance")).toBeInTheDocument();
    });

    expect(screen.queryByText("Practice music")).not.toBeInTheDocument();

    const seatingLink = screen.getByRole("link", { name: "View assigned seat" });
    expect(seatingLink).toHaveAttribute("href", "/seating/event-perf-5678");

    fireEvent.click(seatingLink);
    expect(navigate).toHaveBeenCalledWith("/seating/event-perf-5678");
  });

  it("displays server error message when RSVP update fails with AuthApiError", async () => {
    const dashboardWithOtherEvent: MemberDashboardResponse = {
      ...mockDashboard,
      events: [
        {
          attendanceWarning: null,
          callTime: "",
          details: "Volunteers welcome",
          directRsvp: "Pending",
          durationMinutes: 60,
          featuredAssignments: [],
          id: "event-other-1",
          inheritedFromParent: false,
          isInvited: true,
          location: "",
          otherEventRsvpMode: "optional",
          practice: {
            sourceEventId: null,
            status: "not_published",
            trackCount: 0,
          },
          resolvedRsvp: "Pending",
          rsvpDeadlineAt: null,
          rsvpDeadlineDate: null,
          rsvpDeadlinePassed: false,
          rsvpNote: "",
          rsvpSelfServiceOpen: true,
          seating: { status: "not_published" },
          setList: [],
          startsAt: "2026-11-01T10:00:00Z",
          title: "Community Clean Up",
          type: "Other",
          venueAddress: "",
          venueName: "",
          volunteerCount: 0,
          volunteerGoal: 5,
        },
      ],
    };

    vi.spyOn(authApi, "getMemberDashboard").mockResolvedValue(dashboardWithOtherEvent);
    vi.spyOn(authApi, "setMyEventRsvp").mockRejectedValueOnce(
      new authApi.AuthApiError(
        "Assign a voice part before submitting an RSVP.",
        422,
        "rsvp_voice_part_required",
      ),
    );

    render(<DashboardView accessStatus="ready" enabled={true} navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Community Clean Up")).toBeInTheDocument();
    });

    const attendButton = screen.getByRole("button", { name: "Attend" });
    fireEvent.click(attendButton);

    await waitFor(() => {
      expect(
        screen.getByText("Assign a voice part before submitting an RSVP."),
      ).toBeInTheDocument();
    });
  });

  it("omits RSVP buttons and status badge for Other events when RSVP mode is off", async () => {
    const dashboardWithOffEvent: MemberDashboardResponse = {
      ...mockDashboard,
      events: [
        {
          attendanceWarning: null,
          callTime: "",
          details: "Informational event",
          directRsvp: "Pending",
          durationMinutes: 60,
          featuredAssignments: [],
          id: "event-other-off",
          inheritedFromParent: false,
          isInvited: false,
          location: "",
          otherEventRsvpMode: "off",
          practice: {
            sourceEventId: null,
            status: "not_published",
            trackCount: 0,
          },
          resolvedRsvp: "Pending",
          rsvpDeadlineAt: null,
          rsvpDeadlineDate: null,
          rsvpDeadlinePassed: false,
          rsvpNote: "",
          rsvpSelfServiceOpen: false,
          seating: { status: "not_published" },
          setList: [],
          startsAt: "2026-11-01T10:00:00Z",
          title: "Board Meeting Informational",
          type: "Other",
          venueAddress: "",
          venueName: "",
          volunteerCount: 0,
          volunteerGoal: null,
        },
      ],
    };

    vi.spyOn(authApi, "getMemberDashboard").mockResolvedValueOnce(dashboardWithOffEvent);

    render(<DashboardView accessStatus="ready" enabled={true} navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Board Meeting Informational")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Attend" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
    expect(screen.queryByText("Needs response")).not.toBeInTheDocument();
  });
});
