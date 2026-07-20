import type { HealthResponse, OrganizationContextResponse, ProblemDetails } from "@choir/contracts";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { z } from "zod";

import { createAuth, isCanonicalAuthHost, isProductBaseHost } from "./auth/config";
import {
  authorizePlatformAdministratorSession,
  confirmPlatformAdministratorMfaEnrollment,
  recordPlatformMfaAssertion,
} from "./auth/platformAdministrator";
import type { Env } from "./env";
import { validateStartupConfig } from "./env";
import { authorizeOrganizationMember } from "./tenancy/authorizeOrganization";
import { resolveOrganization } from "./tenancy/resolveOrganization";

interface WorkerHonoEnvironment {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
}

export const router = new Hono<WorkerHonoEnvironment>();

router.use("*", requestId());
router.use("*", async (context, next) => {
  await next();
  context.header("cache-control", "no-store");
  context.header("referrer-policy", "strict-origin-when-cross-origin");
  context.header("x-content-type-options", "nosniff");
  context.header("x-frame-options", "DENY");
});

router.get("/api/health", (context) => {
  const config = validateStartupConfig(context.env);
  const response: HealthResponse = {
    environment: config.APP_ENV,
    requestId: context.get("requestId"),
    service: "choir-management-cloudflare",
    status: "ok",
    version: config.BUILD_VERSION,
  };

  return context.json(response);
});

router.get("/api/ready", async (context) => {
  const requestIdValue = context.get("requestId");

  try {
    validateStartupConfig(context.env);
    await context.env.CONTROL_DB.prepare("SELECT 1 AS ready").first<{ ready: number }>();
    return context.json({ requestId: requestIdValue, status: "ready" as const });
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        errorType: error instanceof Error ? error.name : "UnknownError",
        event: "readiness_check_failed",
        requestId: requestIdValue,
      }),
    );
    const problem: ProblemDetails = {
      code: "service_not_ready",
      message: "The service is not ready.",
      requestId: requestIdValue,
    };
    return context.json(problem, 503);
  }
});

router.on(["GET", "POST"], "/api/auth/*", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);

  const hostnameIsProductBase = isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN);
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

router.get("/api/organization/context", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const resolvedOrganization = await resolveOrganization(requestUrl, context.env);
  if (!resolvedOrganization.ok) {
    const problem: ProblemDetails = {
      code: resolvedOrganization.error.code,
      message: resolvedOrganization.error.message,
      requestId: context.get("requestId"),
    };
    return context.json(
      problem,
      resolvedOrganization.error.code === "validation_failed" ? 400 : 404,
    );
  }
  if (resolvedOrganization.value.routeKind !== "canonical") {
    const problem: ProblemDetails = {
      code: "not_found",
      message: "Authenticated Organization routes require a canonical product hostname.",
      requestId: context.get("requestId"),
    };
    return context.json(problem, 404);
  }
  if (!isCanonicalAuthHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    const problem: ProblemDetails = {
      code: "not_found",
      message: "Authenticated Organization routes require a canonical product hostname.",
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
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    resolvedOrganization.value.organizationId,
    session?.user.id ?? null,
  );
  if (!authorization.ok) {
    const problem: ProblemDetails = {
      code: authorization.error.code,
      message: authorization.error.message,
      requestId: context.get("requestId"),
    };
    return context.json(problem, authorization.error.code === "unauthorized" ? 401 : 403);
  }

  const response: OrganizationContextResponse = {
    organizationId: authorization.value.organizationId,
    requestId: context.get("requestId"),
    role: authorization.value.role,
    userId: authorization.value.userId,
  };
  return context.json(response);
});

const organizationInvitationSchema = z.object({
  email: z
    .email()
    .max(320)
    .transform((email) => email.toLowerCase()),
  role: z.enum(["owner", "administrator", "member"]),
});

router.post("/api/organization/invitations", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const resolvedOrganization = await resolveOrganization(requestUrl, context.env);
  if (
    !resolvedOrganization.ok ||
    resolvedOrganization.value.routeKind !== "canonical" ||
    !isCanonicalAuthHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)
  ) {
    return context.json(
      {
        code: "not_found",
        message: "Organization invitations require a canonical product hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const parsedBody = organizationInvitationSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsedBody.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid invitation email and Organization role are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
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
    resolvedOrganization.value.organizationId,
    session?.user.id ?? null,
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
  if (authorization.value.role === "member") {
    return context.json(
      {
        code: "forbidden",
        message: "Only Organization Owners and Administrators may invite members.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }
  if (parsedBody.data.role === "owner" && authorization.value.role !== "owner") {
    return context.json(
      {
        code: "forbidden",
        message: "Only an Organization Owner may invite another Owner.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }

  const betterAuthRole = parsedBody.data.role === "administrator" ? "admin" : parsedBody.data.role;
  try {
    const invitation = await auth.api.createInvitation({
      body: {
        email: parsedBody.data.email,
        organizationId: resolvedOrganization.value.organizationId,
        role: betterAuthRole,
      },
      headers: context.req.raw.headers,
    });
    const now = Date.now();
    const defaultName = parsedBody.data.email.split("@", 1)[0] ?? "Invited member";
    await context.env.CONTROL_DB.prepare(
      `INSERT OR IGNORE INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES (?, ?, ?, 0, ?, ?, 0)`,
    )
      .bind(crypto.randomUUID(), defaultName, parsedBody.data.email, now, now)
      .run();
    return context.json(
      {
        expiresAt: invitation.expiresAt.toISOString(),
        id: invitation.id,
        status: invitation.status,
      },
      201,
    );
  } catch {
    return context.json(
      {
        code: "conflict",
        message: "The Organization invitation could not be created.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
});

router.post("/api/platform/mfa/confirm-enrollment", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!isCanonicalAuthHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    return context.json(
      {
        code: "not_found",
        message: "Platform administration requires a canonical product hostname.",
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
  const confirmation = await confirmPlatformAdministratorMfaEnrollment(
    context.env.CONTROL_DB,
    session?.user.id ?? null,
  );
  if (!confirmation.ok) {
    return context.json(
      {
        code: confirmation.error.code,
        message: confirmation.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      confirmation.error.code === "unauthorized" ? 401 : 403,
    );
  }
  return context.json({ status: "confirmed" as const });
});

const platformMfaVerificationSchema = z.discriminatedUnion("method", [
  z.object({ code: z.string().regex(/^\d{6}$/), method: z.literal("totp") }),
  z.object({ code: z.string().min(8).max(128), method: z.literal("recovery_code") }),
]);

router.post("/api/platform/mfa/verify", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!isCanonicalAuthHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    return context.json(
      {
        code: "not_found",
        message: "Platform administration requires a canonical product hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const parsedBody = platformMfaVerificationSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsedBody.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid Platform Administrator MFA code and method are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
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
  const existingAuthorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!existingAuthorization.ok && existingAuthorization.error.code === "forbidden") {
    return context.json(
      {
        code: existingAuthorization.error.code,
        message: existingAuthorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Sign in is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }

  try {
    if (parsedBody.data.method === "totp") {
      await auth.api.verifyTOTP({
        body: { code: parsedBody.data.code, trustDevice: false },
        headers: context.req.raw.headers,
      });
    } else {
      await auth.api.verifyBackupCode({
        body: { code: parsedBody.data.code, disableSession: true, trustDevice: false },
        headers: context.req.raw.headers,
      });
    }
  } catch {
    return context.json(
      {
        code: "unauthorized",
        message: "Platform Administrator MFA verification failed.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }

  const assertion = await recordPlatformMfaAssertion(
    context.env.CONTROL_DB,
    session.session.id,
    session.user.id,
    parsedBody.data.method,
  );
  if (!assertion.ok) {
    return context.json(
      {
        code: assertion.error.code,
        message: assertion.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }
  return context.json({
    expiresAt: new Date(assertion.value.mfaVerifiedUntil).toISOString(),
    status: "verified" as const,
  });
});

router.get("/api/platform/context", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!isCanonicalAuthHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    return context.json(
      {
        code: "not_found",
        message: "Platform administration requires a canonical product hostname.",
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
  const authorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
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
  return context.json({
    mfaMethod: authorization.value.mfaMethod,
    mfaVerifiedUntil: new Date(authorization.value.mfaVerifiedUntil).toISOString(),
    userId: authorization.value.userId,
  });
});

router.notFound((context) => {
  const problem: ProblemDetails = {
    code: "not_found",
    message: "The requested API route was not found.",
    requestId: context.get("requestId"),
  };
  return context.json(problem, 404);
});
