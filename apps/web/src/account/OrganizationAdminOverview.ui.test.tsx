import type { ModuleState, OrganizationAuthStatusResponse } from "@choir/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrganizationDashboardSummary, listOrganizationAuditions } from "../auth/api";
import { OrganizationAdminOverview } from "./OrganizationAdminOverview";
import { organizationTerminologyContext } from "./organizationTerminologyContext";

vi.mock("../auth/api", () => ({
  getOrganizationDashboardSummary: vi.fn(),
  listOrganizationAuditions: vi.fn(),
}));

const allModulesEnabled: readonly ModuleState[] = [
  { enabled: true, id: "people" },
  { enabled: true, id: "events" },
  { enabled: true, id: "programs" },
];

describe("OrganizationAdminOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrganizationDashboardSummary).mockResolvedValue({
      activeProfileCount: 88,
      doNotEmailCount: 1,
      nextEvents: [],
      recentBounceCount: 0,
      requestId: "req-summary-1",
      upcomingEventCount: 8,
    });
    vi.mocked(listOrganizationAuditions).mockResolvedValue([
      {
        createdAt: "2026-10-01T00:00:00Z",
        email: "singer@example.com",
        id: "aud-1",
        name: "Test Singer",
        phone: "555-0100",
        requestedSlots: [],
        slots: [],
        status: "pending",
        updatedAt: "2026-10-01T00:00:00Z",
      },
      {
        createdAt: "2026-10-01T00:00:00Z",
        email: "singer2@example.com",
        id: "aud-2",
        name: "Scheduled Singer",
        phone: "555-0101",
        requestedSlots: [],
        slots: [],
        status: "scheduled",
        updatedAt: "2026-10-01T00:00:00Z",
      },
    ]);
  });

  it("renders approved 3-column overview without redundant 'Ready when you are.' heading", async () => {
    const onOpenPalette = vi.fn();
    const navigate = vi.fn();

    render(
      <OrganizationAdminOverview
        context={null}
        displayName="Wes Osborn"
        modules={allModulesEnabled}
        navigate={navigate}
        onOpenCommandPalette={onOpenPalette}
      />,
    );

    // Greeting is present
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Good (morning|afternoon|evening), Wes Osborn/,
      }),
    ).toBeVisible();

    // Redundant "Ready when you are." heading is NOT rendered
    expect(screen.queryByRole("heading", { name: "Ready when you are." })).not.toBeInTheDocument();

    // Search trigger is rendered with search placeholder and shortcut
    const searchButton = screen.getByRole("button", { name: "Open command palette" });
    expect(searchButton).toBeVisible();
    expect(searchButton).toHaveTextContent("Search pages, tools, and features...");

    // Clicking search opens command palette
    fireEvent.click(searchButton);
    expect(onOpenPalette).toHaveBeenCalledTimes(1);

    // KPI values are displayed after API resolution
    expect(await screen.findByText("88")).toBeVisible();
    expect(screen.getByText("Active Performers")).toBeVisible();
    expect(screen.getByText("8")).toBeVisible();
    expect(screen.getByText("Upcoming Events")).toBeVisible();
    const inquiriesKpi = screen.getByRole("link", { name: /Pending Inquiries/i });
    expect(within(inquiriesKpi).getByText("1")).toBeVisible();

    // KPI links navigate correctly
    const activeKpi = screen.getByRole("link", { name: /88\s*Active Performers/i });
    expect(activeKpi).toHaveAttribute("href", "/admin/roster");
    fireEvent.click(activeKpi);
    expect(navigate).toHaveBeenCalledWith("/admin/roster");

    // Quick actions are rendered and navigable
    expect(screen.getByText("Quick actions")).toBeVisible();
    const takeAttendanceAction = screen.getByRole("link", { name: "Take Attendance" });
    expect(takeAttendanceAction).toHaveAttribute("href", "/admin/attendance");
    fireEvent.click(takeAttendanceAction);
    expect(navigate).toHaveBeenCalledWith("/admin/attendance");

    // All 4 sections rendered with tool counts and section notes
    expect(screen.getByRole("heading", { level: 2, name: /People & membership/i })).toBeVisible();
    expect(screen.getByText("Profiles, communications, and supporter relationships")).toBeVisible();
    expect(screen.getByText("7 tools")).toBeVisible();

    expect(screen.getByRole("heading", { level: 2, name: /Events & attendance/i })).toBeVisible();
    expect(
      screen.getByText("Plan performances, manage ticketing, and check in members"),
    ).toBeVisible();
    expect(screen.getByText("6 tools")).toBeVisible();

    expect(screen.getByRole("heading", { level: 2, name: /Music & performance/i })).toBeVisible();
    expect(screen.getByText("Scores, programs, and materials for performers")).toBeVisible();
    expect(screen.getByText("3 tools")).toBeVisible();

    expect(screen.getByRole("heading", { level: 2, name: /Admin/i })).toBeVisible();
    expect(screen.getByText("System configuration, website, and global preferences")).toBeVisible();
    expect(screen.getByText("2 tools")).toBeVisible();

    // Full card link navigation
    const rosterCard = screen.getByRole("link", { name: /Manage Roster/i });
    expect(rosterCard).toHaveAttribute("href", "/admin/roster");
    expect(within(rosterCard).getByText("Manage Roster")).toBeVisible();
    expect(within(rosterCard).getByText("Add performers and track status")).toBeVisible();
    fireEvent.click(rosterCard);
    expect(navigate).toHaveBeenCalledWith("/admin/roster");
  });

  it("dynamically adapts to organization terminology", async () => {
    render(
      <organizationTerminologyContext.Provider
        value={{
          partLabel: "Voice",
          partLabelPlural: "Voices",
          performerLabel: "Chorister",
          performerLabelPlural: "Choristers",
          setPerformerLabel: () => undefined,
        }}
      >
        <OrganizationAdminOverview
          context={null}
          displayName="Director"
          modules={allModulesEnabled}
          navigate={vi.fn()}
        />
      </organizationTerminologyContext.Provider>,
    );

    // Metric reflects custom terminology
    expect(await screen.findByText("Active Choristers")).toBeVisible();

    // Quick action reflects custom terminology
    expect(screen.getByRole("link", { name: "Add Chorister" })).toBeVisible();

    // Cards reflect custom terminology
    expect(screen.getByRole("link", { name: /Chorister Directory/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /Chorister Resources/i })).toBeVisible();
    expect(screen.getByText("Add choristers and track status")).toBeVisible();
  });

  it("filters cards and metrics when modules are disabled", async () => {
    const modules: readonly ModuleState[] = [
      { enabled: true, id: "people" },
      { enabled: false, id: "events" },
      { enabled: false, id: "programs" },
    ];

    render(
      <OrganizationAdminOverview
        context={null}
        displayName="Admin"
        modules={modules}
        navigate={vi.fn()}
      />,
    );

    // People metrics visible
    expect(await screen.findByText("Active Performers")).toBeVisible();
    // Events metric excluded
    expect(screen.queryByText("Upcoming Events")).not.toBeInTheDocument();

    // Events and Music sections hidden because all their cards are disabled
    expect(screen.queryByRole("heading", { name: /Events & attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Music & performance/i })).not.toBeInTheDocument();

    // Programs quick actions excluded
    expect(screen.queryByRole("link", { name: "Send Announcement" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add Music" })).not.toBeInTheDocument();

    // People quick actions present
    expect(screen.getByRole("link", { name: "Add Performer" })).toBeVisible();
  });

  it("renders onboarding GettingStartedGuide when setup is pending", async () => {
    const emptyModules: readonly ModuleState[] = [
      { enabled: false, id: "people" },
      { enabled: false, id: "events" },
      { enabled: false, id: "programs" },
    ];

    render(
      <OrganizationAdminOverview
        context={null}
        displayName="New Org Admin"
        modules={emptyModules}
        navigate={vi.fn()}
      />,
    );

    // Shows onboarding welcome banner text
    expect(await screen.findByText(/Welcome to your organization workspace/i)).toBeVisible();

    // Getting started guide is rendered
    expect(
      screen.getByRole("heading", { level: 2, name: "Next steps for your organization" }),
    ).toBeVisible();
    expect(screen.getByText("Configure Modules")).toBeVisible();
    expect(screen.getByText("Complete Setup Checklist")).toBeVisible();
    expect(screen.getByText("System Settings & Terminology")).toBeVisible();
    expect(screen.getByText("Add Performers & Music")).toBeVisible();
  });

  it("displays error status banner when summary fails to load", async () => {
    vi.mocked(getOrganizationDashboardSummary).mockRejectedValue(new Error("Network failed"));

    render(
      <OrganizationAdminOverview
        context={null}
        displayName="Admin"
        modules={allModulesEnabled}
        navigate={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/Organization summary is temporarily unavailable/i),
    ).toBeVisible();
  });

  it("renders OrganizationMfaPrompt when MFA is required and unsatisfied", async () => {
    const mfaContext: OrganizationAuthStatusResponse = {
      mfaRequired: true,
      mfaSatisfied: false,
      mfaSatisfiedBy: null,
      mfaVerifiedUntil: null,
      organizationId: "11111111-1111-4111-8111-111111111111",
      requestId: "22222222-2222-4222-8222-222222222222",
      role: "administrator",
      twoFactorEnabled: false,
      twoFactorVerified: false,
    };
    render(
      <OrganizationAdminOverview
        context={mfaContext}
        displayName="Admin"
        modules={allModulesEnabled}
        navigate={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(
        "Organization MFA is required before operational data can be opened.",
      ),
    ).toBeVisible();
    // Await KPI resolution so pending promises do not log unhandled act updates
    await screen.findByText("88");
  });
});
