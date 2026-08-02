import { type ProblemDetails } from "@choir/contracts";
import { singerEventSchema } from "@choir/contracts";
import { listMemberSchedule } from "../calendar/organizationCalendar";
import { linkedOrganizationProfileId } from "../tenancy/linkedOrganizationProfile";
import { readOrganizationMemberDashboard } from "../organization/organizationMemberDashboard";
import { generatePublicPlayerToken } from "../organization/organizationPlayerLinks";
import { z } from "zod";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/singer/practice-links/:eventId", async (context) => {
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
          message: "A valid event ID is required.",
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
          message: "A linked Organization Profile is required for practice.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const schedule = await listMemberSchedule(context.env, authorization.organizationId, profileId);
    if (
      !schedule.some(
        (event) => singerEventSchema.parse(event).practice.sourceEventId === eventId.data,
      )
    ) {
      return context.json(
        {
          code: "not_found",
          message: "Practice tracks are not available for this event.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      return context.json({
        ...(await generatePublicPlayerToken(
          context.env,
          authorization.organizationId,
          eventId.data,
        )),
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "practice_unavailable",
          message: "Practice tracks are not available for this event.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      );
    }
  });

  router.get("/api/singer/dashboard", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const profileId = await linkedOrganizationProfileId(
      context.env.CONTROL_DB,
      authorization.organizationId,
      authorization.userId,
    );
    try {
      return context.json({
        ...(await readOrganizationMemberDashboard(
          context.env,
          authorization.organizationId,
          profileId,
        )),
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Your member dashboard is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
