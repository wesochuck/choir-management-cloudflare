import { type ProblemDetails, type PrivateFileResponse } from "@choir/contracts";
import { createAuth } from "../auth/config";
import { validateStartupConfig } from "../env";
import {
  PrivateFileStorageError,
  privateFileIdSchema,
  readPrivateOrganizationFile,
  reclaimPrivateOrganizationFile,
  uploadPrivateOrganizationFile,
} from "../storage/privateFiles";
import { authorizeOrganizationMember } from "../tenancy/authorizeOrganization";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import {
  authorizeCalendarRoute,
  parsePrivateFileUploadHeaders,
  resolveCanonicalOrganizationId,
  privateFileDownloadResponse,
} from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.put("/api/organization/files/:fileId", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    const fileId = privateFileIdSchema.safeParse(context.req.param("fileId"));
    if (!organizationId || !fileId.success) {
      return context.json(
        {
          code: "not_found",
          message: "Private files require a registered canonical Organization hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
    );
    if (!authorization.ok) {
      return context.json(
        {
          code: authorization.error.code,
          message: authorization.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        authorization.error.code === "unauthorized" ? 401 : 403,
      );
    }
    const uploadHeaders = parsePrivateFileUploadHeaders(context.req.raw.headers);
    if (!uploadHeaders) {
      return context.json(
        {
          code: "validation_failed",
          message:
            "A valid encoded file name, content type, and bounded content length are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const body = await context.req.arrayBuffer();
    if (body.byteLength !== uploadHeaders.sizeBytes) {
      return context.json(
        {
          code: "validation_failed",
          message: "The private file body does not match its declared content length.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const uploaded = await uploadPrivateOrganizationFile(context.env, {
        actorUserId: authorization.value.userId,
        body,
        contentType: uploadHeaders.contentType,
        fileId: fileId.data,
        fileName: uploadHeaders.fileName,
        organizationId,
        requestId: context.get("requestId"),
        sizeBytes: body.byteLength,
      });
      const response: PrivateFileResponse = {
        ...uploaded,
        requestId: context.get("requestId"),
      };
      return context.json(response, 201);
    } catch (error: unknown) {
      const conflict = error instanceof PrivateFileStorageError && error.kind === "conflict";
      return context.json(
        {
          code: conflict ? "conflict" : "service_unavailable",
          message: conflict
            ? "The private file ID is already in use."
            : "The private file could not be stored safely.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        conflict ? 409 : 503,
      );
    }
  });

  router.get("/api/organization/files/:fileId", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    const fileId = privateFileIdSchema.safeParse(context.req.param("fileId"));
    if (!organizationId || !fileId.success) {
      return context.json(
        {
          code: "not_found",
          message: "The private Organization file was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
    );
    if (!authorization.ok) {
      return context.json(
        {
          code: authorization.error.code,
          message: authorization.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        authorization.error.code === "unauthorized" ? 401 : 403,
      );
    }
    try {
      const file = await readPrivateOrganizationFile(
        context.env,
        organizationId,
        fileId.data,
        context.req.header("range") ?? null,
      );
      if (!file) {
        return context.json(
          {
            code: "not_found",
            message: "The private Organization file was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      return privateFileDownloadResponse(file);
    } catch (error: unknown) {
      if (error instanceof PrivateFileStorageError && error.kind === "range_not_satisfiable") {
        context.header("content-range", `bytes */${String(error.sizeBytes ?? 0)}`);
        return context.body(null, 416);
      }
      return context.json(
        {
          code: "service_unavailable",
          message: "The private Organization file is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.delete("/api/organization/files/:fileId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    const fileId = privateFileIdSchema.safeParse(context.req.param("fileId"));
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    if (!fileId.success) {
      return context.json(
        {
          code: "not_found",
          message: "The private file was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const reclaimed = await reclaimPrivateOrganizationFile(context.env, {
        actorUserId: authorization.userId,
        fileId: fileId.data,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return reclaimed
        ? context.json({
            fileId: fileId.data,
            requestId: context.get("requestId"),
            status: "deleted",
          })
        : context.json(
            {
              code: "conflict",
              message: "The private file is still in use or is unavailable.",
              requestId: context.get("requestId"),
            } satisfies ProblemDetails,
            409,
          );
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The private file could not be reclaimed.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
