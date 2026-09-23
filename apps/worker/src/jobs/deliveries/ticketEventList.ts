export interface TicketBundleEventDetails {
  readonly id?: string | undefined;
  readonly location: string;
  readonly startsAt: string;
  readonly title: string;
  readonly venueAddress: string;
  readonly venueName: string;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function formatTicketBundleEventList(
  events: readonly TicketBundleEventDetails[],
  timezone: string,
): string {
  if (events.length === 0) return "";

  const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  });

  return [...events]
    .sort((left, right) => {
      const leftStart = Date.parse(left.startsAt);
      const rightStart = Date.parse(right.startsAt);
      if (leftStart < rightStart) return -1;
      if (leftStart > rightStart) return 1;
      return compareText(left.title, right.title) || compareText(left.id ?? "", right.id ?? "");
    })
    .map((event) => {
      const dateTime = dateTimeFormatter.format(new Date(event.startsAt));
      const venue = event.venueName.trim();
      const addressOrLocation = (event.venueAddress.trim() || event.location.trim()).trim();
      const locationParts = [venue, addressOrLocation].filter((part) => part.length > 0);
      const locationLine =
        locationParts.length > 0 ? `\n  - **Location:** ${locationParts.join(", ")}` : "";

      return `- **${event.title}**\n  - **Date and time:** ${dateTime}${locationLine}`;
    })
    .join("\n");
}
