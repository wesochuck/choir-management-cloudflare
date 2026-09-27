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
  it("initializes with default filters and queries history", async () => {
    const historySpy = vi
      .spyOn(apiModule, "getOrganizationCommunicationHistory")
      .mockResolvedValue({
        items: [],
        nextCursor: null,
        requestId: "req-1",
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
