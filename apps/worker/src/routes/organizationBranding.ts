import {
  organizationBrandingRequestSchema,
  organizationBrandingSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";

import { validateStartupConfig } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import { readPrivateOrganizationFile } from "../storage/privateFiles";
import { resolveOrganization } from "../tenancy/resolveOrganization";
import { authorizeCalendarRoute } from "./helpers";
import type { WorkerHonoEnvironment } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/branding", async (context) => {
    validateStartupConfig(context.env);
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const response = await invokeOrganizationRpc(
        stub,
        "https://organization.internal/internal/branding",
      );
      if (!response.ok) {
        return context.json(
          {
            code: "service_unavailable",
            message: "Branding settings are temporarily unavailable.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          503,
        );
      }
      const data = organizationBrandingSchema.parse(await response.json());
      return context.json({ ...data, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Branding settings could not be retrieved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.put("/api/organization/branding", async (context) => {
    validateStartupConfig(context.env);
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const rawBody: unknown = await context.req.json().catch(() => null);
    const parsed = organizationBrandingRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid logo file ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const response = await invokeOrganizationRpc(
        stub,
        `https://organization.internal/internal/branding/manage?organizationId=${encodeURIComponent(authorization.organizationId)}`,
        {
          body: JSON.stringify(parsed.data),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        return context.json(
          {
            code: "service_unavailable",
            message: "Branding settings could not be saved.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          503,
        );
      }
      const data = organizationBrandingSchema.parse(await response.json());
      return context.json({ ...data, requestId: context.get("requestId") });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "Branding settings could not be saved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/public/logo", async (context) => {
    validateStartupConfig(context.env);
    const resolved = await resolveOrganization(new URL(context.req.url), context.env);
    if (!resolved.ok) {
      return context.json(
        {
          code: "not_found",
          message: "No Organization was found for this hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, resolved.value.organizationId);
      const brandingResponse = await invokeOrganizationRpc(
        stub,
        "https://organization.internal/internal/branding",
      );
      if (!brandingResponse.ok) {
        return context.json(
          {
            code: "not_found",
            message: "No Organization logo was found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const branding = organizationBrandingSchema.safeParse(await brandingResponse.json());
      if (!branding.success || !branding.data.logoFileId) {
        return context.json(
          {
            code: "not_found",
            message: "No Organization logo has been configured.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const file = await readPrivateOrganizationFile(
        context.env,
        resolved.value.organizationId,
        branding.data.logoFileId,
        context.req.header("range") ?? null,
      );
      if (!file) {
        return context.json(
          {
            code: "not_found",
            message: "The Organization logo image was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      context.header("etag", file.object.httpEtag);
      context.header("vary", "Host");
      context.header("cache-control", "public, max-age=3600, stale-while-revalidate=86400");
      if (context.req.header("if-none-match") === file.object.httpEtag) {
        return context.body(null, 304);
      }
      context.header(
        "content-type",
        file.object.httpMetadata?.contentType ?? file.metadata.contentType,
      );
      return context.body(file.object.body);
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The Organization logo is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
