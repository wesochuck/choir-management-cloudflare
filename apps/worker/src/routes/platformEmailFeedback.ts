import {
  platformEmailFeedbackActionRequestSchema,
  platformEmailFeedbackViewSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import {
  acknowledgeEmailProviderDeadLetter,
  acknowledgeEmailProviderEvent,
  processEmailProviderEventById,
  retryEmailProviderEvent,
} from "../communications/emailFeedback";
import { createAuth, isProductBaseHost } from "../auth/config";
import { authorizePlatformAdministratorSession } from "../auth/platformAdministrator";
import { validateStartupConfig } from "../env";

import type { Context, Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

type WorkerContext = Context<WorkerHonoEnvironment>;

const PAGE_SIZE = 25;
const cursorSchema = z.tuple([z.iso.datetime(), z.string().min(1).max(512)]);
const sourceKindSchema = z.enum([
  "communication_delivery",
  "ticket_notification",
  "audition_notification",
  "payment_notification",
  "platform_auth",
  "test_email",
]);

interface PlatformAdministrator {
  readonly userId: string;
}

interface ProviderEventRow {
  readonly attempts: number;
  readonly bounceType: "hard" | "soft" | null;
  readonly createdAt: string;
  readonly eventId: string;
  readonly eventTimestamp: string;
  readonly eventType: "delivered" | "deferred" | "bounced" | "failed" | "rejected" | "complained";
  readonly lastError: string;
  readonly messageId: string;
  readonly operatorAt: string | null;
  readonly operatorReason: string;
  readonly operatorStatus: "open" | "acknowledged";
  readonly organizationId: string | null;
  readonly recipient: string;
  readonly rejectionParty: "sender" | "recipient" | "other" | null;
  readonly routeState: "pending" | "accepted" | "unknown" | null;
  readonly sourceDomain: string;
  readonly sourceId: string | null;
  readonly sourceKind: string | null;
  readonly state: "pending" | "processing" | "processed" | "dead_letter";
  readonly terminal: number;
  readonly updatedAt: string;
}

interface ProviderDeadLetterRow {
  readonly actionAt: string | null;
  readonly actionReason: string;
  readonly actionStatus: "open" | "acknowledged";
  readonly eventId: string | null;
  readonly firstSeenAt: string;
  readonly id: string;
  readonly lastSeenAt: string;
  readonly messageId: string;
  readonly observationCount: number;
  readonly observedAttempt: number;
  readonly providerMessageId: string | null;
  readonly queueName: string;
  readonly reason: string;
}

function parseCursor(value: string | null): readonly [string, string] | null | undefined {
  if (value === null) return null;
  if (value.length > 1_024) return undefined;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(decodeURIComponent(value)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function encodeCursor(updatedAt: string, id: string): string {
  return encodeURIComponent(JSON.stringify([updatedAt, id]));
}

function invalidResponse(context: WorkerContext, message: string): Response {
  return context.json(
    {
      code: "validation_failed",
      message,
      requestId: context.get("requestId"),
    } satisfies ProblemDetails,
    400,
  );
}

async function authorizePlatformAdministration(
  context: WorkerContext,
  requestUrl: URL,
): Promise<Response | PlatformAdministrator> {
  const config = validateStartupConfig(context.env);
  if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    return context.json(
      {
        code: "not_found",
        message:
          "Email provider feedback administration is available only on the product base hostname.",
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

async function recordOperatorAction(
  database: D1Database,
  input: {
    readonly action: string;
    readonly actorUserId: string;
    readonly organizationId?: string | null;
    readonly outcome: string;
    readonly reason: string;
    readonly requestId: string;
    readonly targetId: string;
    readonly targetType: string;
  },
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO platform_audit_events
        (id, actor_user_id, organization_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `${input.action}:${input.targetId}:${input.requestId}`,
      input.actorUserId,
      input.organizationId ?? null,
      input.action,
      input.targetType,
      input.targetId,
      input.requestId,
      JSON.stringify({ outcome: input.outcome, reason: input.reason }),
      new Date().toISOString(),
    )
    .run();
  console.info(
    JSON.stringify({
      action: input.action,
      actorUserId: input.actorUserId,
      event: "email_provider_operator_action",
      organizationId: input.organizationId ?? null,
      outcome: input.outcome,
      targetId: input.targetId,
      targetType: input.targetType,
    }),
  );
}

function providerEventResponse(row: ProviderEventRow) {
  const sourceKind = sourceKindSchema.safeParse(row.sourceKind);
  return {
    attempts: row.attempts,
    bounceType: row.bounceType,
    createdAt: row.createdAt,
    eventId: row.eventId,
    eventTimestamp: row.eventTimestamp,
    eventType: row.eventType,
    lastError: row.lastError.slice(0, 500),
    messageId: row.messageId,
    operatorAt: row.operatorAt,
    operatorReason: row.operatorReason.slice(0, 500),
    operatorStatus: row.operatorStatus,
    organizationId: row.organizationId,
    recipient: row.recipient,
    rejectionParty: row.rejectionParty,
    routeState: row.routeState,
    sourceDomain: row.sourceDomain,
    sourceId: row.sourceId,
    sourceKind: sourceKind.success ? sourceKind.data : null,
    state: row.state,
    terminal: row.terminal === 1,
    updatedAt: row.updatedAt,
  };
}

function providerDeadLetterResponse(row: ProviderDeadLetterRow) {
  return {
    actionAt: row.actionAt,
    actionReason: row.actionReason.slice(0, 500),
    actionStatus: row.actionStatus,
    eventId: row.eventId,
    firstSeenAt: row.firstSeenAt,
    id: row.id,
    lastSeenAt: row.lastSeenAt,
    messageId: row.messageId,
    observationCount: row.observationCount,
    observedAttempt: row.observedAttempt,
    providerMessageId: row.providerMessageId,
    queueName: row.queueName,
    reason: row.reason.slice(0, 500),
    retryable: row.eventId !== null,
  };
}

async function readProviderEvent(
  database: D1Database,
  eventId: string,
): Promise<ProviderEventRow | null> {
  return database
    .prepare(
      `SELECT e.event_id AS eventId, e.provider_message_id AS messageId,
        e.event_type AS eventType, e.recipient, e.source_domain AS sourceDomain,
        e.terminal, e.bounce_type AS bounceType, e.rejection_party AS rejectionParty,
        e.event_timestamp AS eventTimestamp, e.state, e.attempts,
        e.last_error AS lastError, e.operator_status AS operatorStatus,
        e.operator_reason AS operatorReason, e.operator_at AS operatorAt,
        e.created_at AS createdAt, e.updated_at AS updatedAt,
        r.organization_id AS organizationId, r.source_kind AS sourceKind,
        r.source_id AS sourceId, r.state AS routeState
       FROM email_provider_events e
       LEFT JOIN email_provider_routes r
         ON r.provider = 'cloudflare_email' AND r.provider_message_id = e.provider_message_id
       WHERE e.event_id = ? LIMIT 1`,
    )
    .bind(eventId)
    .first<ProviderEventRow>();
}

async function readProviderDeadLetter(
  database: D1Database,
  deadLetterId: string,
): Promise<ProviderDeadLetterRow | null> {
  return database
    .prepare(
      `SELECT d.id, d.queue_name AS queueName, d.message_id AS messageId,
        d.event_id AS eventId, d.provider_message_id AS providerMessageId,
        d.reason, d.observed_attempt AS observedAttempt,
        d.first_seen_at AS firstSeenAt, d.last_seen_at AS lastSeenAt,
        d.observation_count AS observationCount,
        d.operator_status AS actionStatus, d.operator_reason AS actionReason,
        d.operator_at AS actionAt
       FROM email_feedback_dead_letters d
       WHERE d.id = ? LIMIT 1`,
    )
    .bind(deadLetterId)
    .first<ProviderDeadLetterRow>();
}

async function runEventRetry(
  context: WorkerContext,
  authorization: PlatformAdministrator,
  eventId: string,
  reason: string,
  auditTarget?: {
    readonly organizationId?: string | null;
    readonly targetId: string;
    readonly targetType: string;
  },
): Promise<Response> {
  const event = await readProviderEvent(context.env.CONTROL_DB, eventId);
  const outcome = await retryEmailProviderEvent(context.env.CONTROL_DB, eventId);
  const organizationId = auditTarget?.organizationId ?? event?.organizationId ?? null;
  const targetId = auditTarget?.targetId ?? eventId;
  const targetType = auditTarget?.targetType ?? "email_provider_event";
  if (outcome === "not_found") {
    await recordOperatorAction(context.env.CONTROL_DB, {
      action: "platform.email_provider_event.retry_not_found",
      actorUserId: authorization.userId,
      organizationId,
      outcome,
      reason,
      requestId: context.get("requestId"),
      targetId,
      targetType,
    });
    return context.json(
      {
        code: "email_provider_event_not_found",
        message: "That email provider event no longer exists.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  if (outcome === "retry_unavailable") {
    await recordOperatorAction(context.env.CONTROL_DB, {
      action: "platform.email_provider_event.retry_unavailable",
      actorUserId: authorization.userId,
      organizationId,
      outcome,
      reason,
      requestId: context.get("requestId"),
      targetId,
      targetType,
    });
    return context.json(
      {
        code: "email_provider_event_retry_unavailable",
        message: "This event is already processed or has reached its manual retry limit.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
  await recordOperatorAction(context.env.CONTROL_DB, {
    action: "platform.email_provider_event.retry_requested",
    actorUserId: authorization.userId,
    organizationId,
    outcome,
    reason,
    requestId: context.get("requestId"),
    targetId,
    targetType,
  });
  context.executionCtx.waitUntil(
    processEmailProviderEventById(
      { CONTROL_DB: context.env.CONTROL_DB, ORGANIZATION_STORE: context.env.ORGANIZATION_STORE },
      eventId,
    ).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          errorType: error instanceof Error ? error.name : "UnknownError",
          event: "email_provider_event_operator_retry_failed",
          eventId,
        }),
      );
    }),
  );
  return context.json({
    actionStatus: "retry_requested" as const,
    eventId,
    requestId: context.get("requestId"),
  });
}

async function runEventAcknowledge(
  context: WorkerContext,
  authorization: PlatformAdministrator,
  eventId: string,
  reason: string,
): Promise<Response> {
  const acknowledged = await acknowledgeEmailProviderEvent(
    context.env.CONTROL_DB,
    eventId,
    authorization.userId,
    reason,
  );
  if (!acknowledged) {
    return context.json(
      {
        code: "email_provider_event_not_found",
        message: "That email provider event no longer exists.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const event = await readProviderEvent(context.env.CONTROL_DB, eventId);
  await recordOperatorAction(context.env.CONTROL_DB, {
    action: "platform.email_provider_event.acknowledged",
    actorUserId: authorization.userId,
    organizationId: event?.organizationId ?? null,
    outcome: "acknowledged",
    reason,
    requestId: context.get("requestId"),
    targetId: eventId,
    targetType: "email_provider_event",
  });
  return context.json({
    actionStatus: "acknowledged" as const,
    eventId,
    requestId: context.get("requestId"),
  });
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/platform/email-feedback/events", async (context) => {
    const authorization = await authorizePlatformAdministration(context, new URL(context.req.url));
    if (authorization instanceof Response) return authorization;
    const url = new URL(context.req.url);
    const cursor = parseCursor(url.searchParams.get("cursor"));
    const view = platformEmailFeedbackViewSchema.safeParse(url.searchParams.get("view") ?? "open");
    if (cursor === undefined || !view.success)
      return invalidResponse(context, "The provider event filter is invalid.");
    const conditions =
      view.data === "open" ? ["e.state <> 'processed'", "e.operator_status = 'open'"] : [];
    const bindings: (string | number)[] = [];
    if (cursor) {
      conditions.push("(e.updated_at < ? OR (e.updated_at = ? AND e.event_id < ?))");
      bindings.push(cursor[0], cursor[0], cursor[1]);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await context.env.CONTROL_DB.prepare(
      `SELECT e.event_id AS eventId, e.provider_message_id AS messageId,
        e.event_type AS eventType, e.recipient, e.source_domain AS sourceDomain,
        e.terminal, e.bounce_type AS bounceType, e.rejection_party AS rejectionParty,
        e.event_timestamp AS eventTimestamp, e.state, e.attempts,
        e.last_error AS lastError, e.operator_status AS operatorStatus,
        e.operator_reason AS operatorReason, e.operator_at AS operatorAt,
        e.created_at AS createdAt, e.updated_at AS updatedAt,
        r.organization_id AS organizationId, r.source_kind AS sourceKind,
        r.source_id AS sourceId, r.state AS routeState
       FROM email_provider_events e
       LEFT JOIN email_provider_routes r
         ON r.provider = 'cloudflare_email' AND r.provider_message_id = e.provider_message_id
       ${where}
       ORDER BY e.updated_at DESC, e.event_id DESC LIMIT ?`,
    )
      .bind(...bindings, PAGE_SIZE + 1)
      .all<ProviderEventRow>();
    const events = rows.results.slice(0, PAGE_SIZE).map(providerEventResponse);
    const cursorRow = rows.results.length > PAGE_SIZE ? rows.results[PAGE_SIZE - 1] : undefined;
    return context.json({
      events,
      nextCursor: cursorRow ? encodeCursor(cursorRow.updatedAt, cursorRow.eventId) : null,
      requestId: context.get("requestId"),
    });
  });

  router.get("/api/platform/email-feedback/events/:eventId", async (context) => {
    const authorization = await authorizePlatformAdministration(context, new URL(context.req.url));
    if (authorization instanceof Response) return authorization;
    const eventId = context.req.param("eventId");
    const event = await readProviderEvent(context.env.CONTROL_DB, eventId);
    if (!event) {
      return context.json(
        {
          code: "email_provider_event_not_found",
          message: "That email provider event no longer exists.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({
      event: providerEventResponse(event),
      requestId: context.get("requestId"),
    });
  });

  router.post("/api/platform/email-feedback/events/:eventId/retry", async (context) => {
    const authorization = await authorizePlatformAdministration(context, new URL(context.req.url));
    if (authorization instanceof Response) return authorization;
    const parsed = platformEmailFeedbackActionRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsed.success)
      return invalidResponse(context, "A retry reason of 3 to 500 characters is required.");
    return runEventRetry(context, authorization, context.req.param("eventId"), parsed.data.reason);
  });

  router.post("/api/platform/email-feedback/events/:eventId/acknowledge", async (context) => {
    const authorization = await authorizePlatformAdministration(context, new URL(context.req.url));
    if (authorization instanceof Response) return authorization;
    const parsed = platformEmailFeedbackActionRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsed.success)
      return invalidResponse(
        context,
        "An acknowledgement reason of 3 to 500 characters is required.",
      );
    return runEventAcknowledge(
      context,
      authorization,
      context.req.param("eventId"),
      parsed.data.reason,
    );
  });

  router.get("/api/platform/email-feedback/dead-letters", async (context) => {
    const authorization = await authorizePlatformAdministration(context, new URL(context.req.url));
    if (authorization instanceof Response) return authorization;
    const url = new URL(context.req.url);
    const cursor = parseCursor(url.searchParams.get("cursor"));
    const view = platformEmailFeedbackViewSchema.safeParse(url.searchParams.get("view") ?? "open");
    if (cursor === undefined || !view.success)
      return invalidResponse(context, "The email dead-letter filter is invalid.");
    const conditions = view.data === "open" ? ["d.operator_status = 'open'"] : [];
    const bindings: (string | number)[] = [];
    if (cursor) {
      conditions.push("(d.last_seen_at < ? OR (d.last_seen_at = ? AND d.id < ?))");
      bindings.push(cursor[0], cursor[0], cursor[1]);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await context.env.CONTROL_DB.prepare(
      `SELECT d.id, d.queue_name AS queueName, d.message_id AS messageId,
        d.event_id AS eventId, d.provider_message_id AS providerMessageId,
        d.reason, d.observed_attempt AS observedAttempt,
        d.first_seen_at AS firstSeenAt, d.last_seen_at AS lastSeenAt,
        d.observation_count AS observationCount,
        d.operator_status AS actionStatus, d.operator_reason AS actionReason,
        d.operator_at AS actionAt
       FROM email_feedback_dead_letters d ${where}
       ORDER BY d.last_seen_at DESC, d.id DESC LIMIT ?`,
    )
      .bind(...bindings, PAGE_SIZE + 1)
      .all<ProviderDeadLetterRow>();
    const deadLetters = rows.results.slice(0, PAGE_SIZE).map(providerDeadLetterResponse);
    const cursorRow = rows.results.length > PAGE_SIZE ? rows.results[PAGE_SIZE - 1] : undefined;
    return context.json({
      deadLetters,
      nextCursor: cursorRow ? encodeCursor(cursorRow.lastSeenAt, cursorRow.id) : null,
      requestId: context.get("requestId"),
    });
  });

  router.get("/api/platform/email-feedback/dead-letters/:deadLetterId", async (context) => {
    const authorization = await authorizePlatformAdministration(context, new URL(context.req.url));
    if (authorization instanceof Response) return authorization;
    const deadLetter = await readProviderDeadLetter(
      context.env.CONTROL_DB,
      context.req.param("deadLetterId"),
    );
    if (!deadLetter) {
      return context.json(
        {
          code: "email_provider_dead_letter_not_found",
          message: "That email provider dead letter no longer exists.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({
      deadLetter: providerDeadLetterResponse(deadLetter),
      requestId: context.get("requestId"),
    });
  });

  router.post("/api/platform/email-feedback/dead-letters/:deadLetterId/retry", async (context) => {
    const authorization = await authorizePlatformAdministration(context, new URL(context.req.url));
    if (authorization instanceof Response) return authorization;
    const parsed = platformEmailFeedbackActionRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!parsed.success)
      return invalidResponse(context, "A retry reason of 3 to 500 characters is required.");
    const deadLetter = await readProviderDeadLetter(
      context.env.CONTROL_DB,
      context.req.param("deadLetterId"),
    );
    if (!deadLetter) {
      return context.json(
        {
          code: "email_provider_dead_letter_not_found",
          message: "That email provider dead letter no longer exists.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    if (!deadLetter.eventId) {
      await recordOperatorAction(context.env.CONTROL_DB, {
        action: "platform.email_provider_dead_letter.retry_unavailable",
        actorUserId: authorization.userId,
        outcome: "retry_unavailable",
        reason: parsed.data.reason,
        requestId: context.get("requestId"),
        targetId: deadLetter.id,
        targetType: "email_provider_dead_letter",
      });
      return context.json({
        actionStatus: "retry_unavailable" as const,
        eventId: null,
        requestId: context.get("requestId"),
      });
    }
    return runEventRetry(context, authorization, deadLetter.eventId, parsed.data.reason, {
      targetId: deadLetter.id,
      targetType: "email_provider_dead_letter",
    });
  });

  router.post(
    "/api/platform/email-feedback/dead-letters/:deadLetterId/acknowledge",
    async (context) => {
      const authorization = await authorizePlatformAdministration(
        context,
        new URL(context.req.url),
      );
      if (authorization instanceof Response) return authorization;
      const parsed = platformEmailFeedbackActionRequestSchema.safeParse(
        await context.req.json<unknown>().catch(() => null),
      );
      if (!parsed.success)
        return invalidResponse(
          context,
          "An acknowledgement reason of 3 to 500 characters is required.",
        );
      const deadLetterId = context.req.param("deadLetterId");
      const acknowledged = await acknowledgeEmailProviderDeadLetter(
        context.env.CONTROL_DB,
        deadLetterId,
        authorization.userId,
        parsed.data.reason,
      );
      if (!acknowledged) {
        return context.json(
          {
            code: "email_provider_dead_letter_not_found",
            message: "That email provider dead letter no longer exists.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }
      await recordOperatorAction(context.env.CONTROL_DB, {
        action: "platform.email_provider_dead_letter.acknowledged",
        actorUserId: authorization.userId,
        outcome: "acknowledged",
        reason: parsed.data.reason,
        requestId: context.get("requestId"),
        targetId: deadLetterId,
        targetType: "email_provider_dead_letter",
      });
      const deadLetter = await readProviderDeadLetter(context.env.CONTROL_DB, deadLetterId);
      return context.json({
        actionStatus: "acknowledged" as const,
        eventId: deadLetter?.eventId ?? null,
        requestId: context.get("requestId"),
      });
    },
  );
}
