import { type ProblemDetails } from "@choir/contracts";
import { z } from "zod";
import { readSingerSeating, SeatingRepositoryError } from "../organization/organizationSeating";
import { linkedOrganizationProfileId } from "../tenancy/linkedOrganizationProfile";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/singer/events/:eventId/seating", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.param("eventId"));
    if (!eventId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid performance is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const profileId = await linkedOrganizationProfileId(
      context.env.CONTROL_DB,
      authorization.organizationId,
      authorization.userId,
    );
    if (!profileId) {
      return context.json(
        {
          code: "not_found",
          message: "A linked Organization Profile is required for seating.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const result = await readSingerSeating(
        context.env,
        authorization.organizationId,
        eventId.data,
        null,
        profileId,
      );
      return context.json({ ...result, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const status = error instanceof SeatingRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
          message:
            status === 403
              ? "Only Profiles on this performance roster may view its seating."
              : "Performance seating is unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });

  router.get("/api/singer/seating-profiles", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventId = z.uuid().safeParse(context.req.query("eventId"));
    const chartId = z.uuid().safeParse(context.req.query("chartId"));
    if (!eventId.success || !chartId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid performance and seating chart are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const profileId = await linkedOrganizationProfileId(
      context.env.CONTROL_DB,
      authorization.organizationId,
      authorization.userId,
    );
    if (!profileId) {
      return context.json(
        {
          code: "forbidden",
          message: "A linked Organization Profile is required for seating.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
    try {
      const result = await readSingerSeating(
        context.env,
        authorization.organizationId,
        eventId.data,
        chartId.data,
        profileId,
      );
      return context.json({
        profiles: result.profiles.map(({ displayName, id, voicePart }) => ({
          id,
          name: displayName,
          voicePart,
        })),
        requestId: context.get("requestId"),
      });
    } catch (error: unknown) {
      const status = error instanceof SeatingRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
          message:
            status === 403
              ? "Only rostered Profiles may view seating."
              : "Seating Profiles are unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });
}
