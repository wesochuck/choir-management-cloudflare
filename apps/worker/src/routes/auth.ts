import { accountPasswordRequestSchema, type ProblemDetails } from "@choir/contracts";
import { z } from "zod";
import { createAuth } from "../auth/config";
import { listAccountOrganizations } from "../auth/accountOrganizations";
import { validateStartupConfig } from "../env";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { isAuthorizedPlatformHostname } from "./helpers";
import type { AccountSessionRow } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/account/organizations", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
      return context.json(
        {
          code: "not_found",
          message: "Account management requires a canonical product hostname.",
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
      organizations: await listAccountOrganizations(context.env.CONTROL_DB, session.user.id),
    });
  });

  router.get("/api/account/sessions", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
      return context.json(
        {
          code: "not_found",
          message: "Account management requires a canonical product hostname.",
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
    const rows = await context.env.CONTROL_DB.prepare(
      `SELECT activeOrganizationId, createdAt, expiresAt, id, ipAddress,
       updatedAt, userAgent, userId
     FROM session
     WHERE userId = ? AND expiresAt > ?
     ORDER BY updatedAt DESC`,
    )
      .bind(session.user.id, Date.now())
      .all<AccountSessionRow>();
    return context.json(
      rows.results.map((row) => ({
        activeOrganizationId: row.activeOrganizationId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        id: row.id,
        ipAddress: row.ipAddress,
        updatedAt: row.updatedAt,
        userAgent: row.userAgent,
        userId: row.userId,
      })),
    );
  });

  router.post("/api/account/sessions/revoke", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
      return context.json(
        {
          code: "not_found",
          message: "Account management requires a canonical product hostname.",
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
    const body = z
      .object({ sessionId: z.string().trim().min(1).max(256) })
      .safeParse(await context.req.json<unknown>().catch(() => null));
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid session is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const revoked = await context.env.CONTROL_DB.prepare(
      "DELETE FROM session WHERE id = ? AND userId = ?",
    )
      .bind(body.data.sessionId, session.user.id)
      .run();
    if (revoked.meta.changes !== 1) {
      return context.json(
        {
          code: "not_found",
          message: "That session is no longer active.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({ requestId: context.get("requestId"), status: true });
  });

  router.get("/api/account/security", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
      return context.json(
        {
          code: "not_found",
          message: "Account management requires a canonical product hostname.",
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
    const credential = await context.env.CONTROL_DB.prepare(
      `SELECT 1 AS passwordSet
     FROM account
     WHERE userId = ? AND providerId = 'credential' AND password IS NOT NULL
     LIMIT 1`,
    )
      .bind(session.user.id)
      .first<{ passwordSet: number }>();
    return context.json({
      passwordSet: credential?.passwordSet === 1,
      requestId: context.get("requestId"),
    });
  });

  router.put("/api/account/password", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
      return context.json(
        {
          code: "not_found",
          message: "Account management requires a canonical product hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const parsedBody = accountPasswordRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Passwords must contain between 12 and 128 characters.",
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
    const credential = await context.env.CONTROL_DB.prepare(
      `SELECT 1 AS passwordSet
     FROM account
     WHERE userId = ? AND providerId = 'credential' AND password IS NOT NULL
     LIMIT 1`,
    )
      .bind(session.user.id)
      .first<{ passwordSet: number }>();
    const passwordSet = credential?.passwordSet === 1;
    if (
      (passwordSet && parsedBody.data.mode !== "change") ||
      (!passwordSet && parsedBody.data.mode !== "set")
    ) {
      return context.json(
        {
          code: "conflict",
          message: passwordSet
            ? "The current password is required to change this account password."
            : "This account does not have a password yet.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      );
    }
    try {
      if (parsedBody.data.mode === "set") {
        await auth.api.setPassword({
          body: { newPassword: parsedBody.data.newPassword },
          headers: context.req.raw.headers,
        });
      } else {
        await auth.api.changePassword({
          body: {
            currentPassword: parsedBody.data.currentPassword,
            newPassword: parsedBody.data.newPassword,
            revokeOtherSessions: false,
          },
          headers: context.req.raw.headers,
        });
      }
    } catch {
      return context.json(
        {
          code: "password_update_failed",
          message: "The password could not be updated. Check the current password and try again.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    return context.json({ passwordSet: true, requestId: context.get("requestId") });
  });
}
