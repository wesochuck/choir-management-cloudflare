import { Hono } from "hono";
import { requestId } from "hono/request-id";
import type { ProblemDetails } from "@choir/contracts";
import type { WorkerHonoEnvironment } from "./routes/helpers";
import { boundJsonRequestBody, MAX_JSON_BODY_BYTES } from "./routes/helpers";
import { registerOrganizationGroupRoutes } from "./routes/groups/organizationRoutes";
import { registerPlatformGroupRoutes } from "./routes/groups/platformRoutes";
import { registerPublicGroupRoutes } from "./routes/groups/publicRoutes";
import { registerSetupGroupRoutes } from "./routes/groups/setupRoutes";
import { registerSingerGroupRoutes } from "./routes/groups/singerRoutes";

export const router = new Hono<WorkerHonoEnvironment>();

export function generateCspNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function buildContentSecurityPolicy(nonce?: string): string {
  const scriptDirective = nonce
    ? `script-src 'self' 'nonce-${nonce}' https://static.cloudflareinsights.com https://challenges.cloudflare.com`
    : "script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    scriptDirective,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com",
    "frame-src 'self' https://challenges.cloudflare.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

export function setSecurityHeaders(
  headers: Headers,
  referrerPolicy = "strict-origin-when-cross-origin",
  nonce = generateCspNonce(),
): void {
  headers.set("referrer-policy", referrerPolicy);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy", buildContentSecurityPolicy(nonce));
}

router.use("*", requestId());
router.use("*", async (context, next) => {
  const method = context.req.method.toUpperCase();
  const cookie = context.req.header("cookie") ?? "";
  const authorization = context.req.header("authorization") ?? "";
  const hasSessionCookie = /(?:^|;\s*)(?:__Secure-)?choir-management\.session_token=/.test(cookie);
  const isBearerClient = /^Bearer\s+/i.test(authorization);
  const path = new URL(context.req.url).pathname;
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    hasSessionCookie &&
    !isBearerClient &&
    !path.startsWith("/api/auth/")
  ) {
    const origin = context.req.header("origin");
    if (origin !== new URL(context.req.url).origin) {
      return context.json(
        {
          code: "csrf_origin_mismatch",
          message: "This request must originate from the current application origin.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
  }
  await next();
});

function resolveCorsOrigin(
  requestOrigin: string | undefined,
  requestUrl: URL,
  baseDomain: string,
): string | null {
  const candidate = requestOrigin ?? requestUrl.origin;
  try {
    const originUrl = new URL(candidate);
    if (baseDomain === "localhost") {
      if (originUrl.hostname === "localhost" || originUrl.hostname.endsWith(".localhost")) {
        return candidate;
      }
      return null;
    }
    if (originUrl.hostname === baseDomain || originUrl.hostname.endsWith(`.${baseDomain}`)) {
      return candidate;
    }
  } catch {
    // Fall back on invalid origin URLs
  }
  return null;
}

function setCorsHeaders(headers: Headers, allowOrigin: string | null): void {
  if (!allowOrigin) return;
  headers.set("access-control-allow-origin", allowOrigin);
  headers.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type, Authorization");
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-max-age", "86400");
}

router.use("*", async (context, next) => {
  if (context.req.method === "OPTIONS") {
    const requestUrl = new URL(context.req.url);
    const allowOrigin = resolveCorsOrigin(
      context.req.header("origin"),
      requestUrl,
      context.env.PRODUCT_BASE_DOMAIN,
    );
    setCorsHeaders(context.res.headers, allowOrigin);
    return context.body(null, 204);
  }
  await next();
});

router.use("*", async (context, next) => {
  await next();
  const requestUrl = new URL(context.req.url);
  const responsePath = requestUrl.pathname;
  const publicProjectionResponse =
    responsePath === "/api/public/projection" &&
    (context.res.status === 200 || context.res.status === 304);
  const publicMediaResponse =
    responsePath.startsWith("/api/public/media/") &&
    (context.res.status === 200 || context.res.status === 304);
  const routeCacheControl = context.res.headers.get("cache-control");
  context.header(
    "cache-control",
    publicProjectionResponse
      ? "public, max-age=60, stale-while-revalidate=300"
      : publicMediaResponse
        ? "public, max-age=31536000, immutable"
        : (routeCacheControl ?? "no-store"),
  );
  setSecurityHeaders(
    context.res.headers,
    responsePath === "/api/calendar/feed" || responsePath === "/api/public/unsubscribe"
      ? "no-referrer"
      : "strict-origin-when-cross-origin",
  );
  const allowOrigin = resolveCorsOrigin(
    context.req.header("origin"),
    requestUrl,
    context.env.PRODUCT_BASE_DOMAIN,
  );
  setCorsHeaders(context.res.headers, allowOrigin);
});

router.use("*", async (context, next) => {
  if (!(await boundJsonRequestBody(context))) {
    return context.json(
      {
        code: "request_body_too_large",
        message: `JSON request bodies must be ${String(MAX_JSON_BODY_BYTES)} bytes or smaller.`,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      413,
    );
  }
  await next();
});

registerPublicGroupRoutes(router);
registerSingerGroupRoutes(router);
registerOrganizationGroupRoutes(router);
registerPlatformGroupRoutes(router);
registerSetupGroupRoutes(router);

router.notFound((context) => {
  const problem: ProblemDetails = {
    code: "not_found",
    message: "The requested API route was not found.",
    requestId: context.get("requestId"),
  };
  return context.json(problem, 404);
});
