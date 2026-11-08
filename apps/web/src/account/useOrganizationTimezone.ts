import { isValidTimeZone } from "@choir/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getOrganizationCalendarSettings, queryKeys } from "../api";

const timezoneOptions = {
  queryKey: queryKeys.organization.calendarSettings,
  queryFn: async ({ signal }: { readonly signal: AbortSignal }) => {
    const settings = await getOrganizationCalendarSettings(signal);
    // Reject malformed settings before they can select the device's timezone.
    if (!isValidTimeZone(settings.timezone)) throw new Error("Invalid Organization timezone.");
    return settings;
  },
};

export function useOrganizationTimezone(enabled: boolean) {
  const client = useQueryClient();
  const query = useQuery({ ...timezoneOptions, enabled });
  const loadTimezone = useCallback(
    () => client.query({ ...timezoneOptions, staleTime: "static" }),
    [client],
  );
  return { ...query, timezone: query.data?.timezone, loadTimezone };
}
