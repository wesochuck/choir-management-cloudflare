import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OrganizationMembershipSummary,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { organizationProfileSchema } from "@choir/contracts";

import {
  AuthApiError,
  deleteOrganizationProfile,
  getOrganizationRosterConfiguration,
  listOrganizationMemberships,
  listOrganizationProfiles,
  updateOrganizationProfile,
} from "../../../auth/api";
import { RosterPage } from "./controller";

vi.mock("../../../auth/api", async () => {
  const actual = await vi.importActual("../../../auth/api");
  return {
    ...actual,
    deleteOrganizationProfile: vi.fn(),
    getOrganizationRosterConfiguration: vi.fn(),
    listOrganizationMemberships: vi.fn(),
    listOrganizationProfiles: vi.fn(),
    updateOrganizationProfile: vi.fn(),
  };
});

const mockConfiguration: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Singer",
  rehearsalAttendanceReportsEnabled: true,
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [],
};

const activeProfile = organizationProfileSchema.parse({
  createdAt: "2026-08-01T00:00:00Z",
  displayName: "Active Singer",
  doNotEmail: false,
  globalStatus: "Active",
  hidden: false,
  id: "00000000-0000-4000-8000-000000000001",
  providerEmailSuppressed: false,
  updatedAt: "2026-08-01T00:00:00Z",
  voicePart: "Soprano 1",
});

const hiddenProfile = organizationProfileSchema.parse({
  createdAt: "2026-08-01T00:00:00Z",
  displayName: "Archived Singer",
  doNotEmail: false,
  globalStatus: "Inactive",
  hidden: true,
  id: "00000000-0000-4000-8000-000000000002",
  providerEmailSuppressed: false,
  updatedAt: "2026-08-01T00:00:00Z",
  voicePart: "Alto 1",
});

const adminProfile = organizationProfileSchema.parse({
  createdAt: "2026-08-01T00:00:00Z",
  displayName: "Admin Singer",
  doNotEmail: false,
  globalStatus: "Active",
  hidden: false,
  id: "00000000-0000-4000-8000-000000000003",
  providerEmailSuppressed: false,
  updatedAt: "2026-08-01T00:00:00Z",
  voicePart: "Bass 1",
});

const mockMemberships: OrganizationMembershipSummary[] = [
  {
    email: "admin@example.test",
    id: "m-admin",
    name: "Admin Singer",
    profileId: "00000000-0000-4000-8000-000000000003",
    role: "administrator",
  },
];

describe("RosterPage Safe Profile Removal (#169)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrganizationRosterConfiguration).mockResolvedValue(mockConfiguration);
    vi.mocked(listOrganizationProfiles).mockResolvedValue([
      activeProfile,
      hiddenProfile,
      adminProfile,
    ]);
    vi.mocked(listOrganizationMemberships).mockResolvedValue({
      memberships: mockMemberships,
      requestId: "req-1",
      truncated: false,
    });
  });

  it("labels login linkage separately from a saved contact email", async () => {
    vi.mocked(listOrganizationProfiles).mockResolvedValue([
      { ...activeProfile, email: "singer@example.test" },
      adminProfile,
    ]);
    render(<RosterPage enabled />);

    const emails = await screen.findAllByRole("link", { name: "singer@example.test" });
    const row = emails.map((email) => email.closest("tr")).find(Boolean);
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("No login account");
    expect(screen.getByRole("columnheader", { name: /Login account/ })).toBeInTheDocument();
    expect(screen.getAllByText("Linked login account").length).toBeGreaterThan(0);
  });

  it("archives an active profile with confirmation modal and updates UI", async () => {
    const user = userEvent.setup();
    const updated = {
      ...activeProfile,
      globalStatus: "Inactive" as const,
      hidden: true,
      statusIsManual: true,
    };
    vi.mocked(updateOrganizationProfile).mockResolvedValue(updated);

    render(<RosterPage enabled />);

    const [menuTrigger] = await screen.findAllByRole("button", {
      name: "More actions for Active Singer",
    });
    if (!menuTrigger) throw new Error("Profile actions missing");
    await user.click(menuTrigger);
    const [archiveBtn] = await screen.findAllByRole("menuitem", { name: "Archive" });
    expect(archiveBtn).toBeInTheDocument();
    if (!archiveBtn) throw new Error("archiveBtn not found");

    await user.click(archiveBtn);

    // Modal confirmation opens
    expect(screen.getByRole("heading", { name: "Archive Active Singer?" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Archiving hides Active Singer from the active roster while preserving all historical attendance/,
      ),
    ).toBeInTheDocument();

    // Confirm archive
    const confirmBtn = screen.getByRole("button", { name: "Archive Profile" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(updateOrganizationProfile).toHaveBeenCalledWith(
        activeProfile.id,
        expect.objectContaining({
          globalStatus: "Inactive",
          hidden: true,
          statusIsManual: true,
        }),
      );
    });

    expect(await screen.findByText("Active Singer has been archived.")).toBeInTheDocument();
  });

  it("cancels archive without calling API", async () => {
    const user = userEvent.setup();
    render(<RosterPage enabled />);

    const [menuTrigger] = await screen.findAllByRole("button", {
      name: "More actions for Active Singer",
    });
    if (!menuTrigger) throw new Error("Profile actions missing");
    await user.click(menuTrigger);
    const [archiveBtn] = await screen.findAllByRole("menuitem", { name: "Archive" });
    if (!archiveBtn) throw new Error("archiveBtn not found");
    await user.click(archiveBtn);

    expect(screen.getByRole("heading", { name: "Archive Active Singer?" })).toBeInTheDocument();

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    await user.click(cancelBtn);

    expect(updateOrganizationProfile).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Archive Active Singer?" }),
    ).not.toBeInTheDocument();
  });

  it("shows Restore button for archived/hidden profiles and restores them", async () => {
    const user = userEvent.setup();
    const restored = {
      ...hiddenProfile,
      globalStatus: "Active" as const,
      hidden: false,
      statusIsManual: true,
    };
    vi.mocked(updateOrganizationProfile).mockResolvedValue(restored);

    render(<RosterPage enabled />);

    // Include off-roster profiles checkbox
    const showHiddenCheckbox = await screen.findByLabelText("Include off-roster profiles");
    await user.click(showHiddenCheckbox);

    const [menuTrigger] = await screen.findAllByRole("button", {
      name: "More actions for Archived Singer",
    });
    if (!menuTrigger) throw new Error("Profile actions missing");
    await user.click(menuTrigger);
    const [restoreBtn] = await screen.findAllByRole("menuitem", { name: "Restore" });
    expect(restoreBtn).toBeInTheDocument();
    if (!restoreBtn) throw new Error("restoreBtn not found");

    await user.click(restoreBtn);

    await waitFor(() => {
      expect(updateOrganizationProfile).toHaveBeenCalledWith(
        hiddenProfile.id,
        expect.objectContaining({
          globalStatus: "Active",
          hidden: false,
          statusIsManual: true,
        }),
      );
    });

    expect(await screen.findByText("Archived Singer has been restored.")).toBeInTheDocument();
  });

  it("does not offer Delete or Impersonate for administrator profiles", async () => {
    render(<RosterPage enabled />);

    await screen.findByRole("heading", { name: "Profiles" });

    const user = userEvent.setup();
    const [trigger] = screen.getAllByRole("button", { name: "More actions for Admin Singer" });
    if (!trigger) throw new Error("Admin actions missing");
    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Impersonate" })).not.toBeInTheDocument();
  });

  it("permanently deletes an unreferenced profile with confirmation modal", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteOrganizationProfile).mockResolvedValue({
      deleted: true,
      profileId: activeProfile.id,
      requestId: "req-del-1",
    });

    render(<RosterPage enabled />);

    const [menuTrigger] = await screen.findAllByRole("button", {
      name: "More actions for Active Singer",
    });
    if (!menuTrigger) throw new Error("Profile actions missing");
    await user.click(menuTrigger);
    const [deleteBtn] = await screen.findAllByRole("menuitem", { name: "Delete" });
    expect(deleteBtn).toBeInTheDocument();
    if (!deleteBtn) throw new Error("deleteBtn not found");

    await user.click(deleteBtn);

    expect(
      screen.getByRole("heading", { name: "Permanently delete Active Singer?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Are you sure you want to permanently delete Active Singer\? This cannot be undone/,
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByText(/Remove the roster profile and unlink its Contacts/),
    ).toBeInTheDocument();

    const confirmDeleteBtn = screen.getByRole("button", { name: "Delete permanently" });
    await user.click(confirmDeleteBtn);

    await waitFor(() => {
      expect(deleteOrganizationProfile).toHaveBeenCalledWith(activeProfile.id, {
        contacts: "keep",
      });
    });

    expect(
      await screen.findByText("Active Singer has been permanently deleted."),
    ).toBeInTheDocument();
  });

  it("lets managers explicitly delete unused Contacts and resets to Keep Contacts after cancel", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteOrganizationProfile).mockResolvedValue({
      deleted: true,
      profileId: activeProfile.id,
      requestId: "req-delete-contacts",
    });
    render(<RosterPage enabled />);
    const [menuTrigger] = await screen.findAllByRole("button", {
      name: "More actions for Active Singer",
    });
    if (!menuTrigger) throw new Error("Profile actions missing");
    await user.click(menuTrigger);
    const buttons = await screen.findAllByRole("menuitem", { name: "Delete" });
    const button = buttons[0];
    if (!button) throw new Error("Missing delete action");
    await user.click(button);
    expect(screen.getByRole("radio", { name: "Keep Contacts" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Delete unused roster-email Contacts" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteOrganizationProfile).not.toHaveBeenCalled();
    await user.click(menuTrigger);
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("radio", { name: "Keep Contacts" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Delete unused roster-email Contacts" }));
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => {
      expect(deleteOrganizationProfile).toHaveBeenCalledWith(activeProfile.id, {
        contacts: "delete_unused",
      });
    });
  });

  it("displays error message if deletion is rejected due to historical dependencies", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteOrganizationProfile).mockRejectedValue(
      new AuthApiError(
        "This profile can't be permanently deleted. It has attendance or RSVP history that must be preserved. Archive Profile instead to remove it from the active roster while retaining its history. You can restore it later.",
        409,
        "profile_event_history_requires_inactive",
      ),
    );

    render(<RosterPage enabled />);

    const [menuTrigger] = await screen.findAllByRole("button", {
      name: "More actions for Active Singer",
    });
    if (!menuTrigger) throw new Error("Profile actions missing");
    await user.click(menuTrigger);
    const [deleteBtn] = await screen.findAllByRole("menuitem", { name: "Delete" });
    if (!deleteBtn) throw new Error("deleteBtn not found");
    await user.click(deleteBtn);

    const confirmDeleteBtn = screen.getByRole("button", { name: "Delete permanently" });
    await user.click(confirmDeleteBtn);

    expect(
      await screen.findByText(
        "This profile can't be permanently deleted. It has attendance or RSVP history that must be preserved. Archive Profile instead to remove it from the active roster while retaining its history. You can restore it later.",
      ),
    ).toBeInTheDocument();
  });
});
