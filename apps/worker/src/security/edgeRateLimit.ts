import type { ProblemDetails } from "@choir/contracts";

import type { Env } from "../env";

export type EdgeRateLimiterName =
  "AUTH_RATE_LIMITER" | "PUBLIC_READ_RATE_LIMITER" | "PUBLIC_MUTATION_RATE_LIMITER";

export interface EvaluateEdgeRateLimitOptions {
  readonly clientIp?: string | undefined;
  readonly env: Env;
  readonly limiterName: EdgeRateLimiterName;
  readonly operation: string;
  readonly organizationId?: string | undefined;
  readonly requestId: string;
}

export type EdgeRateLimitTestOverride = (
  options: EvaluateEdgeRateLimitOptions,
) => { readonly success: boolean } | null;

let testOverride: EdgeRateLimitTestOverride | null = null;

export function setEdgeRateLimitTestOverride(override: EdgeRateLimitTestOverride | null): void {
  testOverride = override;
}

export async function hashClientIp(clientIp: string | undefined): Promise<string> {
  const trimmed = clientIp?.trim();
  const safeIp = trimmed && trimmed.length > 0 ? trimmed : "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(safeIp));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildEdgeRateLimitKey(
  operation: string,
  clientIp?: string,
  organizationId?: string,
): Promise<string> {
  const hashedIp = await hashClientIp(clientIp);
  const normalizedOrg = organizationId?.trim();
  if (normalizedOrg) {
    return `org:${normalizedOrg}:${operation}:${hashedIp}`;
  }
  return `platform:${operation}:${hashedIp}`;
}

export function classifyAuthOperation(pathname: string): string {
  if (
    pathname.startsWith("/api/auth/sign-in") ||
    pathname.startsWith("/api/auth/sign-up") ||
    pathname.startsWith("/api/auth/email-otp") ||
    pathname === "/api/auth/request-password-reset" ||
    pathname === "/api/auth/reset-password" ||
    pathname.startsWith("/api/auth/two-factor") ||
    pathname.startsWith("/api/auth/passkey")
  ) {
    return "auth:sensitive";
  }
  if (pathname.startsWith("/api/auth/callback")) {
    return "auth:callback";
  }
  if (pathname === "/api/auth/get-session") {
    return "auth:session";
  }
  return "auth:general";
}

function getRateLimitExceededMessage(operation: string, limiterName: EdgeRateLimiterName): string {
  if (limiterName === "AUTH_RATE_LIMITER") {
    return "Too many authentication requests. Please try again later.";
  }
  if (operation === "ticket_quote") {
    return "Too many ticket quote requests. Please try again later.";
  }
  if (operation === "audition_inquiry") {
    return "Too many audition inquiries. Please try again later.";
  }
  return "Too many checkout requests. Please try again later.";
}

export async function evaluateEdgeRateLimit(
  options: EvaluateEdgeRateLimitOptions,
): Promise<Response | null> {
  const { clientIp, env, limiterName, operation, organizationId, requestId } = options;
  const binding = env[limiterName];

  let outcome: { readonly success: boolean };

  const overridden = testOverride ? testOverride(options) : null;
  if (overridden) {
    outcome = overridden;
  } else if (binding && typeof binding.limit === "function") {
    const key = await buildEdgeRateLimitKey(operation, clientIp, organizationId);
    outcome = await binding.limit({ key });
  } else {
    if (env.APP_ENV === "staging" || env.APP_ENV === "production") {
      throw new Error(
        `Missing required rate limit binding ${limiterName} in ${env.APP_ENV} environment.`,
      );
    }
    outcome = { success: true };
  }

  if (outcome.success) {
    return null;
  }

  console.warn(
    JSON.stringify({
      environment: env.APP_ENV,
      event: "edge_rate_limit_exceeded",
      limiterName,
      organizationId: organizationId ?? null,
      requestId,
      routeKind: operation,
    }),
  );

  const problem: ProblemDetails = {
    code:
      limiterName === "AUTH_RATE_LIMITER" ? "rate_limit_exceeded" : "public_rate_limit_exceeded",
    message: getRateLimitExceededMessage(operation, limiterName),
    requestId,
  };

  return new Response(JSON.stringify(problem), {
    headers: {
      "content-type": "application/json",
      "retry-after": "60",
    },
    status: 429,
  });
}
