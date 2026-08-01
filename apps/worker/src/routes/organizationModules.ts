import { type ProblemDetails } from "@choir/contracts";
import { getModuleState } from "../organization/organizationSetup";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/module-state", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const modules = await getModuleState(context.env, authorization.organizationId);
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
