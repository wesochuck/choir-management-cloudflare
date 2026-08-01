import { type ProblemDetails } from "@choir/contracts";
import { createAuth, isCanonicalAuthHost, isProductBaseHost } from "../auth/config";
import { validateStartupConfig } from "../env";
import { resolveOrganization } from "../tenancy/resolveOrganization";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { browserOrganizationAuthAllowlist, isAuthorizedPlatformHostname } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/auth/get-session", async (context) => {
    const requestUrl = new URL(context.req.url);
    if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
      return context.json(
        {
          code: "not_found",
          message: "Authentication is available only on a canonical product hostname.",
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
    if (!session) return context.json(null);
    return context.json({
      session: {
        activeOrganizationId: session.session.activeOrganizationId ?? null,
        createdAt: session.session.createdAt,
        expiresAt: session.session.expiresAt,
        id: session.session.id,
        ipAddress: session.session.ipAddress ?? null,
        updatedAt: session.session.updatedAt,
        userAgent: session.session.userAgent ?? null,
        userId: session.session.userId,
      },
      user: {
        createdAt: session.user.createdAt,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
        id: session.user.id,
        image: session.user.image ?? null,
        name: session.user.name,
        twoFactorEnabled: session.user.twoFactorEnabled ?? false,
        updatedAt: session.user.updatedAt,
      },
    });
  });

  router.on(["GET", "POST"], "/api/auth/*", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);

    if (requestUrl.pathname === "/api/auth/list-sessions") {
      return context.json(
        {
          code: "not_found",
          message: "Use the redacted account session endpoint instead.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    if (
      requestUrl.pathname.startsWith("/api/auth/organization/") &&
      !browserOrganizationAuthAllowlist.has(requestUrl.pathname)
    ) {
      return context.json(
        {
          code: "not_found",
          message: "The requested authentication route is not available.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const hostnameIsProductBase = isProductBaseHost(
      requestUrl.hostname,
      config.PRODUCT_BASE_DOMAIN,
    );
    const hostnameIsWithinProduct = isCanonicalAuthHost(
      requestUrl.hostname,
      config.PRODUCT_BASE_DOMAIN,
    );
    const resolvedAuthOrganization =
      hostnameIsProductBase || !hostnameIsWithinProduct
        ? null
        : await resolveOrganization(requestUrl, context.env);
    const hostnameIsRegisteredOrganization =
      resolvedAuthOrganization?.ok === true &&
      resolvedAuthOrganization.value.routeKind === "canonical";
    if (!hostnameIsWithinProduct || (!hostnameIsProductBase && !hostnameIsRegisteredOrganization)) {
      const problem: ProblemDetails = {
        code: "not_found",
        message: "Authentication is available only on a canonical product hostname.",
        requestId: context.get("requestId"),
      };
      return context.json(problem, 404);
    }

    const auth = createAuth({
      env: context.env,
      requestUrl,
      waitUntil: (promise) => {
        context.executionCtx.waitUntil(promise);
      },
    });
    return auth.handler(context.req.raw);
  });
}
