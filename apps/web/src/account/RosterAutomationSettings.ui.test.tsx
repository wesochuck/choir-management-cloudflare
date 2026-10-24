import {
  organizationProfileSchema,
  type OrganizationProfile,
  type OrganizationRosterAutomationPreviewResponse,
  type OrganizationRosterConfiguration,
} from "@choir/contracts";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PersistedDraftReturn } from "../persistence";
import * as api from "../auth/api";
import { RosterAutomationSettings } from "./RosterAutomationSettings";
import {
  rosterConfigurationDraftContext,
  type RosterConfigurationDraftContextValue,
} from "./rosterConfigurationDraftContext";

vi.mock("../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    previewOrganizationRosterAutomation: vi.fn(),
  };
});

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

const sampleProfile: OrganizationProfile = organizationProfileSchema.parse({
  createdAt: "2026-07-20T20:00:00.000Z",
  displayName: "Alex Alto",
  doNotEmail: false,
  globalStatus: "Idle",
  id: "22222222-2222-4222-8222-222222222222",
  isSectionLeader: false,
  notes: "",
  onBreakInactiveAt: "2027-07-31T00:00:00.000Z",
  phone: "",
  photoFileId: null,
  receiveAdminNotifications: true,
  receiveAttendanceReports: true,
  receiveFinancialAlerts: false,
  receiveRsvpDeclineNotices: false,
  showInDirectory: true,
  statusChangedAt: "2026-07-20T20:00:00.000Z",
  statusChangeReason: "Manual On Break status",
  statusIsManual: false,
  updatedAt: "2026-07-20T20:00:00.000Z",
  voicePart: "A1",
});

const samplePreview: OrganizationRosterAutomationPreviewResponse = {
  affectedProfileCount: 2,
  onBreakTimeoutCount: 1,
  rsvpExpiryCount: 1,
  selectedProfile: {
    currentStatus: "Idle",
    displayName: "Alex Alto",
    id: "22222222-2222-4222-8222-222222222222",
    nextStatus: "Inactive",
    nextStatusReason: "On Break timeout is due.",
    onBreakInactiveDate: "2027-07-31",
    recentPerformances: [],
  },
  statusChangeCount: 2,
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
    profiles: [sampleProfile],
    refreshProfiles: vi.fn(),
    setProfiles: vi.fn(),
    ...contextOverrides,
  };

  return render(
    <rosterConfigurationDraftContext.Provider value={value}>
      <RosterAutomationSettings {...props} />
    </rosterConfigurationDraftContext.Provider>,
  );
}

describe("RosterAutomationSettings UI", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders preview when API succeeds and displays affected profile details", async () => {
    vi.mocked(api.previewOrganizationRosterAutomation).mockResolvedValue(samplePreview);

    renderComponent();

    expect(screen.getByText("Previewing the current roster…")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText("2 Profiles affected · 2 status changes · 1 RSVP expiry"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/On Break → Inactive · On Break timeout is due\./)).toBeInTheDocument();
  });

  it("explains status transitions and keeps RSVP automation settings separate", async () => {
    vi.mocked(api.previewOrganizationRosterAutomation).mockResolvedValue(samplePreview);
    renderComponent();
    expect(
      screen.getByLabelText("Missed Performances before changing Active to Inactive"),
    ).toHaveAccessibleDescription(/becomes Inactive after 3 consecutive missed Performances/);
    expect(
      screen.queryByLabelText("Rehearsal misses before an attendance warning"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Edit pending RSVP follow-up template/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Edit Attendance Report template/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", {
        name: "Convert Pending responses to No at the deadline",
      }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Profiles affected/)).toBeInTheDocument());
  });

  it("displays actionable role=alert banner on preview failure and recovers via retry", async () => {
    const user = userEvent.setup();
    vi.mocked(api.previewOrganizationRosterAutomation)
      .mockRejectedValueOnce(new Error("Network connection dropped"))
      .mockResolvedValueOnce(samplePreview);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Network connection dropped");
    });
    expect(screen.getByText("Preview unavailable.")).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: "Retry preview" });
    await user.click(retryBtn);

    await waitFor(() => {
      expect(
        screen.getByText("2 Profiles affected · 2 status changes · 1 RSVP expiry"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows Still previewing indicator when request exceeds UI slow threshold", async () => {
    vi.useFakeTimers();

    let resolvePreview:
      ((preview: OrganizationRosterAutomationPreviewResponse) => void) | undefined;
    const pendingPromise = new Promise<OrganizationRosterAutomationPreviewResponse>((resolve) => {
      resolvePreview = resolve;
    });

    vi.mocked(api.previewOrganizationRosterAutomation).mockReturnValue(pendingPromise);

    renderComponent();

    expect(screen.getByText("Previewing the current roster…")).toBeInTheDocument();

    // Advance past 250ms debounce
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(api.previewOrganizationRosterAutomation).toHaveBeenCalledTimes(1);

    // Advance past the 3000ms slow threshold
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText("Still previewing the current roster…")).toBeInTheDocument();
    expect(screen.getByText("Preview is taking longer than expected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry preview" })).toBeInTheDocument();

    // Resolve promise
    act(() => {
      resolvePreview?.(samplePreview);
    });

    vi.useRealTimers();

    await waitFor(() => {
      expect(
        screen.getByText("2 Profiles affected · 2 status changes · 1 RSVP expiry"),
      ).toBeInTheDocument();
    });
  });

  it("preserves previous preview and shows refreshing indicator while reloading", async () => {
    let resolveSecond: ((preview: OrganizationRosterAutomationPreviewResponse) => void) | undefined;
    const secondPromise = new Promise<OrganizationRosterAutomationPreviewResponse>((resolve) => {
      resolveSecond = resolve;
    });

    vi.mocked(api.previewOrganizationRosterAutomation)
      .mockResolvedValueOnce(samplePreview)
      .mockReturnValueOnce(secondPromise);

    const { rerender } = renderComponent();

    await waitFor(() => {
      expect(
        screen.getByText("2 Profiles affected · 2 status changes · 1 RSVP expiry"),
      ).toBeInTheDocument();
    });

    // Change configuration to trigger reload
    const modifiedConfig: OrganizationRosterConfiguration = {
      ...sampleConfiguration,
      statusAutomationMissThreshold: 5,
    };

    const value: RosterConfigurationDraftContextValue = {
      draft: modifiedConfig,
      draftReturn: createMockDraftReturn({ dirty: true, draft: modifiedConfig }),
      error: null,
      loading: false,
      profiles: [sampleProfile],
      refreshProfiles: vi.fn(),
      setProfiles: vi.fn(),
    };

    rerender(
      <rosterConfigurationDraftContext.Provider value={value}>
        <RosterAutomationSettings enabled />
      </rosterConfigurationDraftContext.Provider>,
    );

    // Existing preview profile is preserved rather than blanked
    expect(screen.getByText(/On Break → Inactive · On Break timeout is due\./)).toBeInTheDocument();

    // Resolving second preview updates the text
    const updatedPreview: OrganizationRosterAutomationPreviewResponse = {
      ...samplePreview,
      affectedProfileCount: 0,
      statusChangeCount: 0,
      rsvpExpiryCount: 0,
    };

    act(() => {
      resolveSecond?.(updatedPreview);
    });

    await waitFor(() => {
      expect(
        screen.getByText("No existing Profiles would change under these settings."),
      ).toBeInTheDocument();
    });
  });

  it("cancels stale in-flight requests and ignores aborted promises on rapid changes", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(api.previewOrganizationRosterAutomation).mockImplementation(
      (_config, _id, signal) => {
        if (signal) signals.push(signal);
        return new Promise<OrganizationRosterAutomationPreviewResponse>(() => undefined);
      },
    );

    const { rerender } = renderComponent();

    await waitFor(() => {
      expect(signals.length).toBe(1);
    });

    expect(signals[0]?.aborted).toBe(false);

    // Trigger second config update
    const nextConfig: OrganizationRosterConfiguration = {
      ...sampleConfiguration,
      onBreakTimeoutDays: 180,
    };

    const value: RosterConfigurationDraftContextValue = {
      draft: nextConfig,
      draftReturn: createMockDraftReturn({ dirty: true, draft: nextConfig }),
      error: null,
      loading: false,
      profiles: [sampleProfile],
      refreshProfiles: vi.fn(),
      setProfiles: vi.fn(),
    };

    rerender(
      <rosterConfigurationDraftContext.Provider value={value}>
        <RosterAutomationSettings enabled />
      </rosterConfigurationDraftContext.Provider>,
    );

    // First signal was aborted
    expect(signals[0]?.aborted).toBe(true);

    await waitFor(() => {
      expect(signals.length).toBe(2);
    });
    expect(signals[1]?.aborted).toBe(false);
  });

  it("unmounts/disables cleanly without unhandled rejection or state leak", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(api.previewOrganizationRosterAutomation).mockImplementation(
      (_config, _id, signal) => {
        if (signal) signals.push(signal);
        return new Promise<OrganizationRosterAutomationPreviewResponse>(() => undefined);
      },
    );

    const { rerender } = renderComponent({}, { enabled: true });

    await waitFor(() => {
      expect(signals.length).toBe(1);
    });

    // Disable tab
    rerender(
      <rosterConfigurationDraftContext.Provider
        value={{
          draft: sampleConfiguration,
          draftReturn: createMockDraftReturn(),
          error: null,
          loading: false,
          profiles: [sampleProfile],
          refreshProfiles: vi.fn(),
          setProfiles: vi.fn(),
        }}
      >
        <RosterAutomationSettings enabled={false} />
      </rosterConfigurationDraftContext.Provider>,
    );

    expect(signals[0]?.aborted).toBe(true);
    expect(
      screen.queryByRole("region", { name: "Roster status automation" }),
    ).not.toBeInTheDocument();
  });

  it("allows toggling status automation recovery", async () => {
    const user = userEvent.setup();
    const mockSetDraft = vi.fn();
    const draftReturn = createMockDraftReturn({ setDraft: mockSetDraft });
    vi.mocked(api.previewOrganizationRosterAutomation).mockResolvedValue(samplePreview);

    renderComponent({ draftReturn });

    const checkbox = screen.getByRole("checkbox", {
      name: "Restore to Active when a future Performance RSVP is Yes",
    });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(mockSetDraft).toHaveBeenCalledWith({
      ...sampleConfiguration,
      statusAutomationRecoveryEnabled: false,
    });
  });
});
