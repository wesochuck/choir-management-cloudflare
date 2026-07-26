import {
  organizationSeatingChartSchema,
  seatingConfigurationRequestSchema,
  singerSeatingResponseSchema,
  type OrganizationSeatingChart,
  type OrganizationSeatingChartRequest,
  type SeatingConfiguration,
  type SingerSeatingResponse,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export class SeatingRepositoryError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 503;

  constructor(code: string, status: SeatingRepositoryError["status"]) {
    super(code);
    this.name = "SeatingRepositoryError";
    this.code = code;
    this.status = status;
  }
}

function stub(env: Env, organizationId: string): DurableObjectStub {
  return env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));
}

async function errorCode(response: Response): Promise<string> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  return typeof body === "object" &&
    body !== null &&
    "code" in body &&
    typeof body.code === "string"
    ? body.code
    : "seating_unavailable";
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  const status =
    response.status === 400 ||
    response.status === 403 ||
    response.status === 404 ||
    response.status === 409
      ? response.status
      : 503;
  throw new SeatingRepositoryError(await errorCode(response), status);
}

async function mutate(
  env: Env,
  actor: ActorContext,
  operation: Readonly<Record<string, unknown>>,
): Promise<Response> {
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/seating/manage",
    {
      body: JSON.stringify({ ...actor, ...operation }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  await assertOk(response);
  return response;
}

export async function readOrganizationSeatingConfiguration(
  env: Env,
  organizationId: string,
): Promise<SeatingConfiguration> {
  const url = new URL("https://organization.internal/internal/seating/configuration");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  await assertOk(response);
  return z.object({ configuration: seatingConfigurationRequestSchema }).parse(await response.json())
    .configuration;
}

export async function updateOrganizationSeatingConfiguration(
  env: Env,
  actor: ActorContext,
  configuration: SeatingConfiguration,
): Promise<SeatingConfiguration> {
  const response = await mutate(env, actor, { action: "update_configuration", configuration });
  return z.object({ configuration: seatingConfigurationRequestSchema }).parse(await response.json())
    .configuration;
}

export async function listOrganizationSeatingCharts(
  env: Env,
  organizationId: string,
  eventId: string,
): Promise<readonly OrganizationSeatingChart[]> {
  const url = new URL("https://organization.internal/internal/seating/charts");
  url.searchParams.set("eventId", eventId);
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  await assertOk(response);
  return z.object({ charts: z.array(organizationSeatingChartSchema) }).parse(await response.json())
    .charts;
}

export async function createOrganizationSeatingChart(
  env: Env,
  actor: ActorContext,
  eventId: string,
  chart: OrganizationSeatingChartRequest,
): Promise<OrganizationSeatingChart> {
  const response = await mutate(env, actor, {
    action: "create_chart",
    chart: { ...chart, id: crypto.randomUUID() },
    eventId,
  });
  return organizationSeatingChartSchema.parse(await response.json());
}

export async function updateOrganizationSeatingChart(
  env: Env,
  actor: ActorContext,
  eventId: string,
  chartId: string,
  chart: OrganizationSeatingChartRequest,
): Promise<OrganizationSeatingChart> {
  const response = await mutate(env, actor, {
    action: "update_chart",
    chart: { ...chart, id: chartId },
    eventId,
  });
  return organizationSeatingChartSchema.parse(await response.json());
}

export async function deleteOrganizationSeatingChart(
  env: Env,
  actor: ActorContext,
  eventId: string,
  chartId: string,
): Promise<void> {
  await mutate(env, actor, { action: "delete_chart", chartId, eventId });
}

export async function reorderOrganizationSeatingCharts(
  env: Env,
  actor: ActorContext,
  eventId: string,
  chartIds: readonly string[],
): Promise<readonly OrganizationSeatingChart[]> {
  const response = await mutate(env, actor, {
    action: "reorder_charts",
    chartIds,
    eventId,
  });
  return z.object({ charts: z.array(organizationSeatingChartSchema) }).parse(await response.json())
    .charts;
}

export async function readSingerSeating(
  env: Env,
  organizationId: string,
  eventId: string,
  chartId: string | null,
  profileId: string,
): Promise<Omit<SingerSeatingResponse, "requestId">> {
  const url = new URL("https://organization.internal/internal/seating/singer");
  if (chartId) url.searchParams.set("chartId", chartId);
  url.searchParams.set("eventId", eventId);
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("profileId", profileId);
  const response = await stub(env, organizationId).fetch(url);
  await assertOk(response);
  return singerSeatingResponseSchema.omit({ requestId: true }).parse(await response.json());
}
