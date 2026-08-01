import { seatingConfigurationRequestSchema, type ProblemDetails } from "@choir/contracts";
import {
  readOrganizationSeatingConfiguration,
  SeatingRepositoryError,
  updateOrganizationSeatingConfiguration,
} from "../organization/organizationSeating";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/seating-configuration", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      return context.json({
        configuration: await readOrganizationSeatingConfiguration(
          context.env,
          authorization.organizationId,
        ),
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Organization seating configuration is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/seating-configuration", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = seatingConfigurationRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid seating formations and a default formation are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const configuration = await updateOrganizationSeatingConfiguration(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data,
      );
      return context.json({ configuration, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const status = error instanceof SeatingRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
          message:
            status === 409
              ? "A formation is invalid or is still used by a seating chart."
              : "The Organization seating configuration could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });
}
