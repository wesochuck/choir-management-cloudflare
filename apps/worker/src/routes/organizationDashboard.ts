import { type ProblemDetails } from "@choir/contracts";
import { readOrganizationDashboardSummary } from "../calendar/organizationCalendar";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, authorizePlatformScopedRead } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/dashboard-summary", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    // Verified Platform Administrators without membership may read this
    // bounded summary for the hostname-resolved Organization (issue #147).
    const organizationId = authorization.ok
      ? authorization.organizationId
      : await authorizePlatformScopedRead(context);
    if (!organizationId && !authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    if (!organizationId) throw new Error("Authorized Organization ID is missing.");
    try {
      return context.json({
        ...(await readOrganizationDashboardSummary(context.env, organizationId)),
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization dashboard summary is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
