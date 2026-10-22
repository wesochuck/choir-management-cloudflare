import {
  organizationProfileSchema,
  type OrganizationProfile,
  type OrganizationRosterConfiguration,
} from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PersistedDraftReturn } from "../persistence";
import { RosterConfiguration } from "./RosterConfiguration";
import {
  rosterConfigurationDraftContext,
  type RosterConfigurationDraftContextValue,
} from "./rosterConfigurationDraftContext";

const sampleConfiguration: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rehearsalAttendanceReportsEnabled: true,
  rosterStructure: "sections_with_parts",
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [
    { code: "T", color: "#2563eb", name: "Tenors", trackOnly: false },
    { code: "B", color: "#16a34a", name: "Basses", trackOnly: false },
    { code: "O", color: "#9333ea", name: "Other Tracks", trackOnly: true },
  ],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [
    { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
    { fullName: "Bass 1", label: "B1", sectionCode: "B" },
    { fullName: "SATB Reference", label: "SATB", sectionCode: "O" },
  ],
};

const assignedProfile: OrganizationProfile = organizationProfileSchema.parse({
  createdAt: "2026-07-20T20:00:00.000Z",
  displayName: "Terry Tenor",
  doNotEmail: false,
  globalStatus: "Active",
  id: "11111111-1111-4111-8111-111111111111",
  isSectionLeader: false,
  notes: "",
  phone: "",
  photoFileId: null,
  receiveAdminNotifications: true,
  receiveAttendanceReports: true,
  receiveFinancialAlerts: false,
  receiveRsvpDeclineNotices: false,
  showInDirectory: true,
  statusChangedAt: "2026-07-20T20:00:00.000Z",
  statusChangeReason: "",
  statusIsManual: false,
  updatedAt: "2026-07-20T20:00:00.000Z",
  voicePart: "T1",
});

function createMockDraftReturn(
  config: OrganizationRosterConfiguration = sampleConfiguration,
  overrides: Partial<PersistedDraftReturn<OrganizationRosterConfiguration>> = {},
): PersistedDraftReturn<OrganizationRosterConfiguration> {
  return {
    clearError: vi.fn(),
    dirty: false,
    discard: vi.fn(),
    draft: config,
    error: null,
    lastSavedAt: null,
    persisted: config,
    replaceDraft: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    saving: false,
    setDraft: vi.fn(),
    updateField: vi.fn(),
    ...overrides,
  };
}

function renderComponent(
  contextOverrides: Partial<RosterConfigurationDraftContextValue> = {},
  props = { enabled: true },
) {
  const config = contextOverrides.draft ?? sampleConfiguration;
  const value: RosterConfigurationDraftContextValue = {
    draft: config,
    draftReturn: createMockDraftReturn(config),
    error: null,
    loading: false,
    profiles: [assignedProfile],
    refreshProfiles: vi.fn(),
    setProfiles: vi.fn(),
    ...contextOverrides,
  };

  return render(
    <rosterConfigurationDraftContext.Provider value={value}>
      <RosterConfiguration {...props} />
    </rosterConfigurationDraftContext.Provider>,
  );
}

describe("RosterConfiguration UI track-only behavior", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("disables Track only checkbox for sections with assigned members and enables it for sections without", () => {
    renderComponent();

    // Section 1 is Tenors (code T) which has assigned profile (Terry Tenor has voicePart T1)
    const tenorsCheckbox = screen.getAllByRole("checkbox", { name: /track only/i })[0];
    expect(tenorsCheckbox).toBeDisabled();
    expect(tenorsCheckbox).toHaveAttribute(
      "title",
      "Reassign members in this section before marking it track-only.",
    );

    // Section 2 is Basses (code B) which has no assigned profile
    const bassesCheckbox = screen.getAllByRole("checkbox", { name: /track only/i })[1];
    expect(bassesCheckbox).not.toBeDisabled();
  });

  it("disables track-only section option when moving an assigned voice part", () => {
    renderComponent();

    // Voice part 1 is Tenor 1 (T1) which is assigned to Terry Tenor
    const t1SectionSelect = screen.getByRole("combobox", { name: "Part 1 section" });
    const otherTracksOption = within(t1SectionSelect).getByRole("option", {
      name: "Other Tracks (Track-only)",
    });
    expect(otherTracksOption).toBeDisabled();
    expect(otherTracksOption).toHaveAttribute(
      "title",
      "Cannot move an assigned part into a track-only section.",
    );

    // Non-track-only section Basses is enabled
    const bassesOption = within(t1SectionSelect).getByRole("option", {
      name: "Basses",
    });
    expect(bassesOption).not.toBeDisabled();
  });

  it("excludes track-only voice parts from reassignment target dropdown", async () => {
    const user = userEvent.setup();
    renderComponent();

    // Click "Manage assignments" on the assigned voice part card
    const reassignButton = screen.getByRole("button", {
      name: "Manage assignments",
    });
    await user.click(reassignButton);

    expect(screen.getByRole("dialog", { name: "Review T1 assignments" })).toBeInTheDocument();

    const replacementSelect = screen.getByLabelText("Move assignments to");
    // Basses (B1) is assignable
    expect(
      within(replacementSelect).getByRole("option", { name: "B1 — Bass 1" }),
    ).toBeInTheDocument();
    // SATB Reference is track-only, so it must not be present
    expect(within(replacementSelect).queryByText(/SATB/)).not.toBeInTheDocument();
  });
});
