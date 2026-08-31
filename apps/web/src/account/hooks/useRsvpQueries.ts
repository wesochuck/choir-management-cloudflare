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
} from "../../auth/api";

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
    queryKey: ["organization", "rsvp", "bootstrap"],
    staleTime: 60 * 1000,
  });
}

export function useEventAttendanceQuery(eventId: string, enabled: boolean) {
  return useQuery<readonly OrganizationAttendanceRow[]>({
    enabled: enabled && Boolean(eventId),
    queryFn: async ({ signal }) => {
      return listOrganizationEventAttendance(eventId, signal);
    },
    queryKey: ["organization", "events", eventId, "attendance"],
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
    queryKey: ["organization", "events", eventId, "history"],
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
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["organization", "events", eventId, "attendance"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["organization", "events", eventId, "history"],
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
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["organization", "events", eventId, "attendance"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["organization", "events", eventId, "history"],
      });
    },
  });
}
