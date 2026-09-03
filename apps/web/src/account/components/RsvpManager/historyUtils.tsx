import type {
  OrganizationEvent,
  OrganizationEventRsvpHistoryEntry,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import type { DataTableColumn } from "@choir/ui";

import { formatHistoryDate, historySource, historyStatusBadge, lastName } from "./rsvpFormat";

export type HistoryFilter = "All" | "Yes" | "No" | "Pending";

export function isHistoryFilter(value: string): value is HistoryFilter {
  return value === "All" || value === "Yes" || value === "No" || value === "Pending";
}

export function nearestUpcomingPerformance(events: readonly OrganizationEvent[]): string {
  const now = Date.now();
  return (
    [...events]
      .filter((event) => event.type === "Performance" && new Date(event.startsAt).getTime() >= now)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0]?.id ?? ""
  );
}

export const rsvpHistoryColumns: readonly DataTableColumn<OrganizationEventRsvpHistoryEntry>[] = [
  {
    header: "Performer",
    id: "profile",
    render: (entry) => <strong>{entry.displayName}</strong>,
    sortValue: (entry) => lastName(entry.displayName),
  },
  {
    header: "Previous RSVP",
    id: "previousRsvp",
    render: (entry) => historyStatusBadge(entry.previousRsvp),
    sortValue: (entry) => entry.previousRsvp,
  },
  {
    header: "New RSVP",
    id: "newRsvp",
    render: (entry) => historyStatusBadge(entry.newRsvp),
    sortValue: (entry) => entry.newRsvp,
  },
  {
    header: "Reason",
    id: "reason",
    render: (entry) => entry.reason,
    sortValue: (entry) => entry.reason,
  },
  {
    header: "Source",
    id: "source",
    render: (entry) => historySource(entry),
    sortValue: (entry) => historySource(entry),
  },
  {
    header: "Changed",
    id: "occurredAt",
    render: (entry) => formatHistoryDate(entry.occurredAt),
    sortValue: (entry) => entry.occurredAt,
  },
];

export function reportableSections(roster: OrganizationRosterConfiguration) {
  return roster.sections.filter(({ trackOnly }) => !trackOnly);
}

export function reportableVoiceParts(roster: OrganizationRosterConfiguration) {
  const trackOnlySections = new Set(
    roster.sections.filter(({ trackOnly }) => trackOnly).map(({ code }) => code),
  );
  return roster.voiceParts.filter(({ sectionCode }) => !trackOnlySections.has(sectionCode));
}
