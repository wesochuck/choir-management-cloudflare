import {
  addCalendarDays,
  datePartInTimeZone,
  rsvpDeadlineFromDate,
  zonedLocalDateTimeToUtc,
} from "@choir/domain";
import type { OrganizationRosterConfiguration } from "@choir/contracts";

export const EVENT_REMINDER_LEAD_MS = 48 * 60 * 60 * 1000;
export const TICKET_REMINDER_LEAD_MS = 36 * 60 * 60 * 1000;
export const ATTENDANCE_REPORT_LOOKBACK_MS = 48 * 60 * 60 * 1000;
export const COMMUNICATION_PREVIEW_DAYS = 90;

export function eventReminderDueAt(startsAt: string): number {
  return Date.parse(startsAt) - EVENT_REMINDER_LEAD_MS;
}

export function ticketReminderDueAt(startsAt: string): number {
  return Date.parse(startsAt) - TICKET_REMINDER_LEAD_MS;
}

export function attendanceReportDueAt(startsAt: string, timezone: string): number {
  const startDate = new Date(startsAt);
  if (!Number.isFinite(startDate.getTime())) return Number.NaN;
  const eventDatePart = datePartInTimeZone(startDate, timezone);
  const nextDatePart = addCalendarDays(eventDatePart, 1);
  const dueUtcIso = zonedLocalDateTimeToUtc(`${nextDatePart}T01:00`, timezone);
  return dueUtcIso ? Date.parse(dueUtcIso) : Number.NaN;
}

export function rsvpFollowUpSchedule(
  event: {
    readonly rsvpFollowUpMode: "disabled" | "enabled" | "inherit";
    readonly rsvpFollowUpLeadHours: number | null;
    readonly rsvpDeadlineDate: string | null;
    readonly startsAt?: string;
    readonly type?: string;
  },
  configuration: OrganizationRosterConfiguration,
  timezone: string,
): { readonly deadlineAt: number; readonly dueAt: number } | null {
  if (!configuration.rsvpExpiryEnabled || event.rsvpFollowUpMode === "disabled") return null;
  const enabled =
    event.rsvpFollowUpMode === "enabled"
      ? event.rsvpFollowUpLeadHours !== null
      : configuration.rsvpFollowUpEnabled;
  const leadHours =
    event.rsvpFollowUpMode === "enabled"
      ? event.rsvpFollowUpLeadHours
      : configuration.rsvpFollowUpLeadHours;
  if (!enabled || leadHours === null) return null;
  if (event.type === "Other" && event.startsAt) {
    const deadlineAt = Date.parse(event.startsAt);
    if (!Number.isFinite(deadlineAt)) return null;
    return { deadlineAt, dueAt: deadlineAt - leadHours * 60 * 60 * 1000 };
  }
  const deadline = rsvpDeadlineFromDate(event.rsvpDeadlineDate ?? "", timezone);
  if (!deadline) return null;
  const deadlineAt = Date.parse(deadline.deadlineAt);
  return { deadlineAt, dueAt: deadlineAt - leadHours * 60 * 60 * 1000 };
}
