import { z } from "zod";

import type { Env } from "../env";

const CLOUDFLARE_EVENT_PREFIX = "cf.email.sending.message.";
const MAX_ATTEMPTS = 20;
const MAX_REASON_LENGTH = 500;
const MAX_SMTP_RESPONSE_LENGTH = 500;

const emailProviderStatusSchema = z.enum([
  "accepted",
  "delivered",
  "deferred",
  "bounced",
  "failed",
  "rejected",
  "complained",
]);

export const emailProviderSourceKindSchema = z.enum([
  "communication_delivery",
  "ticket_notification",
  "audition_notification",
  "payment_notification",
  "platform_auth",
  "test_email",
]);

export type EmailProviderSourceKind = z.infer<typeof emailProviderSourceKindSchema>;
export type EmailProviderStatus = z.infer<typeof emailProviderStatusSchema>;

const organizationEmailProviderSourceKindSchema = z.enum([
  "communication_delivery",
  "ticket_notification",
  "audition_notification",
  "payment_notification",
]);

const cloudflareEventTypeSchema = z.enum([
  "cf.email.sending.message.delivered",
  "cf.email.sending.message.deferred",
  "cf.email.sending.message.bounced",
  "cf.email.sending.message.failed",
  "cf.email.sending.message.rejected",
  "cf.email.sending.message.complained",
]);

const deliverySchema = z
  .looseObject({
    smtpEnhancedStatusCode: z.string().trim().max(32).optional(),
    smtpResponse: z.string().trim().max(MAX_SMTP_RESPONSE_LENGTH).optional(),
    smtpStatusCode: z.string().trim().max(32).optional(),
    status: emailProviderStatusSchema.optional(),
  })
  .optional();

const cloudflareEmailEventSchema = z.looseObject({
  metadata: z.looseObject({
    eventTimestamp: z.string().trim().max(100).optional(),
  }),
  payload: z.looseObject({
    bounce: z
      .looseObject({
        reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
        type: z.enum(["hard", "soft"]).optional(),
      })
      .optional(),
    complaint: z
      .looseObject({ type: z.string().trim().max(MAX_REASON_LENGTH).optional() })
      .optional(),
    delivery: deliverySchema,
    eventId: z.string().trim().min(1).max(128),
    failure: z
      .looseObject({ reason: z.string().trim().max(MAX_REASON_LENGTH).optional() })
      .optional(),
    messageId: z.string().trim().min(1).max(512),
    recipient: z.email(),
    rejection: z
      .looseObject({
        detail: z.string().trim().max(MAX_REASON_LENGTH).optional(),
        party: z.string().trim().max(64).optional(),
        reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
      })
      .optional(),
    sender: z.email(),
    subject: z.string().max(500).optional(),
    terminal: z.boolean(),
  }),
  source: z.looseObject({
    domain: z.string().trim().min(1).max(253),
    type: z.literal("email.sending"),
  }),
  type: cloudflareEventTypeSchema,
});

const providerRouteBackfillRowSchema = z.object({
  destination: z.email(),
  providerMessageId: z.string().trim().min(1).max(512),
  sourceId: z.string().trim().min(1).max(256),
  sourceKind: organizationEmailProviderSourceKindSchema,
});

const providerRouteBackfillResponseSchema = z.object({
  nextOffset: z.number().int().nonnegative().nullable(),
  routes: z.array(providerRouteBackfillRowSchema).max(500),
});

export interface NormalizedEmailProviderEvent {
  readonly bounceType: "hard" | "soft" | null;
  readonly eventId: string;
  readonly eventTimestamp: string;
  readonly eventType: EmailProviderStatus;
  readonly messageId: string;
  readonly reason: string;
  readonly recipient: string;
  readonly smtpEnhancedStatusCode: string | null;
  readonly smtpResponse: string;
  readonly smtpStatusCode: string | null;
  readonly sourceDomain: string;
  readonly terminal: boolean;
}

interface EmailProviderRouteRow {
  readonly destination: string;
  readonly id: string;
  readonly organizationId: string | null;
  readonly providerMessageId: string | null;
  readonly sourceId: string;
  readonly sourceKind: EmailProviderSourceKind;
  readonly state: "pending" | "accepted" | "unknown";
}

interface EmailProviderEventRow {
  readonly attempts: number;
  readonly bounceType: "hard" | "soft" | null;
  readonly eventId: string;
  readonly eventTimestamp: string;
  readonly eventType: EmailProviderStatus;
  readonly lastError: string;
  readonly messageId: string;
  readonly reason: string;
  readonly recipient: string;
  readonly smtpEnhancedStatusCode: string | null;
  readonly smtpResponse: string;
  readonly smtpStatusCode: string | null;
  readonly sourceDomain: string;
  readonly state: "pending" | "processing" | "processed" | "dead_letter";
  readonly terminal: number;
}

export interface EmailProviderRouteInput {
  readonly destination: string;
  readonly organizationId?: string | null;
  readonly sourceId: string;
  readonly sourceKind: EmailProviderSourceKind;
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function bounded(value: string, maximum: number): string {
  return value.trim().slice(0, maximum);
}

function eventTypeFromCloudflareType(value: z.infer<typeof cloudflareEventTypeSchema>) {
  return emailProviderStatusSchema.parse(value.slice(CLOUDFLARE_EVENT_PREFIX.length));
}

function eventReason(payload: z.infer<typeof cloudflareEmailEventSchema>["payload"]): string {
  const rejectionParty = payload.rejection?.party
    ? `rejection_party=${payload.rejection.party}`
    : "";
  const detail =
    payload.bounce?.reason ??
    payload.failure?.reason ??
    payload.rejection?.detail ??
    payload.rejection?.reason ??
    payload.complaint?.type ??
    payload.delivery?.smtpResponse ??
    "";
  return bounded([rejectionParty, detail].filter(Boolean).join(": "), MAX_REASON_LENGTH);
}

export function parseCloudflareEmailEvent(input: unknown): NormalizedEmailProviderEvent {
  const parsed = cloudflareEmailEventSchema.safeParse(input);
  if (!parsed.success) throw new Error("The Cloudflare email event payload was invalid.");
  const event = parsed.data;
  const eventTimestamp =
    event.metadata.eventTimestamp && !Number.isNaN(Date.parse(event.metadata.eventTimestamp))
      ? new Date(event.metadata.eventTimestamp).toISOString()
      : new Date().toISOString();
  return {
    bounceType: event.payload.bounce?.type ?? null,
    eventId: event.payload.eventId,
    eventTimestamp,
    eventType: eventTypeFromCloudflareType(event.type),
    messageId: event.payload.messageId,
    reason: eventReason(event.payload),
    recipient: normalizedEmail(event.payload.recipient),
    smtpEnhancedStatusCode: event.payload.delivery?.smtpEnhancedStatusCode ?? null,
    smtpResponse: bounded(event.payload.delivery?.smtpResponse ?? "", MAX_SMTP_RESPONSE_LENGTH),
    smtpStatusCode: event.payload.delivery?.smtpStatusCode ?? null,
    sourceDomain: event.source.domain,
    terminal: event.payload.terminal,
  };
}

async function readRoute(
  database: D1Database,
  input: EmailProviderRouteInput,
): Promise<EmailProviderRouteRow | null> {
  return database
    .prepare(
      `SELECT id, organization_id AS organizationId, source_kind AS sourceKind,
        source_id AS sourceId, destination, provider_message_id AS providerMessageId, state
       FROM email_provider_routes
       WHERE provider = 'cloudflare_email' AND source_kind = ? AND source_id = ?
       LIMIT 1`,
    )
    .bind(input.sourceKind, input.sourceId)
    .first<EmailProviderRouteRow>();
}

export async function prepareEmailProviderRoute(
  database: D1Database,
  input: EmailProviderRouteInput,
): Promise<{ readonly alreadyAccepted: boolean; readonly providerMessageId: string | null }> {
  const existing = await readRoute(database, input);
  if (existing) {
    if (existing.providerMessageId) {
      return { alreadyAccepted: true, providerMessageId: existing.providerMessageId };
    }
    throw new Error("The email send outcome is still unknown; refusing a duplicate send.");
  }
  const now = new Date().toISOString();
  try {
    await database
      .prepare(
        `INSERT INTO email_provider_routes
          (id, provider, source_kind, source_id, organization_id, destination, state, created_at, updated_at)
         VALUES (?, 'cloudflare_email', ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.sourceKind,
        input.sourceId,
        input.organizationId ?? null,
        normalizedEmail(input.destination),
        now,
        now,
      )
      .run();
  } catch {
    const raced = await readRoute(database, input);
    if (raced?.providerMessageId) {
      return { alreadyAccepted: true, providerMessageId: raced.providerMessageId };
    }
    throw new Error("The email send route could not be reserved.");
  }
  return { alreadyAccepted: false, providerMessageId: null };
}

export async function attachEmailProviderMessage(
  database: D1Database,
  input: EmailProviderRouteInput,
  providerMessageId: string,
): Promise<void> {
  await database
    .prepare(
      `UPDATE email_provider_routes
       SET provider_message_id = ?, state = 'accepted', accepted_at = ?, updated_at = ?
       WHERE provider = 'cloudflare_email' AND source_kind = ? AND source_id = ?
         AND provider_message_id IS NULL`,
    )
    .bind(
      providerMessageId,
      new Date().toISOString(),
      new Date().toISOString(),
      input.sourceKind,
      input.sourceId,
    )
    .run();
}

export async function markEmailProviderRouteUnknown(
  database: D1Database,
  input: EmailProviderRouteInput,
): Promise<void> {
  await database
    .prepare(
      `UPDATE email_provider_routes SET state = 'unknown', updated_at = ?
       WHERE provider = 'cloudflare_email' AND source_kind = ? AND source_id = ?
         AND provider_message_id IS NULL`,
    )
    .bind(new Date().toISOString(), input.sourceKind, input.sourceId)
    .run();
}

export async function isEmailProviderSuppressed(
  database: D1Database,
  destination: string,
): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT active FROM email_recipient_suppressions
       WHERE email_normalized = ? LIMIT 1`,
    )
    .bind(normalizedEmail(destination))
    .first<{ readonly active: number }>();
  return row?.active === 1;
}

export const emailRecipientSuppressedCode = "email_recipient_suppressed" as const;
export const emailRecipientSuppressedMessage =
  "This email address is on the application-wide email suppression list. Contact a Platform Administrator to review the suppression.";

export class EmailRecipientSuppressedError extends Error {
  readonly code = emailRecipientSuppressedCode;
  readonly status = 409 as const;

  constructor() {
    super(emailRecipientSuppressedMessage);
    this.name = "EmailRecipientSuppressedError";
  }
}

export async function assertEmailProviderRecipientAvailable(
  database: D1Database,
  destination: string,
): Promise<void> {
  if (await isEmailProviderSuppressed(database, destination)) {
    throw new EmailRecipientSuppressedError();
  }
}

export async function assertEmailProviderRecipientsAvailable(
  database: D1Database,
  destinations: readonly string[],
): Promise<void> {
  const uniqueDestinations = new Set(destinations.map(normalizedEmail).filter(Boolean));
  for (const destination of uniqueDestinations) {
    await assertEmailProviderRecipientAvailable(database, destination);
  }
}

async function backfillEmailProviderRoutes(
  database: D1Database,
  organizationStore: Env["ORGANIZATION_STORE"],
): Promise<void> {
  const backfill = await database
    .prepare(
      `SELECT completed_at AS completedAt
       FROM email_provider_route_backfill WHERE id = 1 LIMIT 1`,
    )
    .first<{ readonly completedAt: string | null }>();
  if (backfill?.completedAt) return;

  const organizations = await database
    .prepare(
      `SELECT id AS organizationId FROM organizations
       WHERE lifecycle_state <> 'provisioning' ORDER BY id LIMIT 1000`,
    )
    .all<{ readonly organizationId: string }>();
  for (const organization of organizations.results) {
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const response = await organizationStore
        .get(organizationStore.idFromName(organization.organizationId))
        .fetch(
          `https://organization.internal/internal/email/provider-routes?organizationId=${encodeURIComponent(organization.organizationId)}&offset=${String(offset)}`,
        );
      if (!response.ok) throw new Error("The organization provider route backfill was rejected.");
      const parsed = providerRouteBackfillResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!parsed.success) throw new Error("The organization provider route backfill was invalid.");
      const now = new Date().toISOString();
      for (const route of parsed.data.routes) {
        const destination = normalizedEmail(route.destination);
        await database
          .prepare(
            `UPDATE email_provider_routes
             SET provider_message_id = ?, state = 'accepted', accepted_at = COALESCE(accepted_at, ?), updated_at = ?
             WHERE provider = 'cloudflare_email' AND source_kind = ? AND source_id = ?
               AND provider_message_id IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM email_provider_routes AS existing
                 WHERE existing.provider = 'cloudflare_email'
                   AND existing.provider_message_id = ?
               )`,
          )
          .bind(
            route.providerMessageId,
            now,
            now,
            route.sourceKind,
            route.sourceId,
            route.providerMessageId,
          )
          .run();
        await database
          .prepare(
            `INSERT OR IGNORE INTO email_provider_routes
              (id, provider, source_kind, source_id, organization_id, destination,
               provider_message_id, state, created_at, accepted_at, updated_at)
             VALUES (?, 'cloudflare_email', ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            route.sourceKind,
            route.sourceId,
            organization.organizationId,
            destination,
            route.providerMessageId,
            now,
            now,
            now,
          )
          .run();
      }
      hasMore = parsed.data.nextOffset !== null;
      if (parsed.data.nextOffset !== null) offset = parsed.data.nextOffset;
    }
  }
  await database
    .prepare("UPDATE email_provider_route_backfill SET completed_at = ? WHERE id = 1")
    .bind(new Date().toISOString())
    .run();
}

function suppressesFutureEmail(event: EmailProviderEventRow): boolean {
  if (event.eventType === "bounced" || event.eventType === "complained") return true;
  return event.eventType === "rejected" && /suppress|spam|recipient/i.test(event.reason);
}

async function recordGlobalSuppression(
  database: D1Database,
  event: EmailProviderEventRow,
): Promise<void> {
  if (!suppressesFutureEmail(event)) return;
  const reason =
    event.eventType === "complained"
      ? "complaint"
      : event.eventType === "rejected"
        ? "provider_rejected"
        : "bounce";
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO email_recipient_suppressions
        (email_normalized, reason, source_event_id, provider_message_id, detail, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(email_normalized) DO UPDATE SET
         reason = excluded.reason,
         source_event_id = excluded.source_event_id,
         provider_message_id = excluded.provider_message_id,
         detail = excluded.detail,
         active = 1,
         updated_at = excluded.updated_at`,
    )
    .bind(event.recipient, reason, event.eventId, event.messageId, event.reason, now, now)
    .run();
}

async function readEvent(database: D1Database, eventId: string): Promise<EmailProviderEventRow> {
  const row = await database
    .prepare(
      `SELECT event_id AS eventId, provider_message_id AS messageId, event_type AS eventType,
        recipient, source_domain AS sourceDomain, terminal, smtp_status_code AS smtpStatusCode,
        smtp_enhanced_status_code AS smtpEnhancedStatusCode, smtp_response AS smtpResponse,
        reason, event_timestamp AS eventTimestamp, state, attempts, last_error AS lastError
       FROM email_provider_events WHERE event_id = ? LIMIT 1`,
    )
    .bind(eventId)
    .first<EmailProviderEventRow>();
  if (!row) throw new Error("The email provider event was not persisted.");
  return row;
}

export async function ingestEmailProviderEvent(
  database: D1Database,
  event: NormalizedEmailProviderEvent,
): Promise<void> {
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT OR IGNORE INTO email_provider_events
        (event_id, provider, provider_message_id, event_type, recipient, source_domain, terminal,
         smtp_status_code, smtp_enhanced_status_code, smtp_response, reason, event_timestamp,
         state, attempts, next_attempt_at, last_error, created_at, updated_at)
       VALUES (?, 'cloudflare_email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, '', ?, ?)`,
    )
    .bind(
      event.eventId,
      event.messageId,
      event.eventType,
      event.recipient,
      event.sourceDomain,
      event.terminal ? 1 : 0,
      event.smtpStatusCode,
      event.smtpEnhancedStatusCode,
      event.smtpResponse,
      event.reason,
      event.eventTimestamp,
      now,
      now,
      now,
    )
    .run();
}

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
  if (!route) return false;
  if (normalizedEmail(route.destination) !== normalizedEmail(event.recipient)) {
    throw new Error("The provider event recipient did not match its reserved route.");
  }
  await recordGlobalSuppression(database, event);
  if (
    route.organizationId &&
    organizationEmailProviderSourceKindSchema.safeParse(route.sourceKind).success
  ) {
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
          shouldSuppress: suppressesFutureEmail(event),
          sourceId: route.sourceId,
          sourceKind: route.sourceKind,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    if (!response.ok) throw new Error("The organization rejected the provider email event.");
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
  await backfillEmailProviderRoutes(env.CONTROL_DB, env.ORGANIZATION_STORE);
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
  env: Pick<Env, "CONTROL_DB" | "ORGANIZATION_STORE">,
): Promise<void> {
  for (const message of batch.messages) {
    let parsed: NormalizedEmailProviderEvent | null = null;
    try {
      parsed = parseCloudflareEmailEvent(message.body);
      await ingestEmailProviderEvent(env.CONTROL_DB, parsed);
      await processEmailProviderEventById(env, parsed.eventId);
      message.ack();
    } catch (error: unknown) {
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
  env: Pick<Env, "CONTROL_DB">,
): Promise<void> {
  for (const message of batch.messages) {
    let eventId: string | null = null;
    let providerMessageId: string | null = null;
    try {
      const event = parseCloudflareEmailEvent(message.body);
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
    message.ack();
  }
}
