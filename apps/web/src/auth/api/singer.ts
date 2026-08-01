import {
  calendarFeedUrlsResponseSchema,
  singerSeatingResponseSchema,
  organizationRsvpSchema,
  singerEventsResponseSchema,
  type CalendarFeedUrlsResponse,
  type SingerSeatingResponse,
  type OrganizationRsvp,
  type SingerEventsResponse,
} from "@choir/contracts";

import { request } from "./client";

export async function getCalendarFeedUrls(signal?: AbortSignal): Promise<CalendarFeedUrlsResponse> {
  const response = await request("/api/singer/calendar-feed-url", { signal: signal ?? null });
  return calendarFeedUrlsResponseSchema.parse(await response.json());
}

export async function resetCalendarFeedUrls(): Promise<CalendarFeedUrlsResponse> {
  const response = await request("/api/singer/calendar-feed-url/reset", {
    body: JSON.stringify({}),
    method: "POST",
  });
  return calendarFeedUrlsResponseSchema.parse(await response.json());
}

export async function getMyEventSeating(
  eventId: string,
  signal?: AbortSignal,
): Promise<SingerSeatingResponse> {
  const response = await request(`/api/singer/events/${encodeURIComponent(eventId)}/seating`, {
    signal: signal ?? null,
  });
  return singerSeatingResponseSchema.parse(await response.json());
}

export async function getMySchedule(signal?: AbortSignal): Promise<SingerEventsResponse> {
  const response = await request("/api/singer/events", { signal: signal ?? null });
  return singerEventsResponseSchema.parse(await response.json());
}

export async function setMyEventRsvp(
  eventId: string,
  rsvp: "No" | "Pending" | "Yes",
  rsvpNote = "",
): Promise<OrganizationRsvp> {
  const response = await request(`/api/singer/events/${encodeURIComponent(eventId)}/rsvp`, {
    body: JSON.stringify({ rsvp, rsvpNote }),
    method: "PUT",
  });
  return organizationRsvpSchema.parse(await response.json());
}
