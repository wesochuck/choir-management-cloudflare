import type {
  OrganizationAttendanceRow,
  OrganizationEvent,
  OrganizationEventRsvpHistoryEntry,
  OrganizationProfile,
  OrganizationRosterConfiguration,
  OrganizationRsvpRequest,
} from "@choir/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  bulkUpdateOrganizationEventRsvp,
  getOrganizationEventRsvpHistory,
  getOrganizationRosterConfiguration,
  listOrganizationEventAttendance,
  listOrganizationEvents,
  listOrganizationProfiles,
  setOrganizationEventRsvp,
} from "../../api";
import { queryKeys } from "../../api/queryKeys";

export interface RsvpBootstrapData {
  readonly events: readonly OrganizationEvent[];
  readonly profiles: readonly OrganizationProfile[];
  readonly roster: OrganizationRosterConfiguration;
}

export function useRsvpBootstrapQuery(enabled: boolean) {
  return useQuery<RsvpBootstrapData>({
    enabled,
    queryFn: async ({ signal }) => {
      const [events, profiles, roster] = await Promise.all([
        listOrganizationEvents(signal),
        listOrganizationProfiles(signal),
        getOrganizationRosterConfiguration(signal),
      ]);
      return { events, profiles, roster };
    },
    queryKey: queryKeys.organization.rsvpBootstrap,
    staleTime: 60 * 1000,
  });
}

export function useEventAttendanceQuery(eventId: string, enabled: boolean) {
  return useQuery<readonly OrganizationAttendanceRow[]>({
    enabled: enabled && Boolean(eventId),
    queryFn: async ({ signal }) => {
      return listOrganizationEventAttendance(eventId, signal);
    },
    queryKey: queryKeys.organization.attendance(eventId),
    staleTime: 10 * 1000,
  });
}

export function useEventRsvpHistoryQuery(eventId: string, enabled: boolean) {
  return useQuery<readonly OrganizationEventRsvpHistoryEntry[]>({
    enabled: enabled && Boolean(eventId),
    queryFn: async ({ signal }) => {
      const history = await getOrganizationEventRsvpHistory(eventId, signal);
      return history.entries;
    },
    queryKey: queryKeys.organization.rsvpHistory(eventId),
    staleTime: 10 * 1000,
  });
}

export function useSetRsvpMutation(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables: {
      profileId: string;
      rsvp: "Yes" | "No" | "Pending";
      notes?: string;
    }) => {
      return setOrganizationEventRsvp(
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
}

export function useBulkUpdateRsvpMutation(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables: { updates: readonly OrganizationRsvpRequest[] }) => {
      return bulkUpdateOrganizationEventRsvp(eventId, variables.updates);
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
}
