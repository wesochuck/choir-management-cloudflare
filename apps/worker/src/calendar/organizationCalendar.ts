import {
  organizationAttendanceResponseSchema,
  organizationEventSchema,
  organizationEventRsvpHistoryResponseSchema,
  organizationEventArchiveResponseSchema,
  organizationEventCancelResponseSchema,
  organizationEventRsvpExportDataSchema,
  organizationEventsResponseSchema,
  organizationCalendarSettingsResponseSchema,
  organizationDashboardSummaryResponseSchema,
  organizationProfileFolderNumberSchema,
  organizationProfileFolderNumbersResponseSchema,
  organizationRosterConfigurationRequestSchema,
  organizationRosterAutomationPreviewResponseSchema,
  organizationRsvpSchema,
  organizationProfilePerformanceHistoryResponseSchema,
  organizationVenueSchema,
  organizationVenueDeleteResponseSchema,
  organizationVenuesResponseSchema,
  singerEventsResponseSchema,
  type OrganizationEvent,
  type OrganizationEventRsvpHistoryResponse,
  type OrganizationAttendanceRow,
  type OrganizationAttendanceUpdate,
  type OrganizationEventRequest,
  type OrganizationEventArchiveResponse,
  type OrganizationEventCancelResponse,
  type OrganizationEventRsvpExportData,
  type OrganizationProfileFolderNumber,
  type OrganizationProfileFolderNumberUpdate,
  type OrganizationRsvp,
  type OrganizationRsvpRequest,
  type OrganizationVenue,
  type OrganizationVenueRequest,
  type OrganizationCalendarSettings,
  type OrganizationDashboardSummaryResponse,
  type OrganizationRosterConfiguration,
  type OrganizationRosterAutomationPreviewResponse,
  type OrganizationProfilePerformanceHistoryResponse,
  type SingerEvent,
} from "@choir/contracts";

import type { Env } from "../env";
import { z } from "zod";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import {
  mutateOrganizationStore,
  readOrganizationStore,
  storeErrorCode,
} from "../organization/rpc/repository";

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

const organizationProfileEventRsvpSchema = z.object({
  callTime: z.string().max(5),
  details: z.string().max(100_000),
  displayName: z.string().min(1).max(200),
  durationMinutes: z.number().int().positive().nullable(),
  id: z.uuid(),
  location: z.string().max(2_000),
  profileId: z.uuid(),
  rsvp: z.enum(["No", "Pending", "Yes"]),
  rsvpNote: z.string().max(2_000),
  rsvpSelfServiceOpen: z.boolean(),
  startsAt: z.iso.datetime(),
  title: z.string().min(1).max(500),
  type: z.enum(["Performance", "Rehearsal"]),
  venueAddress: z.string().max(2_000),
  venueName: z.string().max(500),
});

export type OrganizationProfileEventRsvp = z.infer<typeof organizationProfileEventRsvpSchema>;

export class CalendarMutationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`The Organization store rejected the calendar mutation (${code}).`);
    this.name = "CalendarMutationError";
  }
}

async function listResource(
  env: Env,
  organizationId: string,
  resource: "events" | "venues",
): Promise<unknown> {
  const response = await readOrganizationStore(
    env,
    organizationId,
    `/internal/calendar/${resource}`,
  );
  if (!response.ok) throw new Error(`The Organization store rejected the ${resource} request.`);
  return response.json();
}

export async function listOrganizationEventAttendance(
  env: Env,
  organizationId: string,
  eventId: string,
): Promise<readonly OrganizationAttendanceRow[] | null> {
  const url = new URL("https://organization.internal/internal/calendar/attendance");
  url.searchParams.set("eventId", eventId);
  url.searchParams.set("organizationId", organizationId);
  const response = await invokeOrganizationRpc(organizationStoreStub(env, organizationId), url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The Organization store rejected the attendance request.");
  return organizationAttendanceResponseSchema.omit({ requestId: true }).parse(await response.json())
    .rows;
}

export async function listOrganizationEventRsvpHistory(
  env: Env,
  organizationId: string,
  eventId: string,
): Promise<OrganizationEventRsvpHistoryResponse | null> {
  const url = new URL("https://organization.internal/internal/calendar/event-rsvp-history");
  url.searchParams.set("eventId", eventId);
  url.searchParams.set("organizationId", organizationId);
  const response = await invokeOrganizationRpc(organizationStoreStub(env, organizationId), url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The Organization store rejected the RSVP history request.");
  return organizationEventRsvpHistoryResponseSchema.parse(await response.json());
}

export async function readOrganizationProfileEventRsvp(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  eventId: string,
  profileId: string,
): Promise<OrganizationProfileEventRsvp | null> {
  const url = new URL("https://organization.internal/internal/calendar/event-rsvp");
  url.searchParams.set("eventId", eventId);
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("profileId", profileId);
  const response = await invokeOrganizationRpc(organizationStoreStub(env, organizationId), url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The Organization store rejected the RSVP details request.");
  return organizationProfileEventRsvpSchema.parse(await response.json());
}

export async function listOrganizationProfileFolderNumbers(
  env: Env,
  organizationId: string,
  profileId: string,
): Promise<readonly OrganizationProfileFolderNumber[]> {
  const response = await readOrganizationStore(
    env,
    organizationId,
    "/internal/calendar/profile-folder-numbers",
    { profileId },
  );
  if (!response.ok) {
    throw new Error("The Organization store rejected the Profile folder numbers request.");
  }
  return organizationProfileFolderNumbersResponseSchema
    .omit({ requestId: true })
    .parse(await response.json()).folderNumbers;
}

export async function readOrganizationEventRsvpExport(
  env: Env,
  organizationId: string,
  eventId: string,
): Promise<OrganizationEventRsvpExportData | null> {
  const url = new URL("https://organization.internal/internal/calendar/event-rsvp-export");
  url.searchParams.set("eventId", eventId);
  url.searchParams.set("organizationId", organizationId);
  const response = await invokeOrganizationRpc(organizationStoreStub(env, organizationId), url);
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

export async function updateOrganizationProfileFolderNumber(
  env: Env,
  actor: ActorContext,
  profileId: string,
  eventId: string,
  folder: OrganizationProfileFolderNumberUpdate,
): Promise<OrganizationProfileFolderNumber> {
  return organizationProfileFolderNumberSchema.parse(
    await mutate(env, {
      action: "update_profile_folder_number",
      ...actor,
      eventId,
      folder,
      profileId,
    }),
  );
}

async function mutate(
  env: Env,
  input: ActorContext & Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const response = await mutateOrganizationStore(
    env,
    input.organizationId,
    "/internal/calendar/manage",
    input,
  );
  if (!response.ok) {
    throw new CalendarMutationError(await storeErrorCode(response, "unknown"), response.status);
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
  const response = await mutateOrganizationStore(
    env,
    actor.organizationId,
    "/internal/calendar/manage",
    { action: "delete_venue", ...actor, venueId },
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
  const response = await readOrganizationStore(
    env,
    organizationId,
    "/internal/calendar/dashboard-summary",
  );
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

export async function cancelOrganizationEvent(
  env: Env,
  actor: ActorContext,
  eventId: string,
): Promise<Omit<OrganizationEventCancelResponse, "requestId">> {
  return organizationEventCancelResponseSchema
    .omit({ requestId: true })
    .parse(await mutate(env, { action: "cancel_event", ...actor, eventId }));
}

export async function setOrganizationEventRsvp(
  env: Env,
  actor: ActorContext,
  eventId: string,
  rsvp: OrganizationRsvpRequest,
  selfService = false,
): Promise<OrganizationRsvp> {
  return organizationRsvpSchema.parse(
    await mutate(env, { action: "set_rsvp", ...actor, eventId, rsvp, selfService }),
  );
}

export async function bulkSetOrganizationEventRsvp(
  env: Env,
  actor: ActorContext,
  eventId: string,
  updates: readonly OrganizationRsvpRequest[],
): Promise<readonly OrganizationAttendanceRow[]> {
  return organizationAttendanceResponseSchema.omit({ requestId: true }).parse(
    await mutate(env, {
      action: "bulk_set_rsvp",
      ...actor,
      eventId,
      updates: [...updates],
    }),
  ).rows;
}

export async function readOrganizationCalendarSettings(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<OrganizationCalendarSettings> {
  const response = await readOrganizationStore(env, organizationId, "/internal/calendar/settings");
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
  const response = await readOrganizationStore(
    env,
    organizationId,
    "/internal/roster/configuration",
  );
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
  const response = await mutateOrganizationStore(
    env,
    actor.organizationId,
    "/internal/calendar/manage",
    { action: "update_roster_configuration", ...actor, configuration },
  );
  if (response.status === 409) return "voice_part_in_use";
  if (!response.ok) {
    throw new Error("The Organization store rejected the roster configuration mutation.");
  }
  return organizationRosterConfigurationRequestSchema.parse(await response.json());
}

export async function previewOrganizationRosterAutomation(
  env: Env,
  organizationId: string,
  configuration: OrganizationRosterConfiguration,
  profileId: string | null,
): Promise<OrganizationRosterAutomationPreviewResponse> {
  const response = await mutateOrganizationStore(
    env,
    organizationId,
    "/internal/roster/automation-preview",
    { configuration, organizationId, profileId },
  );
  if (!response.ok)
    throw new Error("The Organization store rejected the roster automation preview.");
  return organizationRosterAutomationPreviewResponseSchema.parse(await response.json());
}

export async function listMemberSchedule(
  env: Env,
  organizationId: string,
  profileId: string,
  now = new Date(),
  includePast = false,
  includePublishedSetList = false,
): Promise<readonly SingerEvent[]> {
  const response = await readOrganizationStore(
    env,
    organizationId,
    "/internal/calendar/member-events",
    {
      profileId,
      readAt: now.toISOString(),
      ...(includePast ? { includePast: "true" } : {}),
      ...(includePublishedSetList ? { includePublishedSetList: "true" } : {}),
    },
  );
  if (!response.ok) throw new Error("The Organization store rejected the member schedule request.");
  return singerEventsResponseSchema.pick({ events: true }).parse(await response.json()).events;
}

export async function listOrganizationProfilePerformanceHistory(
  env: Env,
  organizationId: string,
  profileId: string,
  now = new Date(),
): Promise<Omit<OrganizationProfilePerformanceHistoryResponse, "requestId">> {
  const response = await readOrganizationStore(
    env,
    organizationId,
    "/internal/calendar/profile-performance-history",
    { profileId, readAt: now.toISOString() },
  );
  if (!response.ok) {
    throw new Error("The Organization store rejected the Profile performance history request.");
  }
  return organizationProfilePerformanceHistoryResponseSchema
    .omit({ requestId: true })
    .parse(await response.json());
}
