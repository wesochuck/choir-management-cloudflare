import { moduleIdSchema } from "@choir/contracts";
import type { ModuleState, OrganizationAuthStatusResponse } from "@choir/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrganizationDashboardSummary, listOrganizationAuditions } from "../auth/api";
import { OrganizationAdminOverview } from "./OrganizationAdminOverview";
import { organizationTerminologyContext } from "./organizationTerminologyContext";

vi.mock("../auth/api", () => ({
  getOrganizationDashboardSummary: vi.fn(),
  listOrganizationAuditions: vi.fn(),
}));

const allModulesEnabled: readonly ModuleState[] = moduleIdSchema.options.map((id) => ({
  id,
  enabled: true,
}));

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

    // Shared semantic groups and full inventory, with exact visible card counts.
    for (const [name, count] of [
      ["People & membership", 5],
      ["Events & attendance", 5],
      ["Music & content", 4],
      ["Communications & finance", 6],
      ["Insights & settings", 2],
    ] as const) {
      const region = screen.getByRole("region", { name });
      expect(within(region).getAllByRole("link")).toHaveLength(count);
      expect(within(region).getByText(`${String(count)} tools`)).toBeVisible();
    }
    // Full card link navigation
    const rosterCard = screen.getByRole("link", { name: /Manage Roster/i });
    expect(rosterCard).toHaveAttribute("href", "/admin/roster");
    expect(within(rosterCard).getByText("Manage Roster")).toBeVisible();
    expect(within(rosterCard).getByText("Add performers and track status")).toBeVisible();
    fireEvent.click(rosterCard);
    expect(navigate).toHaveBeenCalledWith("/admin/roster");
  });

  it("renders long display names without dropping metrics", async () => {
    render(
      <OrganizationAdminOverview
        context={null}
        displayName="Alexandria Constantopoulos Papadopoulos-Smith"
        modules={allModulesEnabled}
        navigate={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Alexandria Constantopoulos Papadopoulos-Smith/,
      }),
    ).toBeVisible();
    expect(await screen.findByText("88")).toBeVisible();
    expect(screen.getByText("Active Performers")).toBeVisible();
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
    const modules = allModulesEnabled.map((module) => ({
      ...module,
      enabled: ["roster", "directory", "auditions"].includes(module.id),
    }));

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
    expect(screen.queryByRole("heading", { name: /Music & content/i })).not.toBeInTheDocument();

    // Programs quick actions excluded
    expect(screen.queryByRole("link", { name: "Send Announcement" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add Music" })).not.toBeInTheDocument();

    // People quick actions present
    expect(screen.getByRole("link", { name: "Add Performer" })).toBeVisible();
  });

  it.each([
    ["roster", "/admin/roster"],
    ["directory", "/directory"],
    ["auditions", "/admin/auditions"],
    ["communications", "/admin/communications"],
    ["polls", "/admin/polls"],
    ["donations", "/admin/donations"],
    ["events", "/admin/events"],
    ["ticketing", "/admin/tickets"],
    ["rsvp", "/admin/rsvp"],
    ["attendance", "/admin/attendance"],
    ["venues", "/admin/venues"],
    ["seating", "/admin/seating"],
    ["music_library", "/admin/library"],
    ["setlists", "/admin/setlists"],
    ["resources", "/admin/resources"],
    ["public_website", "/admin/website"],
  ])("hides every %s shortcut and restores it when enabled", async (moduleId, path) => {
    const modules = allModulesEnabled.map((module) => ({
      ...module,
      enabled: module.id !== moduleId,
    }));
    const props = { context: null, displayName: "Admin", navigate: vi.fn() };
    const { rerender } = render(<OrganizationAdminOverview {...props} modules={modules} />);
    await screen.findByText(moduleId === "roster" ? "8" : "88");
    const linksForPath = () =>
      screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("href")?.split("?")[0] === path);
    expect(linksForPath()).toHaveLength(0);
    expect(screen.getByRole("link", { name: /Organization Settings/ })).toBeVisible();
    if (moduleId === "auditions") {
      expect(listOrganizationAuditions).not.toHaveBeenCalled();
      expect(screen.queryByText("Pending Inquiries")).not.toBeInTheDocument();
    }
    rerender(<OrganizationAdminOverview {...props} modules={allModulesEnabled} />);
    await waitFor(() => {
      expect(linksForPath().length).toBeGreaterThan(0);
    });
    if (moduleId === "auditions") await screen.findByText("Pending Inquiries");
  });

  it("keeps independent modules available and updates visible tool counts", async () => {
    const disabled = new Set([
      "auditions",
      "directory",
      "communications",
      "polls",
      "donations",
      "ticketing",
      "attendance",
      "resources",
      "public_website",
    ]);
    render(
      <OrganizationAdminOverview
        context={null}
        displayName="Admin"
        modules={allModulesEnabled.map((module) => ({
          ...module,
          enabled: !disabled.has(module.id),
        }))}
        navigate={vi.fn()}
      />,
    );
    await screen.findByText("88");
    const people = screen.getByRole("region", { name: "People & membership" });
    expect(within(people).getAllByRole("link")).toHaveLength(3);
    expect(within(people).getByText("3 tools")).toBeVisible();
    expect(within(people).getByRole("link", { name: /Manage Roster/ })).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Events & attendance" })).getByText("4 tools"),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Music & content" })).getByText("2 tools"),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "New Event" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Send Announcement" })).not.toBeInTheDocument();
  });

  it("renders onboarding GettingStartedGuide when setup is pending", async () => {
    const emptyModules = allModulesEnabled.map((module) => ({ ...module, enabled: false }));

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
    expect(screen.queryByRole("link", { name: /Manage performers/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Organization at a glance" }),
    ).not.toBeInTheDocument();
    expect(listOrganizationAuditions).not.toHaveBeenCalled();
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
