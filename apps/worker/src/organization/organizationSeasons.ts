import {
  duesCheckoutRequestSchema,
  duesCheckoutResponseSchema,
  duesRecordSchema,
  duesRecordsResponseSchema,
  seasonCreateRequestSchema,
  seasonSchema,
  seasonUpdateRequestSchema,
  seasonsResponseSchema,
  type DuesCheckoutRequest,
  type DuesRecord,
  type Season,
  type SeasonCreateRequest,
  type SeasonUpdateRequest,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export class SeasonError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SeasonError";
  }
}

function stub(env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) {
  return env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));
}

async function mutateSeason(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await stub(env, organizationId).fetch(
    "https://organization.internal/internal/seasons/manage",
    {
      body: JSON.stringify({ ...body, organizationId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    const code = await errorCode(response);
    const status =
      response.status === 400 || response.status === 404 || response.status === 409
        ? response.status
        : 503;
    throw new SeasonError(code, status, "The season could not be updated.");
  }
  return response;
}

async function errorCode(response: Response): Promise<string> {
  const value: unknown = await response.json().catch(() => null);
  return typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string"
    ? value.code
    : "season_error";
}

export async function createDuesCheckoutSession(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  origin: string,
  checkout: DuesCheckoutRequest,
) {
  const validated = duesCheckoutRequestSchema.parse(checkout);
  const requestId = crypto.randomUUID();
  const response = await stub(env, organizationId).fetch(
    "https://organization.internal/internal/seasons/manage",
    {
      body: JSON.stringify({
        action: "create_dues_checkout",
        checkout: validated,
        organizationId,
        origin,
        requestId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    const code = await errorCode(response);
    throw new SeasonError(code, response.status, "The dues checkout could not be created.");
  }
  return duesCheckoutResponseSchema.parse(await response.json());
}

export async function listSeasons(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<readonly Season[]> {
  const url = new URL("https://organization.internal/internal/seasons/list");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) throw new SeasonError("seasons_unavailable", 503, "Seasons unavailable.");
  return seasonsResponseSchema.omit({ requestId: true }).parse(await response.json()).seasons;
}

export async function listDues(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<readonly DuesRecord[]> {
  const url = new URL("https://organization.internal/internal/seasons/dues");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) throw new SeasonError("dues_unavailable", 503, "Dues unavailable.");
  return duesRecordsResponseSchema.omit({ requestId: true }).parse(await response.json()).dues;
}

export async function createSeason(
  env: Pick<Env, "ORGANIZATION_STORE">,
  context: ActorContext,
  season: SeasonCreateRequest,
): Promise<Season> {
  const response = await mutateSeason(env, context.organizationId, {
    action: "create_season",
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    season: seasonCreateRequestSchema.parse(season),
    seasonId: crypto.randomUUID(),
  });
  return seasonSchema.parse(await response.json());
}

export async function updateSeason(
  env: Pick<Env, "ORGANIZATION_STORE">,
  context: ActorContext,
  seasonId: string,
  season: SeasonUpdateRequest,
): Promise<Season> {
  const response = await mutateSeason(env, context.organizationId, {
    action: "update_season",
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    season: seasonUpdateRequestSchema.parse(season),
    seasonId: z.uuid().parse(seasonId),
  });
  return seasonSchema.parse(await response.json());
}

export async function activateSeason(
  env: Pick<Env, "ORGANIZATION_STORE">,
  context: ActorContext,
  seasonId: string,
): Promise<Season> {
  const response = await mutateSeason(env, context.organizationId, {
    action: "activate_season",
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    seasonId: z.uuid().parse(seasonId),
  });
  return seasonSchema.parse(await response.json());
}

export async function deleteSeason(
  env: Pick<Env, "ORGANIZATION_STORE">,
  context: ActorContext,
  seasonId: string,
): Promise<void> {
  await mutateSeason(env, context.organizationId, {
    action: "delete_season",
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    seasonId: z.uuid().parse(seasonId),
  });
}

export async function refundDues(
  env: Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "ORGANIZATION_STORE">,
  actor: ActorContext,
  duesId: string,
): Promise<DuesRecord> {
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/seasons/manage",
    {
      body: JSON.stringify({
        action: "refund_dues",
        ...actor,
        duesId: z.uuid().parse(duesId),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    const code = await errorCode(response);
    throw new SeasonError(code, response.status, "The dues could not be refunded.");
  }
  return duesRecordSchema.parse(await response.json());
}
