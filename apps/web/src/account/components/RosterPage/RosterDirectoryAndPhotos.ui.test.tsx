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

const listedProfile = organizationProfileSchema.parse({
  createdAt: "2026-08-01T00:00:00Z",
  displayName: "Alice Listed",
  doNotEmail: false,
  globalStatus: "Active",
  hidden: false,
  id: "00000000-0000-4000-8000-000000000010",
  photoFileId: "00000000-0000-4000-8000-000000000099",
  providerEmailSuppressed: false,
  showInDirectory: true,
  updatedAt: "2026-08-01T00:00:00Z",
  voicePart: "Soprano 1",
});

const unlistedProfile = organizationProfileSchema.parse({
  createdAt: "2026-08-01T00:00:00Z",
  displayName: "Bob Unlisted",
  doNotEmail: false,
  globalStatus: "Active",
  hidden: false,
  id: "00000000-0000-4000-8000-000000000011",
  providerEmailSuppressed: false,
  showInDirectory: false,
  updatedAt: "2026-08-01T00:00:00Z",
  voicePart: "Bass 1",
});

const offRosterProfile = organizationProfileSchema.parse({
  createdAt: "2026-08-01T00:00:00Z",
  displayName: "Charlie Hidden",
  doNotEmail: false,
  globalStatus: "Active",
  hidden: true,
  id: "00000000-0000-4000-8000-000000000012",
  providerEmailSuppressed: false,
  showInDirectory: true,
  updatedAt: "2026-08-01T00:00:00Z",
  voicePart: "Tenor 1",
});

const mockMemberships: OrganizationMembershipSummary[] = [];

describe("Roster Directory Clarification and Compact Photos (#240)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrganizationRosterConfiguration).mockResolvedValue(mockConfiguration);
    vi.mocked(listOrganizationMemberships).mockResolvedValue({
      memberships: mockMemberships,
      requestId: "req-1",
      truncated: false,
    });
    vi.mocked(listOrganizationProfiles).mockResolvedValue([
      listedProfile,
      unlistedProfile,
      offRosterProfile,
    ]);
  });

  it("renders compact avatar button and opens photo viewer dialog on click", async () => {
    const user = userEvent.setup();
    render(<RosterPage enabled />);

    const [photoBtn] = await screen.findAllByRole("button", {
      name: "View larger photo of Alice Listed",
    });
    expect(photoBtn).toBeInTheDocument();
    if (!photoBtn) throw new Error("photoBtn not found");

    await user.click(photoBtn);

    const dialog = await screen.findByRole("dialog", {
      name: "Alice Listed's photo",
    });
    expect(dialog).toBeInTheDocument();

    const fullImg = screen.getByAltText("Photo of Alice Listed");
    expect(fullImg).toHaveAttribute(
      "src",
      "/api/organization/files/00000000-0000-4000-8000-000000000099",
    );

    const [closeBtn] = screen.getAllByRole("button", { name: "Close" });
    if (!closeBtn) throw new Error("closeBtn not found");
    await user.click(closeBtn);

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Profile photo: Alice Listed" }),
      ).not.toBeInTheDocument();
    });
  });

  it("displays effective Directory listing status in the table", async () => {
    render(<RosterPage enabled />);

    // Alice is Listed
    const [alice] = await screen.findAllByText("Alice Listed");
    expect(alice).toBeInTheDocument();
    const [listedPill] = screen.getAllByText("Listed");
    expect(listedPill).toBeInTheDocument();

    // Bob opted out
    const [bob] = screen.getAllByText("Bob Unlisted");
    expect(bob).toBeInTheDocument();
    const [notListedPill] = screen.getAllByTitle("Not listed: directory preference off");
    expect(notListedPill).toBeInTheDocument();
    expect(notListedPill).toHaveTextContent("Not listed");
  });

  it("allows returning an off-roster profile to the roster with Return to roster action", async () => {
    const user = userEvent.setup();
    const returnedProfile = { ...offRosterProfile, hidden: false };
    vi.mocked(updateOrganizationProfile).mockResolvedValue(returnedProfile);

    render(<RosterPage enabled />);

    // Check "Include off-roster profiles"
    const offRosterCheckbox = await screen.findByLabelText("Include off-roster profiles");
    await user.click(offRosterCheckbox);

    // Charlie should be visible with "Off roster" badge
    const [charlie] = await screen.findAllByText("Charlie Hidden");
    expect(charlie).toBeInTheDocument();
    const [offRosterBadge] = screen.getAllByText("Off roster");
    expect(offRosterBadge).toBeInTheDocument();
    const [offRosterListing] = screen.getAllByTitle("Not listed: off roster");
    expect(offRosterListing).toBeInTheDocument();
    expect(offRosterListing).toHaveTextContent("Not listed");

    const [menuTrigger] = screen.getAllByRole("button", {
      name: "More actions for Charlie Hidden",
    });
    if (!menuTrigger) throw new Error("Profile actions missing");
    await user.click(menuTrigger);
    const [returnBtn] = screen.getAllByRole("menuitem", {
      name: "Return to roster",
    });
    expect(returnBtn).toBeInTheDocument();
    if (!returnBtn) throw new Error("returnBtn not found");

    await user.click(returnBtn);

    await waitFor(() => {
      expect(updateOrganizationProfile).toHaveBeenCalledWith(
        offRosterProfile.id,
        expect.objectContaining({
          hidden: false,
        }),
      );
    });

    expect(
      await screen.findByText("Charlie Hidden has been returned to the roster."),
    ).toBeInTheDocument();
  });
});
