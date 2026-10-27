import { type ProblemDetails } from "@choir/contracts";
import { getModuleState } from "../organization/organizationSetup";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, authorizePlatformScopedRead } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/module-state", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    // Module IDs/enabled flags are low-sensitivity layout metadata used by
    // both member and admin navigation. Verified Platform scoped reads may
    // also load it (issue #147).
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
      const modules = await getModuleState(context.env, organizationId);
      return context.json({ modules });
    } catch {
      return context.json(
        {
          code: "modules_unavailable",
          message: "Module state is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
