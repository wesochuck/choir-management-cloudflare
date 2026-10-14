import {
  platformElevationRequestSchema,
  type PlatformOrganizationContextResponse,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";
import { z } from "zod";

import { createAuth } from "../../auth/config";
import { authorizePlatformAdministratorSession } from "../../auth/platformAdministrator";
import { createPlatformElevation, revokePlatformElevation } from "../../auth/platformElevation";
import { validateStartupConfig } from "../../env";
import type { WorkerHonoEnvironment } from "../helpers";
import { resolveCanonicalOrganizationId } from "../helpers";

export function registerPlatformElevationRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/platform/elevations", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!organizationId) {
      return context.json(
        {
          code: "not_found",
          message: "Platform edit elevation requires a registered canonical hostname.",
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
    if (!authorization.ok || !session) {
      const code = authorization.ok ? "unauthorized" : authorization.error.code;
      const message = authorization.ok ? "Sign in is required." : authorization.error.message;
      return context.json(
        { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
        code === "unauthorized" ? 401 : 403,
      );
    }

    const parsedBody = platformElevationRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A concise reason is required before enabling Platform Administrator edits.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const platformContext = await createPlatformElevation(context.env.CONTROL_DB, {
      actorUserId: authorization.value.userId,
      organizationId,
      reason: parsedBody.data.reason,
      requestId: context.get("requestId"),
      sessionId: session.session.id,
    });
    const response: PlatformOrganizationContextResponse = {
      ...platformContext,
      requestId: context.get("requestId"),
    };
    return context.json(response, 201);
  });

  router.delete("/api/platform/elevations/:elevationId", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
    const elevationId = z.uuid().safeParse(context.req.param("elevationId"));
    if (!organizationId || !elevationId.success) {
      return context.json(
        {
          code: "not_found",
          message: "The scoped Platform Administrator elevation was not found.",
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
    if (!authorization.ok || !session) {
      const code = authorization.ok ? "unauthorized" : authorization.error.code;
      const message = authorization.ok ? "Sign in is required." : authorization.error.message;
      return context.json(
        { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
        code === "unauthorized" ? 401 : 403,
      );
    }

    const revoked = await revokePlatformElevation(context.env.CONTROL_DB, {
      actorUserId: authorization.value.userId,
      elevationId: elevationId.data,
      organizationId,
      requestId: context.get("requestId"),
      sessionId: session.session.id,
    });
    if (!revoked.ok) {
      return context.json(
        {
          code: revoked.error.code,
          message: revoked.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({ elevationId: revoked.value.elevationId, status: "revoked" as const });
  });
}
