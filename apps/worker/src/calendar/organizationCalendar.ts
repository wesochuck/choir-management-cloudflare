import {
  organizationEventSchema,
  organizationEventArchiveResponseSchema,
  organizationEventsResponseSchema,
  organizationCalendarSettingsResponseSchema,
  organizationRsvpSchema,
  organizationVenueSchema,
  organizationVenuesResponseSchema,
  singerEventsResponseSchema,
  type OrganizationEvent,
  type OrganizationEventRequest,
  type OrganizationEventArchiveResponse,
  type OrganizationRsvp,
  type OrganizationRsvpRequest,
  type OrganizationVenue,
  type OrganizationVenueRequest,
  type OrganizationCalendarSettings,
  type SingerEvent,
} from "@choir/contracts";

import type { Env } from "../env";

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
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
  if (!response.ok) throw new Error("The Organization store rejected the calendar mutation.");
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

export async function listOrganizationEvents(
  env: Env,
  organizationId: string,
): Promise<readonly OrganizationEvent[]> {
  return organizationEventsResponseSchema
    .omit({ requestId: true })
    .parse(await listResource(env, organizationId, "events")).events;
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
