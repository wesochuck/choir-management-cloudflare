import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OrganizationMembershipSummary,
  OrganizationProfile,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { organizationProfileSchema } from "@choir/contracts";

import {
  getOrganizationRosterConfiguration,
  listOrganizationMemberships,
  listOrganizationProfiles,
} from "../../../auth/api";
import { RosterPage } from "./controller";

vi.mock("../../../auth/api", async () => {
  const actual = await vi.importActual("../../../auth/api");
  return {
    ...actual,
    getOrganizationRosterConfiguration: vi.fn(),
    listOrganizationMemberships: vi.fn(),
    listOrganizationProfiles: vi.fn(),
  };
});

const mockConfiguration: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Singer",
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [],
};

const mockProfiles: OrganizationProfile[] = [
  organizationProfileSchema.parse({
    createdAt: "2026-08-01T00:00:00Z",
    displayName: "Alice Singer",
    doNotEmail: false,
    globalStatus: "Active",
    id: "00000000-0000-4000-8000-000000000001",
    providerEmailSuppressed: false,
    updatedAt: "2026-08-01T00:00:00Z",
    voicePart: "Soprano 1",
  }),
  organizationProfileSchema.parse({
    bounceReason: "Mailbox full",
    createdAt: "2026-08-01T00:00:00Z",
    displayName: "Bob Singer",
    doNotEmail: true,
    globalStatus: "Active",
    id: "00000000-0000-4000-8000-000000000002",
    providerEmailSuppressed: false,
    updatedAt: "2026-08-01T00:00:00Z",
    voicePart: "Tenor 1",
  }),
  organizationProfileSchema.parse({
    createdAt: "2026-08-01T00:00:00Z",
    displayName: "Charlie Singer",
    doNotEmail: false,
    globalStatus: "Active",
    id: "00000000-0000-4000-8000-000000000003",
    providerEmailSuppressed: true,
    updatedAt: "2026-08-01T00:00:00Z",
    voicePart: "Bass 1",
  }),
];

const mockMemberships: OrganizationMembershipSummary[] = [
  {
    email: "alice@example.test",
    id: "m-1",
    name: "Alice Singer",
    profileId: "00000000-0000-4000-8000-000000000001",
    role: "member",
  },
];

describe("RosterPage Email & Delivery Status table headers (#175)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrganizationRosterConfiguration).mockResolvedValue(mockConfiguration);
    vi.mocked(listOrganizationProfiles).mockResolvedValue(mockProfiles);
    vi.mocked(listOrganizationMemberships).mockResolvedValue({
      memberships: mockMemberships,
      requestId: "req-1",
      truncated: false,
    });
  });

  it("renders distinct sortable headers for Email address and Delivery status", async () => {
    render(<RosterPage enabled />);

    // Wait for table to load
    const emailHeader = await screen.findByRole("button", { name: "Sort by Email address" });
    const deliveryHeader = screen.getByRole("button", { name: "Sort by Delivery status" });

    expect(emailHeader).toBeInTheDocument();
    expect(deliveryHeader).toBeInTheDocument();

    // Verify there are no duplicate generic "Sort by Email" buttons
    expect(screen.queryByRole("button", { name: "Sort by Email" })).not.toBeInTheDocument();
  });

  it("renders accessible status pill text for Allowed, Blocked, and Suppressed", async () => {
    render(<RosterPage enabled />);

    const allowedElements = await screen.findAllByText("Allowed");
    expect(allowedElements.length).toBeGreaterThan(0);

    const blockedElements = screen.getAllByText("Blocked");
    expect(blockedElements.length).toBeGreaterThan(0);

    const suppressedElements = screen.getAllByText("Suppressed");
    expect(suppressedElements.length).toBeGreaterThan(0);
  });
});
