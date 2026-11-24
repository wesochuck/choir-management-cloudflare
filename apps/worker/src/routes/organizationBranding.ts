import {
  organizationBrandingRequestSchema,
  organizationBrandingSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";

import { validateStartupConfig } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import { readVerifiedLogoImage, verifyPublicLogoCandidate } from "../storage/publicLogo";
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
      let logoVerifiedContentType: "image/jpeg" | "image/png" | "image/webp" | null | undefined;
      if ("logoFileId" in parsed.data) {
        if (parsed.data.logoFileId) {
          const verified = await verifyPublicLogoCandidate(
            context.env,
            authorization.organizationId,
            parsed.data.logoFileId,
          );
          if (!verified.ok) {
            return context.json(
              {
                code: "invalid_logo_image",
                message: "Organization logos must be valid PNG, JPEG, or WebP images up to 5 MB.",
                requestId: context.get("requestId"),
              } satisfies ProblemDetails,
              400,
            );
          }
          logoVerifiedContentType = verified.verifiedContentType;
        } else {
          logoVerifiedContentType = null;
        }
      }
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const response = await invokeOrganizationRpc(
        stub,
        `https://organization.internal/internal/branding/manage?organizationId=${encodeURIComponent(authorization.organizationId)}`,
        {
          body: JSON.stringify({
            ...parsed.data,
            ...(logoVerifiedContentType !== undefined ? { logoVerifiedContentType } : {}),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        return context.json(
          {
            code: response.status === 400 ? "invalid_logo_image" : "service_unavailable",
            message:
              response.status === 400
                ? "Organization logos must be valid PNG, JPEG, or WebP images up to 5 MB."
                : "Branding settings could not be saved.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          response.status === 400 ? 400 : 503,
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
      const logoRef = await stub.readVerifiedOrganizationLogo(resolved.value.organizationId);
      if (!logoRef.logoFileId || !logoRef.logoVerifiedContentType) {
        return context.json(
          {
            code: "not_found",
            message: "No Organization logo has been configured.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      const logo = await readVerifiedLogoImage(
        context.env,
        resolved.value.organizationId,
        logoRef.logoFileId,
        logoRef.logoVerifiedContentType,
      );
      if (!logo) {
        return context.json(
          {
            code: "not_found",
            message: "The Organization logo image was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      context.header("etag", logo.etag);
      context.header("vary", "Host");
      context.header("cache-control", "public, max-age=3600, stale-while-revalidate=86400");
      context.header("content-disposition", "inline");
      context.header("x-content-type-options", "nosniff");
      if (context.req.header("if-none-match") === logo.etag) {
        return context.body(null, 304);
      }
      context.header("content-type", logo.verifiedContentType);
      return context.body(logo.bytes);
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
