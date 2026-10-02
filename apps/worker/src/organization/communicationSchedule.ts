import { rsvpDeadlineFromDate } from "@choir/domain";
import type { OrganizationRosterConfiguration } from "@choir/contracts";

export const EVENT_REMINDER_LEAD_MS = 48 * 60 * 60 * 1000;
export const TICKET_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
export const ATTENDANCE_REPORT_DELAY_MS = 12 * 60 * 60 * 1000;
export const COMMUNICATION_PREVIEW_DAYS = 90;

export function eventReminderDueAt(startsAt: string): number {
  return Date.parse(startsAt) - EVENT_REMINDER_LEAD_MS;
}

export function ticketReminderDueAt(startsAt: string): number {
  return Date.parse(startsAt) - TICKET_REMINDER_LEAD_MS;
}

export function attendanceReportDueAt(startsAt: string): number {
  return Date.parse(startsAt) + ATTENDANCE_REPORT_DELAY_MS;
}

export function rsvpFollowUpSchedule(
  event: {
    readonly rsvpFollowUpMode: "disabled" | "enabled" | "inherit";
    readonly rsvpFollowUpLeadHours: number | null;
    readonly rsvpDeadlineDate: string | null;
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
  const deadline = rsvpDeadlineFromDate(event.rsvpDeadlineDate ?? "", timezone);
  if (!deadline) return null;
  const deadlineAt = Date.parse(deadline.deadlineAt);
  return { deadlineAt, dueAt: deadlineAt - leadHours * 60 * 60 * 1000 };
}
