import { publicWebsiteSettingsRequestSchema, type ProblemDetails } from "@choir/contracts";
import {
  publishOrganizationPublicWebsite,
  readOrganizationPublicWebsiteSettings,
  updateOrganizationPublicWebsiteSettings,
} from "../organization/organizationPublicWebsite";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, publicWebsiteProblem } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/website", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok)
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    try {
      const settings = await readOrganizationPublicWebsiteSettings(
        context.env,
        authorization.organizationId,
      );
      return context.json({ ...settings, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const result = publicWebsiteProblem(
        error,
        context.get("requestId"),
        "The public website settings are temporarily unavailable.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.put("/api/organization/website", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok)
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    const body = publicWebsiteSettingsRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success)
      return context.json(
        {
          code: "validation_failed",
          message: "Valid public website settings are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    try {
      const settings = await updateOrganizationPublicWebsiteSettings(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data,
      );
      return context.json({ ...settings, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const result = publicWebsiteProblem(
        error,
        context.get("requestId"),
        "The public website settings could not be saved.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.post("/api/organization/website/publish", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok)
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    try {
      const publication = await publishOrganizationPublicWebsite(context.env, {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json({ ...publication, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const result = publicWebsiteProblem(
        error,
        context.get("requestId"),
        "The public website could not be published.",
      );
      return context.json(result.problem, result.status);
    }
  });
}
