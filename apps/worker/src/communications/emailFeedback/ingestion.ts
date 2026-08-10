import type { EmailProviderEventRow, NormalizedEmailProviderEvent } from "./contracts";
import { logEmailFeedback } from "./parser";

export function suppressesFutureEmail(event: EmailProviderEventRow): boolean {
  if (event.eventType === "bounced" || event.eventType === "complained") return true;
  return (
    event.eventType === "rejected" &&
    event.rejectionParty === "recipient" &&
    /blocked|disabled|invalid|mailbox|recipient|spam|suppress|unknown/i.test(event.reason)
  );
}

export async function recordGlobalSuppression(
  database: D1Database,
  event: EmailProviderEventRow,
): Promise<void> {
  const shouldSuppress = suppressesFutureEmail(event);
  logEmailFeedback("email_provider_suppression_decision", {
    eventId: event.eventId,
    providerStatus: event.eventType,
    scope: "global",
    suppressed: shouldSuppress,
  });
  if (!shouldSuppress) return;
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

export async function readEvent(
  database: D1Database,
  eventId: string,
): Promise<EmailProviderEventRow> {
  const row = await database
    .prepare(
      `SELECT event_id AS eventId, provider_message_id AS messageId, event_type AS eventType,
        recipient, source_domain AS sourceDomain, terminal, bounce_type AS bounceType,
        rejection_party AS rejectionParty, smtp_status_code AS smtpStatusCode,
        smtp_enhanced_status_code AS smtpEnhancedStatusCode, smtp_response AS smtpResponse,
        reason, event_timestamp AS eventTimestamp, state, attempts, last_error AS lastError,
        operator_status AS operatorStatus, operator_reason AS operatorReason,
        operator_actor_user_id AS operatorActorUserId, operator_at AS operatorAt,
        manual_retry_count AS manualRetryCount, created_at AS createdAt, updated_at AS updatedAt
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
         bounce_type, rejection_party, smtp_status_code, smtp_enhanced_status_code, smtp_response,
         reason, event_timestamp, state, attempts, next_attempt_at, last_error, created_at, updated_at)
       VALUES (?, 'cloudflare_email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, '', ?, ?)`,
    )
    .bind(
      event.eventId,
      event.messageId,
      event.eventType,
      event.recipient,
      event.sourceDomain,
      event.terminal ? 1 : 0,
      event.bounceType,
      event.rejectionParty,
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
