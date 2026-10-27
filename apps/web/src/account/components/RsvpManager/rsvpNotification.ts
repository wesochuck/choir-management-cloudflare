import type { CommunicationAudienceRequest } from "@choir/contracts";

export type RsvpNotificationStatus = CommunicationAudienceRequest["globalStatuses"][number];

export function rsvpNotificationHref(
  eventId: string,
  voiceParts: readonly string[],
  globalStatuses: readonly RsvpNotificationStatus[] = ["Active"],
): string {
  const params = new URLSearchParams({ tab: "compose", rsvpEventId: eventId });
  for (const part of new Set(voiceParts.filter((part) => part.trim() !== ""))) {
    params.append("rsvpPart", part);
  }
  if (globalStatuses.length !== 1 || globalStatuses[0] !== "Active") {
    for (const status of globalStatuses) params.append("rsvpStatus", status);
  }
  return `/admin/communications?${params.toString()}`;
}

export function rsvpNotificationAudience(
  eventId: string,
  voiceParts: readonly string[],
  globalStatuses: readonly RsvpNotificationStatus[] = ["Active"],
): CommunicationAudienceRequest {
  return {
    contactEmailStatus: null,
    contactIds: [],
    contactListIds: [],
    contactSmsStatus: null,
    contactSource: null,
    eventId,
    globalStatuses: [...globalStatuses],
    profileIds: [],
    rsvp: "Pending",
    targetAudiences: ["Members"],
    ticketBuyerMode: "marketing",
    voiceParts: [...voiceParts],
  };
}
