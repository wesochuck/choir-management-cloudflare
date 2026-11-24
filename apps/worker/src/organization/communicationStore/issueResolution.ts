import type { SqlStorageValue } from "@cloudflare/workers-types";
import {
  communicationRecipientSubjectFromLegacy,
  communicationRecipientSubjectSchema,
  type CommunicationRecipientSubject,
} from "@choir/contracts";
import { communicationDeliveryIssueKind } from "@choir/domain";
import { z } from "zod";
import { wakeOrganizationAlarm } from "../scheduler";
import { rosterContactConflict } from "../organizationStore/rosterContact";
import { audit, identityMatches, readMessage } from "./shared";

const reviewIssuesInputSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  messageId: z.uuid(),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

const resolveDeliveryEmailInputSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  deliveryId: z.uuid(),
  email: z.string().trim().max(320).pipe(z.email()),
  jobId: z.uuid(),
  messageId: z.uuid(),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
  resend: z.boolean(),
});

export type ReviewCommunicationIssuesResult =
  | { readonly status: "not_found" }
  | { readonly issuesReviewedAt: string; readonly messageId: string; readonly status: "ok" };

export type ResolveCommunicationDeliveryEmailResult =
  | {
      readonly clearedBounceSuppression: boolean;
      readonly deliveryId: string;
      readonly email: string;
      readonly messageId: string;
      readonly resent: boolean;
      readonly status: "ok";
    }
  | {
      readonly code:
        | "communication_delivery_not_found"
        | "communication_message_not_found"
        | "organization_not_found"
        | "recipient_not_found";
      readonly message: string;
      readonly status: "not_found";
    }
  | {
      readonly code:
        | "contact_duplicate_email"
        | "delivery_has_no_issue"
        | "delivery_not_email"
        | "delivery_spam_complaint"
        | "recipient_email_not_editable";
      readonly message: string;
      readonly status: "conflict";
    };

interface DeliveryLookupRow {
  readonly [column: string]: SqlStorageValue;
  readonly channel: "email" | "sms";
  readonly destination: string;
  readonly id: string;
  readonly profileId: string;
  readonly providerStatus:
    "accepted" | "bounced" | "complained" | "deferred" | "delivered" | "failed" | "rejected" | null;
  readonly recipientSubjectJson: string | null;
  readonly status: "failed" | "processing" | "queued" | "sent" | "suppressed";
}

function parseDeliverySubject(
  value: string | null,
  profileId: string,
): CommunicationRecipientSubject {
  if (value && value !== "") {
    try {
      const parsed = communicationRecipientSubjectSchema.safeParse(JSON.parse(value));
      if (parsed.success) return parsed.data;
    } catch {
      // Fall through to legacy profile adapter.
    }
  }
  return communicationRecipientSubjectFromLegacy(profileId);
}

function clearProfileBounceSuppression(
  storage: DurableObjectStorage,
  profileId: string,
  now: string,
): boolean {
  const profileRow = storage.sql
    .exec<{
      readonly bounceReason: string;
      readonly lastBounceAt: string;
      readonly providerSuppressed: number;
      readonly providerSuppressedReason: string;
    }>(
      `SELECT provider_email_suppressed AS providerSuppressed,
         provider_email_suppressed_reason AS providerSuppressedReason,
         last_bounce_at AS lastBounceAt, bounce_reason AS bounceReason
       FROM profiles WHERE id = ? LIMIT 1`,
      profileId,
    )
    .toArray()
    .at(0);
  if (!profileRow) return false;
  const combinedReason =
    `${profileRow.providerSuppressedReason} ${profileRow.bounceReason}`.toLowerCase();
  if (combinedReason.includes("complain")) return false;

  let cleared = false;
  if (profileRow.providerSuppressed === 1 || profileRow.lastBounceAt !== "") {
    storage.sql.exec(
      `UPDATE profiles
       SET provider_email_suppressed = 0, provider_email_suppressed_at = '',
           provider_email_suppressed_reason = '', last_bounce_at = '', bounce_reason = '',
           updated_at = ?
       WHERE id = ?`,
      now,
      profileId,
    );
    cleared = true;
  }
  const deactivated = storage.sql.exec(
    `UPDATE communication_suppressions
     SET active = 0, updated_at = ?
     WHERE profile_id = ? AND channel = 'email' AND reason = 'provider' AND active = 1`,
    now,
    profileId,
  ).rowsWritten;
  return cleared || deactivated > 0;
}

function clearContactBounceSuppression(
  storage: DurableObjectStorage,
  contactId: string,
  now: string,
): boolean {
  const updated = storage.sql.exec(
    `UPDATE contact_communication_preferences
     SET status = 'unknown', source = 'email_updated', observed_at = ?, updated_at = ?
     WHERE contact_id = ? AND channel = 'email' AND status = 'unsubscribed' AND source = 'provider_bounce'`,
    now,
    now,
    contactId,
  ).rowsWritten;
  return updated > 0;
}

function writeContactAudit(
  storage: DurableObjectStorage,
  input: {
    readonly action: "contact.created" | "contact.updated";
    readonly actorUserId: string;
    readonly contactId: string;
    readonly now: string;
    readonly profileLinked: boolean;
    readonly requestId: string;
  },
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, ?, 'contact', ?, ?, ?, ?)`,
    `delivery-resolve-contact:${input.contactId}:${input.requestId}`,
    input.actorUserId,
    input.action,
    input.contactId,
    input.requestId,
    JSON.stringify({
      hasEmail: true,
      profileLinked: input.profileLinked,
      source: "delivery_issue_resolution",
    }),
    input.now,
  );
}

export function reviewCommunicationIssuesInStore(
  storage: DurableObjectStorage,
  rawInput: z.infer<typeof reviewIssuesInputSchema>,
  now = new Date().toISOString(),
): ReviewCommunicationIssuesResult {
  const input = reviewIssuesInputSchema.parse(rawInput);
  if (!identityMatches(storage, input.organizationId)) return { status: "not_found" };
  const message = readMessage(storage, input.messageId);
  if (!message || message.status === "Draft" || message.status === "Canceled") {
    return { status: "not_found" };
  }
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE communication_messages
       SET issues_reviewed_at = ?, issues_reviewed_by = ?, updated_at = ?
       WHERE id = ? AND canceled_at IS NULL`,
      now,
      input.actorUserId,
      now,
      input.messageId,
    );
    audit(
      storage,
      input.actorUserId,
      input.requestId,
      "organization.communication.issues.reviewed",
      input.messageId,
      { issuesReviewedAt: now },
      now,
    );
  });
  return { issuesReviewedAt: now, messageId: input.messageId, status: "ok" };
}

export async function resolveCommunicationDeliveryEmailInStore(
  storage: DurableObjectStorage,
  rawInput: z.infer<typeof resolveDeliveryEmailInputSchema>,
  now = new Date().toISOString(),
): Promise<ResolveCommunicationDeliveryEmailResult> {
  const input = resolveDeliveryEmailInputSchema.parse(rawInput);
  if (!identityMatches(storage, input.organizationId)) {
    return {
      code: "organization_not_found",
      message: "Organization not found.",
      status: "not_found",
    };
  }
  const message = readMessage(storage, input.messageId);
  if (!message || message.status === "Draft" || message.status === "Canceled") {
    return {
      code: "communication_message_not_found",
      message: "Communication message not found.",
      status: "not_found",
    };
  }
  const delivery = storage.sql
    .exec<DeliveryLookupRow>(
      `SELECT id, profile_id AS profileId, channel, destination, status,
         provider_status AS providerStatus, recipient_subject_json AS recipientSubjectJson
       FROM communication_deliveries
       WHERE id = ? AND message_id = ? LIMIT 1`,
      input.deliveryId,
      input.messageId,
    )
    .toArray()
    .at(0);
  if (!delivery) {
    return {
      code: "communication_delivery_not_found",
      message: "Delivery record not found.",
      status: "not_found",
    };
  }
  if (delivery.channel !== "email") {
    return {
      code: "delivery_not_email",
      message: "Only email deliveries can be resolved by updating an email address.",
      status: "conflict",
    };
  }
  const issueKind = communicationDeliveryIssueKind(delivery.status, delivery.providerStatus);
  if (!issueKind) {
    return {
      code: "delivery_has_no_issue",
      message: "This delivery does not have an active issue.",
      status: "conflict",
    };
  }
  if (issueKind === "complained") {
    return {
      code: "delivery_spam_complaint",
      message: "Recipients who reported spam cannot be cleared or resent here.",
      status: "conflict",
    };
  }
  const subject = parseDeliverySubject(delivery.recipientSubjectJson, delivery.profileId);
  if (subject.kind !== "profile" && subject.kind !== "contact") {
    return {
      code: "recipient_email_not_editable",
      message: "This delivery is not linked to an editable profile or contact record.",
      status: "conflict",
    };
  }

  const trimmedEmail = input.email.trim();
  const nextNormalized = trimmedEmail.toLowerCase();
  const prevNormalized = delivery.destination.trim().toLowerCase();
  const emailChanged = nextNormalized !== prevNormalized;

  const outcome = storage.transactionSync((): ResolveCommunicationDeliveryEmailResult => {
    let clearedBounceSuppression = false;

    if (subject.kind === "profile") {
      const profile = storage.sql
        .exec<{ readonly displayName: string; readonly id: string }>(
          "SELECT id, display_name AS displayName FROM profiles WHERE id = ? LIMIT 1",
          subject.profileId,
        )
        .toArray()
        .at(0);
      if (!profile) {
        return {
          code: "recipient_not_found",
          message: "The recipient's Organization Profile could not be found.",
          status: "not_found",
        };
      }
      if (rosterContactConflict(storage, subject.profileId, trimmedEmail)) {
        return {
          code: "contact_duplicate_email",
          message: "Another contact already uses this email address.",
          status: "conflict",
        };
      }
      const primary = storage.sql
        .exec<{ readonly id: string }>(
          "SELECT id FROM contacts WHERE profile_id = ? ORDER BY created_at, id LIMIT 1",
          subject.profileId,
        )
        .toArray()
        .at(0);
      let primaryContactId: string;
      if (primary) {
        primaryContactId = primary.id;
        storage.sql.exec(
          `UPDATE contacts
           SET email = ?, normalized_email = ?, updated_at = ?
           WHERE id = ?`,
          trimmedEmail,
          nextNormalized,
          now,
          primary.id,
        );
        writeContactAudit(storage, {
          action: "contact.updated",
          actorUserId: input.actorUserId,
          contactId: primary.id,
          now,
          profileLinked: true,
          requestId: input.requestId,
        });
      } else {
        primaryContactId = crypto.randomUUID();
        storage.sql.exec(
          `INSERT INTO contacts
            (id, first_name, last_name, display_name, email, normalized_email,
             phone, normalized_phone, profile_id, source, created_at, updated_at)
           VALUES (?, NULL, NULL, ?, ?, ?, NULL, NULL, ?, 'roster', ?, ?)`,
          primaryContactId,
          profile.displayName,
          trimmedEmail,
          nextNormalized,
          subject.profileId,
          now,
          now,
        );
        for (const channel of ["email", "sms"] as const) {
          storage.sql.exec(
            `INSERT INTO contact_communication_preferences
              (contact_id, channel, status, source, observed_at, updated_at)
             VALUES (?, ?, 'unknown', 'roster', ?, ?)`,
            primaryContactId,
            channel,
            now,
            now,
          );
        }
        writeContactAudit(storage, {
          action: "contact.created",
          actorUserId: input.actorUserId,
          contactId: primaryContactId,
          now,
          profileLinked: true,
          requestId: input.requestId,
        });
      }
      if (emailChanged) {
        const clearedProfile = clearProfileBounceSuppression(storage, subject.profileId, now);
        const clearedContact = clearContactBounceSuppression(storage, primaryContactId, now);
        clearedBounceSuppression = clearedProfile || clearedContact;
      }
    } else {
      const contact = storage.sql
        .exec<{ readonly id: string; readonly profileId: string | null }>(
          "SELECT id, profile_id AS profileId FROM contacts WHERE id = ? LIMIT 1",
          subject.contactId,
        )
        .toArray()
        .at(0);
      if (!contact) {
        return {
          code: "recipient_not_found",
          message: "The recipient's contact record could not be found.",
          status: "not_found",
        };
      }
      const duplicate = storage.sql
        .exec<{ readonly id: string }>(
          "SELECT id FROM contacts WHERE normalized_email = ? AND id <> ? LIMIT 1",
          nextNormalized,
          contact.id,
        )
        .toArray()
        .at(0);
      if (duplicate) {
        return {
          code: "contact_duplicate_email",
          message: "Another contact already uses this email address.",
          status: "conflict",
        };
      }
      storage.sql.exec(
        `UPDATE contacts
         SET email = ?, normalized_email = ?, updated_at = ?
         WHERE id = ?`,
        trimmedEmail,
        nextNormalized,
        now,
        contact.id,
      );
      writeContactAudit(storage, {
        action: "contact.updated",
        actorUserId: input.actorUserId,
        contactId: contact.id,
        now,
        profileLinked: contact.profileId !== null,
        requestId: input.requestId,
      });
      if (emailChanged) {
        const clearedContact = clearContactBounceSuppression(storage, contact.id, now);
        const clearedProfile = contact.profileId
          ? clearProfileBounceSuppression(storage, contact.profileId, now)
          : false;
        clearedBounceSuppression = clearedContact || clearedProfile;
      }
    }

    if (input.resend) {
      storage.sql.exec(
        `UPDATE communication_deliveries
         SET destination = ?, status = 'queued', delivery_job_id = NULL,
             failure_detail = '', provider_message_id = NULL, provider_status = NULL,
             provider_event_id = NULL, provider_event_at = NULL, provider_reason = '',
             provider_smtp_status_code = '', provider_smtp_enhanced_status_code = '',
             updated_at = ?
         WHERE id = ? AND message_id = ?`,
        trimmedEmail,
        now,
        input.deliveryId,
        input.messageId,
      );
      storage.sql.exec(
        `UPDATE communication_messages
         SET status = 'Queued', updated_at = ?
         WHERE id = ? AND canceled_at IS NULL`,
        now,
        input.messageId,
      );
      storage.sql.exec(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, 'communication_delivery', ?, ?, ?)`,
        input.jobId,
        `communication:${input.messageId}:resolve:${input.deliveryId}:${input.requestId}`,
        now,
        now,
      );
    }

    audit(
      storage,
      input.actorUserId,
      input.requestId,
      "organization.communication.delivery_email.resolved",
      input.messageId,
      {
        clearedBounceSuppression,
        deliveryId: input.deliveryId,
        emailChanged,
        recipientKind: subject.kind,
        resent: input.resend,
      },
      now,
    );

    return {
      clearedBounceSuppression,
      deliveryId: input.deliveryId,
      email: trimmedEmail,
      messageId: input.messageId,
      resent: input.resend,
      status: "ok",
    };
  });

  if (outcome.status === "ok" && outcome.resent) {
    await wakeOrganizationAlarm(storage);
  }
  return outcome;
}
