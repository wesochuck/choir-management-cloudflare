export interface EventDateTile {
  readonly day: string;
  readonly fullLabel: string;
  readonly month: string;
  readonly weekday: string;
  readonly year: string;
}

export function formatEventDateTile(isoStartsAt: string, timezone: string): EventDateTile {
  const date = new Date(isoStartsAt);
  if (isNaN(date.getTime())) {
    return { day: "", fullLabel: isoStartsAt, month: "", weekday: "", year: "" };
  }
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(
    date,
  );
  const month = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short" }).format(
    date,
  );
  const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, day: "numeric" }).format(date);
  const year = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(
    date,
  );
  const fullLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
  return { day, fullLabel, month, weekday, year };
}

function formatSingleTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(date);
}

function getDateKeyInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).format(date);
}

export function formatEventTimeRange(
  isoStartsAt: string,
  durationMinutes: number | null | undefined,
  timezone: string,
): string {
  const startDate = new Date(isoStartsAt);
  if (isNaN(startDate.getTime())) return "";

  const startTimeStr = formatSingleTime(startDate, timezone);

  if (
    typeof durationMinutes !== "number" ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0
  ) {
    return startTimeStr;
  }

  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
  const endTimeStr = formatSingleTime(endDate, timezone);

  const startDay = getDateKeyInTimezone(startDate, timezone);
  const endDay = getDateKeyInTimezone(endDate, timezone);

  if (startDay !== endDay) {
    return `${startTimeStr} – ${endTimeStr} (next day)`;
  }

  return `${startTimeStr} – ${endTimeStr}`;
}

export function formatCallTime(callTime: string | null | undefined): string | null {
  if (!callTime) return null;
  const trimmed = callTime.trim();
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (!match) return null;
  const rawHours = match[1];
  const rawMinutes = match[2];
  if (!rawHours || !rawMinutes) return null;
  const hours = parseInt(rawHours, 10);
  const minutes = parseInt(rawMinutes, 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  const hour12 = hours % 12 || 12;
  const amPm = hours >= 12 ? "PM" : "AM";
  const minuteStr = String(minutes).padStart(2, "0");
  return `${String(hour12)}:${minuteStr} ${amPm}`;
}

export function formatRsvpDeadline(deadlineDate: string | null | undefined): string | null {
  if (!deadlineDate) return null;
  const trimmed = deadlineDate.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return trimmed;
  const rawYear = match[1];
  const rawMonth = match[2];
  const rawDay = match[3];
  if (!rawYear || !rawMonth || !rawDay) return trimmed;
  const year = parseInt(rawYear, 10);
  const month = parseInt(rawMonth, 10);
  const day = parseInt(rawDay, 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}
