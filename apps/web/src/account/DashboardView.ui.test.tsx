import type { MemberDashboardResponse } from "@choir/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      expect(screen.getByText("7:00 PM – 9:00 PM")).toBeInTheDocument();
      expect(screen.getByText("Symphony Hall")).toBeInTheDocument();
      expect(screen.getByText("Call 6:45 PM")).toBeInTheDocument();
      expect(screen.getByText("RSVP by Oct 20, 2026")).toBeInTheDocument();
      expect(screen.getByText("Next up")).toBeInTheDocument();
    },
  );

  it("renders dedicated practice music strip with track count and voice part and opens practice player", async () => {
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
        expect(screen.getByText("Practice music")).toBeInTheDocument();
      });

      expect(screen.getByText("6 tracks available")).toBeInTheDocument();
      expect(screen.getByText("Your part: Tenor 2")).toBeInTheDocument();

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

    const seatingLink = screen.getByRole("link", { name: "Seating" });
    expect(seatingLink).toHaveAttribute("href", "/seating/event-perf-5678");

    fireEvent.click(seatingLink);
    expect(navigate).toHaveBeenCalledWith("/seating/event-perf-5678");
  });
});
