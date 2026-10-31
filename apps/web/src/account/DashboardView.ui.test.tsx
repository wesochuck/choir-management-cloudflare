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

  it("uses the shared member workspace loading state without requesting member data", () => {
    const dashboardRequest = vi.spyOn(authApi, "getMemberDashboard");

    render(<DashboardView accessStatus="loading" enabled={false} navigate={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading your member workspace…");
    expect(dashboardRequest).not.toHaveBeenCalled();
  });

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
      expect(screen.getAllByText("Winter Gala Performance").length).toBeGreaterThanOrEqual(1);
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

  it.each([true, false])(
    "renders the concert hero with practice only when its set list is published (%s)",
    async (published) => {
      const dashboardWithConcert: MemberDashboardResponse = {
        ...mockDashboard,
        events: [
          {
            attendanceWarning: null,
            callTime: "18:00",
            details: "Main hall rehearsal",
            directRsvp: "Yes",
            durationMinutes: 120,
            featuredAssignments: [],
            id: "rehearsal-1",
            inheritedFromParent: false,
            location: "Rehearsal Hall",
            practice: { sourceEventId: "rehearsal-1", status: "available", trackCount: 3 },
            resolvedRsvp: "Yes",
            rsvpDeadlineAt: null,
            rsvpDeadlineDate: null,
            rsvpDeadlinePassed: false,
            rsvpNote: "",
            rsvpSelfServiceOpen: true,
            seating: { status: "not_published" },
            setList: [],
            startsAt: "2026-11-15T19:00:00Z",
            title: "Pre-Concert Rehearsal",
            type: "Rehearsal",
            venueAddress: "100 Rehearsal Way",
            venueName: "Rehearsal Hall",
          },
          {
            attendanceWarning: {
              missedRehearsals: 0,
              status: "clear",
              threshold: 3,
              totalRehearsals: 6,
            },
            callTime: "17:00",
            details: "Formal concert attire",
            directRsvp: "Yes",
            durationMinutes: 150,
            featuredAssignments: [],
            id: "concert-1",
            inheritedFromParent: false,
            location: "Riverside Community Hall",
            practice: {
              sourceEventId: published ? "concert-1" : null,
              status: published ? "available" : "not_published",
              trackCount: published ? 8 : 0,
            },
            publicGraphicFileId: "concert-graphic-uuid",
            resolvedRsvp: "Yes",
            rsvpDeadlineAt: null,
            rsvpDeadlineDate: "2026-11-20",
            rsvpDeadlinePassed: false,
            rsvpNote: "",
            rsvpSelfServiceOpen: true,
            seating: { status: "available" },
            setList: [],
            startsAt: "2026-12-06T23:00:00Z",
            title: "Winter Concert",
            type: "Performance",
            venueAddress: "200 Riverside Dr",
            venueName: "Riverside Community Hall",
          },
        ],
      };

      vi.spyOn(authApi, "getMemberDashboard").mockResolvedValueOnce(dashboardWithConcert);

      render(<DashboardView accessStatus="ready" enabled={true} navigate={vi.fn()} />);

      await waitFor(() => {
        expect(
          screen.getByRole("region", { name: "Featured performance: Winter Concert" }),
        ).toBeInTheDocument();
      });

      const hero = screen.getByRole("region", { name: "Featured performance: Winter Concert" });
      expect(within(hero).getByText("Next Performance")).toBeInTheDocument();
      expect(within(hero).getByText("Winter Concert")).toBeInTheDocument();
      expect(within(hero).getByText("Riverside Community Hall")).toBeInTheDocument();
      expect(within(hero).getByText("Rehearsals Remaining")).toBeInTheDocument();
      // 1 rehearsal before concert
      expect(within(hero).getAllByText("1").length).toBeGreaterThanOrEqual(1);
      expect(within(hero).getByText("Rehearsal")).toBeInTheDocument();

      const practiceButton = within(hero).queryByRole("button", { name: /Open Practice Player/ });
      if (published) expect(practiceButton).toBeInTheDocument();
      else expect(practiceButton).not.toBeInTheDocument();
      // Another event's practice stays available without supplying a fallback for the hero.
      expect(screen.getAllByRole("button", { name: "Open practice player" })).toHaveLength(
        published ? 2 : 1,
      );

      // Verify background image applied from publicGraphicFileId
      expect(hero).toHaveClass("member-concert-hero--has-image");
      expect(hero.style.backgroundImage).toContain("/api/organization/files/concert-graphic-uuid");
    },
  );

  it("omits concert hero callout when no Performance event exists", async () => {
    const dashboardOnlyRehearsals: MemberDashboardResponse = {
      ...mockDashboard,
      events: [
        {
          attendanceWarning: null,
          callTime: "",
          details: "",
          directRsvp: "Yes",
          durationMinutes: 90,
          featuredAssignments: [],
          id: "rehearsal-1",
          inheritedFromParent: false,
          location: "Studio",
          practice: { sourceEventId: null, status: "not_available", trackCount: 0 },
          resolvedRsvp: "Yes",
          rsvpDeadlineAt: null,
          rsvpDeadlineDate: null,
          rsvpDeadlinePassed: false,
          rsvpNote: "",
          rsvpSelfServiceOpen: true,
          seating: { status: "not_published" },
          setList: [],
          startsAt: "2026-11-15T19:00:00Z",
          title: "Regular Rehearsal",
          type: "Rehearsal",
          venueAddress: "",
          venueName: "Studio",
        },
      ],
    };

    vi.spyOn(authApi, "getMemberDashboard").mockResolvedValueOnce(dashboardOnlyRehearsals);

    render(<DashboardView accessStatus="ready" enabled={true} navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Regular Rehearsal")).toBeInTheDocument();
    });

    expect(screen.queryByText("Next Performance")).not.toBeInTheDocument();
    expect(screen.queryByText("Rehearsals Remaining")).not.toBeInTheDocument();
  });

  it("opens practice player when Open Practice Player button in concert hero is clicked", async () => {
    const dashboardWithConcert: MemberDashboardResponse = {
      ...mockDashboard,
      events: [
        {
          attendanceWarning: null,
          callTime: "",
          details: "",
          directRsvp: "Yes",
          durationMinutes: 120,
          featuredAssignments: [],
          id: "concert-1",
          inheritedFromParent: false,
          location: "Hall",
          practice: {
            sourceEventId: "concert-1",
            status: "available",
            trackCount: 5,
          },
          publicGraphicFileId: null,
          resolvedRsvp: "Yes",
          rsvpDeadlineAt: null,
          rsvpDeadlineDate: null,
          rsvpDeadlinePassed: false,
          rsvpNote: "",
          rsvpSelfServiceOpen: true,
          seating: { status: "not_published" },
          setList: [],
          startsAt: "2026-12-10T19:00:00Z",
          title: "Holiday Gala",
          type: "Performance",
          venueAddress: "",
          venueName: "Hall",
        },
      ],
    };

    vi.spyOn(authApi, "getMemberDashboard").mockResolvedValueOnce(dashboardWithConcert);
    vi.spyOn(authApi, "getMemberPracticeLink").mockResolvedValueOnce(
      "https://test.chorus.app/practice/concert-1",
    );

    const assignSpy = vi.fn();
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

    render(<DashboardView accessStatus="ready" enabled={true} navigate={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open Practice Player for Holiday Gala" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Practice Player for Holiday Gala" }));

    await waitFor(() => {
      expect(authApi.getMemberPracticeLink).toHaveBeenCalledWith("concert-1");
      expect(assignSpy).toHaveBeenCalledWith("https://test.chorus.app/practice/concert-1");
    });
  });
});
