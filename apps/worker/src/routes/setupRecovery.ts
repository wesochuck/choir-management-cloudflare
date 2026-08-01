import { type ProblemDetails } from "@choir/contracts";
import { getSetupStatus } from "../organization/organizationSetup";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, recoverAdministrator } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/setup/health", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const status = await getSetupStatus(context.env, authorization.organizationId);
      return context.json({
        ...status,
        environment: {
          externalEffectsMode: context.env.EXTERNAL_EFFECTS_MODE,
          platformEmailConfigured: Boolean(context.env.PLATFORM_EMAIL),
          signedLinksConfigured: context.env.SIGNED_LINK_SECRET.length >= 32,
        },
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "setup_health_unavailable",
          message: "Setup health is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/setup/recover-admin", recoverAdministrator);
}
