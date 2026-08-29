import {
  organizationAttendanceResponseSchema,
  organizationEventSchema,
  organizationEventArchiveResponseSchema,
  organizationEventCancelResponseSchema,
  organizationEventRsvpHistoryResponseSchema,
  organizationEventsResponseSchema,
  organizationDashboardSummaryResponseSchema,
  organizationCalendarSettingsResponseSchema,
  organizationRsvpSchema,
  organizationVenueSchema,
  organizationVenueDeleteResponseSchema,
  organizationVenuesResponseSchema,
  type OrganizationAttendanceRow,
  type OrganizationAttendanceUpdate,
  type OrganizationCalendarSettings,
  type OrganizationDashboardSummaryResponse,
  type OrganizationEvent,
  type OrganizationEventRequest,
  type OrganizationEventRsvpHistoryResponse,
  type OrganizationRsvp,
  type OrganizationRsvpRequest,
  type OrganizationVenue,
} from "@choir/contracts";

import { request } from "./client";

export async function listOrganizationVenues(
  signal?: AbortSignal,
): Promise<readonly OrganizationVenue[]> {
  const response = await request("/api/organization/venues", { signal: signal ?? null });
  return organizationVenuesResponseSchema.parse(await response.json()).venues;
}

export async function createOrganizationVenue(
  name: string,
  address: string,
): Promise<OrganizationVenue> {
  const response = await request("/api/organization/venues", {
    body: JSON.stringify({ address, name }),
    method: "POST",
  });
  return organizationVenueSchema.parse(await response.json());
}

export async function updateOrganizationVenue(
  venueId: string,
  name: string,
  address: string,
): Promise<OrganizationVenue> {
  const response = await request(`/api/organization/venues/${encodeURIComponent(venueId)}`, {
    body: JSON.stringify({ address, name }),
    method: "PUT",
  });
  return organizationVenueSchema.parse(await response.json());
}

export async function deleteOrganizationVenue(venueId: string): Promise<void> {
  const response = await request(`/api/organization/venues/${encodeURIComponent(venueId)}`, {
    method: "DELETE",
  });
  organizationVenueDeleteResponseSchema.parse(await response.json());
}

export async function listOrganizationEvents(
  signal?: AbortSignal,
): Promise<readonly OrganizationEvent[]> {
  const response = await request("/api/organization/events", { signal: signal ?? null });
  return organizationEventsResponseSchema.parse(await response.json()).events;
}

export async function getOrganizationDashboardSummary(
  signal?: AbortSignal,
): Promise<OrganizationDashboardSummaryResponse> {
  const response = await request("/api/organization/dashboard-summary", {
    signal: signal ?? null,
  });
  return organizationDashboardSummaryResponseSchema.parse(await response.json());
}

export async function createOrganizationEvent(
  event: OrganizationEventRequest,
): Promise<OrganizationEvent> {
  const response = await request("/api/organization/events", {
    body: JSON.stringify(event),
    method: "POST",
  });
  return organizationEventSchema.parse(await response.json());
}

export async function updateOrganizationEvent(
  eventId: string,
  event: OrganizationEventRequest,
): Promise<OrganizationEvent> {
  const response = await request(`/api/organization/events/${encodeURIComponent(eventId)}`, {
    body: JSON.stringify(event),
    method: "PUT",
  });
  return organizationEventSchema.parse(await response.json());
}

export async function archiveOrganizationEvent(eventId: string): Promise<void> {
  const response = await request(`/api/organization/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
  organizationEventArchiveResponseSchema.parse(await response.json());
}

export async function cancelOrganizationEvent(eventId: string): Promise<void> {
  const response = await request(`/api/organization/events/${encodeURIComponent(eventId)}/cancel`, {
    method: "POST",
  });
  organizationEventCancelResponseSchema.parse(await response.json());
}

export async function setOrganizationEventRsvp(
  eventId: string,
  profileId: string,
  rsvp: "No" | "Pending" | "Yes",
  rsvpNote = "",
): Promise<OrganizationRsvp> {
  const response = await request(`/api/organization/events/${encodeURIComponent(eventId)}/rsvp`, {
    body: JSON.stringify({ profileId, rsvp, rsvpNote }),
    method: "PUT",
  });
  return organizationRsvpSchema.parse(await response.json());
}

export async function bulkUpdateOrganizationEventRsvp(
  eventId: string,
  updates: readonly OrganizationRsvpRequest[],
): Promise<readonly OrganizationAttendanceRow[]> {
  const response = await request(
    `/api/organization/events/${encodeURIComponent(eventId)}/rsvp/bulk`,
    {
      body: JSON.stringify({ updates }),
      method: "PUT",
    },
  );
  return organizationAttendanceResponseSchema.parse(await response.json()).rows;
}

export async function listOrganizationEventAttendance(
  eventId: string,
  signal?: AbortSignal,
): Promise<readonly OrganizationAttendanceRow[]> {
  const response = await request(
    `/api/organization/events/${encodeURIComponent(eventId)}/attendance`,
    { signal: signal ?? null },
  );
  return organizationAttendanceResponseSchema.parse(await response.json()).rows;
}

export async function getOrganizationEventRsvpHistory(
  eventId: string,
  signal?: AbortSignal,
): Promise<OrganizationEventRsvpHistoryResponse> {
  const response = await request(
    `/api/organization/events/${encodeURIComponent(eventId)}/rsvp-history`,
    { signal: signal ?? null },
  );
  return organizationEventRsvpHistoryResponseSchema.parse(await response.json());
}

export async function updateOrganizationEventAttendance(
  eventId: string,
  updates: readonly OrganizationAttendanceUpdate[],
): Promise<readonly OrganizationAttendanceRow[]> {
  const response = await request(
    `/api/organization/events/${encodeURIComponent(eventId)}/attendance`,
    { body: JSON.stringify({ updates }), method: "PUT" },
  );
  return organizationAttendanceResponseSchema.parse(await response.json()).rows;
}

export async function getOrganizationCalendarSettings(
  signal?: AbortSignal,
): Promise<OrganizationCalendarSettings> {
  const response = await request("/api/organization/calendar-settings", {
    signal: signal ?? null,
  });
  return organizationCalendarSettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationCalendarSettings(
  timezone: string,
): Promise<OrganizationCalendarSettings> {
  const response = await request("/api/organization/calendar-settings", {
    body: JSON.stringify({ timezone }),
    method: "PUT",
  });
  return organizationCalendarSettingsResponseSchema.parse(await response.json());
}
