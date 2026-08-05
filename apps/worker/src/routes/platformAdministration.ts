import {
  type PlatformJobDeadLetterSummary,
  platformJobDeadLetterActionRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
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
import { z } from "zod";

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

const platformDeadLetterSelect = `SELECT dl.id, dl.queue_name AS queueName, dl.message_id AS messageId,
    dl.message_valid AS messageValid, dl.observed_attempt AS observedAttempt,
    dl.organization_id AS organizationId, dl.job_id AS jobId, dl.job_kind AS jobKind,
    dl.idempotency_key AS idempotencyKey, dl.first_seen_at AS firstSeenAt,
    dl.last_seen_at AS lastSeenAt, dl.observation_count AS observationCount,
    dl.resolution_status AS resolutionStatus, dl.resolution_note AS resolutionNote,
    dl.resolution_actor_user_id AS resolutionActorUserId, dl.resolution_at AS resolutionAt,
    dl.retry_count AS retryCount, o.name AS organizationName, d.hostname AS organizationHostname
  FROM job_dead_letters dl
  LEFT JOIN organizations o ON o.id = dl.organization_id
  LEFT JOIN organization_domains d
    ON d.organization_id = dl.organization_id AND d.kind = 'canonical'`;

function platformDeadLetterSummary(row: PlatformDeadLetterRow): PlatformJobDeadLetterSummary {
  return {
    firstSeenAt: row.firstSeenAt,
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    jobId: row.jobId,
    jobKind: row.jobKind,
    lastSeenAt: row.lastSeenAt,
    messageId: row.messageId,
    messageValid: row.messageValid === 1,
    observationCount: row.observationCount,
    observedAttempt: row.observedAttempt,
    organizationId: row.organizationId,
    organizationHostname: row.organizationHostname,
    organizationName: row.organizationName,
    queueName: row.queueName,
    resolutionActorUserId: row.resolutionActorUserId,
    resolutionAt: row.resolutionAt,
    resolutionNote: row.resolutionNote,
    resolutionStatus: row.resolutionStatus,
    retryCount: row.retryCount,
  };
}

async function readPlatformDeadLetter(
  database: D1Database,
  deadLetterId: string,
): Promise<PlatformDeadLetterRow | null> {
  return database
    .prepare(`${platformDeadLetterSelect} WHERE dl.id = ? LIMIT 1`)
    .bind(deadLetterId)
    .first<PlatformDeadLetterRow>();
}

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

    const baseQuery = platformDeadLetterSelect;
    const statement = cursor
      ? context.env.CONTROL_DB.prepare(
          `${baseQuery}
         WHERE dl.last_seen_at < ? OR (dl.last_seen_at = ? AND dl.id < ?)
         ORDER BY dl.last_seen_at DESC, dl.id DESC
         LIMIT ?`,
        ).bind(cursor[0], cursor[0], cursor[1], PLATFORM_DEAD_LETTER_PAGE_SIZE + 1)
      : context.env.CONTROL_DB.prepare(
          `${baseQuery}
         ORDER BY dl.last_seen_at DESC, dl.id DESC
         LIMIT ?`,
        ).bind(PLATFORM_DEAD_LETTER_PAGE_SIZE + 1);
    const rows = await statement.all<PlatformDeadLetterRow>();
    const deadLetters = rows.results
      .slice(0, PLATFORM_DEAD_LETTER_PAGE_SIZE)
      .map(platformDeadLetterSummary);
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

  // eslint-disable-next-line complexity -- authenticates, claims, performs, and records three audited operator actions.
  router.post("/api/platform/job-dead-letters/:deadLetterId/actions", async (context) => {
    const config = validateStartupConfig(context.env);
    const requestUrl = new URL(context.req.url);
    if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
      return context.json(
        {
          code: "not_found",
          message: "Queue failure actions are available only on the product base hostname.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const deadLetterId = z.string().min(1).max(512).safeParse(context.req.param("deadLetterId"));
    const action = platformJobDeadLetterActionRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!deadLetterId.success || !action.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A queue failure ID, action, and operator note are required.",
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

    const row = await readPlatformDeadLetter(context.env.CONTROL_DB, deadLetterId.data);
    if (!row) {
      return context.json(
        {
          code: "not_found",
          message: "The queue failure was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    if (row.resolutionStatus === "resolved" || row.resolutionStatus === "ignored") {
      return context.json(
        {
          code: "conflict",
          message: "This queue failure has already been closed.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      );
    }

    if (action.data.action === "retry") {
      if (
        row.resolutionStatus !== "open" ||
        row.messageValid !== 1 ||
        !row.organizationId ||
        !row.jobId ||
        !row.jobKind ||
        !row.idempotencyKey
      ) {
        return context.json(
          {
            code: "conflict",
            message: "This queue failure does not contain a validated Organization job to retry.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }

      const claimedAt = new Date().toISOString();
      const claimed = await context.env.CONTROL_DB.prepare(
        `UPDATE job_dead_letters
           SET resolution_status = 'retry_queued', resolution_note = ?,
             resolution_actor_user_id = ?, resolution_at = ?, retry_count = retry_count + 1
           WHERE id = ? AND resolution_status = 'open'`,
      )
        .bind(action.data.note, authorization.value.userId, claimedAt, deadLetterId.data)
        .run();
      if (claimed.meta.changes !== 1) {
        return context.json(
          {
            code: "conflict",
            message: "This queue failure is already being handled. Refresh and review it again.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }

      const retryResponse = await context.env.ORGANIZATION_STORE.get(
        context.env.ORGANIZATION_STORE.idFromName(row.organizationId),
      ).fetch("https://organization.internal/internal/jobs/retry", {
        body: JSON.stringify({
          actorUserId: authorization.value.userId,
          attempt: 1,
          idempotencyKey: row.idempotencyKey,
          jobId: row.jobId,
          kind: row.jobKind,
          organizationId: row.organizationId,
          requestId: context.get("requestId"),
          version: 1,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!retryResponse.ok) {
        await context.env.CONTROL_DB.prepare(
          `UPDATE job_dead_letters
             SET resolution_status = 'open', resolution_note = ?,
               resolution_actor_user_id = ?, resolution_at = ?
             WHERE id = ? AND resolution_status = 'retry_queued'`,
        )
          .bind(
            action.data.note,
            authorization.value.userId,
            new Date().toISOString(),
            deadLetterId.data,
          )
          .run();
        const retryFailure = retryResponse.status === 404 ? "not_found" : "service_unavailable";
        return context.json(
          {
            code: retryFailure,
            message:
              retryFailure === "not_found"
                ? "The Organization job could not be found for retry."
                : "The Organization job could not be queued. Check the queue and try again.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          retryResponse.status === 404 ? 404 : 503,
        );
      }

      await context.env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
            (id, actor_user_id, organization_id, action, target_type, target_id,
             request_id, change_summary, occurred_at)
           VALUES (?, ?, ?, 'platform.queue_failure.retry_queued', 'job_dead_letter', ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          authorization.value.userId,
          row.organizationId,
          row.id,
          context.get("requestId"),
          JSON.stringify({ jobId: row.jobId, jobKind: row.jobKind, note: action.data.note }),
          new Date().toISOString(),
        )
        .run();
    } else {
      const status = action.data.action === "resolve" ? "resolved" : "ignored";
      const changedAt = new Date().toISOString();
      const changed = await context.env.CONTROL_DB.prepare(
        `UPDATE job_dead_letters
           SET resolution_status = ?, resolution_note = ?,
             resolution_actor_user_id = ?, resolution_at = ?
           WHERE id = ? AND resolution_status IN ('open', 'retry_queued')`,
      )
        .bind(status, action.data.note, authorization.value.userId, changedAt, row.id)
        .run();
      if (changed.meta.changes !== 1) {
        return context.json(
          {
            code: "conflict",
            message: "This queue failure is already being handled. Refresh and review it again.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
      }
      await context.env.CONTROL_DB.prepare(
        `INSERT INTO platform_audit_events
            (id, actor_user_id, organization_id, action, target_type, target_id,
             request_id, change_summary, occurred_at)
           VALUES (?, ?, ?, ?, 'job_dead_letter', ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          authorization.value.userId,
          row.organizationId,
          `platform.queue_failure.${status}`,
          row.id,
          context.get("requestId"),
          JSON.stringify({ jobId: row.jobId, jobKind: row.jobKind, note: action.data.note }),
          changedAt,
        )
        .run();
    }

    const updated = await readPlatformDeadLetter(context.env.CONTROL_DB, deadLetterId.data);
    if (!updated) {
      return context.json(
        {
          code: "service_unavailable",
          message:
            "The queue failure action was recorded, but its updated state could not be read.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
    return context.json({
      deadLetter: platformDeadLetterSummary(updated),
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
