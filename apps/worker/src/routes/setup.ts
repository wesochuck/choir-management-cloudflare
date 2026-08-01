import { setupProgressRequestSchema, type ProblemDetails } from "@choir/contracts";
import {
  claimSetup,
  completeSetup,
  getSetupStatus,
  saveSetupProgress,
  SetupError,
} from "../organization/organizationSetup";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { setupFailureStatus, authorizeCalendarRoute } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/setup/status", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const status = await getSetupStatus(context.env, authorization.organizationId);
      return context.json(status);
    } catch (error: unknown) {
      const setupError = error instanceof SetupError ? error : null;
      const responseStatus = setupFailureStatus(setupError?.status ?? 503);
      if (!setupError) {
        console.error(
          JSON.stringify({
            event: "setup_status_failed",
            errorType: error instanceof Error ? error.name : "unknown",
            organizationId: authorization.organizationId,
            requestId: context.get("requestId"),
          }),
        );
      }
      return context.json(
        {
          code: setupError?.code ?? "setup_unavailable",
          message: "Setup status is temporarily unavailable.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        responseStatus,
      );
    }
  });

  router.post("/api/setup/claim", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const result = await claimSetup(context.env, {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json(result);
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof SetupError ? error.code : "setup_claim_unavailable",
          message: error instanceof SetupError ? error.message : "Setup could not be claimed.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof SetupError && error.status === 409 ? 409 : 503,
      );
    }
  });

  router.post("/api/setup/progress", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = setupProgressRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid setup step is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const result = await saveSetupProgress(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data,
      );
      return context.json(result);
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof SetupError ? error.code : "setup_progress_unavailable",
          message:
            error instanceof SetupError ? error.message : "Setup progress could not be saved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof SetupError && error.status === 409 ? 409 : 503,
      );
    }
  });

  router.post("/api/setup/complete", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const result = await completeSetup(context.env, {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json(result);
    } catch (error: unknown) {
      return context.json(
        {
          code: error instanceof SetupError ? error.code : "setup_complete_unavailable",
          message: error instanceof SetupError ? error.message : "Setup could not be completed.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        error instanceof SetupError && error.status === 409 ? 409 : 503,
      );
    }
  });
}
