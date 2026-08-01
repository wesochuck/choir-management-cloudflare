import {
  organizationAuditionCreateRequestSchema,
  organizationAuditionListResponseSchema,
  organizationAuditionSchema,
  type ProblemDetails,
} from "@choir/contracts";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/auditions", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = organizationAuditionCreateRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid audition details are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const response = await context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
      ).fetch("https://organization.internal/internal/audition/create", {
        body: JSON.stringify({
          ...body.data,
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const responseBody: unknown = await response.json();
      if (!response.ok) {
        return context.json(
          {
            code: "audition_create_failed",
            message: "The audition could not be created.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          response.status === 400 || response.status === 409 ? response.status : 503,
        );
      }
      const audition = organizationAuditionSchema.safeParse(responseBody);
      if (!audition.success) throw new Error("invalid_audition");
      return context.json({ ...audition.data, requestId: context.get("requestId") }, 201);
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The audition could not be created.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/auditions", async (context) => {
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
      const response = await stub.fetch("https://organization.internal/internal/auditions/list");
      const bodyJson: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        return context.json(
          {
            code: response.status === 404 ? "organization_not_found" : "auditions_list_failed",
            message: "Auditions could not be retrieved.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          response.status === 404 ? 404 : response.status === 409 ? 409 : 503,
        );
      }
      const auditionsList = organizationAuditionListResponseSchema.safeParse(bodyJson);
      if (!auditionsList.success) throw new Error("invalid_audition_list");
      return context.json({ requestId: context.get("requestId"), ...auditionsList.data });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Auditions could not be retrieved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
