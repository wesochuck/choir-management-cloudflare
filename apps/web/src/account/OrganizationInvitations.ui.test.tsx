import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  CurrentAuthSession,
  OrganizationAuthStatusResponse,
  OrganizationInvitationSummary,
  OrganizationMembershipSummary,
  OrganizationProfile,
} from "@choir/contracts";
import { organizationProfileSchema } from "@choir/contracts";
import { OrganizationInvitations } from "./OrganizationInvitations";

vi.mock("../auth/api", () => {
  class MockAuthApiError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(message: string, status = 400, code = "error") {
      super(message);
      this.name = "AuthApiError";
      this.status = status;
      this.code = code;
    }
  }
  return {
    AuthApiError: MockAuthApiError,
    cancelOrganizationInvitation: vi.fn(),
    createOrganizationInvitation: vi.fn(),
    getCurrentSession: vi.fn(),
    linkOrganizationMembershipProfile: vi.fn(),
    listOrganizationInvitations: vi.fn(),
    listOrganizationMemberships: vi.fn(),
    listOrganizationProfiles: vi.fn(),
    updateOrganizationMemberRole: vi.fn(),
  };
});

import {
  AuthApiError,
  getCurrentSession,
  listOrganizationInvitations,
  listOrganizationMemberships,
  listOrganizationProfiles,
  updateOrganizationMemberRole,
} from "../auth/api";

const MOCK_INVITATIONS: OrganizationInvitationSummary[] = [];

const MOCK_PROFILES: OrganizationProfile[] = [
  organizationProfileSchema.parse({
    createdAt: new Date().toISOString(),
    displayName: "Alice Smith",
    id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    updatedAt: new Date().toISOString(),
  }),
];

const MOCK_MEMBERSHIPS: OrganizationMembershipSummary[] = [
  {
    email: "alice@example.com",
    id: "mem-alice",
    name: "Alice Smith",
    profileId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    role: "member",
    userId: "user-alice",
  },
  {
    email: "bob-admin@example.com",
    id: "mem-bob",
    name: "Bob Admin",
    profileId: null,
    role: "administrator",
    userId: "user-bob",
  },
  {
    email: "owner@example.com",
    id: "mem-owner",
    name: "Owner User",
    profileId: null,
    role: "owner",
    userId: "user-owner",
  },
];

const MOCK_SESSION_OWNER: CurrentAuthSession = {
  session: {
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    id: "session-1",
    updatedAt: new Date().toISOString(),
    userId: "user-owner",
  },
  user: {
    createdAt: new Date().toISOString(),
    email: "owner@example.com",
    emailVerified: true,
    id: "user-owner",
    name: "Owner User",
    twoFactorEnabled: true,
    updatedAt: new Date().toISOString(),
  },
};

const OWNER_CONTEXT: OrganizationAuthStatusResponse = {
  mfaRequired: false,
  mfaSatisfied: true,
  mfaSatisfiedBy: null,
  mfaVerifiedUntil: null,
  organizationId: "org-1",
  requestId: "req-1",
  role: "owner",
  twoFactorEnabled: true,
  twoFactorVerified: true,
};

const ADMIN_CONTEXT: OrganizationAuthStatusResponse = {
  mfaRequired: false,
  mfaSatisfied: true,
  mfaSatisfiedBy: null,
  mfaVerifiedUntil: null,
  organizationId: "org-1",
  requestId: "req-1",
  role: "administrator",
  twoFactorEnabled: true,
  twoFactorVerified: true,
};

describe("OrganizationInvitations membership role management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listOrganizationInvitations).mockResolvedValue({
      invitations: MOCK_INVITATIONS,
      requestId: "req-1",
      truncated: false,
    });
    vi.mocked(listOrganizationMemberships).mockResolvedValue({
      memberships: MOCK_MEMBERSHIPS,
      requestId: "req-1",
      truncated: false,
    });
    vi.mocked(listOrganizationProfiles).mockResolvedValue(MOCK_PROFILES);
    vi.mocked(getCurrentSession).mockResolvedValue(MOCK_SESSION_OWNER);
  });

  it("renders Organization Memberships section with role labels and Change role buttons", async () => {
    render(<OrganizationInvitations context={OWNER_CONTEXT} />);

    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Organization Memberships" })).toBeInTheDocument();
    });

    const membershipsGroup = screen.getByRole("group", { name: "Organization Memberships" });

    expect(
      within(membershipsGroup).getByRole("heading", { level: 4, name: "Alice Smith" }),
    ).toBeInTheDocument();
    expect(
      within(membershipsGroup).getByRole("heading", { level: 4, name: "Bob Admin" }),
    ).toBeInTheDocument();
    expect(
      within(membershipsGroup).getByRole("heading", { level: 4, name: "Owner User" }),
    ).toBeInTheDocument();

    expect(within(membershipsGroup).getByText("Organization Member")).toBeInTheDocument();
    expect(within(membershipsGroup).getByText("Organization Administrator")).toBeInTheDocument();
    expect(within(membershipsGroup).getByText("Organization Owner")).toBeInTheDocument();

    const changeRoleButtons = screen.getAllByRole("button", { name: /Change role/i });
    expect(changeRoleButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("opens dialog, allows selecting new role, displays owner promotion notice, and saves role", async () => {
    const user = userEvent.setup();
    vi.mocked(updateOrganizationMemberRole).mockResolvedValue({
      membershipId: "mem-alice",
      organizationId: "org-1",
      previousRole: "member",
      requestId: "req-update",
      role: "owner",
    });

    render(<OrganizationInvitations context={OWNER_CONTEXT} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Change role for Alice Smith" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Change role for Alice Smith" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Change member role")).toBeInTheDocument();

    const roleSelect = within(dialog).getByLabelText("Organization role");
    expect(roleSelect).toHaveValue("member");

    // Select "owner"
    await user.selectOptions(roleSelect, "owner");
    expect(
      within(dialog).getByText(/Promoting to Organization Owner grants full management access/i),
    ).toBeInTheDocument();

    // Click Save role
    const saveButton = within(dialog).getByRole("button", { name: "Save role" });
    await user.click(saveButton);

    expect(updateOrganizationMemberRole).toHaveBeenCalledWith("mem-alice", "owner", "member");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(
      screen.getByText("Role updated to Organization Owner for Alice Smith."),
    ).toBeInTheDocument();
  });

  it("preserves draft on error and displays error alert", async () => {
    const user = userEvent.setup();
    vi.mocked(updateOrganizationMemberRole).mockRejectedValue(
      new AuthApiError("Failed to update role. Please try again.", 400, "bad_request"),
    );

    render(<OrganizationInvitations context={OWNER_CONTEXT} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Change role for Alice Smith" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Change role for Alice Smith" }));
    const dialog = screen.getByRole("dialog");
    const roleSelect = within(dialog).getByLabelText("Organization role");

    await user.selectOptions(roleSelect, "administrator");
    await user.click(within(dialog).getByRole("button", { name: "Save role" }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Failed to update role. Please try again.",
      );
    });

    // Draft is preserved
    expect(roleSelect).toHaveValue("administrator");
  });

  it("administrator cannot change their own role or owner role", async () => {
    const mockSessionAdmin: CurrentAuthSession = {
      session: {
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        id: "session-2",
        updatedAt: new Date().toISOString(),
        userId: "user-bob",
      },
      user: {
        createdAt: new Date().toISOString(),
        email: "bob-admin@example.com",
        emailVerified: true,
        id: "user-bob",
        name: "Bob Admin",
        twoFactorEnabled: true,
        updatedAt: new Date().toISOString(),
      },
    };
    vi.mocked(getCurrentSession).mockResolvedValue(mockSessionAdmin);

    render(<OrganizationInvitations context={ADMIN_CONTEXT} />);

    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Organization Memberships" })).toBeInTheDocument();
    });

    // Admin can change Alice's role (member)
    expect(screen.getByRole("button", { name: "Change role for Alice Smith" })).toBeInTheDocument();

    // Admin cannot change their own role (Bob Admin)
    expect(
      screen.queryByRole("button", { name: "Change role for Bob Admin" }),
    ).not.toBeInTheDocument();

    // Admin cannot change Owner User's role
    expect(
      screen.queryByRole("button", { name: "Change role for Owner User" }),
    ).not.toBeInTheDocument();
  });
});
