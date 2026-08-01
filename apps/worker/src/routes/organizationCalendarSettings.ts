import { organizationCalendarSettingsRequestSchema, type ProblemDetails } from "@choir/contracts";
import { isValidTimeZone } from "@choir/domain";
import {
  readOrganizationCalendarSettings,
  updateOrganizationCalendarSettings,
} from "../calendar/organizationCalendar";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/calendar-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      return context.json({
        ...(await readOrganizationCalendarSettings(context.env, authorization.organizationId)),
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization calendar settings are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/calendar-settings", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = organizationCalendarSettingsRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success || !isValidTimeZone(body.data.timezone)) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid IANA Organization timezone is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const settings = await updateOrganizationCalendarSettings(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data,
      );
      return context.json({ ...settings, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization timezone could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
