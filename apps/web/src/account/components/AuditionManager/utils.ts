import type {
  AuditionStatus,
  OrganizationAuditionCreateRequest,
  OrganizationAuditionSettings,
} from "@choir/contracts";
import { utcToZonedLocalDateTime, zonedLocalDateTimeToUtc } from "@choir/domain";

export const STATUS_LABELS: Record<AuditionStatus, string> = {
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No Show",
  pending: "Pending Review",
  scheduled: "Scheduled",
};

export function auditionFollowUpUrl(token: string): string {
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL("/auditions", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

export const STATUS_OPTIONS: readonly { readonly label: string; readonly value: AuditionStatus }[] =
  [
    { label: "Pending Review", value: "pending" },
    { label: "Scheduled", value: "scheduled" },
    { label: "Completed", value: "completed" },
    { label: "Cancelled", value: "cancelled" },
    { label: "No Show", value: "no_show" },
  ];

export const fallbackSettings: OrganizationAuditionSettings = {
  adminNotifyEnabled: false,
  adminNotifyUsers: [],
  confirmationMessage: "Thank you for your interest. We will be in touch soon.",
  defaultPerformanceId: null,
  enabled: true,
  slots: [],
  venueId: null,
};

export const emptyCreate: OrganizationAuditionCreateRequest = {
  availabilityNotes: "",
  email: "",
  experience: "",
  name: "",
  performanceId: null,
  phone: "",
  requestedSlots: [],
  scheduledTimeSlot: null,
  status: "pending",
  voicePart: "",
};

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function requestedScheduleValue(
  scheduleTime: string,
  requestedSlots: readonly string[] | undefined,
  timezone: string,
): string {
  return requestedSlots?.some((slot) => utcToZonedLocalDateTime(slot, timezone) === scheduleTime)
    ? scheduleTime
    : "";
}

export function localScheduleInputValue(
  value: string | null | undefined,
  timezone: string,
): string {
  return value ? (utcToZonedLocalDateTime(value, timezone) ?? "") : "";
}

export function normalizedDateInputValue(value: string): string | null {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (isoMatch) return value.trim();
  const localizedMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(value.trim());
  if (!localizedMatch) return null;
  const month = localizedMatch[1];
  const day = localizedMatch[2];
  const year = localizedMatch[3];
  if (month === undefined || day === undefined || year === undefined) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function normalizedTimeInputValue(value: string): string | null {
  const match = /(?:^|T)(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(AM|PM)?$/i.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "AM" && hour === 12) hour = 0;
    if (meridiem === "PM" && hour < 12) hour += 12;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function dateInputStateValue(input: HTMLInputElement): string {
  const normalized = normalizedDateInputValue(input.value);
  if (normalized) return normalized;
  const date = input.valueAsDate;
  if (date) {
    return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  return "";
}

export function timeInputStateValue(input: HTMLInputElement): string {
  const normalized = normalizedTimeInputValue(input.value);
  if (normalized) return normalized;
  const date = input.valueAsDate;
  if (date) {
    return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  }
  return "";
}

export function slotUtcValue(date: string, time: string, timezone: string): string | null {
  const normalizedDate = normalizedDateInputValue(date);
  const normalizedTime = normalizedTimeInputValue(time);
  if (!normalizedDate || !normalizedTime) return null;
  return zonedLocalDateTimeToUtc(`${normalizedDate}T${normalizedTime}`, timezone);
}
