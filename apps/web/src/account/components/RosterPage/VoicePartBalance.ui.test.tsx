import {
  organizationProfileSchema,
  type OrganizationProfile,
  type OrganizationRosterConfiguration,
} from "@choir/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VoicePartBalance } from "./shared";

const baseConfiguration: OrganizationRosterConfiguration = {
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

const mockProfiles: readonly OrganizationProfile[] = [
  organizationProfileSchema.parse({
    createdAt: "2026-08-01T00:00:00Z",
    displayName: "Singer 1",
    globalStatus: "Active",
    id: "11111111-1111-4111-8111-111111111111",
    updatedAt: "2026-08-01T00:00:00Z",
    voicePart: "T1",
  }),
];

describe("VoicePartBalance", () => {
  it("renders 2 + 2 layout with unified columns and section spans", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <VoicePartBalance
        configuration={baseConfiguration}
        onToggle={onToggle}
        partLabel="Voice Part"
        profiles={mockProfiles}
        selectedFilters={[]}
      />,
    );

    const layoutContainer = container.querySelector(".roster-balance__assignment-layout");
    expect(layoutContainer).not.toBeNull();
    expect(layoutContainer?.getAttribute("style")).toContain("--roster-balance-columns: 4");

    const tenorBtn = screen.getByRole("button", { name: /Tenors/i });
    const bassBtn = screen.getByRole("button", { name: /Basses/i });
    const t1Btn = screen.getByRole("button", { name: /T1/i });
    const t2Btn = screen.getByRole("button", { name: /T2/i });
    const b1Btn = screen.getByRole("button", { name: /B1/i });
    const b2Btn = screen.getByRole("button", { name: /B2/i });

    expect(t2Btn).toBeDefined();
    expect(b1Btn).toBeDefined();
    expect(b2Btn).toBeDefined();

    expect(tenorBtn.getAttribute("style")).toContain("--roster-balance-section-span: 2");
    expect(bassBtn.getAttribute("style")).toContain("--roster-balance-section-span: 2");

    fireEvent.click(tenorBtn);
    expect(onToggle).toHaveBeenCalledWith("section:T");

    fireEvent.click(t1Btn);
    expect(onToggle).toHaveBeenCalledWith("part:T1");
  });

  it("renders uneven 1 + 3 layout with exact section spans", () => {
    const onToggle = vi.fn();
    const unevenConfiguration: OrganizationRosterConfiguration = {
      ...baseConfiguration,
      voiceParts: [
        { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
        { fullName: "Bass 1", label: "B1", sectionCode: "B" },
        { fullName: "Bass 2", label: "B2", sectionCode: "B" },
        { fullName: "Bass 3", label: "B3", sectionCode: "B" },
      ],
    };

    const { container } = render(
      <VoicePartBalance
        configuration={unevenConfiguration}
        onToggle={onToggle}
        partLabel="Voice Part"
        profiles={mockProfiles}
        selectedFilters={[]}
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
    const onToggle = vi.fn();
    const orphanConfiguration: OrganizationRosterConfiguration = {
      ...baseConfiguration,
      voiceParts: [
        { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
        { fullName: "Orphan 1", label: "O1", sectionCode: "UNKNOWN" },
      ],
    };

    const { container } = render(
      <VoicePartBalance
        configuration={orphanConfiguration}
        onToggle={onToggle}
        partLabel="Voice Part"
        profiles={mockProfiles}
        selectedFilters={[]}
      />,
    );

    const layoutContainer = container.querySelector(".roster-balance__assignment-layout");
    expect(layoutContainer?.classList.contains("roster-balance__assignment-layout--fallback")).toBe(
      true,
    );
    expect(layoutContainer?.getAttribute("style")).toBeNull();

    // All parts are preserved
    expect(screen.getByRole("button", { name: /T1/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /O1/i })).toBeDefined();
  });
});
