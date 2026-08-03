import {
  organizationExportRequestSchema,
  organizationExportStartResponseSchema,
  organizationExportStatusResponseSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import {
  authorizeExportRoute,
  downloadOrganizationExportFile,
  organizationExportJobResponseSchema,
} from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/export", async (context) => {
    const authorization = await authorizeExportRoute(context);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = organizationExportRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A supported Organization export format is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const stub = context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
      );
      const createResponse = await stub.fetch(
        "https://organization.internal/internal/export/create",
        {
          body: JSON.stringify({
            ...body.data,
            actorType:
              authorization.actorType === "platform_administrator"
                ? "platform_administrator"
                : "organization_member",
            actorUserId: authorization.userId,
            organizationId: authorization.organizationId,
            requestId: context.get("requestId"),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      const createdBody = z
        .object({ exportId: z.uuid(), status: z.literal("queued") })
        .safeParse(await createResponse.json().catch(() => null));
      if (!createResponse.ok || !createdBody.success) throw new Error("export_create_failed");
      const created = organizationExportStartResponseSchema.parse({
        ...createdBody.data,
        requestId: context.get("requestId"),
      });
      return context.json(created, 202);
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization export could not be started.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/export/:exportId", async (context) => {
    const authorization = await authorizeExportRoute(context);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const exportId = z.uuid().safeParse(context.req.param("exportId"));
    if (!exportId.success) {
      return context.json(
        {
          code: "export_not_found",
          message: "The export was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const url = new URL("https://organization.internal/internal/export/job");
      url.searchParams.set("organizationId", authorization.organizationId);
      url.searchParams.set("exportId", exportId.data);
      const response = await context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
      ).fetch(url);
      const job = organizationExportJobResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!response.ok || !job.success) {
        return context.json(
          {
            code: "export_not_found",
            message: "The export was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          response.status === 409 ? 409 : 404,
        );
      }
      const status = organizationExportStatusResponseSchema.parse({
        byteCount: job.data.byteCount,
        checksumSha256: job.data.checksumSha256,
        downloadUrl:
          job.data.status === "completed"
            ? `/api/organization/export/${encodeURIComponent(exportId.data)}/download`
            : null,
        errorCode: job.data.errorCode,
        exportId: job.data.exportId,
        requestId: context.get("requestId"),
        status: job.data.status,
      });
      return context.json(status);
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The export status is unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/organization/export/:exportId/download", async (context) => {
    const authorization = await authorizeExportRoute(context);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const exportId = z.uuid().safeParse(context.req.param("exportId"));
    if (!exportId.success) {
      return context.json(
        {
          code: "export_not_found",
          message: "The export was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return downloadOrganizationExportFile(
      context.env,
      authorization.organizationId,
      exportId.data,
      context.get("requestId"),
    );
  });
}
