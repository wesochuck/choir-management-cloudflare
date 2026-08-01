import type {
  OrganizationProfile,
  OrganizationRosterConfiguration,
  OrganizationSeatingChart,
  SeatingFormation,
  OrganizationSeatingChartRequest,
  OrganizationProfileRequest,
} from "@choir/contracts";
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
