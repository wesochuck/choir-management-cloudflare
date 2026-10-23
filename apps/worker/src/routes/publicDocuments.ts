import { type ProblemDetails } from "@choir/contracts";
import type { Hono } from "hono";

import { validateStartupConfig } from "../env";
import { organizationStoreStub } from "../organization/rpc/client";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import type { WorkerHonoEnvironment } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/public/documents/:identifier", async (context) => {
    validateStartupConfig(context.env);

    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "The requested public document was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const identifier = context.req.param("identifier");
    const stub = organizationStoreStub(context.env, resolved.value.organizationId);
    const doc = await stub.getPublicWebsiteDocumentForDownload({
      identifier,
      organizationId: resolved.value.organizationId,
    });

    if (!doc) {
      return context.json(
        {
          code: "not_found",
          message: "The requested public document was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const object = await context.env.ORGANIZATION_FILES.get(doc.storageKey);
    const metadata = object?.customMetadata;
    if (
      !object ||
      metadata?.organizationId !== resolved.value.organizationId ||
      metadata.fileId !== doc.fileId
    ) {
      return context.json(
        {
          code: "not_found",
          message: "The requested public document was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    context.header("etag", object.httpEtag);
    context.header("vary", "Host");
    context.header("cache-control", "public, max-age=60, must-revalidate");

    if (context.req.header("if-none-match") === object.httpEtag) {
      return context.body(null, 304);
    }

    context.header("content-type", doc.contentType);
    context.header("content-length", String(object.size));

    const forceDownload =
      doc.contentType !== "application/pdf" || context.req.query("download") === "1";
    const disposition = forceDownload ? "attachment" : "inline";
    const safeAsciiName = doc.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");

    context.header(
      "content-disposition",
      `${disposition}; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
    );

    return context.body(object.body);
  });
}
