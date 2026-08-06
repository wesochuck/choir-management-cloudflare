import {
  platformJobDeadLetterActionRequestSchema,
  platformJobDeadLetterViewSchema,
  type ProblemDetails,
  type PlatformJobDeadLetterActionStatus,
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

import type { Context, Hono } from "hono";

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

type PlatformAdministrationContext = Context<WorkerHonoEnvironment>;

interface PlatformAdministratorAuthorization {
  readonly userId: string;
}

interface PlatformDeadLetterActionRow {
  readonly actionAt: string;
  readonly actionError: string;
  readonly actionReason: string;
  readonly actionStatus: Exclude<PlatformJobDeadLetterActionStatus, "open">;
  readonly actorUserId: string;
  readonly retryAttempt: number | null;
  readonly retryIdempotencyKey: string | null;
  readonly retryJobId: string | null;
}

interface PlatformDeadLetterRecordRow {
  readonly actionAt: string | null;
  readonly actionError: string | null;
  readonly actionReason: string | null;
  readonly actionStatus: PlatformJobDeadLetterActionStatus | null;
  readonly firstSeenAt: string;
  readonly id: string;
  readonly idempotencyKey: string | null;
  readonly jobId: string | null;
  readonly jobKind: PlatformDeadLetterRow["jobKind"];
  readonly lastSeenAt: string;
  readonly messageId: string;
  readonly messageValid: number;
  readonly observationCount: number;
  readonly observedAttempt: number;
  readonly organizationId: string | null;
  readonly queueName: string;
}

async function authorizePlatformAdministration(
  context: PlatformAdministrationContext,
  requestUrl: URL,
): Promise<Response | PlatformAdministratorAuthorization> {
  const config = validateStartupConfig(context.env);
  if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    return context.json(
      {
        code: "not_found",
        message: "Platform administration is available only on the product base hostname.",
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
  return { userId: authorization.value.userId };
}

function actionResponse(
  context: PlatformAdministrationContext,
  deadLetterId: string,
  actionStatus: PlatformJobDeadLetterActionStatus,
  retryAttempt: number | null,
  status: 200 | 202 = 200,
): Response {
  return context.json(
    {
      actionStatus,
      deadLetterId,
      requestId: context.get("requestId"),
      retryAttempt,
    },
    status,
  );
}

async function readDeadLetterRecord(
  database: D1Database,
  deadLetterId: string,
): Promise<PlatformDeadLetterRecordRow | null> {
  return database
    .prepare(
      `SELECT id, queue_name AS queueName, message_id AS messageId,
        message_valid AS messageValid, observed_attempt AS observedAttempt,
        organization_id AS organizationId, job_id AS jobId, job_kind AS jobKind,
        idempotency_key AS idempotencyKey, first_seen_at AS firstSeenAt,
        last_seen_at AS lastSeenAt, observation_count AS observationCount
       FROM job_dead_letters WHERE id = ? LIMIT 1`,
    )
    .bind(deadLetterId)
    .first<PlatformDeadLetterRecordRow>();
}

async function readDeadLetterAction(
  database: D1Database,
  deadLetterId: string,
): Promise<PlatformDeadLetterActionRow | null> {
  return database
    .prepare(
      `SELECT action_at AS actionAt, error_detail AS actionError,
        reason AS actionReason, status AS actionStatus, actor_user_id AS actorUserId,
        retry_attempt AS retryAttempt, retry_idempotency_key AS retryIdempotencyKey,
        retry_job_id AS retryJobId
       FROM job_dead_letter_actions WHERE dead_letter_id = ? LIMIT 1`,
    )
    .bind(deadLetterId)
    .first<PlatformDeadLetterActionRow>();
}

async function recordDeadLetterRetryFailure(
  database: D1Database,
  deadLetterId: string,
  detail: string,
): Promise<void> {
  await database
    .prepare(
      `UPDATE job_dead_letter_actions
       SET status = 'retry_failed', error_detail = ?, action_at = ?
       WHERE dead_letter_id = ? AND status = 'retry_requested'`,
    )
    .bind(detail.slice(0, 500), new Date().toISOString(), deadLetterId)
    .run();
}

// eslint-disable-next-line complexity -- this bounded workflow coordinates auth, source reset, queueing, and audit state.
async function retryPlatformJobDeadLetter(
  context: PlatformAdministrationContext,
  authorization: PlatformAdministratorAuthorization,
  deadLetterId: string,
  reason: string,
): Promise<Response> {
  const deadLetter = await readDeadLetterRecord(context.env.CONTROL_DB, deadLetterId);
  if (!deadLetter) {
    return context.json(
      {
        code: "job_dead_letter_not_found",
        message: "That queue failure record no longer exists.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }

  const existingAction = await readDeadLetterAction(context.env.CONTROL_DB, deadLetterId);
  if (existingAction?.actionStatus === "dismissed") {
    return context.json(
      {
        code: "job_dead_letter_dismissed",
        message: "This queue failure has already been dismissed.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
  if (existingAction?.actionStatus === "retry_requested") {
    return actionResponse(
      context,
      deadLetterId,
      "retry_requested",
      existingAction.retryAttempt,
      202,
    );
  }
  if (existingAction?.actionStatus === "retry_queued") {
    return actionResponse(context, deadLetterId, "retry_queued", existingAction.retryAttempt);
  }

  if (
    deadLetter.queueName !== context.env.JOBS_DLQ_NAME ||
    deadLetter.messageValid !== 1 ||
    !deadLetter.organizationId ||
    !deadLetter.jobId ||
    !deadLetter.jobKind ||
    !deadLetter.idempotencyKey
  ) {
    return context.json(
      {
        code: "job_dead_letter_not_retryable",
        message:
          "This record does not contain a validated originating job. Dismiss it after review instead of retrying it.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
  if (deadLetter.observedAttempt >= 10) {
    return context.json(
      {
        code: "job_dead_letter_retry_limit",
        message:
          "This job has reached the retry safety limit. Create a new send from the originating record instead.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }

  const requestId = context.get("requestId");
  const requestedAt = new Date().toISOString();
  if (existingAction?.actionStatus === "retry_failed") {
    await context.env.CONTROL_DB.prepare(
      `UPDATE job_dead_letter_actions
       SET status = 'retry_requested', reason = ?, error_detail = '',
           actor_user_id = ?, action_at = ?, retry_attempt = NULL,
           retry_job_id = NULL, retry_idempotency_key = NULL
       WHERE dead_letter_id = ? AND status = 'retry_failed'`,
    )
      .bind(reason, authorization.userId, requestedAt, deadLetterId)
      .run();
  } else {
    await context.env.CONTROL_DB.prepare(
      `INSERT OR IGNORE INTO job_dead_letter_actions
        (dead_letter_id, status, reason, error_detail, actor_user_id, action_at)
       VALUES (?, 'retry_requested', ?, '', ?, ?)`,
    )
      .bind(deadLetterId, reason, authorization.userId, requestedAt)
      .run();
  }

  const claimedAction = await readDeadLetterAction(context.env.CONTROL_DB, deadLetterId);
  if (claimedAction?.actionStatus !== "retry_requested") {
    return claimedAction
      ? actionResponse(
          context,
          deadLetterId,
          claimedAction.actionStatus,
          claimedAction.retryAttempt,
          200,
        )
      : context.json(
          {
            code: "job_dead_letter_action_unavailable",
            message: "The queue failure action could not be claimed. Refresh and try again.",
            requestId,
          } satisfies ProblemDetails,
          409,
        );
  }
  if (claimedAction.actionAt !== requestedAt && existingAction?.actionStatus !== "retry_failed") {
    return actionResponse(
      context,
      deadLetterId,
      claimedAction.actionStatus,
      claimedAction.retryAttempt,
      202,
    );
  }

  await context.env.CONTROL_DB.prepare(
    `INSERT OR IGNORE INTO platform_audit_events
      (id, actor_user_id, organization_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, ?, NULL, 'platform.job_dead_letter.retry_requested',
       'job_dead_letter', ?, ?, ?, ?)`,
  )
    .bind(
      `job-dead-letter-retry-requested:${deadLetterId}:${requestedAt}`,
      authorization.userId,
      deadLetterId,
      requestId,
      JSON.stringify({ jobId: deadLetter.jobId, jobKind: deadLetter.jobKind, reason }),
      requestedAt,
    )
    .run();

  const objectStub = context.env.ORGANIZATION_STORE.get(
    context.env.ORGANIZATION_STORE.idFromName(deadLetter.organizationId),
  );
  let requeueResponse: Response;
  try {
    requeueResponse = await objectStub.fetch(
      "https://organization.internal/internal/jobs/requeue",
      {
        body: JSON.stringify({
          idempotencyKey: deadLetter.idempotencyKey,
          jobId: deadLetter.jobId,
          kind: deadLetter.jobKind,
          organizationId: deadLetter.organizationId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message:
          "Retry was requested, but the originating Organization store did not confirm the reset. Do not submit another retry until it is inspected.",
        requestId,
      } satisfies ProblemDetails,
      503,
    );
  }
  const requeueErrorBody: unknown = requeueResponse.ok
    ? null
    : await requeueResponse
        .clone()
        .json()
        .catch(() => null);
  if (!requeueResponse.ok) {
    const sourceCode =
      typeof requeueErrorBody === "object" &&
      requeueErrorBody !== null &&
      "code" in requeueErrorBody &&
      typeof requeueErrorBody.code === "string"
        ? requeueErrorBody.code
        : null;
    const detail =
      requeueResponse.status === 404
        ? "The originating job could not be found in its Organization store."
        : sourceCode === "job_source_not_retryable"
          ? "The originating source record is no longer in a retryable state. Use its source-specific retry action instead."
          : `The originating job is not currently retryable (${sourceCode ?? "unknown source state"}).`;
    await recordDeadLetterRetryFailure(context.env.CONTROL_DB, deadLetterId, detail);
    return context.json(
      {
        code: "job_dead_letter_retry_unavailable",
        message: detail,
        requestId,
      } satisfies ProblemDetails,
      requeueResponse.status === 404 ? 404 : 409,
    );
  }
  const requeueBody: unknown = await requeueResponse.json().catch(() => null);
  if (
    typeof requeueBody !== "object" ||
    requeueBody === null ||
    !("requeued" in requeueBody) ||
    requeueBody.requeued !== true
  ) {
    const detail = "The originating job is already complete or cannot be retried.";
    await recordDeadLetterRetryFailure(context.env.CONTROL_DB, deadLetterId, detail);
    return context.json(
      {
        code: "job_dead_letter_retry_unavailable",
        message: detail,
        requestId,
      } satisfies ProblemDetails,
      409,
    );
  }

  try {
    await context.env.JOBS_QUEUE.send({
      attempt: 1,
      idempotencyKey: deadLetter.idempotencyKey,
      jobId: deadLetter.jobId,
      kind: deadLetter.jobKind,
      organizationId: deadLetter.organizationId,
      version: 1,
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message:
          "The originating job was reset, but the fresh queue message was not confirmed. Do not submit another retry until the source job is inspected.",
        requestId,
      } satisfies ProblemDetails,
      503,
    );
  }

  const queuedAt = new Date().toISOString();
  await context.env.CONTROL_DB.batch([
    context.env.CONTROL_DB.prepare(
      `UPDATE job_dead_letter_actions
       SET status = 'retry_queued', error_detail = '', action_at = ?,
           retry_attempt = 1, retry_job_id = ?, retry_idempotency_key = ?
       WHERE dead_letter_id = ? AND status = 'retry_requested'`,
    ).bind(queuedAt, deadLetter.jobId, deadLetter.idempotencyKey, deadLetterId),
    context.env.CONTROL_DB.prepare(
      `INSERT OR IGNORE INTO platform_audit_events
        (id, actor_user_id, organization_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, ?, NULL, 'platform.job_dead_letter.retry_queued',
         'job_dead_letter', ?, ?, ?, ?)`,
    ).bind(
      `job-dead-letter-retry-queued:${deadLetterId}:${queuedAt}`,
      authorization.userId,
      deadLetterId,
      requestId,
      JSON.stringify({ jobId: deadLetter.jobId, jobKind: deadLetter.jobKind }),
      queuedAt,
    ),
  ]);
  return actionResponse(context, deadLetterId, "retry_queued", 1, 202);
}

async function dismissPlatformJobDeadLetter(
  context: PlatformAdministrationContext,
  authorization: PlatformAdministratorAuthorization,
  deadLetterId: string,
  reason: string,
): Promise<Response> {
  const deadLetter = await readDeadLetterRecord(context.env.CONTROL_DB, deadLetterId);
  if (!deadLetter) {
    return context.json(
      {
        code: "job_dead_letter_not_found",
        message: "That queue failure record no longer exists.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const existingAction = await readDeadLetterAction(context.env.CONTROL_DB, deadLetterId);
  if (existingAction?.actionStatus === "retry_requested") {
    return context.json(
      {
        code: "job_dead_letter_retry_pending",
        message:
          "The retry outcome is still pending. Inspect the originating job before dismissing it.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
  if (existingAction?.actionStatus === "dismissed") {
    return actionResponse(context, deadLetterId, "dismissed", existingAction.retryAttempt);
  }

  const actionAt = new Date().toISOString();
  if (existingAction) {
    await context.env.CONTROL_DB.prepare(
      `UPDATE job_dead_letter_actions
       SET status = 'dismissed', reason = ?, error_detail = '', actor_user_id = ?, action_at = ?
       WHERE dead_letter_id = ? AND status IN ('retry_queued', 'retry_failed')`,
    )
      .bind(reason, authorization.userId, actionAt, deadLetterId)
      .run();
  } else {
    await context.env.CONTROL_DB.prepare(
      `INSERT OR IGNORE INTO job_dead_letter_actions
        (dead_letter_id, status, reason, error_detail, actor_user_id, action_at)
       VALUES (?, 'dismissed', ?, '', ?, ?)`,
    )
      .bind(deadLetterId, reason, authorization.userId, actionAt)
      .run();
  }
  const action = await readDeadLetterAction(context.env.CONTROL_DB, deadLetterId);
  if (action?.actionStatus !== "dismissed") {
    return context.json(
      {
        code: "job_dead_letter_action_unavailable",
        message: "The queue failure could not be dismissed. Refresh and try again.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
  await context.env.CONTROL_DB.prepare(
    `INSERT OR IGNORE INTO platform_audit_events
      (id, actor_user_id, organization_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, ?, NULL, 'platform.job_dead_letter.dismissed',
       'job_dead_letter', ?, ?, ?, ?)`,
  )
    .bind(
      `job-dead-letter-dismissed:${deadLetterId}:${actionAt}`,
      authorization.userId,
      deadLetterId,
      context.get("requestId"),
      JSON.stringify({ reason }),
      actionAt,
    )
    .run();
  return actionResponse(context, deadLetterId, "dismissed", action.retryAttempt);
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
    const requestUrl = new URL(context.req.url);
    const authorization = await authorizePlatformAdministration(context, requestUrl);
    if (authorization instanceof Response) return authorization;

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

    const view = platformJobDeadLetterViewSchema.safeParse(
      requestUrl.searchParams.get("view") ?? "open",
    );
    if (!view.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "The queue dead-letter view is invalid.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const baseQuery = `SELECT id, queue_name AS queueName, message_id AS messageId,
      message_valid AS messageValid, observed_attempt AS observedAttempt,
      organization_id AS organizationId, job_id AS jobId, job_kind AS jobKind,
      idempotency_key AS idempotencyKey, first_seen_at AS firstSeenAt,
      last_seen_at AS lastSeenAt, observation_count AS observationCount,
      a.status AS actionStatus, a.reason AS actionReason,
      a.error_detail AS actionError, a.action_at AS actionAt
    FROM job_dead_letters
    LEFT JOIN job_dead_letter_actions a ON a.dead_letter_id = job_dead_letters.id`;
    const conditions: string[] = [];
    const bindings: (string | number)[] = [];
    if (view.data === "open") {
      conditions.push("(a.status IS NULL OR a.status != 'dismissed')");
    }
    if (cursor) {
      conditions.push("(last_seen_at < ? OR (last_seen_at = ? AND id < ?))");
      bindings.push(cursor[0], cursor[0], cursor[1]);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const rows = await context.env.CONTROL_DB.prepare(
      `${baseQuery}${where}
         ORDER BY last_seen_at DESC, id DESC
         LIMIT ?`,
    )
      .bind(...bindings, PLATFORM_DEAD_LETTER_PAGE_SIZE + 1)
      .all<PlatformDeadLetterRecordRow>();
    const deadLetters = rows.results.slice(0, PLATFORM_DEAD_LETTER_PAGE_SIZE).map((row) => ({
      actionAt: row.actionAt,
      actionError: row.actionError ?? "",
      actionReason: row.actionReason,
      actionStatus: row.actionStatus ?? "open",
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

  router.post("/api/platform/job-dead-letters/:deadLetterId/retry", async (context) => {
    const requestUrl = new URL(context.req.url);
    const authorization = await authorizePlatformAdministration(context, requestUrl);
    if (authorization instanceof Response) return authorization;
    const parsedBody = platformJobDeadLetterActionRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A reason of 3 to 500 characters is required before retrying a queue job.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const deadLetterId = context.req.param("deadLetterId");
    if (!deadLetterId || deadLetterId.length > 512) {
      return context.json(
        {
          code: "validation_failed",
          message: "The queue failure identifier is invalid.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    return retryPlatformJobDeadLetter(context, authorization, deadLetterId, parsedBody.data.reason);
  });

  router.post("/api/platform/job-dead-letters/:deadLetterId/dismiss", async (context) => {
    const requestUrl = new URL(context.req.url);
    const authorization = await authorizePlatformAdministration(context, requestUrl);
    if (authorization instanceof Response) return authorization;
    const parsedBody = platformJobDeadLetterActionRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsedBody.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A reason of 3 to 500 characters is required before dismissing a queue job.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const deadLetterId = context.req.param("deadLetterId");
    if (!deadLetterId || deadLetterId.length > 512) {
      return context.json(
        {
          code: "validation_failed",
          message: "The queue failure identifier is invalid.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    return dismissPlatformJobDeadLetter(
      context,
      authorization,
      deadLetterId,
      parsedBody.data.reason,
    );
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
