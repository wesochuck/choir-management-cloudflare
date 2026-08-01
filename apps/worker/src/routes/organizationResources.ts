import {
  organizationResourceOrderRequestSchema,
  organizationResourceRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import {
  createOrganizationResource,
  deleteOrganizationResource,
  listOrganizationResources,
  reorderOrganizationResources,
  updateOrganizationResource,
} from "../organization/organizationResources";
import { reclaimPrivateOrganizationFile } from "../storage/privateFiles";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, resourceProblem } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/resources", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok)
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    try {
      return context.json({
        resources: await listOrganizationResources(context.env, authorization.organizationId),
        requestId: context.get("requestId"),
      });
    } catch (error: unknown) {
      const result = resourceProblem(
        error,
        context.get("requestId"),
        "Organization resources are temporarily unavailable.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.post("/api/organization/resources", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok)
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    const body = organizationResourceRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success)
      return context.json(
        {
          code: "validation_failed",
          message: "A valid private file or HTTPS resource link is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    try {
      const resource = await createOrganizationResource(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data,
      );
      return context.json({ ...resource, requestId: context.get("requestId") }, 201);
    } catch (error: unknown) {
      const result = resourceProblem(
        error,
        context.get("requestId"),
        "The resource could not be created.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.put("/api/organization/resources/order", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok)
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    const body = organizationResourceOrderRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success)
      return context.json(
        {
          code: "validation_failed",
          message: "A complete valid resource order is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    try {
      await reorderOrganizationResources(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data.resourceIds,
      );
      return context.json({ requestId: context.get("requestId"), status: "updated" as const });
    } catch (error: unknown) {
      const result = resourceProblem(
        error,
        context.get("requestId"),
        "The resource order could not be updated.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.put("/api/organization/resources/:resourceId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok)
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    const resourceId = z.uuid().safeParse(context.req.param("resourceId"));
    const body = organizationResourceRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!resourceId.success || !body.success)
      return context.json(
        {
          code: "validation_failed",
          message: "A valid resource and details are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    try {
      const resource = await updateOrganizationResource(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        resourceId.data,
        body.data,
      );
      return context.json({ ...resource, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const result = resourceProblem(
        error,
        context.get("requestId"),
        "The resource could not be updated.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.delete("/api/organization/resources/:resourceId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok)
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    const resourceId = z.uuid().safeParse(context.req.param("resourceId"));
    if (!resourceId.success)
      return context.json(
        {
          code: "validation_failed",
          message: "A valid resource is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    try {
      const deleted = await deleteOrganizationResource(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        resourceId.data,
      );
      if (deleted.fileId)
        await reclaimPrivateOrganizationFile(context.env, {
          actorUserId: authorization.userId,
          fileId: deleted.fileId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        });
      return context.json({
        requestId: context.get("requestId"),
        resourceId: resourceId.data,
        status: "deleted" as const,
      });
    } catch (error: unknown) {
      const result = resourceProblem(
        error,
        context.get("requestId"),
        "The resource could not be deleted.",
      );
      return context.json(result.problem, result.status);
    }
  });
}
