import type { Hono } from "hono";
import type { WorkerHonoEnvironment } from "../helpers";
import {
  platformJobDeadLetterActionRequestSchema,
  platformJobDeadLetterViewSchema,
  type ProblemDetails,
} from "@choir/contracts";
import {
  PLATFORM_DEAD_LETTER_PAGE_SIZE,
  encodePlatformDeadLetterCursor,
  parsePlatformDeadLetterCursor,
} from "../helpers";
import {
  authorizePlatformAdministration,
  dismissPlatformJobDeadLetter,
  retryPlatformJobDeadLetter,
  type PlatformDeadLetterRecordRow,
} from "./shared";

export function registerPlatformDeadLetterRoutes(router: Hono<WorkerHonoEnvironment>): void {
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
}
