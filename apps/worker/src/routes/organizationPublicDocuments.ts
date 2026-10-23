import {
  publicWebsiteDocumentDeleteResponseSchema,
  publicWebsiteDocumentRequestSchema,
  publicWebsiteDocumentResponseSchema,
  publicWebsiteDocumentsResponseSchema,
  type ProblemDetails,
  type PublicWebsiteDocumentDeleteResponse,
  type PublicWebsiteDocumentResponse,
  type PublicWebsiteDocumentsResponse,
} from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import { PublicDocumentStoreError } from "../organization/publicDocumentStore";
import { organizationStoreStub } from "../organization/rpc/client";
import { reclaimPrivateOrganizationFile } from "../storage/privateFiles";
import type { WorkerHonoEnvironment } from "./helpers";
import { authorizeCalendarRoute } from "./helpers";

const PROBLEM_MAPPINGS: Record<
  string,
  {
    readonly code: "conflict" | "not_found" | "validation_failed";
    readonly message: string;
    readonly status: 400 | 404 | 409;
  }
> = {
  document_file_invalid_type: {
    code: "validation_failed",
    message: "Only PDF and Word (.docx) files are supported for public website documents.",
    status: 400,
  },
  document_file_name_invalid: {
    code: "validation_failed",
    message: "File extension must match its MIME type (.pdf or .docx).",
    status: 400,
  },
  document_file_not_found: {
    code: "not_found",
    message: "Backing private file was not found or is not ready.",
    status: 404,
  },
  document_file_oversized: {
    code: "validation_failed",
    message: "Public documents must not exceed 5 MB.",
    status: 400,
  },
  document_limit_exceeded: {
    code: "conflict",
    message: "Organizations may host at most 50 public documents.",
    status: 409,
  },
  document_not_found: {
    code: "not_found",
    message: "Public document not found.",
    status: 404,
  },
};

function resolveErrorCode(error: unknown): string | null {
  if (error instanceof PublicDocumentStoreError) {
    return error.code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  if (error instanceof Error) {
    return error.message.split(":", 1)[0]?.trim() ?? null;
  }
  return null;
}

function publicDocumentProblem(
  error: unknown,
  requestId: string,
  fallbackMessage: string,
): { readonly problem: ProblemDetails; readonly status: 400 | 404 | 409 | 500 } {
  const code = resolveErrorCode(error);
  const mapping = code ? PROBLEM_MAPPINGS[code] : undefined;
  if (mapping) {
    return {
      problem: { code: mapping.code, message: mapping.message, requestId },
      status: mapping.status,
    };
  }

  if (code === "validation_failed") {
    const message =
      error instanceof PublicDocumentStoreError ? error.message : "Validation failed.";
    return {
      problem: { code: "validation_failed", message, requestId },
      status: 400,
    };
  }

  return {
    problem: { code: "internal_error", message: fallbackMessage, requestId },
    status: 500,
  };
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/website/documents", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const documents = await stub.listPublicWebsiteDocuments({
        organizationId: authorization.organizationId,
      });

      const response: PublicWebsiteDocumentsResponse = {
        documents: [...documents],
        requestId: context.get("requestId"),
      };
      return context.json(publicWebsiteDocumentsResponseSchema.parse(response));
    } catch (error: unknown) {
      const mapped = publicDocumentProblem(
        error,
        context.get("requestId"),
        "Public website documents could not be retrieved.",
      );
      return context.json(mapped.problem, mapped.status);
    }
  });

  router.post("/api/organization/website/documents", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const body = publicWebsiteDocumentRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid title and uploaded file are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    try {
      const documentId = crypto.randomUUID();
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const document = await stub.createPublicWebsiteDocument({
        actorUserId: authorization.userId,
        documentId,
        fileId: body.data.fileId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
        title: body.data.title,
      });

      const response: PublicWebsiteDocumentResponse = {
        ...document,
        requestId: context.get("requestId"),
      };
      return context.json(publicWebsiteDocumentResponseSchema.parse(response), 201);
    } catch (error: unknown) {
      const mapped = publicDocumentProblem(
        error,
        context.get("requestId"),
        "The public document could not be created.",
      );
      return context.json(mapped.problem, mapped.status);
    }
  });

  router.put("/api/organization/website/documents/:documentId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const documentId = z.uuid().safeParse(context.req.param("documentId"));
    const body = publicWebsiteDocumentRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!documentId.success || !body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid document ID, title, and uploaded file are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const result = await stub.updatePublicWebsiteDocument({
        actorUserId: authorization.userId,
        documentId: documentId.data,
        fileId: body.data.fileId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
        title: body.data.title,
      });

      if (result.previousFileId && result.previousFileId !== result.document.fileId) {
        await reclaimPrivateOrganizationFile(context.env, {
          actorUserId: authorization.userId,
          fileId: result.previousFileId,
          organizationId: authorization.organizationId,
          requestId: crypto.randomUUID(),
        });
      }

      const response: PublicWebsiteDocumentResponse = {
        ...result.document,
        requestId: context.get("requestId"),
      };
      return context.json(publicWebsiteDocumentResponseSchema.parse(response));
    } catch (error: unknown) {
      const mapped = publicDocumentProblem(
        error,
        context.get("requestId"),
        "The public document could not be updated.",
      );
      return context.json(mapped.problem, mapped.status);
    }
  });

  router.delete("/api/organization/website/documents/:documentId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const documentId = z.uuid().safeParse(context.req.param("documentId"));
    if (!documentId.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid document ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const result = await stub.deletePublicWebsiteDocument({
        actorUserId: authorization.userId,
        documentId: documentId.data,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });

      await reclaimPrivateOrganizationFile(context.env, {
        actorUserId: authorization.userId,
        fileId: result.fileId,
        organizationId: authorization.organizationId,
        requestId: crypto.randomUUID(),
      });

      const response: PublicWebsiteDocumentDeleteResponse = {
        documentId: documentId.data,
        requestId: context.get("requestId"),
        status: "deleted",
      };
      return context.json(publicWebsiteDocumentDeleteResponseSchema.parse(response));
    } catch (error: unknown) {
      const mapped = publicDocumentProblem(
        error,
        context.get("requestId"),
        "The public document could not be deleted.",
      );
      return context.json(mapped.problem, mapped.status);
    }
  });
}
