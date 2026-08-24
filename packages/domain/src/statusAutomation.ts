import { datePartInTimeZone, zonedLocalDateTimeToUtc } from "./calendarTime";

export type AutomatedProfileStatus = "Active" | "Idle" | "Inactive";
export type AttendanceStatus = "Absent" | "Pending" | "Present";
export type RsvpStatus = "No" | "Pending" | "Yes";

export interface StatusAutomationConfiguration {
  readonly onBreakTimeoutDays: number;
  readonly onBreakTimeoutEnabled: boolean;
  readonly rsvpExpiryEnabled: boolean;
  readonly rsvpExpiryLeadDays: number;
  readonly statusAutomationEnabled: boolean;
  readonly statusAutomationMissThreshold: number;
  readonly statusAutomationRecoveryEnabled: boolean;
}

export interface PerformanceAutomationRecord {
  readonly attendance: AttendanceStatus;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly isArchived: boolean;
  readonly isCanceled: boolean;
  readonly rsvp: RsvpStatus;
  readonly startsAt: string;
}

export interface ProfileAutomationSnapshot {
  readonly currentStatus: AutomatedProfileStatus;
  readonly isManual: boolean;
  readonly isPerformer: boolean;
}

export interface ProfileStatusEvaluation {
  readonly nextStatus: AutomatedProfileStatus;
  readonly reason: string;
  readonly triggerId: string;
  readonly triggerType: "future_performance_rsvp" | "performance_miss" | "none";
}

export interface RsvpDeadline {
  readonly deadlineAt: string;
  readonly deadlineDate: string;
}

function calendarDateFromParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addCalendarDays(datePart: string, days: number): string {
  const [yearPart, monthPart, dayPart] = datePart.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid calendar date: ${datePart}`);
  }
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return calendarDateFromParts(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    result.getUTCDate(),
  );
}

function startOfLocalDate(datePart: string, timezone: string): Date | null {
  const utc = zonedLocalDateTimeToUtc(`${datePart}T00:00`, timezone);
  if (!utc) return null;
  const result = new Date(utc);
  return Number.isFinite(result.getTime()) ? result : null;
}

function endOfLocalDate(datePart: string, timezone: string): Date | null {
  const nextDayStart = startOfLocalDate(addCalendarDays(datePart, 1), timezone);
  return nextDayStart ? new Date(nextDayStart.getTime() - 1) : null;
}

export function performanceHasEnded(
  record: Pick<PerformanceAutomationRecord, "durationMinutes" | "startsAt">,
  now: Date,
  timezone: string,
): boolean {
  const start = new Date(record.startsAt);
  if (!Number.isFinite(start.getTime())) return false;
  const end =
    record.durationMinutes === null
      ? endOfLocalDate(datePartInTimeZone(start, timezone), timezone)
      : new Date(start.getTime() + record.durationMinutes * 60 * 1_000);
  return end !== null && now.getTime() >= end.getTime();
}

export function isMissedPerformance(
  record: Pick<PerformanceAutomationRecord, "attendance" | "rsvp">,
): boolean {
  if (record.attendance === "Present") return false;
  if (record.attendance === "Absent") return true;
  return record.rsvp === "No";
}

export function calculateRsvpDeadline(
  event: Pick<PerformanceAutomationRecord, "startsAt"> & {
    readonly type: "Performance" | "Rehearsal";
  },
  leadDays: number,
  timezone: string,
): RsvpDeadline | null {
  if (event.type !== "Performance") return null;
  const start = new Date(event.startsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(leadDays) || leadDays < 1) {
    return null;
  }
  const deadlineDate = addCalendarDays(datePartInTimeZone(start, timezone), -leadDays);
  const deadlineAt = endOfLocalDate(deadlineDate, timezone);
  return deadlineAt ? { deadlineAt: deadlineAt.toISOString(), deadlineDate } : null;
}

export function isRsvpDeadlinePassed(deadline: RsvpDeadline | null, now: Date): boolean {
  return deadline !== null && now.getTime() > new Date(deadline.deadlineAt).getTime();
}

export function calculateOnBreakInactiveAt(input: {
  readonly statusChangedAt: string;
  readonly status: AutomatedProfileStatus;
  readonly isManual: boolean;
  readonly enabled: boolean;
  readonly timeoutDays: number;
  readonly now: Date;
  readonly timezone: string;
}): string | null {
  if (
    input.status !== "Idle" ||
    input.isManual ||
    !input.enabled ||
    !Number.isInteger(input.timeoutDays) ||
    input.timeoutDays < 1
  ) {
    return null;
  }
  const changedAt = new Date(input.statusChangedAt);
  if (!Number.isFinite(changedAt.getTime())) return null;
  const dueDate = addCalendarDays(datePartInTimeZone(changedAt, input.timezone), input.timeoutDays);
  const dueAt = startOfLocalDate(dueDate, input.timezone);
  return dueAt?.toISOString() ?? null;
}

export function evaluateProfileStatus(input: {
  readonly configuration: Pick<
    StatusAutomationConfiguration,
    "statusAutomationEnabled" | "statusAutomationMissThreshold" | "statusAutomationRecoveryEnabled"
  >;
  readonly now: Date;
  readonly performances: readonly PerformanceAutomationRecord[];
  readonly profile: ProfileAutomationSnapshot;
  readonly timezone: string;
}): ProfileStatusEvaluation {
  const none: ProfileStatusEvaluation = {
    nextStatus: input.profile.currentStatus,
    reason: "No automatic status change is due.",
    triggerId: "",
    triggerType: "none",
  };
  if (
    !input.configuration.statusAutomationEnabled ||
    input.profile.isManual ||
    !input.profile.isPerformer
  ) {
    return none;
  }

  if (
    input.configuration.statusAutomationRecoveryEnabled &&
    input.profile.currentStatus !== "Active"
  ) {
    const futureYes = input.performances
      .filter(
        (performance) =>
          !performance.isArchived &&
          !performance.isCanceled &&
          new Date(performance.startsAt).getTime() > input.now.getTime() &&
          performance.rsvp === "Yes",
      )
      .sort(
        (left, right) =>
          left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id),
      )[0];
    if (futureYes) {
      return {
        nextStatus: "Active",
        reason: "A future Performance RSVP is Yes.",
        triggerId: futureYes.id,
        triggerType: "future_performance_rsvp",
      };
    }
  }

  if (input.profile.currentStatus !== "Active") return none;
  const ended = input.performances
    .filter(
      (performance) =>
        !performance.isArchived &&
        !performance.isCanceled &&
        performanceHasEnded(performance, input.now, input.timezone),
    )
    .sort(
      (left, right) =>
        right.startsAt.localeCompare(left.startsAt) || right.id.localeCompare(left.id),
    )
    .slice(0, input.configuration.statusAutomationMissThreshold);
  if (
    ended.length === input.configuration.statusAutomationMissThreshold &&
    ended.every(isMissedPerformance)
  ) {
    return {
      nextStatus: "Inactive",
      reason: `The latest ${String(ended.length)} ended Performances were missed.`,
      triggerId: ended[0]?.id ?? "",
      triggerType: "performance_miss",
    };
  }
  return none;
}
