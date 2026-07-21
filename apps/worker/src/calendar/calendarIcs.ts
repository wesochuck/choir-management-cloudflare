import { z } from "zod";

const setListItemSchema = z.object({
  composer: z.string().max(300).optional(),
  isFeaturedNumber: z.boolean().optional(),
  performerCredits: z.array(z.object({ displayName: z.string().max(200).optional() })).optional(),
  soloSmallGroup: z.boolean().optional(),
  title: z.string().min(1).max(300),
  type: z.string().max(100).optional(),
});

export interface CalendarProjectionEvent {
  readonly callTime: string;
  readonly details: string;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly location: string;
  readonly resolvedRsvp: "Pending" | "Yes";
  readonly setListApproved: boolean;
  readonly setListJson: string;
  readonly startsAt: string;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal";
  readonly venueAddress: string;
  readonly venueName: string;
}

interface CalendarProjection {
  readonly events: readonly CalendarProjectionEvent[];
  readonly generatedAt: Date;
  readonly organizationName: string;
  readonly profileName: string;
  readonly timezone: string;
}

function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function formatUtc(date: Date): string {
  return date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
}

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

function localDatePart(date: Date, timezone: string): string {
  const parts = timeZoneParts(date, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localDateTimeToUtc(datePart: string, time: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) return null;
  const desired = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
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
  const resultParts = timeZoneParts(result, timezone);
  return resultParts.year === Number(match[1]) &&
    resultParts.month === Number(match[2]) &&
    resultParts.day === Number(match[3]) &&
    (resultParts.hour === 24 ? 0 : resultParts.hour) === Number(timeMatch[1]) &&
    resultParts.minute === Number(timeMatch[2])
    ? result
    : null;
}

function performerCredit(item: z.infer<typeof setListItemSchema>): string {
  const featured = item.isFeaturedNumber ?? item.soloSmallGroup === true;
  if (!featured || item.type === "intermission") return "";
  const names = (item.performerCredits ?? [])
    .map((credit) => credit.displayName?.trim() ?? "")
    .filter(Boolean);
  if (names.length === 0) return "Featured Number — Performers TBA";
  return `${names.length === 1 ? "Solo" : "Group"} — ${names.join(", ")}`;
}

function parseSetList(value: string): z.infer<typeof setListItemSchema>[] {
  try {
    const parsed = z.array(setListItemSchema).safeParse(JSON.parse(value || "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function eventDescription(event: CalendarProjectionEvent): string {
  const description = [
    `Type: ${event.type}`,
    `Your Status: ${event.resolvedRsvp === "Yes" ? "Attending" : "Pending RSVP"}`,
  ];
  if (event.callTime) description.push(`Call Time: ${event.callTime}`);
  if (event.details) description.push(`\nDetails:\n${event.details}`);
  if (event.setListApproved && event.resolvedRsvp === "Yes") {
    const setList = parseSetList(event.setListJson);
    if (setList.length > 0) {
      description.push("\nSet List:");
      setList.forEach((item, index) => {
        description.push(
          `${String(index + 1)}. ${item.title}${item.composer ? ` (${item.composer})` : ""}`,
        );
        const credit = performerCredit(item);
        if (credit) description.push(`   ${credit}`);
      });
    }
  }
  return description.join("\n");
}

export function renderCalendarIcs(input: CalendarProjection): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Choir Management Tool//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcsText(input.organizationName)}`,
    `X-WR-CALDESC:${escapeIcsText(`Personal schedule for ${input.profileName}`)}`,
  ];
  for (const event of input.events) {
    const start = new Date(event.startsAt);
    if (!Number.isFinite(start.getTime())) continue;
    const duration = event.durationMinutes ?? (event.type === "Performance" ? 150 : 120);
    const end = new Date(start.getTime() + duration * 60_000);
    const location = event.venueName
      ? `${event.venueName}${event.venueAddress ? `, ${event.venueAddress}` : ""}`
      : event.location;
    const uid = `event-${event.id}@choir-management.local`;
    if (event.callTime) {
      const callStart = localDateTimeToUtc(
        localDatePart(start, input.timezone),
        event.callTime,
        input.timezone,
      );
      if (callStart && callStart < start) {
        lines.push(
          "BEGIN:VEVENT",
          `UID:call-${uid}`,
          `DTSTAMP:${formatUtc(input.generatedAt)}`,
          `DTSTART:${formatUtc(callStart)}`,
          `DTEND:${formatUtc(start)}`,
          `SUMMARY:Call Time: ${escapeIcsText(event.title)}`,
          `LOCATION:${escapeIcsText(location)}`,
          `DESCRIPTION:Arrival and warm-up for ${escapeIcsText(event.title)}.`,
          "END:VEVENT",
        );
      }
    }
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${formatUtc(input.generatedAt)}`,
      `DTSTART:${formatUtc(start)}`,
      `DTEND:${formatUtc(end)}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      `LOCATION:${escapeIcsText(location)}`,
      `DESCRIPTION:${escapeIcsText(eventDescription(event))}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}
