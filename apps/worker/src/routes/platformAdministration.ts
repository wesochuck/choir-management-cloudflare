import { type ProblemDetails } from "@choir/contracts";
import { createAuth, isProductBaseHost } from "../auth/config";
import {
  authorizePlatformAdministratorSession,
  confirmPlatformAdministratorMfaEnrollment,
  getPlatformAdministratorMfaStatus,
  recordPlatformMfaAssertion,
} from "../auth/platformAdministrator";
import {
  beginFleetSchemaPreparation,
  FleetSchemaPreparationError,
} from "../control/prepareFleetSchema";
import { validateStartupConfig } from "../env";
import { currentOrganizationSchemaVersion } from "../organization/schema";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import {
  PLATFORM_ORGANIZATION_PAGE_SIZE,
  PLATFORM_DEAD_LETTER_PAGE_SIZE,
  parsePlatformOrganizationCursor,
  encodePlatformOrganizationCursor,
  parsePlatformDeadLetterCursor,
  encodePlatformDeadLetterCursor,
  isAuthorizedPlatformHostname,
  resolveCanonicalOrganizationId,
  platformMfaVerificationSchema,
} from "./helpers";
import type {
  PlatformOrganizationRow,
  PlatformDeadLetterRow,
  PlatformFleetSchemaPreparationRow,
} from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
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

  router.get("/api/platform/job-dead-letters", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message: "Queue dead-letter visibility is available only on the product base hostname.",
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

    const cursor = parsePlatformDeadLetterCursor(requestUrl.searchParams.get("cursor"));
    if (cursor === undefined) {
      return context.json(
        {
          code: "validation_failed",
          message: "The queue dead-letter cursor is invalid.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const baseQuery = `SELECT id, queue_name AS queueName, message_id AS messageId,
      message_valid AS messageValid, observed_attempt AS observedAttempt,
      organization_id AS organizationId, job_id AS jobId, job_kind AS jobKind,
      idempotency_key AS idempotencyKey, first_seen_at AS firstSeenAt,
      last_seen_at AS lastSeenAt, observation_count AS observationCount
    FROM job_dead_letters`;
    const statement = cursor
      ? context.env.CONTROL_DB.prepare(
          `${baseQuery}
         WHERE last_seen_at < ? OR (last_seen_at = ? AND id < ?)
         ORDER BY last_seen_at DESC, id DESC
         LIMIT ?`,
        ).bind(cursor[0], cursor[0], cursor[1], PLATFORM_DEAD_LETTER_PAGE_SIZE + 1)
      : context.env.CONTROL_DB.prepare(
          `${baseQuery}
         ORDER BY last_seen_at DESC, id DESC
         LIMIT ?`,
        ).bind(PLATFORM_DEAD_LETTER_PAGE_SIZE + 1);
    const rows = await statement.all<PlatformDeadLetterRow>();
    const deadLetters = rows.results.slice(0, PLATFORM_DEAD_LETTER_PAGE_SIZE).map((row) => ({
      firstSeenAt: row.firstSeenAt,
      idempotencyKey: row.idempotencyKey,
      jobId: row.jobId,
      jobKind: row.jobKind,
      lastSeenAt: row.lastSeenAt,
      messageId: row.messageId,
      messageValid: row.messageValid === 1,
      observationCount: row.observationCount,
      observedAttempt: row.observedAttempt,
      organizationId: row.organizationId,
      queueName: row.queueName,
    }));
    const cursorRow =
      deadLetters.length === PLATFORM_DEAD_LETTER_PAGE_SIZE
        ? rows.results[PLATFORM_DEAD_LETTER_PAGE_SIZE - 1]
        : undefined;
    return context.json({
      deadLetters,
      nextCursor:
        rows.results.length > PLATFORM_DEAD_LETTER_PAGE_SIZE && cursorRow
          ? encodePlatformDeadLetterCursor(cursorRow)
          : null,
      requestId: context.get("requestId"),
    });
  });

  router.get("/api/platform/organizations", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message:
            "The Platform Organization directory is available only on the product base hostname.",
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

    const cursor = parsePlatformOrganizationCursor(requestUrl.searchParams.get("cursor"));
    if (cursor === undefined) {
      return context.json(
        {
          code: "validation_failed",
          message: "The Organization directory cursor is invalid.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const baseQuery = `SELECT o.id AS organizationId, o.name, o.slug,
      o.lifecycle_state AS lifecycleState,
      o.operational_schema_version AS operationalSchemaVersion,
      o.provisioned_at AS provisionedAt, o.created_at AS createdAt,
      d.hostname AS canonicalHostname, d.status AS canonicalStatus
    FROM organizations o
    INNER JOIN organization_domains d
      ON d.organization_id = o.id AND d.kind = 'canonical'`;
    const statement = cursor
      ? context.env.CONTROL_DB.prepare(
          `${baseQuery}
         WHERE o.created_at < ? OR (o.created_at = ? AND o.id < ?)
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ?`,
        ).bind(cursor[0], cursor[0], cursor[1], PLATFORM_ORGANIZATION_PAGE_SIZE + 1)
      : context.env.CONTROL_DB.prepare(
          `${baseQuery}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ?`,
        ).bind(PLATFORM_ORGANIZATION_PAGE_SIZE + 1);
    const rows = await statement.all<PlatformOrganizationRow>();
    const organizations = rows.results.slice(0, PLATFORM_ORGANIZATION_PAGE_SIZE).map((row) => ({
      canonicalHostname: row.canonicalHostname,
      canonicalStatus: row.canonicalStatus,
      lifecycleState: row.lifecycleState,
      name: row.name,
      operationalSchemaVersion: row.operationalSchemaVersion,
      organizationId: row.organizationId,
      provisionedAt: row.provisionedAt,
      slug: row.slug,
    }));
    const cursorRow =
      organizations.length === PLATFORM_ORGANIZATION_PAGE_SIZE
        ? rows.results[PLATFORM_ORGANIZATION_PAGE_SIZE - 1]
        : undefined;
    return context.json({
      nextCursor:
        rows.results.length > PLATFORM_ORGANIZATION_PAGE_SIZE && cursorRow
          ? encodePlatformOrganizationCursor(cursorRow)
          : null,
      organizations,
      requestId: context.get("requestId"),
    });
  });
}
