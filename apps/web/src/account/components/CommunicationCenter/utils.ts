import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  OrganizationEvent,
} from "@choir/contracts";
import { AuthApiError } from "../../../auth/api";
import type { CommunicationAudienceTarget, CommunicationTab } from "./types";

export const defaultAudience: CommunicationAudienceRequest = {
  eventId: null,
  globalStatuses: ["Active"],
  profileIds: [],
  rsvp: "All",
  targetAudiences: ["Members"],
  voiceParts: [],
};

export function failureMessage(error: unknown): string {
  return error instanceof AuthApiError
    ? error.message
    : "Organization communications are temporarily unavailable.";
}

export function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function eventLabel(event: OrganizationEvent): string {
  return `${event.title} · ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(event.startsAt))}`;
}

export function channelFromValue(value: string): CommunicationChannel {
  if (value === "SMS" || value === "Both") return value;
  return "Email";
}

export const audienceOptions: readonly CommunicationAudienceTarget[] = [
  "Members",
  "Ticket Buyers",
  "Donors",
];

export function communicationTabFromSearch(search: string): CommunicationTab | null {
  const tab = new URLSearchParams(search).get("tab");
  return tab === "compose" ||
    tab === "drafts" ||
    tab === "history" ||
    tab === "templates" ||
    tab === "upcoming" ||
    tab === "settings"
    ? tab
    : null;
}

export const defaultTestEmailSubject = "Choir Management connection test";

export const defaultTestEmailContent =
  "This is a test email from Choir Management. Your organization email delivery is configured.";
