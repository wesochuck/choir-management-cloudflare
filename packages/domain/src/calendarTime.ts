interface TimeZoneParts {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly month: number;
  readonly second: number;
  readonly year: number;
}

function timeZoneParts(date: Date, timezone: string): TimeZoneParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(parts.find((part) => part.type === type)?.value);
    if (!Number.isInteger(value)) throw new Error(`Missing ${type} for timezone ${timezone}.`);
    return value;
  };
  return {
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    month: read("month"),
    second: read("second"),
    year: read("year"),
  };
}

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return timezone.length > 0 && timezone.length <= 100;
  } catch {
    return false;
  }
}

export function datePartInTimeZone(date: Date, timezone: string): string {
  const parts = timeZoneParts(date, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function utcToZonedLocalDateTime(value: string, timezone: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || !isValidTimeZone(timezone)) return null;
  const parts = timeZoneParts(date, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour === 24 ? 0 : parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function zonedLocalDateTimeToUtc(value: string, timezone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match || !isValidTimeZone(timezone)) return null;
  const desired = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  let candidate = desired;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = timeZoneParts(new Date(candidate), timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour === 24 ? 0 : parts.hour,
      parts.minute,
      parts.second,
    );
    candidate += desired - represented;
  }
  const result = new Date(candidate);
  const parts = timeZoneParts(result, timezone);
  return parts.year === Number(match[1]) &&
    parts.month === Number(match[2]) &&
    parts.day === Number(match[3]) &&
    (parts.hour === 24 ? 0 : parts.hour) === Number(match[4]) &&
    parts.minute === Number(match[5])
    ? result.toISOString()
    : null;
}
