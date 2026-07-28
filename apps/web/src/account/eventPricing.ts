import { zonedLocalDateTimeToUtc } from "@choir/domain";

export function dayOfPriceStartLabel(localStart: string, timezone: string): string | null {
  const localDate = localStart.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
  const midnight = zonedLocalDateTimeToUtc(`${localDate}T00:00`, timezone);
  if (!midnight) return null;
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(midnight));
  return `Advance pricing applies before ${formatted}; day-of pricing starts then (${timezone}). Ticket sales open as soon as this performance is published.`;
}
