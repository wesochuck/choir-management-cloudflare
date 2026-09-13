import type { Hono } from "hono";
import type { WorkerHonoEnvironment } from "../helpers";
import { type ProblemDetails } from "@choir/contracts";
import { createAuth } from "../../auth/config";
import {
  authorizePlatformAdministratorSession,
  confirmPlatformAdministratorMfaEnrollment,
  getPlatformAdministratorMfaStatus,
  recordPlatformMfaAssertion,
} from "../../auth/platformAdministrator";
import { validateStartupConfig } from "../../env";
import {
  isAuthorizedPlatformHostname,
  platformMfaVerificationSchema,
  type PlatformMfaVerification,
} from "../helpers";

async function verifyPlatformFactor(
  auth: ReturnType<typeof createAuth>,
  database: D1Database,
  sessionId: string,
  userId: string,
  headers: Headers,
  verification: PlatformMfaVerification,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  if (verification.method === "passkey") {
    const assurance = await database
      .prepare(
        `SELECT verified_at AS verifiedAt
         FROM session_auth_assurance
         WHERE session_id = ? AND user_id = ? AND method = 'passkey'`,
      )
      .bind(sessionId, userId)
      .first<{ verifiedAt: number }>();

    const now = Date.now();
    const maxAgeMs = 5 * 60 * 1000;
    if (!assurance || now - assurance.verifiedAt > maxAgeMs) {
      return { ok: false, message: "A fresh passkey verification is required." };
    }
    return { ok: true };
  }

  try {
    if (verification.method === "totp") {
      await auth.api.verifyTOTP({
        body: { code: verification.code, trustDevice: false },
        headers,
      });
    } else {
      await auth.api.verifyBackupCode({
        body: { code: verification.code, disableSession: true, trustDevice: false },
        headers,
      });
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Platform Administrator MFA verification failed." };
  }
}

export function registerPlatformMfaRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/platform/mfa/status", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
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
    return context.json({
      ...(await getPlatformAdministratorMfaStatus(context.env.CONTROL_DB, session.user.id)),
      requestId: context.get("requestId"),
    });
  });

  router.post("/api/platform/mfa/confirm-enrollment", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
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

  router.post("/api/platform/mfa/verify", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
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

    const factorVerification = await verifyPlatformFactor(
      auth,
      context.env.CONTROL_DB,
      session.session.id,
      session.user.id,
      context.req.raw.headers,
      parsedBody.data,
    );
    if (!factorVerification.ok) {
      return context.json(
        {
          code: "unauthorized",
          message: factorVerification.message,
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
}
