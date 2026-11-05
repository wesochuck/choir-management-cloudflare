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

function parseDateStringInstant(date: string, timezone: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const utcInstant = zonedLocalDateTimeToUtc(`${date}T12:00`, timezone);
    return utcInstant ? new Date(utcInstant) : new Date(`${date}T12:00:00Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(date)) {
    const normalized = date.length === 16 ? date : date.slice(0, 16);
    const utcInstant = zonedLocalDateTimeToUtc(normalized, timezone);
    return utcInstant ? new Date(utcInstant) : new Date(date);
  }
  const parsed = new Date(date);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function resolveTargetDate(
  date: Date | string | number | null | undefined,
  timezone: string,
): Date | null {
  if (date == null || date === "") return null;
  if (typeof date === "string") return parseDateStringInstant(date, timezone);
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function extractTimeZonePart(format: Intl.DateTimeFormat, date: Date): string | null {
  try {
    return format.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? null;
  } catch {
    return null;
  }
}

function formatGenericTimezoneName(timezone: string): string {
  const now = new Date();
  try {
    const generic = extractTimeZonePart(
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longGeneric" }),
      now,
    );
    if (generic && !generic.startsWith("GMT")) return generic;
  } catch {
    // Fall through
  }
  try {
    const seasonal = extractTimeZonePart(
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "long" }),
      now,
    );
    if (seasonal) return seasonal;
  } catch {
    // Fall through
  }
  return timezone;
}

export function formatTimezoneName(timezone: string, date?: Date | string | number | null): string {
  if (!isValidTimeZone(timezone)) return timezone;
  if (timezone === "UTC") return "UTC";

  const targetDate = resolveTargetDate(date, timezone);
  if (targetDate) {
    try {
      const named = extractTimeZonePart(
        new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "long" }),
        targetDate,
      );
      if (named) return named;
    } catch {
      // Fall through
    }
  }

  return formatGenericTimezoneName(timezone);
}

export function formatTimezoneOption(timezone: string): string {
  if (timezone === "UTC") return "UTC";
  const name = formatTimezoneName(timezone);
  if (name && name !== timezone) {
    return `${timezone} (${name})`;
  }
  return timezone;
}
