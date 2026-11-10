import { eventWebsiteVisibility } from "./eventWebsiteVisibility";
import { ticketSalesPath } from "./ticketLinks";

export const UPCOMING_PERFORMANCES_PLACEHOLDER = "{{UPCOMING_PERFORMANCES}}";
export const UPCOMING_PERFORMANCES_EMPTY_FALLBACK = "No upcoming performances scheduled.";

const upcomingPerformancesPlaceholderPattern = /\{\{UPCOMING_PERFORMANCES\}\}/i;
const upcomingPerformancesReplacementPattern = /\{\{UPCOMING_PERFORMANCES\}\}/gi;

export interface UpcomingPerformanceListItem {
  readonly id: string;
  readonly isArchived?: boolean | undefined;
  readonly isCanceled?: boolean | undefined;
  readonly isTicketingEnabled: boolean;
  readonly location: string;
  readonly publishOnWebsite: boolean;
  readonly startsAt: string;
  readonly ticketSlug?: string | null | undefined;
  readonly title: string;
  readonly type: "Performance" | "Rehearsal" | "Other";
  readonly venueAddress?: string | undefined;
  readonly venueName?: string | undefined;
}

export function usesUpcomingPerformancesPlaceholder(text: string): boolean {
  return upcomingPerformancesPlaceholderPattern.test(text);
}

export function replaceUpcomingPerformancesPlaceholder(
  content: string,
  replacement: string,
): string {
  return content.replace(upcomingPerformancesReplacementPattern, () => replacement);
}

/**
 * Only Messages targeted strictly to Members may include internal/unpublished
 * Performances. Any audience that includes external recipients (Contacts,
 * Ticket Buyers, Donors) or an empty/unknown audience is restricted to
 * Performances published on the public website or ticketing pages.
 */
export function shouldIncludeUnpublishedUpcomingPerformances(
  targetAudiences: readonly string[],
): boolean {
  return targetAudiences.length === 1 && targetAudiences[0] === "Members";
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sanitizeSingleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function formatPerformanceLocation(event: UpcomingPerformanceListItem): string {
  const venueName = sanitizeSingleLine(event.venueName ?? "");
  const venueAddress = sanitizeSingleLine(event.venueAddress ?? "");
  const rawLocation = sanitizeSingleLine(event.location);

  if (venueName.length > 0) {
    const secondary =
      venueAddress.length > 0 && venueAddress !== venueName
        ? venueAddress
        : rawLocation.length > 0 && rawLocation !== venueName
          ? rawLocation
          : "";
    return secondary.length > 0 ? `${venueName}, ${secondary}` : venueName;
  }

  if (rawLocation.length > 0 && venueAddress.length > 0 && rawLocation !== venueAddress) {
    return `${rawLocation}, ${venueAddress}`;
  }

  return rawLocation || venueAddress;
}

function buildTicketLink(
  event: UpcomingPerformanceListItem,
  canonicalOrigin: string | null | undefined,
  allowRelativeLinks: boolean,
): string | null {
  if (!event.isTicketingEnabled) return null;
  const path = ticketSalesPath({ id: event.id, ticketSlug: event.ticketSlug });
  const trimmedOrigin = canonicalOrigin?.trim();
  if (trimmedOrigin) {
    try {
      const parsed = new URL(trimmedOrigin);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return new URL(path, parsed.origin).toString();
      }
    } catch {
      return null;
    }
    return null;
  }
  return allowRelativeLinks ? path : null;
}

export function filterUpcomingPerformances<T extends UpcomingPerformanceListItem>(
  events: readonly T[],
  options: {
    readonly includeUnpublished: boolean;
    readonly nowMs: number;
  },
): T[] {
  return events
    .filter((event) => {
      if (event.type !== "Performance") return false;
      if (event.isArchived || event.isCanceled) return false;
      const startsAtMs = Date.parse(event.startsAt);
      if (!Number.isFinite(startsAtMs) || startsAtMs < options.nowMs) return false;
      return options.includeUnpublished || eventWebsiteVisibility(event);
    })
    .sort((left, right) => {
      const leftStart = Date.parse(left.startsAt);
      const rightStart = Date.parse(right.startsAt);
      if (leftStart < rightStart) return -1;
      if (leftStart > rightStart) return 1;
      return compareText(left.title, right.title) || compareText(left.id, right.id);
    });
}

export function formatUpcomingPerformancesList(
  performances: readonly UpcomingPerformanceListItem[],
  options: {
    readonly allowRelativeLinks?: boolean | undefined;
    readonly canonicalOrigin?: string | null | undefined;
    readonly emptyFallback?: string | undefined;
    readonly timezone: string;
  },
): string {
  if (performances.length === 0) {
    return options.emptyFallback ?? UPCOMING_PERFORMANCES_EMPTY_FALLBACK;
  }

  const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: options.timezone,
  });
  const allowRelativeLinks = options.allowRelativeLinks ?? false;

  return performances
    .map((event) => {
      const title = sanitizeSingleLine(event.title) || "Upcoming Performance";
      const dateTime = dateTimeFormatter.format(new Date(event.startsAt));
      const location = formatPerformanceLocation(event);
      const locationLine = location.length > 0 ? `\n  - **Location:** ${location}` : "";
      const ticketUrl = buildTicketLink(event, options.canonicalOrigin, allowRelativeLinks);
      const ticketsLine = ticketUrl ? `\n  - **Tickets:** [Buy tickets](${ticketUrl})` : "";
      return `- **${title}**\n  - **Date and time:** ${dateTime}${locationLine}${ticketsLine}`;
    })
    .join("\n\n");
}
