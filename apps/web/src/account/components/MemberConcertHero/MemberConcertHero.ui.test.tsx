import type { MemberDashboardResponse } from "@choir/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberConcertHero } from "./MemberConcertHero";

type DashboardEvent = MemberDashboardResponse["events"][number];

function createConcert(overrides: Partial<DashboardEvent> = {}): DashboardEvent {
  return {
    attendanceWarning: null,
    callTime: "18:30",
    details: "Winter performance",
    directRsvp: "Yes",
    durationMinutes: 120,
    featuredAssignments: [],
    id: "concert-1111-2222-3333-444444444444",
    inheritedFromParent: false,
    location: "Riverside Community Hall",
    practice: {
      sourceEventId: "concert-1111-2222-3333-444444444444",
      status: "available",
      trackCount: 12,
    },
    publicGraphicFileId: null,
    resolvedRsvp: "Yes",
    rsvpDeadlineAt: null,
    rsvpDeadlineDate: "2026-11-20",
    rsvpDeadlinePassed: false,
    rsvpNote: "",
    rsvpSelfServiceOpen: true,
    seating: { status: "not_published" },
    setList: [],
    startsAt: "2026-12-06T23:00:00Z", // Dec 6, 2026 at 6:00 PM EST (or 7:00 PM depending on TZ)
    title: "Winter Concert",
    type: "Performance",
    venueAddress: "100 Riverside Ave",
    venueName: "Riverside Community Hall",
    ...overrides,
  };
}

describe("MemberConcertHero", () => {
  it("renders concert title, date, venue, and countdown stats", () => {
    const concert = createConcert();
    // Simulate 38 days before Dec 6, 2026 23:00 UTC (e.g. Oct 29, 2026 23:00 UTC) -> 5 weeks, 3 days
    const simulatedNow = new Date("2026-10-29T23:00:00Z");

    render(
      <MemberConcertHero
        busyEventId={null}
        concert={concert}
        now={simulatedNow}
        onOpenPractice={vi.fn()}
        rehearsalsRemainingCount={4}
        timezone="America/New_York"
      />,
    );

    expect(screen.getByText("Winter Concert")).toBeInTheDocument();
    expect(screen.getByText("Next Performance")).toBeInTheDocument();
    expect(screen.getByText("Riverside Community Hall")).toBeInTheDocument();
    const heroMapLink = screen.getByRole("link", {
      name: /Riverside Community Hall on Google Maps/i,
    });
    expect(heroMapLink).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Riverside%20Community%20Hall%2C%20100%20Riverside%20Ave",
    );
    expect(heroMapLink).toHaveAttribute("target", "_blank");
    expect(heroMapLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/Sunday, December 6, 2026/)).toBeInTheDocument();

    // Stats
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Weeks")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Days")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Rehearsals")).toBeInTheDocument();
  });

  it("handles singular countdown labels (1 Week, 1 Day, 1 Rehearsal)", () => {
    const concert = createConcert();
    // 8 days difference: 1 week and 1 day
    const simulatedNow = new Date("2026-11-28T23:00:00Z");

    render(
      <MemberConcertHero
        busyEventId={null}
        concert={concert}
        now={simulatedNow}
        onOpenPractice={vi.fn()}
        rehearsalsRemainingCount={1}
        timezone="America/New_York"
      />,
    );

    expect(screen.getAllByText("1")).toHaveLength(3);
    expect(screen.getByText("Week")).toBeInTheDocument();
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.getByText("Rehearsal")).toBeInTheDocument();
  });

  it("uses generic background class when publicGraphicFileId is null", () => {
    const concert = createConcert({ publicGraphicFileId: null });

    const { container } = render(
      <MemberConcertHero
        busyEventId={null}
        concert={concert}
        onOpenPractice={vi.fn()}
        rehearsalsRemainingCount={4}
        timezone="America/New_York"
      />,
    );

    const section = container.querySelector("section");
    expect(section).toHaveClass("member-concert-hero--generic");
    expect(section).not.toHaveClass("member-concert-hero--has-image");
  });

  it("applies background image style when publicGraphicFileId is provided", () => {
    const concert = createConcert({ publicGraphicFileId: "banner-file-uuid" });

    const { container } = render(
      <MemberConcertHero
        busyEventId={null}
        concert={concert}
        onOpenPractice={vi.fn()}
        rehearsalsRemainingCount={4}
        timezone="America/New_York"
      />,
    );

    const section = container.querySelector("section");
    expect(section).toHaveClass("member-concert-hero--has-image");
    expect(section?.style.backgroundImage).toContain("/api/organization/files/banner-file-uuid");
  });

  it("calls onOpenPractice when Open Practice Player button is clicked and practice is available", () => {
    const concert = createConcert();
    const onOpenPractice = vi.fn();

    render(
      <MemberConcertHero
        busyEventId={null}
        concert={concert}
        onOpenPractice={onOpenPractice}
        rehearsalsRemainingCount={4}
        timezone="America/New_York"
      />,
    );

    const button = screen.getByRole("button", {
      name: `Open Practice Player for ${concert.title}`,
    });
    expect(button.querySelector("svg")).toHaveAttribute("data-feature-icon", "headphones");
    fireEvent.click(button);

    expect(onOpenPractice).toHaveBeenCalledWith(concert);
  });

  it.each<DashboardEvent["practice"]>([
    { sourceEventId: null, status: "not_published", trackCount: 0 },
    { sourceEventId: null, status: "not_available", trackCount: 0 },
    {
      sourceEventId: "concert-1111-2222-3333-444444444444",
      status: "not_available",
      trackCount: 0,
    },
    { sourceEventId: "another-event", status: "available", trackCount: 12 },
    { sourceEventId: null, status: "available", trackCount: 12 },
  ])("hides the practice action unless it is available for this concert: %j", (practice) => {
    const concert = createConcert({ practice });
    render(
      <MemberConcertHero
        busyEventId={null}
        concert={concert}
        onOpenPractice={vi.fn()}
        rehearsalsRemainingCount={4}
        timezone="America/New_York"
      />,
    );

    expect(screen.getByText(concert.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Practice Player/ })).not.toBeInTheDocument();
  });

  it("disables button and displays Opening… when busyEventId matches concert id", () => {
    const concert = createConcert();

    render(
      <MemberConcertHero
        busyEventId={concert.id}
        concert={concert}
        onOpenPractice={vi.fn()}
        rehearsalsRemainingCount={4}
        timezone="America/New_York"
      />,
    );

    const button = screen.getByRole("button", {
      name: `Open Practice Player for ${concert.title}`,
    });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Opening…");
  });

  it("resets button to enabled Open Practice Player when busyEventId resets to null", () => {
    const concert = createConcert();
    const onOpenPractice = vi.fn();

    const { rerender } = render(
      <MemberConcertHero
        busyEventId={concert.id}
        concert={concert}
        onOpenPractice={onOpenPractice}
        rehearsalsRemainingCount={4}
        timezone="America/New_York"
      />,
    );

    const button = screen.getByRole("button", {
      name: `Open Practice Player for ${concert.title}`,
    });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Opening…");

    rerender(
      <MemberConcertHero
        busyEventId={null}
        concert={concert}
        onOpenPractice={onOpenPractice}
        rehearsalsRemainingCount={4}
        timezone="America/New_York"
      />,
    );

    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("Open Practice Player");

    fireEvent.click(button);
    expect(onOpenPractice).toHaveBeenCalledWith(concert);
  });

  it("renders progress bar with 6 segments and highlights remaining rehearsals", () => {
    const concert = createConcert({
      attendanceWarning: {
        missedRehearsals: 2,
        status: "clear",
        threshold: 3,
        totalRehearsals: 6,
      },
    });

    const { container } = render(
      <MemberConcertHero
        busyEventId={null}
        concert={concert}
        onOpenPractice={vi.fn()}
        rehearsalsRemainingCount={4}
        timezone="America/New_York"
      />,
    );

    const progress = container.querySelector(".member-concert-hero__progress");
    expect(progress).toBeInTheDocument();
    const segments = container.querySelectorAll(".member-concert-hero__progress-segment");
    expect(segments).toHaveLength(6);
    const activeSegments = container.querySelectorAll(
      ".member-concert-hero__progress-segment.is-active",
    );
    expect(activeSegments).toHaveLength(4);
  });

  it("does not render a Google Maps link when concert venue is a placeholder", () => {
    const concert = createConcert({
      location: "",
      venueAddress: "",
      venueName: "",
    });

    render(
      <MemberConcertHero
        busyEventId={null}
        concert={concert}
        onOpenPractice={vi.fn()}
        rehearsalsRemainingCount={4}
        timezone="America/New_York"
      />,
    );

    expect(screen.getByText("Location to be announced")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /on Google Maps/i })).not.toBeInTheDocument();
  });

  it("renders attendance summary and declined badge when member declined performance and self-service is closed", () => {
    const concert = createConcert({
      directRsvp: "No",
      resolvedRsvp: "No",
      rsvpSelfServiceOpen: false,
    });

    render(
      <MemberConcertHero
        busyEventId={null}
        concert={concert}
        onOpenPractice={vi.fn()}
        rehearsalsRemainingCount={0}
        timezone="America/New_York"
      />,
    );

    expect(screen.getByText("Your Attendance")).toBeInTheDocument();
    expect(screen.getByText("Declined")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You are marked as not attending this performance cycle. Linked rehearsals are excluded from your schedule.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Self-service RSVP is closed for this concert. Contact a director or roster manager if your availability has changed.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Rehearsals Remaining")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders attendance summary with update guidance when member declined and self-service is open", () => {
    const concert = createConcert({
      directRsvp: "No",
      resolvedRsvp: "No",
      rsvpSelfServiceOpen: true,
    });

    render(
      <MemberConcertHero
        busyEventId={null}
        concert={concert}
        onOpenPractice={vi.fn()}
        rehearsalsRemainingCount={0}
        timezone="America/New_York"
      />,
    );

    expect(screen.getByText("Your Attendance")).toBeInTheDocument();
    expect(screen.getByText("Declined")).toBeInTheDocument();
    expect(
      screen.getByText("You can update your RSVP in the upcoming events list below."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Rehearsals Remaining")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
