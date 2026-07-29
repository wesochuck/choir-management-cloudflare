import {
  organizationAttendanceResponseSchema,
  organizationEventSchema,
  organizationEventArchiveResponseSchema,
  organizationEventRsvpExportDataSchema,
  organizationEventsResponseSchema,
  organizationCalendarSettingsResponseSchema,
  organizationDashboardSummaryResponseSchema,
  organizationRosterConfigurationRequestSchema,
  organizationRsvpSchema,
  organizationProfilePerformanceHistoryResponseSchema,
  organizationVenueSchema,
  organizationVenueDeleteResponseSchema,
  organizationVenuesResponseSchema,
  singerEventsResponseSchema,
  type OrganizationEvent,
  type OrganizationAttendanceRow,
  type OrganizationAttendanceUpdate,
  type OrganizationEventRequest,
  type OrganizationEventArchiveResponse,
  type OrganizationEventRsvpExportData,
  type OrganizationRsvp,
  type OrganizationRsvpRequest,
  type OrganizationVenue,
  type OrganizationVenueRequest,
  type OrganizationCalendarSettings,
  type OrganizationDashboardSummaryResponse,
  type OrganizationRosterConfiguration,
  type OrganizationProfilePerformanceHistoryResponse,
  type SingerEvent,
} from "@choir/contracts";

import type { Env } from "../env";

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export class CalendarMutationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`The Organization store rejected the calendar mutation (${code}).`);
    this.name = "CalendarMutationError";
  }
}

function errorCode(value: unknown): string {
  if (typeof value !== "object" || value === null || !("code" in value)) return "unknown";
  return typeof value.code === "string" ? value.code : "unknown";
}

function stub(env: Env, organizationId: string): DurableObjectStub {
  return env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));
}

async function listResource(
  env: Env,
  organizationId: string,
  resource: "events" | "venues",
): Promise<unknown> {
  const url = new URL(`https://organization.internal/internal/calendar/${resource}`);
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) throw new Error(`The Organization store rejected the ${resource} request.`);
  return response.json();
}

export async function listOrganizationEventAttendance(
  env: Env,
  organizationId: string,
  eventId: string,
): Promise<readonly OrganizationAttendanceRow[]> {
  const url = new URL("https://organization.internal/internal/calendar/attendance");
  url.searchParams.set("eventId", eventId);
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) throw new Error("The Organization store rejected the attendance request.");
  return organizationAttendanceResponseSchema.omit({ requestId: true }).parse(await response.json())
    .rows;
}

export async function readOrganizationEventRsvpExport(
  env: Env,
  organizationId: string,
  eventId: string,
): Promise<OrganizationEventRsvpExportData | null> {
  const url = new URL("https://organization.internal/internal/calendar/event-rsvp-export");
  url.searchParams.set("eventId", eventId);
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The Organization store rejected the event RSVP export.");
  return organizationEventRsvpExportDataSchema.parse(await response.json());
}

export async function updateOrganizationEventAttendance(
  env: Env,
  actor: ActorContext,
  eventId: string,
  updates: readonly OrganizationAttendanceUpdate[],
): Promise<readonly OrganizationAttendanceRow[]> {
  return organizationAttendanceResponseSchema.omit({ requestId: true }).parse(
    await mutate(env, {
      action: "bulk_attendance",
      ...actor,
      attendance: { updates },
      eventId,
    }),
  ).rows;
}

async function mutate(
  env: Env,
  input: ActorContext & Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const response = await stub(env, input.organizationId).fetch(
    "https://organization.internal/internal/calendar/manage",
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new CalendarMutationError(errorCode(body), response.status);
  }
  return response.json();
}

export async function listOrganizationVenues(
  env: Env,
  organizationId: string,
): Promise<readonly OrganizationVenue[]> {
  return organizationVenuesResponseSchema
    .omit({ requestId: true })
    .parse(await listResource(env, organizationId, "venues")).venues;
}

export async function createOrganizationVenue(
  env: Env,
  actor: ActorContext,
  venue: OrganizationVenueRequest,
): Promise<OrganizationVenue> {
  return organizationVenueSchema.parse(
    await mutate(env, {
      action: "create_venue",
      ...actor,
      venue: { ...venue, id: crypto.randomUUID() },
    }),
  );
}

export async function updateOrganizationVenue(
  env: Env,
  actor: ActorContext,
  venue: OrganizationVenueRequest & Readonly<{ id: string }>,
): Promise<OrganizationVenue> {
  return organizationVenueSchema.parse(
    await mutate(env, {
      action: "update_venue",
      ...actor,
      venue,
    }),
  );
}

export async function deleteOrganizationVenue(
  env: Env,
  actor: ActorContext,
  venueId: string,
): Promise<"deleted" | "in_use" | "not_found"> {
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/calendar/manage",
    {
      body: JSON.stringify({ action: "delete_venue", ...actor, venueId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (response.status === 409) return "in_use";
  if (response.status === 404) return "not_found";
  if (!response.ok) throw new Error("The Organization store rejected the venue deletion.");
  return organizationVenueDeleteResponseSchema
    .omit({ requestId: true })
    .parse(await response.json()).status;
}

export async function listOrganizationEvents(
  env: Env,
  organizationId: string,
): Promise<readonly OrganizationEvent[]> {
  return organizationEventsResponseSchema
    .omit({ requestId: true })
    .parse(await listResource(env, organizationId, "events")).events;
}

export async function readOrganizationDashboardSummary(
  env: Env,
  organizationId: string,
): Promise<Omit<OrganizationDashboardSummaryResponse, "requestId">> {
  const url = new URL("https://organization.internal/internal/calendar/dashboard-summary");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) {
    throw new Error("The Organization store rejected the dashboard summary request.");
  }
  return organizationDashboardSummaryResponseSchema
    .omit({ requestId: true })
    .parse(await response.json());
}

export async function createOrganizationEvent(
  env: Env,
  actor: ActorContext,
  event: OrganizationEventRequest,
): Promise<OrganizationEvent> {
  return organizationEventSchema.parse(
    await mutate(env, {
      action: "create_event",
      ...actor,
      event: { ...event, id: crypto.randomUUID() },
    }),
  );
}

export async function updateOrganizationEvent(
  env: Env,
  actor: ActorContext,
  eventId: string,
  event: OrganizationEventRequest,
): Promise<OrganizationEvent> {
  return organizationEventSchema.parse(
    await mutate(env, { action: "update_event", ...actor, event: { ...event, id: eventId } }),
  );
}

export async function archiveOrganizationEvent(
  env: Env,
  actor: ActorContext,
  eventId: string,
): Promise<Omit<OrganizationEventArchiveResponse, "requestId">> {
  return organizationEventArchiveResponseSchema
    .omit({ requestId: true })
    .parse(await mutate(env, { action: "archive_event", ...actor, eventId }));
}

export async function setOrganizationEventRsvp(
  env: Env,
  actor: ActorContext,
  eventId: string,
  rsvp: OrganizationRsvpRequest,
): Promise<OrganizationRsvp> {
  return organizationRsvpSchema.parse(
    await mutate(env, { action: "set_rsvp", ...actor, eventId, rsvp }),
  );
}

export async function readOrganizationCalendarSettings(
  env: Env,
  organizationId: string,
): Promise<OrganizationCalendarSettings> {
  const url = new URL("https://organization.internal/internal/calendar/settings");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok)
    throw new Error("The Organization store rejected the calendar settings request.");
  return organizationCalendarSettingsResponseSchema
    .omit({ requestId: true })
    .parse(await response.json());
}

export async function updateOrganizationCalendarSettings(
  env: Env,
  actor: ActorContext,
  settings: OrganizationCalendarSettings,
): Promise<OrganizationCalendarSettings> {
  return organizationCalendarSettingsResponseSchema
    .omit({ requestId: true })
    .parse(await mutate(env, { action: "update_timezone", ...actor, settings }));
}

export async function readOrganizationRosterConfiguration(
  env: Env,
  organizationId: string,
): Promise<OrganizationRosterConfiguration> {
  const url = new URL("https://organization.internal/internal/roster/configuration");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) {
    throw new Error("The Organization store rejected the roster configuration request.");
  }
  return organizationRosterConfigurationRequestSchema.parse(await response.json());
}

export async function updateOrganizationRosterConfiguration(
  env: Env,
  actor: ActorContext,
  configuration: OrganizationRosterConfiguration,
): Promise<OrganizationRosterConfiguration | "voice_part_in_use"> {
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/calendar/manage",
    {
      body: JSON.stringify({ action: "update_roster_configuration", ...actor, configuration }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (response.status === 409) return "voice_part_in_use";
  if (!response.ok) {
    throw new Error("The Organization store rejected the roster configuration mutation.");
  }
  return organizationRosterConfigurationRequestSchema.parse(await response.json());
}

export async function listMemberSchedule(
  env: Env,
  organizationId: string,
  profileId: string,
  now = new Date(),
): Promise<readonly SingerEvent[]> {
  const url = new URL("https://organization.internal/internal/calendar/member-events");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("profileId", profileId);
  url.searchParams.set("readAt", now.toISOString());
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) throw new Error("The Organization store rejected the member schedule request.");
  return singerEventsResponseSchema.pick({ events: true }).parse(await response.json()).events;
}

export async function listOrganizationProfilePerformanceHistory(
  env: Env,
  organizationId: string,
  profileId: string,
  now = new Date(),
): Promise<Omit<OrganizationProfilePerformanceHistoryResponse, "requestId">> {
  const url = new URL(
    "https://organization.internal/internal/calendar/profile-performance-history",
  );
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("profileId", profileId);
  url.searchParams.set("readAt", now.toISOString());
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) {
    throw new Error("The Organization store rejected the Profile performance history request.");
  }
  return organizationProfilePerformanceHistoryResponseSchema
    .omit({ requestId: true })
    .parse(await response.json());
}
