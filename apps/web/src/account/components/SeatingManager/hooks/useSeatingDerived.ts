import { useMemo } from "react";
import type { OrganizationSeatingChartRequest } from "@choir/contracts";
import { getUniqueDisplayNames } from "../../../nameFormatting";
import type { SeatingResources } from "../types";

interface Args {
  readonly attendance: readonly {
    readonly profileId: string;
    readonly rsvp: "No" | "Pending" | "Yes";
  }[];
  readonly chart: OrganizationSeatingChartRequest;
  readonly resources: SeatingResources | null;
}

export function useSeatingDerived({ attendance, chart, resources }: Args) {
  const eligibleProfiles = useMemo(() => {
    if (!resources) return [];
    const attending = new Set(
      attendance.filter(({ rsvp }) => rsvp === "Yes").map(({ profileId }) => profileId),
    );
    return resources.profiles.filter(
      (profile) =>
        profile.globalStatus === "Active" &&
        Boolean(profile.voicePart.trim()) &&
        attending.has(profile.id),
    );
  }, [attendance, resources]);

  const rsvpYesCount = useMemo(
    () => attendance.filter(({ rsvp }) => rsvp === "Yes").length,
    [attendance],
  );

  const profilesById = useMemo(
    () => new Map((resources?.profiles ?? []).map((profile) => [profile.id, profile])),
    [resources?.profiles],
  );

  const assignedProfiles = useMemo(
    () =>
      [...new Set(Object.values(chart.assignments))].flatMap((profileId) => {
        const profile = profilesById.get(profileId);
        return profile ? [profile] : [];
      }),
    [chart.assignments, profilesById],
  );

  const seatingDisplayNames = useMemo(
    () => getUniqueDisplayNames(assignedProfiles),
    [assignedProfiles],
  );

  const assignedIds = useMemo(() => new Set(Object.values(chart.assignments)), [chart.assignments]);

  const unassignedProfiles = useMemo(
    () => eligibleProfiles.filter(({ id }) => !assignedIds.has(id)),
    [assignedIds, eligibleProfiles],
  );

  const lookupProfiles = useMemo(() => {
    const presentIds = new Set([...unassignedProfiles.map(({ id }) => id), ...assignedIds]);
    return (resources?.profiles ?? []).filter(({ id }) => !presentIds.has(id));
  }, [assignedIds, resources?.profiles, unassignedProfiles]);

  const currentFormation = useMemo(() => {
    const found = resources?.seating.formations.find(({ id }) => id === chart.formationId);
    return found ?? resources?.seating.formations[0] ?? null;
  }, [chart.formationId, resources?.seating.formations]);

  return {
    assignedIds,
    assignedProfiles,
    currentFormation,
    eligibleProfiles,
    lookupProfiles,
    profilesById,
    rsvpYesCount,
    seatingDisplayNames,
    unassignedProfiles,
  };
}
