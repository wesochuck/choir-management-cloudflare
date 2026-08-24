import { type ProblemDetails } from "@choir/contracts";
import { createAuth, isCanonicalAuthHost, isProductBaseHost } from "../auth/config";
import { validateStartupConfig } from "../env";
import { resolveOrganization } from "../tenancy/resolveOrganization";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { browserOrganizationAuthAllowlist, isAuthorizedPlatformHostname } from "./helpers";

interface AuthCookieAttributes {
  readonly domain?: string;
  readonly httpOnly?: boolean;
  readonly path?: string;
  readonly sameSite?: boolean | string;
  readonly secure?: boolean;
}

interface AuthCookieDefinitionLike {
  readonly name: string;
  readonly attributes: AuthCookieAttributes;
}

function presentedCookieNames(headerValue: string | undefined): ReadonlySet<string> {
  if (!headerValue) return new Set();
  const names = headerValue
    .split(";")
    .map((pair) => pair.split("=", 1)[0]?.trim() ?? "")
    .filter(Boolean);
  return new Set(names);
}

function sameSiteAttributeValue(sameSite: boolean | string | undefined): string {
  if (typeof sameSite === "boolean") return sameSite ? "Strict" : "Lax";
  if (!sameSite) return "Lax";
  return `${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`;
}

function expiredAuthCookie(
  name: string,
  attributes: AuthCookieAttributes,
  includeDomain: boolean,
): string {
  const parts = [
    `${name}=`,
    `Path=${attributes.path ?? "/"}`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (includeDomain && attributes.domain) parts.push(`Domain=${attributes.domain}`);
  if (attributes.httpOnly ?? true) parts.push("HttpOnly");
  if (attributes.secure) parts.push("Secure");
  parts.push(`SameSite=${sameSiteAttributeValue(attributes.sameSite)}`);
  return parts.join("; ");
}

async function staleAuthCookieExpiries(
  cookieHeader: string | undefined,
  auth: ReturnType<typeof createAuth>,
): Promise<string[]> {
  const presented = presentedCookieNames(cookieHeader);
  if (presented.size === 0) return [];
  const authContext = await auth.$context;
  const pluginDefinitions = ["two_factor", "trust_device"].map((name) =>
    authContext.createAuthCookie(name),
  );
  const definitions: AuthCookieDefinitionLike[] = [
    ...Object.values(authContext.authCookies),
    ...pluginDefinitions,
  ];
  const expiries: string[] = [];
  for (const definition of definitions) {
    if (!presented.has(definition.name)) continue;
    expiries.push(expiredAuthCookie(definition.name, definition.attributes, false));
    if (definition.attributes.domain) {
      expiries.push(expiredAuthCookie(definition.name, definition.attributes, true));
    }
  }
  return expiries;
}

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
    if (!session) {
      const expiryCookies = await staleAuthCookieExpiries(context.req.header("cookie"), auth);
      const response = Response.json(null);
      for (const cookie of expiryCookies) response.headers.append("set-cookie", cookie);
      return response;
    }
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
