import type { OrganizationEventRsvpHistoryEntry } from "@choir/contracts";
import type { ReactElement } from "react";

export function displayEventDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function lastName(value: string): string {
  const parts = value.trim().split(/\s+/);
  return parts.length > 1 ? (parts.at(-1) ?? value) : value;
}

export function statusText(status: "Yes" | "No" | "Pending"): string {
  if (status === "Yes") return "Attending";
  if (status === "No") return "Declined";
  return "No response";
}

export function historySource(entry: OrganizationEventRsvpHistoryEntry): string {
  return entry.automatic ? "Automation" : "Manual update";
}

export function formatHistoryDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function historyStatusBadge(status: "Yes" | "No" | "Pending"): ReactElement {
  return (
    <span className={`rsvp-status-badge rsvp-status-badge--${status}`}>{statusText(status)}</span>
  );
}
