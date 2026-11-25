import type { SqlStorageValue } from "@cloudflare/workers-types";
import {
  communicationRecipientSubjectFromLegacy,
  communicationRecipientSubjectSchema,
  type CommunicationRecipientSubject,
} from "@choir/contracts";
import { communicationDeliveryIssueKind, hasAcceptableContactIdentity } from "@choir/domain";
import { z } from "zod";
import { wakeOrganizationAlarm } from "../scheduler";
import { rosterContactConflict } from "../organizationStore/rosterContact";
import { recordProfileStatusChange } from "../statusAutomation";
import { audit, identityMatches, readMessage } from "./shared";

const reviewIssuesInputSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  messageId: z.uuid(),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

const resolveDeliveryBaseSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  deliveryId: z.uuid(),
  jobId: z.uuid(),
  messageId: z.uuid(),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

const resolveDeliveryEmailInputSchema = z.union([
  resolveDeliveryBaseSchema.extend({
    action: z.literal("update_email").optional(),
    email: z.string().trim().max(320).pipe(z.email()),
    resend: z.boolean(),
  }),
  resolveDeliveryBaseSchema.extend({
    action: z.literal("clear_email"),
  }),
  resolveDeliveryBaseSchema.extend({
    action: z.literal("delete_contact"),
  }),
  resolveDeliveryBaseSchema.extend({
    action: z.literal("archive_profile"),
  }),
]);

export type ReviewCommunicationIssuesResult =
  | { readonly status: "not_found" }
  | { readonly issuesReviewedAt: string; readonly messageId: string; readonly status: "ok" };

export type ResolveCommunicationDeliveryEmailResult =
  | {
      readonly action: "archive_profile" | "clear_email" | "delete_contact" | "update_email";
      readonly clearedBounceSuppression: boolean;
      readonly deliveryId: string;
      readonly email: string | null;
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
        | "contact_missing_identity"
        | "delivery_has_no_issue"
        | "delivery_not_email"
        | "delivery_spam_complaint"
        | "recipient_contact_not_deletable"
        | "recipient_email_not_editable"
        | "recipient_profile_not_archivable";
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
    readonly action: "contact.created" | "contact.deleted" | "contact.updated";
    readonly actorUserId: string;
    readonly contactId: string;
    readonly hasEmail?: boolean;
    readonly membershipsRemoved?: number;
    readonly now: string;
    readonly profileLinked?: boolean;
    readonly requestId: string;
  },
): void {
  const summary = {
    source: "delivery_issue_resolution",
    ...(input.hasEmail !== undefined ? { hasEmail: input.hasEmail } : {}),
    ...(input.profileLinked !== undefined ? { profileLinked: input.profileLinked } : {}),
    ...(input.membershipsRemoved !== undefined
      ? { membershipsRemoved: input.membershipsRemoved }
      : {}),
  };
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
    JSON.stringify(summary),
    input.now,
  );
}

function clearDeliveryRecipientEmail(
  storage: DurableObjectStorage,
  subject: Extract<CommunicationRecipientSubject, { readonly kind: "contact" | "profile" }>,
  input: z.infer<typeof resolveDeliveryBaseSchema>,
  now: string,
): ResolveCommunicationDeliveryEmailResult {
  return storage.transactionSync((): ResolveCommunicationDeliveryEmailResult => {
    let clearedBounceSuppression: boolean;

    if (subject.kind === "profile") {
      const profile = storage.sql
        .exec<{ readonly id: string }>(
          "SELECT id FROM profiles WHERE id = ? LIMIT 1",
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
      const primary = storage.sql
        .exec<{ readonly email: string | null; readonly id: string }>(
          "SELECT id, email FROM contacts WHERE profile_id = ? ORDER BY created_at, id LIMIT 1",
          subject.profileId,
        )
        .toArray()
        .at(0);
      if (primary && primary.email !== null) {
        storage.sql.exec(
          `UPDATE contacts
           SET email = NULL, normalized_email = NULL, updated_at = ?
           WHERE id = ?`,
          now,
          primary.id,
        );
        writeContactAudit(storage, {
          action: "contact.updated",
          actorUserId: input.actorUserId,
          contactId: primary.id,
          hasEmail: false,
          now,
          profileLinked: true,
          requestId: input.requestId,
        });
      }
      const clearedProfile = clearProfileBounceSuppression(storage, subject.profileId, now);
      const clearedContact = primary
        ? clearContactBounceSuppression(storage, primary.id, now)
        : false;
      clearedBounceSuppression = clearedProfile || clearedContact;
    } else {
      const contact = storage.sql
        .exec<{
          readonly displayName: string | null;
          readonly email: string | null;
          readonly firstName: string | null;
          readonly id: string;
          readonly lastName: string | null;
          readonly normalizedPhone: string | null;
          readonly phone: string | null;
          readonly profileId: string | null;
        }>(
          `SELECT id, first_name AS firstName, last_name AS lastName, display_name AS displayName,
             email, phone, normalized_phone AS normalizedPhone, profile_id AS profileId
           FROM contacts WHERE id = ? LIMIT 1`,
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
      if (
        !hasAcceptableContactIdentity({
          displayName: contact.displayName,
          email: null,
          firstName: contact.firstName,
          lastName: contact.lastName,
          normalizedEmail: null,
          normalizedPhone: contact.normalizedPhone,
          phone: contact.phone,
          profileId: contact.profileId,
        })
      ) {
        return {
          code: "contact_missing_identity",
          message: "This contact only has an email address. Remove the contact instead.",
          status: "conflict",
        };
      }
      if (contact.email !== null) {
        storage.sql.exec(
          `UPDATE contacts
           SET email = NULL, normalized_email = NULL, updated_at = ?
           WHERE id = ?`,
          now,
          contact.id,
        );
        writeContactAudit(storage, {
          action: "contact.updated",
          actorUserId: input.actorUserId,
          contactId: contact.id,
          hasEmail: false,
          now,
          profileLinked: contact.profileId !== null,
          requestId: input.requestId,
        });
      }
      const clearedContact = clearContactBounceSuppression(storage, contact.id, now);
      const clearedProfile = contact.profileId
        ? clearProfileBounceSuppression(storage, contact.profileId, now)
        : false;
      clearedBounceSuppression = clearedContact || clearedProfile;
    }

    audit(
      storage,
      input.actorUserId,
      input.requestId,
      "organization.communication.delivery_email.resolved",
      input.messageId,
      {
        action: "clear_email",
        clearedBounceSuppression,
        deliveryId: input.deliveryId,
        recipientKind: subject.kind,
        resent: false,
      },
      now,
    );

    return {
      action: "clear_email",
      clearedBounceSuppression,
      deliveryId: input.deliveryId,
      email: null,
      messageId: input.messageId,
      resent: false,
      status: "ok",
    };
  });
}

function deleteDeliveryRecipientContact(
  storage: DurableObjectStorage,
  subject: Extract<CommunicationRecipientSubject, { readonly kind: "contact" | "profile" }>,
  input: z.infer<typeof resolveDeliveryBaseSchema>,
  now: string,
): ResolveCommunicationDeliveryEmailResult {
  if (subject.kind !== "contact") {
    return {
      code: "recipient_contact_not_deletable",
      message:
        "Organization Profiles cannot be deleted here. Remove or update their email address instead.",
      status: "conflict",
    };
  }
  return storage.transactionSync((): ResolveCommunicationDeliveryEmailResult => {
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
    if (contact.profileId !== null) {
      return {
        code: "recipient_contact_not_deletable",
        message:
          "This contact is linked to an Organization Profile and cannot be deleted here. Remove or update their email address instead.",
        status: "conflict",
      };
    }
    const membershipCount =
      storage.sql
        .exec<{ readonly count: number }>(
          "SELECT COUNT(*) AS count FROM contact_list_memberships WHERE contact_id = ?",
          contact.id,
        )
        .toArray()
        .at(0)?.count ?? 0;

    storage.sql.exec("DELETE FROM contact_list_memberships WHERE contact_id = ?", contact.id);
    storage.sql.exec(
      "DELETE FROM contact_communication_preferences WHERE contact_id = ?",
      contact.id,
    );
    for (const table of ["ticket_purchases", "donations"] as const) {
      const hasContactColumn = storage.sql
        .exec<{ readonly name: string }>(`PRAGMA table_info(${table})`)
        .toArray()
        .some((column) => column.name === "contact_id");
      if (hasContactColumn) {
        storage.sql.exec(`UPDATE ${table} SET contact_id = NULL WHERE contact_id = ?`, contact.id);
      }
    }
    storage.sql.exec("DELETE FROM contacts WHERE id = ?", contact.id);
    writeContactAudit(storage, {
      action: "contact.deleted",
      actorUserId: input.actorUserId,
      contactId: contact.id,
      membershipsRemoved: membershipCount,
      now,
      requestId: input.requestId,
    });
    audit(
      storage,
      input.actorUserId,
      input.requestId,
      "organization.communication.delivery_email.resolved",
      input.messageId,
      {
        action: "delete_contact",
        clearedBounceSuppression: false,
        deliveryId: input.deliveryId,
        recipientKind: subject.kind,
        resent: false,
      },
      now,
    );
    return {
      action: "delete_contact",
      clearedBounceSuppression: false,
      deliveryId: input.deliveryId,
      email: null,
      messageId: input.messageId,
      resent: false,
      status: "ok",
    };
  });
}

function archiveDeliveryRecipientProfile(
  storage: DurableObjectStorage,
  subject: Extract<CommunicationRecipientSubject, { readonly kind: "contact" | "profile" }>,
  input: z.infer<typeof resolveDeliveryBaseSchema>,
  now: string,
): ResolveCommunicationDeliveryEmailResult {
  return storage.transactionSync((): ResolveCommunicationDeliveryEmailResult => {
    let profileId: string | null;
    if (subject.kind === "profile") {
      profileId = subject.profileId;
    } else {
      const contact = storage.sql
        .exec<{ readonly profileId: string | null }>(
          "SELECT profile_id AS profileId FROM contacts WHERE id = ? LIMIT 1",
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
      profileId = contact.profileId;
    }

    if (!profileId) {
      return {
        code: "recipient_profile_not_archivable",
        message:
          "Standalone contacts cannot be archived. Remove the email address or delete the contact instead.",
        status: "conflict",
      };
    }

    const profile = storage.sql
      .exec<{
        readonly displayName: string;
        readonly globalStatus: "Active" | "Idle" | "Inactive";
        readonly id: string;
      }>(
        "SELECT id, display_name AS displayName, global_status AS globalStatus FROM profiles WHERE id = ? LIMIT 1",
        profileId,
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

    if (profile.globalStatus !== "Inactive") {
      recordProfileStatusChange(storage, {
        actor: {
          actorId: input.actorUserId,
          actorType: "organization_member",
          requestId: input.requestId,
        },
        newStatus: "Inactive",
        occurredAt: now,
        profileId: profile.id,
        reason: "Archived from communication delivery issue resolution.",
        triggerId: "",
        triggerType: "manual_status_selection",
      });
    }
    storage.sql.exec(
      `UPDATE profiles
       SET global_status = 'Inactive', hidden = 1, status_is_manual = 1, updated_at = ?
       WHERE id = ?`,
      now,
      profile.id,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'profile.updated', 'profile', ?, ?, ?, ?)`,
      `delivery-resolve-profile:${profile.id}:${input.requestId}`,
      input.actorUserId,
      profile.id,
      input.requestId,
      JSON.stringify({
        displayName: profile.displayName,
        globalStatus: "Inactive",
        hidden: true,
        source: "delivery_issue_resolution",
      }),
      now,
    );
    audit(
      storage,
      input.actorUserId,
      input.requestId,
      "organization.communication.delivery_email.resolved",
      input.messageId,
      {
        action: "archive_profile",
        clearedBounceSuppression: false,
        deliveryId: input.deliveryId,
        recipientKind: subject.kind,
        resent: false,
      },
      now,
    );
    return {
      action: "archive_profile",
      clearedBounceSuppression: false,
      deliveryId: input.deliveryId,
      email: null,
      messageId: input.messageId,
      resent: false,
      status: "ok",
    };
  });
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

function loadResolvableDelivery(
  storage: DurableObjectStorage,
  input: z.infer<typeof resolveDeliveryBaseSchema>,
):
  | {
      readonly delivery: DeliveryLookupRow;
      readonly ok: true;
      readonly subject: Extract<
        CommunicationRecipientSubject,
        { readonly kind: "contact" | "profile" }
      >;
    }
  | {
      readonly error: Exclude<ResolveCommunicationDeliveryEmailResult, { readonly status: "ok" }>;
      readonly ok: false;
    } {
  if (!identityMatches(storage, input.organizationId)) {
    return {
      error: {
        code: "organization_not_found",
        message: "Organization not found.",
        status: "not_found",
      },
      ok: false,
    };
  }
  const message = readMessage(storage, input.messageId);
  if (!message || message.status === "Draft" || message.status === "Canceled") {
    return {
      error: {
        code: "communication_message_not_found",
        message: "Communication message not found.",
        status: "not_found",
      },
      ok: false,
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
      error: {
        code: "communication_delivery_not_found",
        message: "Delivery record not found.",
        status: "not_found",
      },
      ok: false,
    };
  }
  if (delivery.channel !== "email") {
    return {
      error: {
        code: "delivery_not_email",
        message: "Only email deliveries can be resolved by updating an email address.",
        status: "conflict",
      },
      ok: false,
    };
  }
  const issueKind = communicationDeliveryIssueKind(delivery.status, delivery.providerStatus);
  if (!issueKind) {
    return {
      error: {
        code: "delivery_has_no_issue",
        message: "This delivery does not have an active issue.",
        status: "conflict",
      },
      ok: false,
    };
  }
  if (issueKind === "complained") {
    return {
      error: {
        code: "delivery_spam_complaint",
        message: "Recipients who reported spam cannot be cleared or resent here.",
        status: "conflict",
      },
      ok: false,
    };
  }
  const subject = parseDeliverySubject(delivery.recipientSubjectJson, delivery.profileId);
  if (subject.kind !== "profile" && subject.kind !== "contact") {
    return {
      error: {
        code: "recipient_email_not_editable",
        message: "This delivery is not linked to an editable profile or contact record.",
        status: "conflict",
      },
      ok: false,
    };
  }
  return { delivery, ok: true, subject };
}

export async function resolveCommunicationDeliveryEmailInStore(
  storage: DurableObjectStorage,
  rawInput: z.infer<typeof resolveDeliveryEmailInputSchema>,
  now = new Date().toISOString(),
): Promise<ResolveCommunicationDeliveryEmailResult> {
  const input = resolveDeliveryEmailInputSchema.parse(rawInput);
  const loaded = loadResolvableDelivery(storage, input);
  if (!loaded.ok) return loaded.error;
  const { delivery, subject } = loaded;

  if (input.action === "clear_email") {
    return clearDeliveryRecipientEmail(storage, subject, input, now);
  }
  if (input.action === "delete_contact") {
    return deleteDeliveryRecipientContact(storage, subject, input, now);
  }
  if (input.action === "archive_profile") {
    return archiveDeliveryRecipientProfile(storage, subject, input, now);
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
          hasEmail: true,
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
          hasEmail: true,
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
        hasEmail: true,
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
        action: "update_email",
        clearedBounceSuppression,
        deliveryId: input.deliveryId,
        emailChanged,
        recipientKind: subject.kind,
        resent: input.resend,
      },
      now,
    );

    return {
      action: "update_email",
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
