import {
  organizationEventSchema,
  organizationEventsResponseSchema,
  organizationRsvpSchema,
  organizationVenueSchema,
  organizationVenuesResponseSchema,
  type OrganizationEvent,
  type OrganizationEventRequest,
  type OrganizationRsvp,
  type OrganizationRsvpRequest,
  type OrganizationVenue,
  type OrganizationVenueRequest,
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
