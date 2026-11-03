import type {
  OrganizationEvent,
  OrganizationRosterConfiguration,
  OrganizationVenue,
} from "@choir/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import {
  getOrganizationRosterConfiguration,
  listOrganizationContactLists,
  listOrganizationEventAttendance,
  listOrganizationProfiles,
  previewOrganizationCommunicationReach,
} from "../../../../api";
import {
  createOrganizationVenue,
  getOrganizationBranding,
  getOrganizationProviderStatus,
  listOrganizationCommunicationTemplates,
  listOrganizationEventPromotionMessages,
  listOrganizationVenues,
} from "../../../../auth/api";
import type { EventsState } from "../types";

export const readyState: Extract<EventsState, { status: "ready" }> = {
  events: [],
  rsvpExpiryEnabled: false,
  rsvpFollowUpEnabled: false,
  rsvpFollowUpLeadHours: 48,
  status: "ready",
  timezone: "America/New_York",
  venues: [],
};

export const venueHall: OrganizationVenue = {
  address: "123 Main St",
  createdAt: "2026-01-01T00:00:00Z",
  id: "venue-1",
  name: "City Concert Hall",
  updatedAt: "2026-01-01T00:00:00Z",
};

export const tbdVenue: OrganizationVenue = {
  address: "",
  createdAt: "2026-01-02T00:00:00Z",
  id: "venue-tbd",
  name: "TBD",
  updatedAt: "2026-01-02T00:00:00Z",
};

const defaultRosterConfiguration: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rehearsalAttendanceReportsEnabled: true,
  rosterStructure: "sections_only",
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [{ code: "S", color: "#123456", name: "Soprano", trackOnly: false }],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [{ fullName: "Soprano", label: "S", sectionCode: "S" }],
};

export function stateWithVenues(venues: readonly OrganizationVenue[]): EventsState {
  return { ...readyState, venues };
}

export async function switchToSection(label: RegExp | string): Promise<void> {
  const user = userEvent.setup();
  const tab = screen.getByRole("tab", { name: label });
  await user.click(tab);
}

export function resetEventEditorMocks(): void {
  vi.mocked(createOrganizationVenue).mockReset();
  vi.mocked(listOrganizationVenues).mockReset();
  vi.mocked(listOrganizationVenues).mockResolvedValue([]);
  vi.mocked(getOrganizationBranding).mockReset();
  vi.mocked(getOrganizationBranding).mockResolvedValue({
    logoFileId: null,
    organizationId: "organization-test",
    organizationName: "Community Choir",
    physicalAddress: null,
  });
  vi.mocked(getOrganizationProviderStatus).mockReset();
  vi.mocked(getOrganizationProviderStatus).mockResolvedValue({
    brevo: { detail: "Ready", status: "ok" },
    emailSender: { fromEmail: "choir@example.test", fromName: "Community Choir" },
    environment: "local",
    externalEffectsMode: "fake",
    requestId: "11111111-1111-4111-8111-111111111111",
    stripe: { detail: "Not configured", status: "attention" },
  });
  vi.mocked(listOrganizationCommunicationTemplates).mockReset();
  vi.mocked(listOrganizationCommunicationTemplates).mockResolvedValue([]);
  vi.mocked(listOrganizationEventPromotionMessages).mockReset();
  vi.mocked(listOrganizationEventPromotionMessages).mockResolvedValue([]);
  vi.mocked(getOrganizationRosterConfiguration).mockReset();
  vi.mocked(getOrganizationRosterConfiguration).mockResolvedValue(defaultRosterConfiguration);
  vi.mocked(listOrganizationEventAttendance).mockReset();
  vi.mocked(listOrganizationEventAttendance).mockResolvedValue([]);
  vi.mocked(listOrganizationProfiles).mockReset();
  vi.mocked(listOrganizationProfiles).mockResolvedValue([]);
  vi.mocked(listOrganizationContactLists).mockReset();
  vi.mocked(listOrganizationContactLists).mockResolvedValue([]);
  vi.mocked(previewOrganizationCommunicationReach).mockReset();
  vi.mocked(previewOrganizationCommunicationReach).mockResolvedValue({
    audienceOverLimit: false,
    both: 0,
    email: 5,
    sms: 0,
    ticketBuyerPurchasesOverLimit: 0,
    total: 5,
    undeliverableTicketBuyerPurchases: 0,
    unreachable: 0,
  });
}

export function eventStateWithPromotion(
  event: OrganizationEvent,
): Extract<EventsState, { readonly status: "ready" }> {
  return {
    events: [event],
    rsvpExpiryEnabled: false,
    rsvpFollowUpEnabled: false,
    rsvpFollowUpLeadHours: 48,
    status: "ready",
    timezone: "America/New_York",
    venues: [venueHall],
  };
}
