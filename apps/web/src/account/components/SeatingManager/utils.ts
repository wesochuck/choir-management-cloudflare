import type {
  OrganizationProfile,
  OrganizationRosterConfiguration,
  OrganizationSeatingChart,
  SeatingFormation,
  OrganizationSeatingChartRequest,
  OrganizationProfileRequest,
} from "@choir/contracts";
import { getFirstName, getLastName } from "../../nameFormatting";
import type { FormationOrderOption } from "./types";

export const defaultRows = [8, 10, 12];

export const emptyChart: OrganizationSeatingChartRequest = {
  assignments: {},
  formationId: "columns-standard",
  name: "Main Seating Chart",
  rowCounts: defaultRows,
  sectionSuggestions: {},
  sortOrder: 0,
  venueId: null,
};

export const emptyProfile: OrganizationProfileRequest = {
  displayName: "",
  doNotEmail: false,
  globalStatus: "Active",
  isSectionLeader: false,
  notes: "",
  phone: "",
  receiveAdminNotifications: true,
  receiveAttendanceReports: true,
  receiveFinancialAlerts: false,
  receiveRsvpDeclineNotices: false,
  showInDirectory: true,
  statusIsManual: false,
  voicePart: "",
};

export function chartRequest(chart: OrganizationSeatingChart): OrganizationSeatingChartRequest {
  return {
    assignments: chart.assignments,
    formationId: chart.formationId,
    name: chart.name,
    rowCounts: chart.rowCounts,
    sectionSuggestions: chart.sectionSuggestions,
    sortOrder: chart.sortOrder,
    venueId: chart.venueId,
  };
}

export function formatEventDate(startsAt: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(startsAt));
  } catch {
    return startsAt;
  }
}

/** Keep the voice-part code visible anywhere a profile can be picked up for seating. */
export function seatingProfileLabel(
  profile: Pick<OrganizationProfile, "displayName" | "voicePart">,
): string {
  const displayName = profile.displayName.trim();
  const voicePart = profile.voicePart.trim();
  return voicePart ? `${displayName} (${voicePart})` : displayName;
}

export interface SeatAssignmentProfile {
  readonly displayName: string;
  readonly id: string;
  readonly voicePart: string;
}

export interface SeatAssignmentProfileGroup {
  readonly key: string;
  readonly label: string;
  readonly profiles: readonly SeatAssignmentProfile[];
}

function compareProfilesByLastName(
  left: SeatAssignmentProfile,
  right: SeatAssignmentProfile,
): number {
  const lastName = getLastName(left.displayName).localeCompare(
    getLastName(right.displayName),
    undefined,
    {
      sensitivity: "base",
    },
  );
  if (lastName !== 0) return lastName;
  const firstName = getFirstName(left.displayName).localeCompare(
    getFirstName(right.displayName),
    undefined,
    { sensitivity: "base" },
  );
  if (firstName !== 0) return firstName;
  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
}

/**
 * Groups seat candidates by configured section and puts the clicked seat's
 * matching section first. For voice-part formations, an exact voice-part
 * match leads its section before the other voice parts in that section.
 */
export function groupSeatAssignmentProfiles(
  profiles: readonly SeatAssignmentProfile[],
  suggestion: string | undefined,
  isVoicePartLayout: boolean,
  roster: Pick<OrganizationRosterConfiguration, "sections" | "voiceParts">,
): readonly SeatAssignmentProfileGroup[] {
  const normalize = (value: string | undefined): string => value?.trim().toLocaleLowerCase() ?? "";
  const voicePartSections = new Map(
    roster.voiceParts.map(({ label, sectionCode }) => [normalize(label), sectionCode]),
  );
  const sectionDetails = new Map(roster.sections.map((section) => [section.code, section]));
  const targetVoicePart = isVoicePartLayout ? normalize(suggestion) : "";
  const targetSection = isVoicePartLayout
    ? (voicePartSections.get(targetVoicePart) ?? suggestion?.trim() ?? "")
    : (suggestion?.trim() ?? "");
  const groups = new Map<string, SeatAssignmentProfile[]>();

  for (const profile of profiles) {
    const sectionCode = voicePartSections.get(normalize(profile.voicePart)) ?? "__other";
    const group = groups.get(sectionCode) ?? [];
    group.push(profile);
    groups.set(sectionCode, group);
  }

  return [...groups.entries()]
    .map(([key, groupProfiles]) => ({
      key,
      label:
        key === "__other" ? "Other sections" : `${sectionDetails.get(key)?.name ?? key} (${key})`,
      profiles: [...groupProfiles].sort((left, right) => {
        if (targetVoicePart) {
          const leftExact = normalize(left.voicePart) === targetVoicePart;
          const rightExact = normalize(right.voicePart) === targetVoicePart;
          if (leftExact !== rightExact) return leftExact ? -1 : 1;
        }
        return compareProfilesByLastName(left, right);
      }),
    }))
    .sort((left, right) => {
      const leftTarget = left.key.toLocaleLowerCase() === targetSection.toLocaleLowerCase();
      const rightTarget = right.key.toLocaleLowerCase() === targetSection.toLocaleLowerCase();
      if (leftTarget !== rightTarget) return leftTarget ? -1 : 1;
      if (left.key === "__other") return 1;
      if (right.key === "__other") return -1;
      const leftIndex = roster.sections.findIndex(({ code }) => code === left.key);
      const rightIndex = roster.sections.findIndex(({ code }) => code === right.key);
      return leftIndex - rightIndex;
    });
}

export function statusLabel(status: OrganizationProfile["globalStatus"]): string {
  return status === "Idle" ? "On Break" : status;
}

export function formationOrderOptions(
  formation: SeatingFormation,
  roster: OrganizationRosterConfiguration,
): readonly FormationOrderOption[] {
  if (formation.isVoicePartLayout) {
    return roster.voiceParts.map(({ fullName, label }) => ({
      label: `${fullName} (${label})`,
      value: label,
    }));
  }
  return roster.sections
    .filter(({ trackOnly }) => !trackOnly)
    .map(({ code, name }) => ({ label: `${name} (${code})`, value: code }));
}

export function normalizeFormationOrder(
  formation: SeatingFormation,
  roster: OrganizationRosterConfiguration,
): string[] {
  const options = formationOrderOptions(formation, roster);
  const allowed = new Set(options.map(({ value }) => value));
  const current = formation.sectionOrder.filter((value) => allowed.has(value));
  const present = new Set(current);
  return [...current, ...options.map(({ value }) => value).filter((value) => !present.has(value))];
}

export function moveFormationOrderItem(
  order: readonly string[],
  from: number,
  to: number,
): string[] {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) {
    return [...order];
  }
  const next = [...order];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}
