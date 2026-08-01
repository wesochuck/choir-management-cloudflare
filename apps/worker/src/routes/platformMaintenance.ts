import { type ProblemDetails } from "@choir/contracts";
import { z } from "zod";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/platform/maintenance/run", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const stub = context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
      );
      const response = await stub.fetch(
        "https://organization.internal/internal/scheduler/run-now",
        {
          body: JSON.stringify({ organizationId: authorization.organizationId }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        return context.json(
          {
            code: "maintenance_unavailable",
            message: "Organization maintenance could not be run.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          503,
        );
      }
      const result = z
        .object({
          enqueuedJobCount: z.number().int().nonnegative(),
          organizationId: z.string().min(1),
          ranAt: z.string(),
        })
        .safeParse(body);
      if (!result.success) throw new Error("maintenance_result_invalid");
      return context.json({ ...result.data, requestId: context.get("requestId"), success: true });
    } catch {
      return context.json(
        {
          code: "maintenance_unavailable",
          message: "Organization maintenance could not be run.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
