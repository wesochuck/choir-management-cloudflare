import { type ProblemDetails } from "@choir/contracts";
import { listOrganizationVenues } from "../calendar/organizationCalendar";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/venues", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      return context.json({
        requestId: context.get("requestId"),
        venues: await listOrganizationVenues(context.env, authorization.organizationId),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization venues are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
