import type {
  OrganizationAttendanceRow,
  OrganizationEventRsvpHistoryEntry,
  OrganizationRsvp,
  OrganizationRsvpRequest,
} from "@choir/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../../api";
import { queryKeys } from "../../api/queryKeys";

afterEach(() => {
  vi.restoreAllMocks();
});

const eventId = "11111111-1111-4111-8111-111111111111";
const profileId1 = "22222222-2222-4222-8222-222222222221";
const profileId2 = "22222222-2222-4222-8222-222222222222";

const initialAttendance: readonly OrganizationAttendanceRow[] = [
  {
    attendance: "Pending",
    displayName: "Alice Singer",
    profileId: profileId1,
    rsvp: "Pending",
    updatedAt: "2026-08-30T10:00:00Z",
    voicePart: "Soprano",
  },
  {
    attendance: "Pending",
    displayName: "Bob Singer",
    profileId: profileId2,
    rsvp: "No",
    updatedAt: "2026-08-30T10:00:00Z",
    voicePart: "Tenor",
  },
];

describe("RSVP TanStack Query hooks & cache updates", () => {
  it("useRsvpBootstrapQuery uses canonical queryKeys.organization.rsvpBootstrap", () => {
    expect(queryKeys.organization.rsvpBootstrap).toEqual(["organization", "rsvp", "bootstrap"]);
  });

  it("useEventAttendanceQuery uses canonical queryKeys.organization.attendance", () => {
    expect(queryKeys.organization.attendance(eventId)).toEqual([
      "organization",
      "events",
      eventId,
      "attendance",
    ]);
  });

  it("useEventRsvpHistoryQuery uses canonical queryKeys.organization.rsvpHistory", () => {
    expect(queryKeys.organization.rsvpHistory(eventId)).toEqual([
      "organization",
      "events",
      eventId,
      "history",
    ]);
  });

  it("single RSVP mutation updates attendance cache immediately and triggers background invalidations", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.organization.attendance(eventId), initialAttendance);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const updatedRsvp: OrganizationRsvp = {
      eventId,
      profileId: profileId1,
      rsvp: "Yes",
      rsvpNote: "Ready to sing",
      updatedAt: "2026-08-31T12:00:00Z",
    };

    vi.spyOn(api, "setOrganizationEventRsvp").mockResolvedValue(updatedRsvp);

    const mutationObserver = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async (variables: {
        profileId: string;
        rsvp: "Yes" | "No" | "Pending";
        notes?: string;
      }) => {
        return api.setOrganizationEventRsvp(
          eventId,
          variables.profileId,
          variables.rsvp,
          variables.notes ?? "",
        );
      },
      onSuccess: (data, variables) => {
        queryClient.setQueryData<readonly OrganizationAttendanceRow[]>(
          queryKeys.organization.attendance(eventId),
          (old) => {
            if (!old) return old;
            return old.map((row) =>
              row.profileId === variables.profileId
                ? {
                    ...row,
                    rsvp: data.rsvp,
                    updatedAt: data.updatedAt,
                  }
                : row,
            );
          },
        );
        void queryClient.invalidateQueries({
          queryKey: queryKeys.organization.attendance(eventId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.organization.rsvpHistory(eventId),
        });
      },
    });

    await mutationObserver.execute({
      notes: "Ready to sing",
      profileId: profileId1,
      rsvp: "Yes",
    });

    const cachedRows = queryClient.getQueryData<readonly OrganizationAttendanceRow[]>(
      queryKeys.organization.attendance(eventId),
    );

    expect(cachedRows).toBeDefined();
    expect(cachedRows?.[0]?.rsvp).toBe("Yes");
    expect(cachedRows?.[0]?.updatedAt).toBe("2026-08-31T12:00:00Z");
    expect(cachedRows?.[1]?.rsvp).toBe("No");

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.organization.attendance(eventId),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.organization.rsvpHistory(eventId),
    });
  });

  it("bulk RSVP mutation updates attendance cache immediately with returned updated rows and invalidates queries", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.organization.attendance(eventId), initialAttendance);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const updatedRows: readonly OrganizationAttendanceRow[] = [
      {
        attendance: "Pending",
        displayName: "Alice Singer",
        profileId: profileId1,
        rsvp: "Yes",
        updatedAt: "2026-08-31T12:05:00Z",
        voicePart: "Soprano",
      },
      {
        attendance: "Pending",
        displayName: "Bob Singer",
        profileId: profileId2,
        rsvp: "Yes",
        updatedAt: "2026-08-31T12:05:00Z",
        voicePart: "Tenor",
      },
    ];

    vi.spyOn(api, "bulkUpdateOrganizationEventRsvp").mockResolvedValue(updatedRows);

    const mutationObserver = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async (variables: { updates: readonly OrganizationRsvpRequest[] }) => {
        return api.bulkUpdateOrganizationEventRsvp(eventId, variables.updates);
      },
      onSuccess: (data) => {
        queryClient.setQueryData<readonly OrganizationAttendanceRow[]>(
          queryKeys.organization.attendance(eventId),
          (old) => {
            if (!old) return data;
            const updatedByProfile = new Map(data.map((row) => [row.profileId, row]));
            return old.map((row) => updatedByProfile.get(row.profileId) ?? row);
          },
        );
        void queryClient.invalidateQueries({
          queryKey: queryKeys.organization.attendance(eventId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.organization.rsvpHistory(eventId),
        });
      },
    });

    await mutationObserver.execute({
      updates: [
        { profileId: profileId1, rsvp: "Yes", rsvpNote: "" },
        { profileId: profileId2, rsvp: "Yes", rsvpNote: "" },
      ],
    });

    const cachedRows = queryClient.getQueryData<readonly OrganizationAttendanceRow[]>(
      queryKeys.organization.attendance(eventId),
    );

    expect(cachedRows).toEqual(updatedRows);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.organization.attendance(eventId),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.organization.rsvpHistory(eventId),
    });
  });

  it("handles history query independently from attendance query", async () => {
    const queryClient = new QueryClient();

    const mockHistoryEntries: OrganizationEventRsvpHistoryEntry[] = [
      {
        actorType: "Admin",
        automatic: false,
        displayName: "Alice Singer",
        eventId,
        newRsvp: "Yes",
        occurredAt: "2026-08-31T11:00:00Z",
        previousRsvp: "Pending",
        profileId: profileId1,
        reason: "Admin update",
      },
    ];

    vi.spyOn(api, "listOrganizationEventAttendance").mockResolvedValue(initialAttendance);
    vi.spyOn(api, "getOrganizationEventRsvpHistory").mockResolvedValue({
      entries: mockHistoryEntries,
      eventId,
    });

    const attendanceData = await api.listOrganizationEventAttendance(eventId);
    queryClient.setQueryData(queryKeys.organization.attendance(eventId), attendanceData);
    expect(queryClient.getQueryData(queryKeys.organization.attendance(eventId))).toEqual(
      initialAttendance,
    );

    const historyData = await api.getOrganizationEventRsvpHistory(eventId);
    queryClient.setQueryData(queryKeys.organization.rsvpHistory(eventId), historyData.entries);
    expect(queryClient.getQueryData(queryKeys.organization.rsvpHistory(eventId))).toEqual(
      mockHistoryEntries,
    );
  });
});
