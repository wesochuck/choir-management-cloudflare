import type {
  OrganizationEmailSettings,
  OrganizationProviderStatusResponse,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "../../../auth/api";
import { useCommunicationCenterController } from "./hooks";

const mockProviderStatus: OrganizationProviderStatusResponse = {
  brevo: { detail: "ok", status: "ok" },
  emailSender: { fromEmail: null, fromName: null },
  environment: "production",
  externalEffectsMode: "sandbox",
  requestId: "req-1",
  stripe: { detail: "ok", status: "ok" },
};

const mockEmailSettings: OrganizationEmailSettings = {
  customDomain: null,
  customDomainStatus: "none",
  dnsRecords: [],
  fromName: "Choir Admin",
  lastCheckedAt: null,
  replyToEmail: "admin@example.test",
  verifiedAt: null,
};

const mockRosterConfig: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 30,
  onBreakTimeoutEnabled: false,
  performerLabel: "Singer",
  rehearsalAttendanceReportsEnabled: true,
  rsvpExpiryEnabled: false,
  rsvpFollowUpEnabled: false,
  rsvpFollowUpLeadHours: 24,
  sections: [{ code: "S", color: "#000000", name: "Soprano", trackOnly: false }],
  statusAutomationEnabled: false,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: false,
  voiceParts: [{ fullName: "Soprano 1", label: "S1", sectionCode: "S" }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCommunicationCenterController filters", () => {
  it.each([
    { query: "", statuses: ["Active"] },
    { query: "&rsvpStatus=Idle", statuses: ["Idle"] },
    { query: "&rsvpStatus=Inactive", statuses: ["Inactive"] },
    {
      query: "&rsvpStatus=Active&rsvpStatus=Idle&rsvpStatus=Inactive",
      statuses: ["Active", "Idle", "Inactive"],
    },
  ])("prepares a nonresponder-only RSVP request for $statuses", ({ query, statuses }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(
      null,
      "",
      `/admin/communications?tab=compose&rsvpEventId=event-1&rsvpPart=S1&rsvpPart=A1${query}`,
    );
    try {
      const { result } = renderHook(() => useCommunicationCenterController({ enabled: false }));
      expect(result.current.messageMode).toBe("compose");
      expect(result.current.audience).toMatchObject({
        eventId: "event-1",
        globalStatuses: statuses,
        rsvp: "Pending",
        targetAudiences: ["Members"],
        voiceParts: ["S1", "A1"],
      });
      expect(result.current.channel).toBe("Email");
      expect(result.current.subject).toBe("Please RSVP: {eventTitle}");
      expect(result.current.contentMarkdown).toContain("{{RSVP_LINKS}}");
      act(() => {
        result.current.openNewMessage();
      });
      expect(result.current.audience.eventId).toBeNull();
      expect(result.current.contentMarkdown).toBe("");
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it("opens a new message addressed only to the linked contact list", () => {
    const originalUrl = window.location.href;
    window.history.replaceState(
      null,
      "",
      "/admin/communications?tab=compose&contactListId=33333333-3333-4333-8333-333333333333",
    );
    try {
      const { result } = renderHook(() => useCommunicationCenterController({ enabled: false }));
      expect(result.current.messageMode).toBe("compose");
      expect(result.current.audience.targetAudiences).toEqual(["Contacts"]);
      expect(result.current.audience.contactListIds).toEqual([
        "33333333-3333-4333-8333-333333333333",
      ]);
      expect(result.current.subject).toBe("");
      act(() => {
        result.current.openNewMessage();
      });
      expect(result.current.audience.targetAudiences).toEqual(["Members"]);
      expect(result.current.audience.contactListIds).toEqual([]);
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it("initializes with default filters and queries history", async () => {
    const historySpy = vi
      .spyOn(apiModule, "getOrganizationCommunicationHistory")
      .mockResolvedValue({
        items: [],
        nextCursor: null,
        requestId: "req-1",
      });
    vi.spyOn(apiModule, "getOrganizationCalendarSettings").mockResolvedValue({
      timezone: "America/New_York",
    });
    vi.spyOn(apiModule, "listOrganizationEvents").mockResolvedValue([]);
    vi.spyOn(apiModule, "listOrganizationCommunicationTemplates").mockResolvedValue([]);
    vi.spyOn(apiModule, "getOrganizationProviderStatus").mockResolvedValue(mockProviderStatus);
    vi.spyOn(apiModule, "getOrganizationEmailSettings").mockResolvedValue(mockEmailSettings);
    vi.spyOn(apiModule, "getOrganizationRosterConfiguration").mockResolvedValue(mockRosterConfig);

    const { result } = renderHook(() => useCommunicationCenterController({ enabled: true }));

    await waitFor(() => {
      expect(historySpy).toHaveBeenCalledWith({ cursor: null, limit: 50 }, expect.any(AbortSignal));
    });

    expect(result.current.statusFilter).toBe("all");
    expect(result.current.originFilter).toBe("all");
  });

  it("changing status filter preserves origin and resets pagination", async () => {
    const historySpy = vi
      .spyOn(apiModule, "getOrganizationCommunicationHistory")
      .mockResolvedValue({
        items: [],
        nextCursor: "cursor-2",
        requestId: "req-1",
      });
    vi.spyOn(apiModule, "getOrganizationCalendarSettings").mockResolvedValue({
      timezone: "America/New_York",
    });
    vi.spyOn(apiModule, "listOrganizationEvents").mockResolvedValue([]);
    vi.spyOn(apiModule, "listOrganizationCommunicationTemplates").mockResolvedValue([]);
    vi.spyOn(apiModule, "getOrganizationProviderStatus").mockResolvedValue(mockProviderStatus);
    vi.spyOn(apiModule, "getOrganizationEmailSettings").mockResolvedValue(mockEmailSettings);
    vi.spyOn(apiModule, "getOrganizationRosterConfiguration").mockResolvedValue(mockRosterConfig);

    const { result } = renderHook(() => useCommunicationCenterController({ enabled: true }));

    await waitFor(() => {
      expect(historySpy).toHaveBeenCalled();
    });

    // Change status to sent
    act(() => {
      result.current.setStatusFilter("sent");
    });

    expect(result.current.statusFilter).toBe("sent");
    expect(result.current.originFilter).toBe("all");
    expect(result.current.pageNumber).toBe(1);

    await waitFor(() => {
      expect(historySpy).toHaveBeenLastCalledWith(
        { cursor: null, limit: 50, status: "sent" },
        expect.any(AbortSignal),
      );
    });

    // Change origin to manual while status is sent
    act(() => {
      result.current.setOriginFilter("manual");
    });

    expect(result.current.statusFilter).toBe("sent");
    expect(result.current.originFilter).toBe("manual");
    expect(result.current.pageNumber).toBe(1);

    await waitFor(() => {
      expect(historySpy).toHaveBeenLastCalledWith(
        { cursor: null, limit: 50, origin: "manual", status: "sent" },
        expect.any(AbortSignal),
      );
    });
  });
});
