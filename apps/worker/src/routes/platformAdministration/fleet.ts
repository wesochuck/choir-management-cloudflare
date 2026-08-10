import type { Hono } from "hono";
import type { WorkerHonoEnvironment } from "../helpers";
import { type ProblemDetails } from "@choir/contracts";
import { createAuth, isProductBaseHost } from "../../auth/config";
import { authorizePlatformAdministratorSession } from "../../auth/platformAdministrator";
import {
  beginFleetSchemaPreparation,
  FleetSchemaPreparationError,
} from "../../control/prepareFleetSchema";
import { validateStartupConfig } from "../../env";
import { currentOrganizationSchemaVersion } from "../../organization/schema";
import { resolveCanonicalOrganizationId } from "../helpers";
import type { PlatformFleetSchemaPreparationRow } from "../helpers";

export function registerPlatformFleetRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/platform/context", async (context) => {
    validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    const productBaseScope = isProductBaseHost(
      requestUrl.hostname,
      context.env.PRODUCT_BASE_DOMAIN,
    );
    const organizationId = productBaseScope
      ? null
      : await resolveCanonicalOrganizationId(requestUrl, context.env);
    if (!productBaseScope && !organizationId) {
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
      requestId: context.get("requestId"),
      scope: organizationId
        ? ({ kind: "organization", organizationId } as const)
        : ({ kind: "product_base" } as const),
      userId: authorization.value.userId,
    });
  });

  router.get("/api/platform/fleet-schema-preparation", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message: "Fleet schema preparation is available only on the product base hostname.",
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
    const preparation = await context.env.CONTROL_DB.prepare(
      `SELECT id AS runId, target_version AS targetVersion, status,
      processed_count AS processedCount, started_at AS startedAt,
      updated_at AS updatedAt, completed_at AS completedAt
     FROM fleet_schema_preparations
     ORDER BY started_at DESC, id DESC LIMIT 1`,
    ).first<PlatformFleetSchemaPreparationRow>();
    return context.json({
      currentVersion: currentOrganizationSchemaVersion,
      preparation,
      requestId: context.get("requestId"),
    });
  });

  router.post("/api/platform/fleet-schema-preparation", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message: "Fleet schema preparation is available only on the product base hostname.",
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
    try {
      const started = await beginFleetSchemaPreparation(context.env, {
        actorUserId: authorization.value.userId,
        requestId: context.get("requestId"),
      });
      return context.json(
        {
          currentVersion: currentOrganizationSchemaVersion,
          preparation: {
            completedAt: null,
            processedCount: 0,
            runId: started.runId,
            startedAt: started.startedAt,
            status: "running" as const,
            targetVersion: started.targetVersion,
            updatedAt: started.startedAt,
            workflowId: started.workflowId,
          },
          requestId: context.get("requestId"),
        },
        202,
      );
    } catch (error: unknown) {
      const workflowDispatchFailed =
        error instanceof FleetSchemaPreparationError && error.phase === "workflow";
      return context.json(
        {
          code: workflowDispatchFailed ? "service_unavailable" : "conflict",
          message: workflowDispatchFailed
            ? "The schema-preparation run was recorded, but its Workflow could not be dispatched."
            : "Another fleet schema-preparation run is active.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        workflowDispatchFailed ? 503 : 409,
      );
    }
  });
}
