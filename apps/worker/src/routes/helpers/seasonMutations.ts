import {
  seasonCreateRequestSchema,
  seasonUpdateRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { type Context } from "hono";

import { createSeason, updateSeason, SeasonError } from "../../organization/organizationSeasons";
import { authorizeCalendarRoute } from "./routeContracts";
import type { WorkerHonoEnvironment } from "./routeContracts";

export function seasonMutationFailure(
  error: unknown,
  requestIdValue: string,
  fallback: string,
): { readonly problem: ProblemDetails; readonly status: 400 | 404 | 409 | 503 } {
  const status =
    error instanceof SeasonError &&
    (error.status === 400 || error.status === 404 || error.status === 409)
      ? error.status
      : 503;
  return {
    problem: {
      code: error instanceof SeasonError ? error.code : "season_unavailable",
      message: error instanceof SeasonError ? error.message : fallback,
      requestId: requestIdValue,
    },
    status,
  };
}

export async function saveSeasonRoute(
  context: Context<WorkerHonoEnvironment>,
  seasonId: string | null,
) {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const parsed = (seasonId ? seasonUpdateRequestSchema : seasonCreateRequestSchema).safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsed.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid season details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const actor = {
      actorUserId: authorization.userId,
      organizationId: authorization.organizationId,
      requestId: context.get("requestId"),
    };
    const season = seasonId
      ? await updateSeason(context.env, actor, seasonId, parsed.data)
      : await createSeason(context.env, actor, parsed.data);
    return context.json({ ...season, requestId: context.get("requestId") }, seasonId ? 200 : 201);
  } catch (error: unknown) {
    const failure = seasonMutationFailure(
      error,
      context.get("requestId"),
      `The season could not be ${seasonId ? "updated" : "created"}.`,
    );
    return context.json(failure.problem, failure.status);
  }
}
