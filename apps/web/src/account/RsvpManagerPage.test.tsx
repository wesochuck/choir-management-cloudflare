import {
  organizationEventSchema,
  organizationProfileSchema,
  type OrganizationAttendanceRow,
  type OrganizationEvent,
  type OrganizationEventRsvpHistoryEntry,
  type OrganizationProfile,
  type OrganizationRosterConfiguration,
} from "@choir/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { queryKeys } from "../api/queryKeys";
import { RsvpManagerPage } from "./RsvpManagerPage";

afterEach(() => {
  vi.restoreAllMocks();
});

const eventId1 = "11111111-1111-4111-8111-111111111111";
const profileId1 = "33333333-3333-4333-8333-333333333331";

const mockEvents: readonly OrganizationEvent[] = [
  organizationEventSchema.parse({
    callTime: "18:30",
    createdAt: "2026-08-01T00:00:00Z",
    details: "Winter Concert",
    endsAt: "2026-12-15T21:00:00Z",
    id: eventId1,
    location: "Main Hall",
    rsvpDeadlineDate: "2026-12-10",
    rsvpDeadlinePassed: false,
    startsAt: "2026-12-15T19:00:00Z",
    title: "Winter Concert",
    type: "Performance",
    updatedAt: "2026-08-01T00:00:00Z",
  }),
];

const mockProfiles: readonly OrganizationProfile[] = [
  organizationProfileSchema.parse({
    createdAt: "2026-08-01T00:00:00Z",
    displayName: "Alice Singer",
    globalStatus: "Active",
    id: profileId1,
    updatedAt: "2026-08-01T00:00:00Z",
    voicePart: "S1",
  }),
];

const mockRoster: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [{ code: "S", color: "#1b4d3e", name: "Sopranos", trackOnly: false }],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [{ fullName: "Soprano 1", label: "S1", sectionCode: "S" }],
};

const mockAttendance: readonly OrganizationAttendanceRow[] = [
  {
    attendance: "Pending",
    displayName: "Alice Singer",
    profileId: profileId1,
    rsvp: "Yes",
    updatedAt: "2026-08-30T10:00:00Z",
    voicePart: "S1",
  },
];

const mockHistory: readonly OrganizationEventRsvpHistoryEntry[] = [
  {
    actorType: "Performer",
    automatic: false,
    displayName: "Alice Singer",
    eventId: eventId1,
    newRsvp: "Yes",
    occurredAt: "2026-08-30T10:00:00Z",
    previousRsvp: "Pending",
    profileId: profileId1,
    reason: "Member response",
  },
];

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        networkMode: "always",
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Infinity,
      },
    },
  });
}

describe("RsvpManagerPage rendering & error decoupling", () => {
  it("renders roster view successfully when bootstrap and attendance succeed", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.organization.rsvpBootstrap, {
      events: mockEvents,
      profiles: mockProfiles,
      roster: mockRoster,
    });
    queryClient.setQueryData(queryKeys.organization.attendance(eventId1), mockAttendance);
    queryClient.setQueryData(queryKeys.organization.rsvpHistory(eventId1), mockHistory);

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <RsvpManagerPage enabled={true} eventId={eventId1} />
      </QueryClientProvider>,
    );

    expect(html).toContain("RSVP roster");
    expect(html).toContain("Alice Singer");
    expect(html).toContain("Attending");
    expect(html).toContain("1 shown");
  });

  it("renders roster view normally when history query fails (decoupled error state)", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.organization.rsvpBootstrap, {
      events: mockEvents,
      profiles: mockProfiles,
      roster: mockRoster,
    });
    queryClient.setQueryData(queryKeys.organization.attendance(eventId1), mockAttendance);

    const historyQuery = queryClient.getQueryCache().build(queryClient, {
      queryKey: queryKeys.organization.rsvpHistory(eventId1),
    });
    historyQuery.setState({
      data: [],
      dataUpdatedAt: Date.now(),
      error: new api.AuthApiError("Failed to load RSVP history", 500, "history_error"),
      errorUpdatedAt: Date.now(),
      fetchStatus: "idle",
      status: "error",
    });

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <RsvpManagerPage enabled={true} eventId={eventId1} />
      </QueryClientProvider>,
    );

    // Roster is fully displayed and not broken by history failure
    expect(html).toContain("RSVP roster");
    expect(html).toContain("Alice Singer");
    expect(html).toContain("1 shown");
    // Attendance roster error is not triggered
    expect(html).not.toContain("The RSVP roster could not be loaded.");
  });

  it("displays error notice when attendance fails", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.organization.rsvpBootstrap, {
      events: mockEvents,
      profiles: mockProfiles,
      roster: mockRoster,
    });

    const attendanceQuery = queryClient.getQueryCache().build(queryClient, {
      queryKey: queryKeys.organization.attendance(eventId1),
    });
    attendanceQuery.setState({
      data: [],
      dataUpdatedAt: Date.now(),
      error: new api.AuthApiError("Attendance service offline", 500, "attendance_error"),
      errorUpdatedAt: Date.now(),
      fetchStatus: "idle",
      status: "error",
    });

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <RsvpManagerPage enabled={true} eventId={eventId1} />
      </QueryClientProvider>,
    );

    expect(html).toContain("Attendance service offline");
    expect(html).toContain('role="alert"');
  });

  it("renders MFA prompt when disabled", () => {
    const queryClient = createTestQueryClient();
    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <RsvpManagerPage enabled={false} eventId={eventId1} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Verify Organization MFA to manage RSVPs.");
  });
});
