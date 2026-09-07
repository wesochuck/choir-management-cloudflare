import { communicationRecipientSubjectSchema } from "@choir/contracts";
import { z } from "zod";

const providerStatusSchema = z.enum([
  "accepted",
  "delivered",
  "deferred",
  "bounced",
  "failed",
  "rejected",
  "complained",
]);
const sourceKindSchema = z.enum([
  "communication_delivery",
  "ticket_notification",
  "audition_notification",
  "payment_notification",
]);

const providerFeedbackSchema = z.object({
  bounceType: z.enum(["hard", "soft"]).nullable(),
  eventId: z.string().trim().min(1).max(128),
  eventTimestamp: z.iso.datetime(),
  organizationId: z.string().trim().min(1).max(128),
  providerMessageId: z.string().trim().min(1).max(512),
  providerReason: z.string().max(500),
  providerSmtpEnhancedStatusCode: z.string().max(32).nullable(),
  providerSmtpResponse: z.string().max(500),
  providerSmtpStatusCode: z.string().max(32).nullable(),
  providerStatus: providerStatusSchema,
  recipient: z.email(),
  rejectionParty: z.enum(["sender", "recipient", "other"]).nullable().default(null),
  shouldSuppress: z.boolean(),
  sourceId: z.string().trim().min(1).max(256),
  sourceKind: sourceKindSchema,
});

type ProviderStatus = z.infer<typeof providerStatusSchema>;

const providerRouteSourceKindSchema = z.enum([
  "communication_delivery",
  "ticket_notification",
  "audition_notification",
  "payment_notification",
]);

const providerRouteRowSchema = z.object({
  destination: z.string().min(1).max(320),
  providerMessageId: z.string().trim().min(1).max(512),
  sourceId: z.string().trim().min(1).max(256),
  sourceKind: providerRouteSourceKindSchema,
});

interface SourceRecord {
  readonly [column: string]: SqlStorageValue;
  readonly contactId: string | null;
  readonly profileId: string | null;
  readonly providerStatus: ProviderStatus | null;
}

export function listEmailProviderRoutesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  offset = 0,
): Response {
  if (!organizationId || readOrganizationId(storage) !== organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const rows = storage.sql
    .exec<z.infer<typeof providerRouteRowSchema>>(
      `SELECT 'communication_delivery' AS sourceKind, id AS sourceId,
          destination, provider_message_id AS providerMessageId
       FROM communication_deliveries
       WHERE channel = 'email' AND provider_message_id IS NOT NULL
       UNION ALL
       SELECT 'ticket_notification' AS sourceKind, id AS sourceId,
          destination, provider_message_id AS providerMessageId
       FROM ticket_notifications
       WHERE provider_message_id IS NOT NULL
       UNION ALL
       SELECT 'audition_notification' AS sourceKind, id AS sourceId,
          destination, provider_message_id AS providerMessageId
       FROM audition_notifications
       WHERE provider_message_id IS NOT NULL
       UNION ALL
       SELECT 'payment_notification' AS sourceKind, id AS sourceId,
          destination, provider_message_id AS providerMessageId
       FROM payment_notifications
       WHERE provider_message_id IS NOT NULL
       ORDER BY sourceKind, sourceId
       LIMIT 500 OFFSET ?`,
      offset,
    )
    .toArray()
    .flatMap((row) => {
      const parsed = providerRouteRowSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
  return Response.json({
    nextOffset: rows.length === 500 ? offset + rows.length : null,
    organizationId,
    routes: rows,
  });
}

function readOrganizationId(storage: DurableObjectStorage): string | null {
  return (
    storage.sql
      .exec<{ readonly organizationId: string }>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId ?? null
  );
}

function providerStatusRank(status: ProviderStatus): number {
  switch (status) {
    case "complained":
      return 6;
    case "bounced":
      return 5;
    case "failed":
    case "rejected":
      return 4;
    case "delivered":
      return 3;
    case "deferred":
      return 2;
    case "accepted":
      return 1;
  }
}

function shouldReplaceProviderStatus(
  current: ProviderStatus | null,
  incoming: ProviderStatus,
): boolean {
  if (!current) return true;
  if (current === "bounced" || current === "complained") {
    return incoming === "bounced" || incoming === "complained";
  }
  return providerStatusRank(incoming) >= providerStatusRank(current);
}

function sourceRecordQuery(sourceKind: z.infer<typeof sourceKindSchema>): string {
  switch (sourceKind) {
    case "communication_delivery":
      return `SELECT profile_id AS profileId, provider_status AS providerStatus,
          recipient_subject_json AS recipientSubjectJson
        FROM communication_deliveries
        WHERE id = ? AND lower(destination) = lower(?)
          AND (provider_message_id = ? OR provider_message_id IS NULL) LIMIT 1`;
    case "ticket_notification":
      return `SELECT NULL AS profileId, provider_status AS providerStatus
        FROM ticket_notifications
        WHERE id = ? AND lower(destination) = lower(?)
          AND (provider_message_id = ? OR provider_message_id IS NULL) LIMIT 1`;
    case "audition_notification":
      return `SELECT NULL AS profileId, provider_status AS providerStatus
        FROM audition_notifications
        WHERE id = ? AND lower(destination) = lower(?)
          AND (provider_message_id = ? OR provider_message_id IS NULL) LIMIT 1`;
    case "payment_notification":
      return `SELECT NULL AS profileId, provider_status AS providerStatus
        FROM payment_notifications
        WHERE id = ? AND lower(destination) = lower(?)
          AND (provider_message_id = ? OR provider_message_id IS NULL) LIMIT 1`;
  }
}

interface RawSourceRecord {
  readonly [column: string]: SqlStorageValue;
  readonly profileId: string | null;
  readonly providerStatus: ProviderStatus | null;
  readonly recipientSubjectJson?: string | null;
}

function resolveRecipientIdentity(
  storage: DurableObjectStorage,
  raw: RawSourceRecord,
): { readonly contactId: string | null; readonly profileId: string | null } {
  const carrier = raw.profileId;
  const subjectJson = raw.recipientSubjectJson;
  if (typeof subjectJson === "string" && subjectJson !== "") {
    try {
      const parsed = communicationRecipientSubjectSchema.safeParse(JSON.parse(subjectJson));
      if (parsed.success) {
        if (parsed.data.kind === "contact")
          return { contactId: parsed.data.contactId, profileId: null };
        if (parsed.data.kind === "profile")
          return { contactId: null, profileId: parsed.data.profileId };
        // Commerce kinds (ticket_purchase/donation) resolve through Contacts
        // in Phase 8/9; never treat their transaction IDs as profile IDs.
        return { contactId: null, profileId: null };
      }
    } catch {
      // Fall through to the legacy carrier lookup below.
    }
  }
  if (carrier === null) return { contactId: null, profileId: null };
  // Legacy pre-subject rows carry only the profile ID. Contact deliveries
  // minted since Phase 6 always store a subject; a NULL subject whose carrier
  // matches a contact row is treated as that contact (never as a profile).
  const contact = storage.sql
    .exec<{ readonly id: string }>("SELECT id FROM contacts WHERE id = ? LIMIT 1", carrier)
    .toArray()
    .at(0);
  if (contact) return { contactId: contact.id, profileId: null };
  return { contactId: null, profileId: carrier };
}

function updateSourceRecord(
  storage: DurableObjectStorage,
  input: z.infer<typeof providerFeedbackSchema>,
  status: ProviderStatus,
): SourceRecord | null {
  const raw = storage.sql
    .exec<RawSourceRecord>(
      sourceRecordQuery(input.sourceKind),
      input.sourceId,
      input.recipient,
      input.providerMessageId,
    )
    .toArray()
    .at(0);
  if (!raw) return null;
  const identity = resolveRecipientIdentity(storage, raw);
  const record: SourceRecord = {
    contactId: identity.contactId,
    profileId: identity.profileId,
    providerStatus: raw.providerStatus,
  };
  const table =
    input.sourceKind === "communication_delivery"
      ? "communication_deliveries"
      : input.sourceKind === "ticket_notification"
        ? "ticket_notifications"
        : input.sourceKind === "audition_notification"
          ? "audition_notifications"
          : "payment_notifications";
  if (!shouldReplaceProviderStatus(raw.providerStatus, status)) return record;
  storage.sql.exec(
    `UPDATE ${table}
     SET provider_message_id = ?, provider_status = ?, provider_event_id = ?, provider_event_at = ?,
       provider_reason = ?, provider_smtp_status_code = ?, provider_smtp_enhanced_status_code = ?,
       updated_at = ?
     WHERE id = ? AND lower(destination) = lower(?)
       AND (provider_message_id = ? OR provider_message_id IS NULL)`,
    input.providerMessageId,
    status,
    input.eventId,
    input.eventTimestamp,
    input.providerReason,
    input.providerSmtpStatusCode,
    input.providerSmtpEnhancedStatusCode,
    input.eventTimestamp,
    input.sourceId,
    input.recipient,
    input.providerMessageId,
  );
  return record;
}

function applyProfileSuppression(
  storage: DurableObjectStorage,
  profileId: string,
  input: z.infer<typeof providerFeedbackSchema>,
): void {
  storage.sql.exec(
    `UPDATE profiles
     SET provider_email_suppressed = 1, provider_email_suppressed_at = ?,
       provider_email_suppressed_reason = ?, last_bounce_at = ?, bounce_reason = ?, updated_at = ?
     WHERE id = ?`,
    input.eventTimestamp,
    input.providerReason,
    input.eventTimestamp,
    input.providerReason,
    input.eventTimestamp,
    profileId,
  );
  storage.sql.exec(
    `INSERT INTO communication_suppressions
      (id, profile_id, channel, reason, source_message_id, active, created_at, updated_at)
     VALUES (?, ?, 'email', 'provider', ?, 1, ?, ?)
     ON CONFLICT(profile_id, channel) DO UPDATE SET
       reason = CASE
         WHEN communication_suppressions.reason IN ('user_unsubscribe', 'manager')
         THEN communication_suppressions.reason
         ELSE 'provider'
       END,
       source_message_id = excluded.source_message_id,
       active = 1, updated_at = excluded.updated_at`,
    crypto.randomUUID(),
    profileId,
    input.providerMessageId,
    input.eventTimestamp,
    input.eventTimestamp,
  );
}

/**
 * Phase 7 contact provider suppression.
 *
 * A hard bounce or spam complaint for a contact delivery marks the contact's
 * email preference `unsubscribed` (the only blocking status the preference
 * table supports) with a provider source and records the provider reason in
 * an audit-safe event. Lists, commerce history, and linked profiles are
 * untouched. Idempotent: replaying the same provider event re-applies the
 * same terminal preference state.
 */
function applyContactSuppression(
  storage: DurableObjectStorage,
  contactId: string,
  input: z.infer<typeof providerFeedbackSchema>,
): void {
  const contact = storage.sql
    .exec<{ readonly id: string }>("SELECT id FROM contacts WHERE id = ? LIMIT 1", contactId)
    .toArray()
    .at(0);
  if (!contact) return;
  const providerSource =
    input.providerStatus === "complained" ? "provider_complaint" : "provider_bounce";
  storage.sql.exec(
    `INSERT INTO contact_communication_preferences
      (contact_id, channel, status, source, observed_at, updated_at)
     VALUES (?, 'email', 'unsubscribed', ?, ?, ?)
     ON CONFLICT(contact_id, channel) DO UPDATE SET
       status = 'unsubscribed',
       source = CASE
         WHEN contact_communication_preferences.source IS NULL
           OR contact_communication_preferences.source = ''
         THEN excluded.source
         ELSE contact_communication_preferences.source
       END,
       observed_at = CASE WHEN contact_communication_preferences.status != 'unsubscribed'
         THEN excluded.observed_at ELSE contact_communication_preferences.observed_at END,
       updated_at = excluded.updated_at`,
    contact.id,
    providerSource,
    input.eventTimestamp,
    input.eventTimestamp,
  );
  storage.sql.exec(
    `INSERT OR IGNORE INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, 'provider', ?, ?, 'contact', ?, ?, ?, ?)`,
    `email-provider-contact:${input.eventId}:${contact.id}`,
    input.providerMessageId,
    `organization.contact.email_provider_${input.providerStatus}`,
    contact.id,
    input.eventId,
    JSON.stringify({
      providerReason: input.providerReason,
      providerStatus: input.providerStatus,
      source: providerSource,
    }),
    input.eventTimestamp,
  );
}

export async function recordProviderEmailFeedback(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = providerFeedbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ code: "invalid_provider_email_feedback" }, { status: 400 });
  if (readOrganizationId(storage) !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const input = parsed.data;
  const record = storage.transactionSync(() => {
    return updateSourceRecord(storage, input, input.providerStatus);
  });
  if (!record) return Response.json({ code: "provider_email_source_not_found" }, { status: 404 });
  if (input.shouldSuppress && record.contactId) {
    const contactId = record.contactId;
    storage.transactionSync(() => {
      applyContactSuppression(storage, contactId, input);
    });
  } else if (input.shouldSuppress && record.profileId) {
    const profileId = record.profileId;
    storage.transactionSync(() => {
      applyProfileSuppression(storage, profileId, input);
    });
  }
  const action = `organization.email_provider_${input.providerStatus}`;
  storage.sql.exec(
    `INSERT OR IGNORE INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
     VALUES (?, 'provider', ?, ?, 'email_delivery', ?, ?, ?, ?)`,
    `email-provider:${input.eventId}`,
    input.providerMessageId,
    action,
    input.sourceId,
    input.eventId,
    JSON.stringify({
      providerReason: input.providerReason,
      providerStatus: input.providerStatus,
      sourceKind: input.sourceKind,
      suppressed: input.shouldSuppress,
    }),
    input.eventTimestamp,
  );
  return Response.json({
    contactId: record.contactId,
    profileId: record.profileId,
    providerSuppressed:
      input.shouldSuppress && (record.profileId !== null || record.contactId !== null),
    recorded: true,
  });
}

const providerSuppressionReleaseSchema = z.object({
  actorUserId: z.string().trim().min(1).max(128),
  email: z.email(),
  organizationId: z.string().trim().min(1).max(128),
  profileId: z.uuid(),
  requestId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
});

export async function releaseProviderEmailSuppression(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = providerSuppressionReleaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ code: "invalid_provider_suppression_release" }, { status: 400 });
  const input = parsed.data;
  if (readOrganizationId(storage) !== input.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const profile = storage.sql
    .exec<{
      readonly email: string;
      readonly providerEmailSuppressed: number;
    }>(
      `SELECT email, provider_email_suppressed AS providerEmailSuppressed
       FROM profiles WHERE id = ? LIMIT 1`,
      input.profileId,
    )
    .toArray()
    .at(0);
  if (profile?.email.trim().toLowerCase() !== input.email.trim().toLowerCase()) {
    return Response.json({ code: "provider_suppression_not_found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE profiles
       SET provider_email_suppressed = 0, provider_email_suppressed_at = '',
           provider_email_suppressed_reason = '', updated_at = ?
       WHERE id = ?`,
      now,
      input.profileId,
    );
    storage.sql.exec(
      `UPDATE communication_suppressions
       SET active = 0, updated_at = ?
       WHERE profile_id = ? AND channel = 'email' AND reason = 'provider'`,
      now,
      input.profileId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'platform', ?, 'organization.email_provider_suppression_released',
        'profile', ?, ?, ?, ?)`,
      `email-provider-suppression-release:${input.profileId}:${now}`,
      input.actorUserId,
      input.profileId,
      input.requestId,
      JSON.stringify({ email: input.email, reason: input.reason }),
      now,
    );
  });
  return Response.json({ released: true, updatedAt: now });
}
