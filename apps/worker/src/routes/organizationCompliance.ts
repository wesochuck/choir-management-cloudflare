import {
  nonprofitComplianceCompleteRequestSchema,
  nonprofitComplianceTaskUpdateRequestSchema,
  nonprofitComplianceToggleRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";

import { organizationStoreStub } from "../organization/rpc/client";
import { authorizeCalendarRoute, type WorkerHonoEnvironment } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/compliance", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const settings = await stub.readNonprofitCompliance();
      return context.json({ ...settings, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Nonprofit compliance settings are temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/compliance/toggle", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = nonprofitComplianceToggleRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A boolean enabled flag is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const settings = await stub.setNonprofitEnabled({
        actorUserId: authorization.userId,
        enabled: body.data.enabled,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json({ ...settings, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Nonprofit compliance settings could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.patch("/api/organization/compliance/tasks/:taskId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const taskId = context.req.param("taskId");
    const body = nonprofitComplianceTaskUpdateRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success || body.data.taskId !== taskId) {
      return context.json(
        {
          code: "validation_failed",
          message: "Check the compliance task parameters and try again.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const result = await stub.updateComplianceTask({
        actorUserId: authorization.userId,
        applicable: body.data.applicable,
        nextDueDate: body.data.nextDueDate,
        organizationId: authorization.organizationId,
        recurrenceMonths: body.data.recurrenceMonths,
        requestId: context.get("requestId"),
        taskId,
      });
      if (!result.ok) {
        const isNotFound = result.code === "not_found";
        return context.json(
          {
            code: isNotFound ? "not_found" : "validation_failed",
            message: isNotFound
              ? "The compliance task was not found."
              : "Check the compliance task parameters and try again.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          isNotFound ? 404 : 400,
        );
      }
      const settings = await stub.readNonprofitCompliance();
      return context.json({ ...settings, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The compliance task could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/compliance/tasks/:taskId/complete", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const taskId = context.req.param("taskId");
    const body = nonprofitComplianceCompleteRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success || body.data.taskId !== taskId) {
      return context.json(
        {
          code: "validation_failed",
          message: "Check the completion date and try again.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const result = await stub.completeComplianceTask({
        actorUserId: authorization.userId,
        completedDate: body.data.completedDate,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
        taskId,
      });
      if (!result.ok) {
        const isNotFound = result.code === "not_found";
        return context.json(
          {
            code: isNotFound ? "not_found" : "validation_failed",
            message: isNotFound
              ? "The compliance task was not found."
              : "Check the completion date and try again.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          isNotFound ? 404 : 400,
        );
      }
      const settings = await stub.readNonprofitCompliance();
      return context.json({ ...settings, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The compliance task could not be completed.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
