import type { WorkerHonoEnvironment } from "../helpers";
import { type ProblemDetails, type PlatformJobDeadLetterActionStatus } from "@choir/contracts";
import { createAuth, isProductBaseHost } from "../../auth/config";
import { authorizePlatformAdministratorSession } from "../../auth/platformAdministrator";
import { validateStartupConfig } from "../../env";
import type { PlatformDeadLetterRow } from "../helpers";
import { type Context } from "hono";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";

export type PlatformAdministrationContext = Context<WorkerHonoEnvironment>;

export interface PlatformAdministratorAuthorization {
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

export interface PlatformDeadLetterRecordRow {
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

export async function authorizePlatformAdministration(
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
export async function retryPlatformJobDeadLetter(
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

  const objectStub = organizationStoreStub(context.env, deadLetter.organizationId);
  let requeueResponse: Response;
  try {
    requeueResponse = await invokeOrganizationRpc(
      objectStub,
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

export async function dismissPlatformJobDeadLetter(
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
