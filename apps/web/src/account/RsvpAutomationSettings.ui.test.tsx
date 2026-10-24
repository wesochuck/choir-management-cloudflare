import type { OrganizationRosterConfiguration } from "@choir/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PersistedDraftReturn } from "../persistence";
import { RsvpAutomationSettings } from "./RsvpAutomationSettings";
import {
  rosterConfigurationDraftContext,
  type RosterConfigurationDraftContextValue,
} from "./rosterConfigurationDraftContext";

const sampleConfiguration: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 3,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rehearsalAttendanceReportsEnabled: true,
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [{ code: "SATB", color: "#336699", name: "SATB", trackOnly: false }],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [{ fullName: "Alto", label: "A1", sectionCode: "SATB" }],
};

function createMockDraftReturn(
  overrides: Partial<PersistedDraftReturn<OrganizationRosterConfiguration>> = {},
): PersistedDraftReturn<OrganizationRosterConfiguration> {
  return {
    clearError: vi.fn(),
    dirty: false,
    discard: vi.fn(),
    draft: sampleConfiguration,
    error: null,
    lastSavedAt: null,
    persisted: sampleConfiguration,
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
  const value: RosterConfigurationDraftContextValue = {
    draft: sampleConfiguration,
    draftReturn: createMockDraftReturn(),
    error: null,
    loading: false,
    profiles: [],
    refreshProfiles: vi.fn(),
    setProfiles: vi.fn(),
    ...contextOverrides,
  };

  return render(
    <rosterConfigurationDraftContext.Provider value={value}>
      <RsvpAutomationSettings {...props} />
    </rosterConfigurationDraftContext.Provider>,
  );
}

describe("RsvpAutomationSettings UI", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders RSVP Expiry and RSVP follow-up & attendance reports cards", () => {
    renderComponent();

    expect(screen.getByRole("region", { name: "RSVP automation settings" })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "Convert Pending responses to No at the deadline",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Send the pending RSVP follow-up email",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("spinbutton", {
        name: "Hours before the RSVP deadline",
      }),
    ).toHaveValue(48);
    expect(
      screen.getByRole("spinbutton", {
        name: "Rehearsal misses before an attendance warning",
      }),
    ).toHaveValue(3);
    expect(
      screen.getByRole("checkbox", {
        name: "Send attendance reports for Rehearsals",
      }),
    ).toBeChecked();
  });

  it("links the two distinct automation templates and provides accessible descriptions", () => {
    renderComponent();

    expect(
      screen.getByRole("link", { name: /Edit pending RSVP follow-up template/ }),
    ).toHaveAttribute(
      "href",
      "/admin/communications?tab=templates&templateId=5f0ca4a5-7e4c-4e1a-9a1c-000000000015",
    );
    expect(screen.getByRole("link", { name: /Edit Attendance Report template/ })).toHaveAttribute(
      "href",
      "/admin/communications?tab=templates&templateId=5f0ca4a5-7e4c-4e1a-9a1c-000000000016",
    );
    expect(
      screen.getByLabelText("Rehearsal misses before an attendance warning"),
    ).toHaveAccessibleDescription(/does not change Profile Status/);
  });

  it("allows toggling RSVP expiry", async () => {
    const user = userEvent.setup();
    const mockSetDraft = vi.fn();
    const draftReturn = createMockDraftReturn({ setDraft: mockSetDraft });

    renderComponent({ draftReturn });

    const checkbox = screen.getByRole("checkbox", {
      name: "Convert Pending responses to No at the deadline",
    });
    await user.click(checkbox);

    expect(mockSetDraft).toHaveBeenCalledWith({
      ...sampleConfiguration,
      rsvpExpiryEnabled: false,
    });
  });

  it("allows toggling pending RSVP follow-up email", async () => {
    const user = userEvent.setup();
    const mockSetDraft = vi.fn();
    const draftReturn = createMockDraftReturn({ setDraft: mockSetDraft });

    renderComponent({ draftReturn });

    const checkbox = screen.getByRole("checkbox", {
      name: "Send the pending RSVP follow-up email",
    });
    await user.click(checkbox);

    expect(mockSetDraft).toHaveBeenCalledWith({
      ...sampleConfiguration,
      rsvpFollowUpEnabled: false,
    });
  });

  it("allows updating RSVP follow-up lead hours", async () => {
    const user = userEvent.setup();
    const mockSetDraft = vi.fn();
    const draftReturn = createMockDraftReturn({ setDraft: mockSetDraft });

    renderComponent({ draftReturn });

    const input = screen.getByRole("spinbutton", {
      name: "Hours before the RSVP deadline",
    });
    await user.clear(input);
    await user.type(input, "24");

    expect(mockSetDraft).toHaveBeenLastCalledWith({
      ...sampleConfiguration,
      rsvpFollowUpLeadHours: 24,
    });
  });

  it("allows updating attendance report warning threshold", async () => {
    const user = userEvent.setup();
    const mockSetDraft = vi.fn();
    const draftReturn = createMockDraftReturn({ setDraft: mockSetDraft });

    renderComponent({ draftReturn });

    const input = screen.getByRole("spinbutton", {
      name: "Rehearsal misses before an attendance warning",
    });
    await user.clear(input);
    await user.type(input, "5");

    expect(mockSetDraft).toHaveBeenLastCalledWith({
      ...sampleConfiguration,
      attendanceReportWarningThreshold: 5,
    });
  });

  it("allows toggling rehearsal attendance reports", async () => {
    const user = userEvent.setup();
    const mockSetDraft = vi.fn();
    const draftReturn = createMockDraftReturn({ setDraft: mockSetDraft });

    renderComponent({ draftReturn });

    const checkbox = screen.getByRole("checkbox", {
      name: "Send attendance reports for Rehearsals",
    });
    await user.click(checkbox);

    expect(mockSetDraft).toHaveBeenCalledWith({
      ...sampleConfiguration,
      rehearsalAttendanceReportsEnabled: false,
    });
  });

  it("displays loading notice when loading is true", () => {
    renderComponent({ draft: null, loading: true });
    expect(screen.getByRole("status")).toHaveTextContent("Loading RSVP automation settings…");
  });

  it("displays error notice when error exists", () => {
    renderComponent({ error: "Failed to load RSVP automation settings." });
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load RSVP automation settings.");
  });

  it("displays saved success notice when lastSavedAt is present and not dirty", () => {
    const draftReturn = createMockDraftReturn({ dirty: false, lastSavedAt: Date.now() });
    renderComponent({ draftReturn });
    expect(screen.getByRole("status")).toHaveTextContent("RSVP automation settings saved.");
  });

  it("renders nothing when enabled is false", () => {
    renderComponent({}, { enabled: false });
    expect(
      screen.queryByRole("region", { name: "RSVP automation settings" }),
    ).not.toBeInTheDocument();
  });
});
