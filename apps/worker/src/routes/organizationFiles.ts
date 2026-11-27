import { type ProblemDetails, type PrivateFileResponse } from "@choir/contracts";
import { createAuth } from "../auth/config";
import { validateStartupConfig } from "../env";
import { organizationStoreStub } from "../organization/rpc/client";
import {
  PrivateFileStorageError,
  findPrivateFileStorageError,
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

const websiteUploadTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function canReadScopedPrivateFile(
  stub: ReturnType<typeof organizationStoreStub>,
  input: Parameters<typeof stub.canWebsiteEditorReadFile>[0],
  websiteOnly: boolean | undefined,
): Promise<boolean> {
  return websiteOnly ? stub.canWebsiteEditorReadFile(input) : stub.canMemberReadPrivateFile(input);
}

function formatPrivateFileUploadError(
  error: unknown,
  requestId: string,
): { readonly body: ProblemDetails; readonly status: 400 | 409 | 503 } {
  const storageError = findPrivateFileStorageError(error);
  if (storageError?.kind === "validation") {
    return {
      body: {
        code: "validation_failed",
        message: storageError.message,
        requestId,
      },
      status: 400,
    };
  }
  const conflict = storageError?.kind === "conflict";
  return {
    body: {
      code: conflict ? "conflict" : "service_unavailable",
      message: conflict
        ? "The private file ID is already in use."
        : "The private file could not be stored safely.",
      requestId,
    },
    status: conflict ? 409 : 503,
  };
}

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
    const websiteUpload = context.req.query("scope") === "website";
    const authorization = await authorizeOrganizationMember(
      context.env.CONTROL_DB,
      organizationId,
      session?.session.id,
      session?.user.id,
      websiteUpload ? { scope: "website" } : undefined,
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
    if (
      websiteUpload &&
      (!websiteUploadTypes.has(uploadHeaders.contentType) ||
        uploadHeaders.sizeBytes > 5 * 1024 * 1024)
    ) {
      return context.json(
        {
          code: "validation_failed",
          message: "Website uploads must be a JPEG, PNG, WebP, PDF, or Word document up to 5 MB.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    if (!context.req.raw.body) {
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
        body: context.req.raw.body,
        contentType: uploadHeaders.contentType,
        fileId: fileId.data,
        fileName: uploadHeaders.fileName,
        organizationId,
        requestId: context.get("requestId"),
        sizeBytes: uploadHeaders.sizeBytes,
        websiteUpload,
      });
      const response: PrivateFileResponse = {
        ...uploaded,
        requestId: context.get("requestId"),
      };
      return context.json(response, 201);
    } catch (error: unknown) {
      const { body, status } = formatPrivateFileUploadError(error, context.get("requestId"));
      return context.json(body, status);
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
      { scope: "shell" },
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
      if (authorization.value.role === "member") {
        const stub = organizationStoreStub(context.env, organizationId);
        const input = {
          actorUserId: authorization.value.userId,
          fileId: fileId.data,
          organizationId,
        };
        const allowed = await canReadScopedPrivateFile(
          stub,
          input,
          authorization.value.websiteOnly,
        );
        if (!allowed) {
          return context.json(
            {
              code: "not_found",
              message: "The private Organization file was not found.",
              requestId: context.get("requestId"),
            } satisfies ProblemDetails,
            404,
          );
        }
      }
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
    const websiteCleanup = context.req.query("scope") === "website";
    const authorization = await authorizeCalendarRoute(
      context,
      !websiteCleanup,
      websiteCleanup ? "website" : undefined,
    );
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
        websiteEditorOnly: authorization.role === "member",
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
