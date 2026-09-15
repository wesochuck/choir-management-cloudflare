import type {
  DuesRecord,
  OrganizationProfile,
  OrganizationProfileRequest,
  OrganizationRosterConfiguration,
} from "@choir/contracts";

import type { RosterStatusFilter, RsvpStatus } from "./types";

export const emptyProfile: OrganizationProfileRequest = {
  displayName: "",
  doNotEmail: false,
  globalStatus: "Active",
  hidden: false,
  isSectionLeader: false,
  notes: "",
  phone: "",
  receiveAdminNotifications: false,
  receiveAttendanceReports: true,
  receiveFinancialAlerts: false,
  receiveRsvpDeclineNotices: false,
  showInDirectory: true,
  statusIsManual: false,
  voicePart: "",
};

export const UNASSIGNED_VOICE_FILTER = "unassigned";

export function sectionFilterKey(code: string): string {
  return `section:${code}`;
}

export function formatProfileTransitionDate(value: string | null): string {
  if (!value) return "No automatic transition date is scheduled.";
  return `Scheduled for ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))}.`;
}

export function voicePartFilterKey(label: string): string {
  return `part:${label}`;
}

export function reportableSections(
  configuration: OrganizationRosterConfiguration,
): readonly OrganizationRosterConfiguration["sections"][number][] {
  return configuration.sections.filter(({ trackOnly }) => !trackOnly);
}

export function reportableVoiceParts(
  configuration: OrganizationRosterConfiguration,
): readonly OrganizationRosterConfiguration["voiceParts"][number][] {
  const trackOnlySections = new Set(
    configuration.sections.filter(({ trackOnly }) => trackOnly).map(({ code }) => code),
  );
  return configuration.voiceParts.filter(({ sectionCode }) => !trackOnlySections.has(sectionCode));
}

export function profileSectionCode(
  profile: OrganizationProfile,
  configuration: OrganizationRosterConfiguration,
): string | null {
  return (
    configuration.voiceParts.find(({ label }) => label === profile.voicePart)?.sectionCode ?? null
  );
}

export function profileMatchesVoiceFilters(
  profile: OrganizationProfile,
  configuration: OrganizationRosterConfiguration,
  filters: readonly string[],
): boolean {
  if (filters.length === 0) return true;
  const sectionCode = profileSectionCode(profile, configuration);
  const voicePart = configuration.voiceParts.find(({ label }) => label === profile.voicePart);
  if (
    voicePart &&
    configuration.sections.some(
      ({ code, trackOnly }) => code === voicePart.sectionCode && trackOnly,
    )
  ) {
    return false;
  }
  return filters.some((filter) =>
    filter === UNASSIGNED_VOICE_FILTER
      ? !profile.voicePart
      : filter === voicePartFilterKey(profile.voicePart) ||
        filter === sectionFilterKey(sectionCode ?? ""),
  );
}

export function profileRequestFrom(profile: OrganizationProfile): OrganizationProfileRequest {
  return {
    displayName: profile.displayName,
    doNotEmail: profile.doNotEmail,
    globalStatus: profile.globalStatus,
    hidden: profile.hidden,
    isSectionLeader: profile.isSectionLeader,
    notes: profile.notes,
    phone: profile.phone,
    receiveAdminNotifications: profile.receiveAdminNotifications,
    receiveAttendanceReports: profile.receiveAttendanceReports,
    receiveFinancialAlerts: profile.receiveFinancialAlerts,
    receiveRsvpDeclineNotices: profile.receiveRsvpDeclineNotices,
    showInDirectory: profile.showInDirectory,
    statusIsManual: profile.statusIsManual,
    voicePart: profile.voicePart,
  };
}

export function statusLabel(status: OrganizationProfile["globalStatus"]): string {
  return status === "Idle" ? "On Break" : status;
}

export function parseRosterStatusFilter(value: string): RosterStatusFilter {
  return value === "Active" || value === "Idle" || value === "Inactive" ? value : "all";
}

export function formatPerformanceDate(value: string): {
  readonly date: string;
  readonly time: string;
} {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: "Date unavailable", time: "" };
  return {
    date: new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      weekday: "short",
    }).format(parsed),
    time: new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(parsed),
  };
}

export function attendanceLabel(value: "Absent" | "Pending" | "Present"): string {
  return value === "Present" ? "Attended" : value;
}

export function parseRsvpStatus(value: string): RsvpStatus {
  return value === "Yes" || value === "No" ? value : "Pending";
}

export function formatDuesAmount(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    currency: "USD",
    style: "currency",
  });
}

export function duesStatusLabel(record: DuesRecord | undefined): string {
  if (!record) return "Not paid";
  if (record.status === "paid") {
    return record.paymentMethod === "cash" ? "Paid · Cash" : "Paid";
  }
  return record.status === "refunded" ? "Refunded" : "Pending";
}
