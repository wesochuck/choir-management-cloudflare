import {
  organizationEventSchema,
  type OrganizationEvent,
  type OrganizationRosterConfiguration,
} from "@choir/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RsvpManagerFilters } from "./RsvpManagerFilters";

const baseRoster: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [
    { code: "T", color: "#1b4d3e", name: "Tenors", trackOnly: false },
    { code: "B", color: "#2d3748", name: "Basses", trackOnly: false },
  ],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [
    { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
    { fullName: "Tenor 2", label: "T2", sectionCode: "T" },
    { fullName: "Bass 1", label: "B1", sectionCode: "B" },
    { fullName: "Bass 2", label: "B2", sectionCode: "B" },
  ],
};

const mockEventId = "22222222-2222-4222-8222-222222222222";

const mockEvent: OrganizationEvent = organizationEventSchema.parse({
  callTime: "18:30",
  createdAt: "2026-08-01T00:00:00Z",
  details: "Holiday Concert",
  id: mockEventId,
  location: "Concert Hall",
  rsvpDeadlineDate: "2026-12-08",
  rsvpDeadlinePassed: false,
  startsAt: "2026-12-15T20:00:00Z",
  title: "Holiday Concert",
  type: "Performance",
  updatedAt: "2026-08-01T00:00:00Z",
});

const mockCounts = {
  active: 4,
  attending: 2,
  declined: 1,
  pending: 1,
};

describe("RsvpManagerFilters", () => {
  it("renders 2 + 2 layout with unified columns and section spans", () => {
    const toggleAssignmentFilter = vi.fn();
    const { container } = render(
      <RsvpManagerFilters
        assignmentFilter={null}
        counts={mockCounts}
        eventId={mockEventId}
        events={[mockEvent]}
        filter="active"
        onEventChange={vi.fn()}
        partLabel="Voice Part"
        roster={baseRoster}
        sectionCounts={
          new Map([
            ["T", 2],
            ["B", 2],
          ])
        }
        selectedEvent={mockEvent}
        setFilter={vi.fn()}
        setView={vi.fn()}
        toggleAssignmentFilter={toggleAssignmentFilter}
        view="roster"
        voicePartCounts={
          new Map([
            ["T1", 1],
            ["T2", 1],
            ["B1", 1],
            ["B2", 1],
          ])
        }
      />,
    );

    const layoutContainer = container.querySelector(".roster-balance__assignment-layout");
    expect(layoutContainer).not.toBeNull();
    expect(layoutContainer?.getAttribute("style")).toContain("--roster-balance-columns: 4");

    const tenorBtn = screen.getByRole("button", { name: /Tenors/i });
    const bassBtn = screen.getByRole("button", { name: /Basses/i });
    const t1Btn = screen.getByRole("button", { name: /T1/i });
    const b2Btn = screen.getByRole("button", { name: /B2/i });

    expect(tenorBtn.getAttribute("style")).toContain("--roster-balance-section-span: 2");
    expect(bassBtn.getAttribute("style")).toContain("--roster-balance-section-span: 2");

    fireEvent.click(tenorBtn);
    expect(toggleAssignmentFilter).toHaveBeenCalledWith({ kind: "section", value: "T" });

    fireEvent.click(t1Btn);
    expect(toggleAssignmentFilter).toHaveBeenCalledWith({ kind: "voicePart", value: "T1" });

    fireEvent.click(b2Btn);
    expect(toggleAssignmentFilter).toHaveBeenCalledWith({ kind: "voicePart", value: "B2" });
  });

  it("renders uneven 1 + 3 layout with exact section spans", () => {
    const unevenRoster: OrganizationRosterConfiguration = {
      ...baseRoster,
      voiceParts: [
        { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
        { fullName: "Bass 1", label: "B1", sectionCode: "B" },
        { fullName: "Bass 2", label: "B2", sectionCode: "B" },
        { fullName: "Bass 3", label: "B3", sectionCode: "B" },
      ],
    };

    const { container } = render(
      <RsvpManagerFilters
        assignmentFilter={null}
        counts={mockCounts}
        eventId={mockEventId}
        events={[mockEvent]}
        filter="active"
        onEventChange={vi.fn()}
        partLabel="Voice Part"
        roster={unevenRoster}
        sectionCounts={
          new Map([
            ["T", 1],
            ["B", 3],
          ])
        }
        selectedEvent={mockEvent}
        setFilter={vi.fn()}
        setView={vi.fn()}
        toggleAssignmentFilter={vi.fn()}
        view="roster"
        voicePartCounts={
          new Map([
            ["T1", 1],
            ["B1", 1],
            ["B2", 1],
            ["B3", 1],
          ])
        }
      />,
    );

    const layoutContainer = container.querySelector(".roster-balance__assignment-layout");
    expect(layoutContainer?.getAttribute("style")).toContain("--roster-balance-columns: 4");

    const tenorBtn = screen.getByRole("button", { name: /Tenors/i });
    const bassBtn = screen.getByRole("button", { name: /Basses/i });

    expect(tenorBtn.getAttribute("style")).toContain("--roster-balance-section-span: 1");
    expect(bassBtn.getAttribute("style")).toContain("--roster-balance-section-span: 3");
  });

  it("falls back safely when configuration has orphan parts", () => {
    const orphanRoster: OrganizationRosterConfiguration = {
      ...baseRoster,
      voiceParts: [
        { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
        { fullName: "Orphan 1", label: "O1", sectionCode: "UNKNOWN" },
      ],
    };

    const { container } = render(
      <RsvpManagerFilters
        assignmentFilter={null}
        counts={mockCounts}
        eventId={mockEventId}
        events={[mockEvent]}
        filter="active"
        onEventChange={vi.fn()}
        partLabel="Voice Part"
        roster={orphanRoster}
        sectionCounts={new Map([["T", 1]])}
        selectedEvent={mockEvent}
        setFilter={vi.fn()}
        setView={vi.fn()}
        toggleAssignmentFilter={vi.fn()}
        view="roster"
        voicePartCounts={
          new Map([
            ["T1", 1],
            ["O1", 1],
          ])
        }
      />,
    );

    const layoutContainer = container.querySelector(".roster-balance__assignment-layout");
    expect(layoutContainer?.classList.contains("roster-balance__assignment-layout--fallback")).toBe(
      true,
    );
    expect(layoutContainer?.getAttribute("style")).toBeNull();

    expect(screen.getByRole("button", { name: /T1/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /O1/i })).toBeDefined();
  });
});
