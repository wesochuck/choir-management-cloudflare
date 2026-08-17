import { organizationPollRequestSchema, type ProblemDetails } from "@choir/contracts";
import { z } from "zod";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/polls", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const archived = context.req.query("archived") === "true";
    const url = new URL(
      archived
        ? "https://organization.internal/internal/polls/archived"
        : "https://organization.internal/internal/polls",
    );
    url.searchParams.set("organizationId", authorization.organizationId);
    const response = await invokeOrganizationRpc(
      organizationStoreStub(context.env, authorization.organizationId),
      url,
    );
    if (!response.ok) {
      return context.json(
        {
          code: "service_unavailable",
          message: "Polls could not be listed.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
    return context.json({ polls: await response.json(), requestId: context.get("requestId") });
  });

  router.get("/api/organization/polls/:pollId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const pollId = z.uuid().safeParse(context.req.param("pollId"));
    if (!pollId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid poll ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const url = new URL("https://organization.internal/internal/polls/poll");
    url.searchParams.set("organizationId", authorization.organizationId);
    url.searchParams.set("pollId", pollId.data);
    const response = await invokeOrganizationRpc(
      organizationStoreStub(context.env, authorization.organizationId),
      url,
    );
    if (!response.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Poll not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const poll: object = await response.json();
    return context.json({ ...poll, requestId: context.get("requestId") });
  });

  router.post("/api/organization/polls", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = organizationPollRequestSchema
      .extend({ id: z.uuid() })
      .safeParse(await context.req.json<unknown>().catch(() => null));
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid poll is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, authorization.organizationId),
        "https://organization.internal/internal/polls/manage",
        {
          body: JSON.stringify({
            action: "create_poll",
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            poll: body.data,
            requestId: context.get("requestId"),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        return context.json(
          {
            code: "validation_failed",
            message: "The poll could not be created.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      const created: object = await response.json();
      return context.json(
        {
          ...created,
          requestId: context.get("requestId"),
        },
        201,
      );
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The poll could not be created.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/polls/:pollId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const pollId = z.uuid().safeParse(context.req.param("pollId"));
    const body = organizationPollRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!pollId.success || !body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid poll and ID are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, authorization.organizationId),
        "https://organization.internal/internal/polls/manage",
        {
          body: JSON.stringify({
            action: "update_poll",
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            poll: { id: pollId.data, ...body.data },
            requestId: context.get("requestId"),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        return context.json(
          {
            code: "validation_failed",
            message: "The poll could not be updated.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      const updated: object = await response.json();
      return context.json({
        ...updated,
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The poll could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/polls/:pollId/archive", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const pollId = z.uuid().safeParse(context.req.param("pollId"));
    if (!pollId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid poll ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const response = await invokeOrganizationRpc(
        organizationStoreStub(context.env, authorization.organizationId),
        "https://organization.internal/internal/polls/manage",
        {
          body: JSON.stringify({
            action: "archive_poll",
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            pollId: pollId.data,
            requestId: context.get("requestId"),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        return context.json(
          {
            code: "not_found",
            message: "Poll not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const archived: object = await response.json();
      return context.json({
        ...archived,
        requestId: context.get("requestId"),
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The poll could not be archived.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
