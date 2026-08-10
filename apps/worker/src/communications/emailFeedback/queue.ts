import { z } from "zod";

import type { Env } from "../../env";
import {
  MAX_ATTEMPTS,
  organizationEmailProviderSourceKindSchema,
  type EmailProviderEventRow,
  type EmailProviderRouteRow,
  type NormalizedEmailProviderEvent,
} from "./contracts";
import {
  bounded,
  emailDomain,
  logEmailFeedback,
  normalizedEmail,
  parseCloudflareEmailEvent,
} from "./parser";
import { backfillEmailProviderRoutes } from "./routes";
import {
  ingestEmailProviderEvent,
  readEvent,
  recordGlobalSuppression,
  suppressesFutureEmail,
} from "./ingestion";

async function claimEvent(database: D1Database, eventId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 10 * 60 * 1_000).toISOString();
  const result = await database
    .prepare(
      `UPDATE email_provider_events
       SET state = 'processing', attempts = attempts + 1, updated_at = ?
       WHERE event_id = ? AND (
         (state = 'pending' AND next_attempt_at <= ?) OR
         (state = 'processing' AND updated_at <= ?)
       )`,
    )
    .bind(now, eventId, now, staleBefore)
    .run();
  return result.meta.changes > 0;
}

async function markEventProcessed(database: D1Database, eventId: string): Promise<void> {
  await database
    .prepare(
      `UPDATE email_provider_events SET state = 'processed', last_error = '', updated_at = ?
       WHERE event_id = ?`,
    )
    .bind(new Date().toISOString(), eventId)
    .run();
}

async function markEventPending(
  database: D1Database,
  eventId: string,
  attempts: number,
  error: string,
): Promise<void> {
  const now = new Date().toISOString();
  const boundedError = bounded(error, 500);
  const delayMs = Math.min(60 * 60 * 1_000, 10_000 * 2 ** Math.min(attempts, 8));
  await database
    .prepare(
      `UPDATE email_provider_events
       SET state = CASE WHEN attempts >= ? THEN 'dead_letter' ELSE 'pending' END,
           next_attempt_at = ?, last_error = ?, updated_at = ?
       WHERE event_id = ?`,
    )
    .bind(MAX_ATTEMPTS, new Date(Date.now() + delayMs).toISOString(), boundedError, now, eventId)
    .run();
}

export async function retryEmailProviderEvent(
  database: D1Database,
  eventId: string,
): Promise<"retry_requested" | "retry_unavailable" | "not_found"> {
  const result = await database
    .prepare(
      `UPDATE email_provider_events
       SET state = 'pending', next_attempt_at = ?, last_error = '',
           operator_status = 'open', operator_reason = '', operator_actor_user_id = NULL,
           operator_at = ?, manual_retry_count = manual_retry_count + 1, updated_at = ?
       WHERE event_id = ? AND state <> 'processed' AND manual_retry_count < 3`,
    )
    .bind(new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), eventId)
    .run();
  if (result.meta.changes === 1) return "retry_requested";
  const exists = await database
    .prepare(
      "SELECT event_id AS eventId, state FROM email_provider_events WHERE event_id = ? LIMIT 1",
    )
    .bind(eventId)
    .first<{ readonly eventId: string; readonly state: string }>();
  return exists ? "retry_unavailable" : "not_found";
}

export async function acknowledgeEmailProviderEvent(
  database: D1Database,
  eventId: string,
  actorUserId: string,
  reason: string,
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE email_provider_events
       SET operator_status = 'acknowledged', operator_reason = ?,
           operator_actor_user_id = ?, operator_at = ?, updated_at = ?
       WHERE event_id = ?`,
    )
    .bind(reason, actorUserId, new Date().toISOString(), new Date().toISOString(), eventId)
    .run();
  return result.meta.changes === 1;
}

export async function acknowledgeEmailProviderDeadLetter(
  database: D1Database,
  deadLetterId: string,
  actorUserId: string,
  reason: string,
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE email_feedback_dead_letters
       SET operator_status = 'acknowledged', operator_reason = ?,
           operator_actor_user_id = ?, operator_at = ?
       WHERE id = ?`,
    )
    .bind(reason, actorUserId, new Date().toISOString(), deadLetterId)
    .run();
  return result.meta.changes === 1;
}

async function processEventRow(
  database: D1Database,
  organizationStore: Env["ORGANIZATION_STORE"],
  event: EmailProviderEventRow,
): Promise<boolean> {
  const route = await database
    .prepare(
      `SELECT id, organization_id AS organizationId, source_kind AS sourceKind,
        source_id AS sourceId, destination, provider_message_id AS providerMessageId, state
       FROM email_provider_routes
       WHERE provider = 'cloudflare_email' AND provider_message_id = ? LIMIT 1`,
    )
    .bind(event.messageId)
    .first<EmailProviderRouteRow>();
  if (!route) {
    logEmailFeedback("email_provider_route_unmatched", {
      eventId: event.eventId,
      messageId: event.messageId,
    });
    return false;
  }
  if (normalizedEmail(route.destination) !== normalizedEmail(event.recipient)) {
    throw new Error("The provider event recipient did not match its reserved route.");
  }
  await recordGlobalSuppression(database, event);
  if (
    route.organizationId &&
    organizationEmailProviderSourceKindSchema.safeParse(route.sourceKind).success
  ) {
    if (event.eventType === "rejected") {
      logEmailFeedback("email_provider_rejected_feedback", {
        eventId: event.eventId,
        rejectionParty: event.rejectionParty,
        suppressed: suppressesFutureEmail(event),
      });
    }
    const response = await organizationStore
      .get(organizationStore.idFromName(route.organizationId))
      .fetch("https://organization.internal/internal/email/provider-event", {
        body: JSON.stringify({
          bounceType: event.bounceType,
          eventId: event.eventId,
          eventTimestamp: event.eventTimestamp,
          organizationId: route.organizationId,
          providerMessageId: event.messageId,
          providerStatus: event.eventType,
          providerReason: event.reason,
          providerSmtpEnhancedStatusCode: event.smtpEnhancedStatusCode,
          providerSmtpResponse: event.smtpResponse,
          providerSmtpStatusCode: event.smtpStatusCode,
          recipient: event.recipient,
          rejectionParty: event.rejectionParty,
          shouldSuppress: suppressesFutureEmail(event),
          sourceId: route.sourceId,
          sourceKind: route.sourceKind,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    if (!response.ok) throw new Error("The organization rejected the provider email event.");
    const feedback = z
      .object({
        profileId: z.uuid().nullable(),
        providerSuppressed: z.boolean(),
        recorded: z.literal(true),
      })
      .safeParse(await response.json().catch(() => null));
    if (!feedback.success) throw new Error("The organization provider feedback was invalid.");
    if (feedback.data.providerSuppressed && feedback.data.profileId) {
      const suppressionReason =
        event.eventType === "complained"
          ? "complaint"
          : event.eventType === "rejected"
            ? "provider_rejected"
            : "bounce";
      await database
        .prepare(
          `INSERT INTO email_provider_profile_suppressions
            (organization_id, profile_id, email_normalized, source_event_id, provider_message_id,
             reason, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(organization_id, profile_id) DO UPDATE SET
             email_normalized = excluded.email_normalized,
             source_event_id = excluded.source_event_id,
             provider_message_id = excluded.provider_message_id,
             reason = excluded.reason,
             active = 1,
             updated_at = excluded.updated_at`,
        )
        .bind(
          route.organizationId,
          feedback.data.profileId,
          event.recipient,
          event.eventId,
          event.messageId,
          suppressionReason,
          event.eventTimestamp,
          event.eventTimestamp,
        )
        .run();
    }
  }
  await markEventProcessed(database, event.eventId);
  return true;
}

export async function processEmailProviderEventById(
  env: Pick<Env, "CONTROL_DB" | "ORGANIZATION_STORE">,
  eventId: string,
): Promise<boolean> {
  const event = await readEvent(env.CONTROL_DB, eventId);
  if (event.state === "processed" || event.state === "dead_letter") return true;
  if (!(await claimEvent(env.CONTROL_DB, event.eventId))) return false;
  try {
    const processed = await processEventRow(env.CONTROL_DB, env.ORGANIZATION_STORE, event);
    if (!processed) {
      await markEventPending(
        env.CONTROL_DB,
        event.eventId,
        event.attempts + 1,
        "provider_message_route_pending",
      );
      return false;
    }
    return true;
  } catch (error: unknown) {
    await markEventPending(
      env.CONTROL_DB,
      event.eventId,
      event.attempts + 1,
      error instanceof Error ? error.message : "provider_event_processing_failed",
    );
    throw error;
  }
}

export async function reconcileEmailProviderEvents(
  env: Pick<Env, "CONTROL_DB" | "ORGANIZATION_STORE">,
): Promise<void> {
  await backfillEmailProviderRoutes(env.CONTROL_DB, async (organizationId, offset) =>
    env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId)).fetch(
      `https://organization.internal/internal/email/provider-routes?organizationId=${encodeURIComponent(organizationId)}&offset=${String(offset)}`,
    ),
  );
  const now = new Date().toISOString();
  const events = await env.CONTROL_DB.prepare(
    `SELECT event_id AS eventId FROM email_provider_events
       WHERE state IN ('pending', 'processing') AND next_attempt_at <= ?
       ORDER BY created_at LIMIT 50`,
  )
    .bind(now)
    .all<{ readonly eventId: string }>();
  for (const event of events.results) {
    try {
      await processEmailProviderEventById(env, event.eventId);
    } catch (error: unknown) {
      console.error(
        JSON.stringify({
          errorType: error instanceof Error ? error.name : "UnknownError",
          event: "email_provider_event_reconciliation_failed",
          eventId: event.eventId,
        }),
      );
    }
  }
}

export async function processEmailProviderQueue(
  batch: MessageBatch,
  env: Pick<Env, "CONTROL_DB" | "ORGANIZATION_STORE"> & Partial<Pick<Env, "PLATFORM_EMAIL_FROM">>,
): Promise<void> {
  for (const message of batch.messages) {
    let parsed: NormalizedEmailProviderEvent | null = null;
    try {
      parsed = parseCloudflareEmailEvent(message.body, emailDomain(env.PLATFORM_EMAIL_FROM));
      await ingestEmailProviderEvent(env.CONTROL_DB, parsed);
      await processEmailProviderEventById(env, parsed.eventId);
      message.ack();
    } catch (error: unknown) {
      if (!parsed) {
        logEmailFeedback("email_provider_event_malformed", {
          messageId: message.id,
          queueName: batch.queue,
        });
      }
      console.error(
        JSON.stringify({
          errorType: error instanceof Error ? error.name : "UnknownError",
          event: "email_provider_queue_failed",
          eventId: parsed?.eventId ?? null,
          messageId: message.id,
        }),
      );
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** Math.min(message.attempts, 5)) });
    }
  }
}

export async function processEmailProviderDeadLetterBatch(
  batch: MessageBatch,
  env: Pick<Env, "CONTROL_DB"> & Partial<Pick<Env, "PLATFORM_EMAIL_FROM">>,
): Promise<void> {
  for (const message of batch.messages) {
    let eventId: string | null = null;
    let providerMessageId: string | null = null;
    try {
      const event = parseCloudflareEmailEvent(message.body, emailDomain(env.PLATFORM_EMAIL_FROM));
      eventId = event.eventId;
      providerMessageId = event.messageId;
    } catch {
      // The dead-letter record intentionally omits untrusted payload details.
    }
    const now = new Date().toISOString();
    await env.CONTROL_DB.prepare(
      `INSERT INTO email_feedback_dead_letters
          (id, queue_name, message_id, event_id, provider_message_id, reason,
           observed_attempt, first_seen_at, last_seen_at, observation_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(queue_name, message_id) DO UPDATE SET
           last_seen_at = excluded.last_seen_at,
           observed_attempt = excluded.observed_attempt,
           observation_count = email_feedback_dead_letters.observation_count + 1`,
    )
      .bind(
        crypto.randomUUID(),
        batch.queue,
        message.id,
        eventId,
        providerMessageId,
        "email_provider_event_queue_dead_letter",
        message.attempts,
        now,
        now,
      )
      .run();
    logEmailFeedback("email_provider_dead_letter_recorded", {
      eventId,
      messageId: message.id,
      queueName: batch.queue,
      retryable: eventId !== null,
    });
    message.ack();
  }
}
