import {
  complianceTaskArchiveRequestSchema,
  complianceTaskCreateRequestSchema,
  nonprofitComplianceCompleteRequestSchema,
  nonprofitComplianceTaskUpdateRequestSchema,
  nonprofitComplianceToggleRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import { organizationStoreStub } from "../organization/rpc/client";
import type { Env } from "../env";
import { authorizeCalendarRoute, type WorkerHonoEnvironment } from "./helpers";
import { complianceResponseWithNames } from "./helpers/complianceResponse";

async function resolveAssigneeUserId(
  db: Pick<Env, "CONTROL_DB">["CONTROL_DB"],
  organizationId: string,
  membershipId: string,
): Promise<{ readonly code: string } | { readonly userId: string }> {
  const row = await db
    .prepare(
      `SELECT m.userId AS userId, m.role AS role
       FROM member m
       WHERE m.id = ? AND m.organizationId = ? LIMIT 1`,
    )
    .bind(membershipId, organizationId)
    .first<{ readonly role: string; readonly userId: string }>();
  if (!row || (row.role !== "owner" && row.role !== "admin")) {
    return { code: "assignee_ineligible" };
  }
  return { userId: row.userId };
}

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
      const response = await complianceResponseWithNames(
        context.env,
        authorization.organizationId,
        settings,
      );
      return context.json({ ...response, requestId: context.get("requestId") });
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

  router.get("/api/organization/compliance/assignees", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const result = await context.env.CONTROL_DB.prepare(
        `SELECT m.id AS membershipId, m.userId AS userId, u.name AS name, u.email AS email, m.role AS role
         FROM member m
         JOIN user u ON u.id = m.userId
         WHERE m.organizationId = ?
           AND m.role IN ('owner', 'admin')
         ORDER BY lower(u.name), lower(u.email), m.id
         LIMIT 500`,
      )
        .bind(authorization.organizationId)
        .all<{
          readonly email: string;
          readonly membershipId: string;
          readonly name: string | null;
          readonly role: string;
          readonly userId: string;
        }>();
      const assignees = result.results.flatMap((row) => {
        const name = row.name?.trim();
        const email = row.email.trim();
        if (!name || !email) return [];
        if (row.role !== "owner" && row.role !== "admin") return [];
        const role = row.role === "owner" ? ("owner" as const) : ("admin" as const);
        return [
          {
            email,
            membershipId: row.membershipId,
            name,
            role,
            userId: row.userId,
          },
        ];
      });
      return context.json({ assignees, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Eligible assignees are temporarily unavailable.",
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
      const response = await complianceResponseWithNames(
        context.env,
        authorization.organizationId,
        settings,
      );
      return context.json({ ...response, requestId: context.get("requestId") });
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

  router.post("/api/organization/compliance/tasks", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = complianceTaskCreateRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Check the compliance reminder fields and try again.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      let responsibleUserId: string | null | undefined;
      if (body.data.responsibleMembershipId !== null) {
        const resolved = await resolveAssigneeUserId(
          context.env.CONTROL_DB,
          authorization.organizationId,
          body.data.responsibleMembershipId,
        );
        if ("code" in resolved) {
          return context.json(
            {
              code: "validation_failed",
              message: "The responsible administrator must be a current Owner or Administrator.",
              requestId: context.get("requestId"),
            } satisfies ProblemDetails,
            400,
          );
        }
        responsibleUserId = resolved.userId;
      }
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const result = await stub.createComplianceTask({
        actorUserId: authorization.userId,
        applicable: body.data.applicable,
        description: body.data.description,
        nextDueDate: body.data.nextDueDate,
        organizationId: authorization.organizationId,
        recurrenceMonths: body.data.recurrenceMonths,
        referenceUrl: body.data.referenceUrl,
        requestId: context.get("requestId"),
        responsibleMembershipId: body.data.responsibleMembershipId,
        ...(responsibleUserId !== undefined ? { responsibleUserId } : {}),
        title: body.data.title,
      });
      if (!result.ok) {
        if (result.code === "task_limit_reached") {
          return context.json(
            {
              code: "task_limit_reached",
              message: "The Organization compliance catalog is full (50 reminders).",
              requestId: context.get("requestId"),
            } satisfies ProblemDetails,
            409,
          );
        }
        return context.json(
          {
            code: "validation_failed",
            message: "Check the compliance reminder fields and try again.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      const settings = await stub.readNonprofitCompliance();
      const response = await complianceResponseWithNames(
        context.env,
        authorization.organizationId,
        settings,
      );
      return context.json({ ...response, requestId: context.get("requestId") }, 201);
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The compliance reminder could not be created.",
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
      let responsibleUserId: string | null | undefined;
      if (
        body.data.responsibleMembershipId !== undefined &&
        body.data.responsibleMembershipId !== null
      ) {
        const resolved = await resolveAssigneeUserId(
          context.env.CONTROL_DB,
          authorization.organizationId,
          body.data.responsibleMembershipId,
        );
        if ("code" in resolved) {
          return context.json(
            {
              code: "validation_failed",
              message: "The responsible administrator must be a current Owner or Administrator.",
              requestId: context.get("requestId"),
            } satisfies ProblemDetails,
            400,
          );
        }
        responsibleUserId = resolved.userId;
      }
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const result = await stub.updateComplianceTask({
        actorUserId: authorization.userId,
        applicable: body.data.applicable,
        description: body.data.description,
        nextDueDate: body.data.nextDueDate,
        organizationId: authorization.organizationId,
        recurrenceMonths: body.data.recurrenceMonths,
        referenceUrl: body.data.referenceUrl,
        requestId: context.get("requestId"),
        responsibleMembershipId: body.data.responsibleMembershipId,
        ...(responsibleUserId !== undefined ? { responsibleUserId } : {}),
        taskId,
        title: body.data.title,
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
      const response = await complianceResponseWithNames(
        context.env,
        authorization.organizationId,
        settings,
      );
      return context.json({ ...response, requestId: context.get("requestId") });
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

  router.post("/api/organization/compliance/tasks/:taskId/archive", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const taskId = context.req.param("taskId");
    const taskIdParsed = z.uuid().safeParse(taskId);
    const body = complianceTaskArchiveRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!taskIdParsed.success || !body.success || body.data.taskId !== taskId) {
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
      const result = await stub.archiveComplianceTask({
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
        taskId,
      });
      if (!result.ok) {
        if (result.code === "not_found") {
          return context.json(
            {
              code: "not_found",
              message: "The compliance task was not found.",
              requestId: context.get("requestId"),
            } satisfies ProblemDetails,
            404,
          );
        }
        return context.json(
          {
            code: "validation_failed",
            message:
              result.code === "builtin_not_archivable"
                ? "Built-in requirements cannot be archived; mark them not applicable instead."
                : "Check the compliance task parameters and try again.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      const settings = await stub.readNonprofitCompliance();
      const response = await complianceResponseWithNames(
        context.env,
        authorization.organizationId,
        settings,
      );
      return context.json({ ...response, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The compliance task could not be archived.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.post("/api/organization/compliance/tasks/:taskId/restore", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const taskId = context.req.param("taskId");
    const taskIdParsed = z.uuid().safeParse(taskId);
    const body = complianceTaskArchiveRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!taskIdParsed.success || !body.success || body.data.taskId !== taskId) {
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
      const result = await stub.restoreComplianceTask({
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
        taskId,
      });
      if (!result.ok) {
        return context.json(
          {
            code: "not_found",
            message: "The compliance task was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const settings = await stub.readNonprofitCompliance();
      const response = await complianceResponseWithNames(
        context.env,
        authorization.organizationId,
        settings,
      );
      return context.json({ ...response, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The compliance task could not be restored.",
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
      const response = await complianceResponseWithNames(
        context.env,
        authorization.organizationId,
        settings,
      );
      return context.json({ ...response, requestId: context.get("requestId") });
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
