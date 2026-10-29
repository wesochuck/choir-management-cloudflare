import type {
  communicationSendRequestSchema,
  CommunicationRecipientSubject,
} from "@choir/contracts";
import { communicationRecipientSubjectFromLegacy } from "@choir/contracts";
import { communicationTemplateSchema } from "@choir/contracts";
import { communicationReach, normalizeEmail } from "@choir/domain";
import type { z } from "zod";

import type {
  cancelOperationSchema,
  deliveryResultOperationSchema,
  deleteDraftOperationSchema,
  deleteTemplateOperationSchema,
  recipientSchema,
  retryOperationSchema,
  resetTemplateToSystemDefaultOperationSchema,
  saveOperationSchema,
  saveTemplateOperationSchema,
  sendOperationSchema,
  updateTemplateOperationSchema,
} from "./contracts";
import { MAX_COMMUNICATION_DELIVERIES, type TemplateRow } from "./contracts";
import { audit, eventPromotionIsEligible, readMessage } from "./shared";
import { wakeOrganizationAlarm } from "../scheduler";
import { getSystemCommunicationTemplateDefault } from "../schema/templates";

function deliveryRows(
  message: z.infer<typeof communicationSendRequestSchema>,
  recipients: readonly z.infer<typeof recipientSchema>[],
  messageId: string,
  now: string,
) {
  const seen = new Set<string>();
  return recipients.flatMap((recipient) => {
    const subject: CommunicationRecipientSubject =
      recipient.subject ?? communicationRecipientSubjectFromLegacy(recipient.profileId);
    const values: { channel: "email" | "sms"; destination: string }[] = [];
    if (message.channel !== "SMS" && recipient.email) {
      values.push({ channel: "email", destination: recipient.email });
    }
    if (message.channel !== "Email" && recipient.phone) {
      values.push({ channel: "sms", destination: recipient.phone });
    }
    return values.flatMap((value) => {
      const key = `${subject.kind}:${recipient.profileId}:${value.channel}:${value.destination.trim().toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          ...value,
          id: crypto.randomUUID(),
          messageId,
          now,
          recipient,
          subject,
        },
      ];
    });
  });
}

function updatePromotionDraftForSend(
  storage: DurableObjectStorage,
  operation: z.infer<typeof sendOperationSchema>,
  reach: ReturnType<typeof communicationReach>,
  now: string,
): boolean {
  const promotion = operation.message.eventPromotion;
  if (!promotion || !eventPromotionIsEligible(storage, promotion.eventId, now)) return false;
  const draft = storage.sql
    .exec<{
      readonly draftRevision: number;
      readonly eventPromotionJson: string | null;
      readonly status: string;
    }>(
      `SELECT status, draft_revision AS draftRevision,
        event_promotion_json AS eventPromotionJson
       FROM communication_messages WHERE id = ? LIMIT 1`,
      operation.messageId,
    )
    .toArray()
    .at(0);
  const storedPromotion = draft?.eventPromotionJson
    ? (JSON.parse(draft.eventPromotionJson) as unknown)
    : null;
  if (
    draft?.status !== "Draft" ||
    draft.draftRevision !== operation.message.expectedRevision ||
    JSON.stringify(storedPromotion) !== JSON.stringify(promotion)
  ) {
    return false;
  }
  storage.sql.exec(
    `UPDATE communication_messages SET channel = ?, status = 'Queued', subject = ?,
      content_markdown = ?, audience_json = ?, reach_json = ?,
      draft_revision = draft_revision + 1, updated_at = ?, queued_at = ?,
      dedupe_key = ?, automation_json = NULL, queued_by_user_id = ?, queued_by_name = ?
     WHERE id = ? AND status = 'Draft' AND draft_revision = ?`,
    operation.message.channel,
    operation.message.subject,
    operation.message.contentMarkdown,
    JSON.stringify(operation.message.audience),
    JSON.stringify(reach),
    now,
    now,
    operation.dedupeKey ?? null,
    operation.actorType === "organization_system" ? null : operation.actorUserId,
    operation.actorType === "organization_system"
      ? "Organization system"
      : (operation.actorUserName ?? null),
    operation.messageId,
    operation.message.expectedRevision,
  );
  return true;
}

function insertQueuedMessage(
  storage: DurableObjectStorage,
  operation: z.infer<typeof sendOperationSchema>,
  reach: ReturnType<typeof communicationReach>,
  now: string,
): void {
  storage.sql.exec(
    `INSERT${operation.dedupeKey ? " OR IGNORE" : ""} INTO communication_messages
    (id, channel, status, subject, content_markdown, audience_json, reach_json, event_promotion_json,
     created_by, created_at, updated_at, queued_at, dedupe_key, automation_json,
     queued_by_user_id, queued_by_name)
   VALUES (?, ?, 'Queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    operation.messageId,
    operation.message.channel,
    operation.message.subject,
    operation.message.contentMarkdown,
    JSON.stringify(operation.message.audience),
    JSON.stringify(reach),
    operation.message.eventPromotion ? JSON.stringify(operation.message.eventPromotion) : null,
    operation.actorUserId,
    now,
    now,
    now,
    operation.dedupeKey ?? null,
    operation.automation ? JSON.stringify(operation.automation) : null,
    operation.actorType === "organization_system" ? null : operation.actorUserId,
    operation.actorType === "organization_system"
      ? "Organization system"
      : (operation.actorUserName ?? null),
  );
}

function validateNewPromotionContext(
  storage: DurableObjectStorage,
  promotion: NonNullable<z.infer<typeof communicationSendRequestSchema>["eventPromotion"]>,
): string | null {
  if (promotion.announcementKind === "initial") {
    const existing = storage.sql
      .exec<{ readonly id: string }>(
        `SELECT message_id AS id FROM event_communication_links
         WHERE event_id = ? AND announcement_kind = 'initial' LIMIT 1`,
        promotion.eventId,
      )
      .toArray()
      .at(0);
    return existing ? "event_promotion_initial_exists" : null;
  }
  const parent = storage.sql
    .exec<{ readonly eventId: string; readonly status: string }>(
      `SELECT l.event_id AS eventId, m.status FROM event_communication_links l
       JOIN communication_messages m ON m.id = l.message_id
       WHERE l.message_id = ? LIMIT 1`,
      promotion.parentMessageId,
    )
    .toArray()
    .at(0);
  if (parent?.eventId !== promotion.eventId) {
    return "event_promotion_parent_not_found";
  }
  if (parent.status === "Draft") return "event_promotion_parent_not_found";
  return null;
}

function targetEventPurchaseExists(
  storage: DurableObjectStorage,
  eventId: string,
  column: "contact_id" | "normalized_buyer_email",
  values: readonly string[],
): boolean {
  for (let offset = 0; offset < values.length; offset += 400) {
    const batch = values.slice(offset, offset + 400);
    const placeholders = batch.map(() => "?").join(", ");
    const found = storage.sql
      .exec<{ readonly id: string }>(
        `SELECT p.id FROM ticket_purchases p
         WHERE p.status = 'paid' AND p.event_id = ? AND p.${column} IN (${placeholders})
         UNION ALL
         SELECT p.id FROM ticket_bundle_allocations a
         JOIN ticket_purchases p ON p.id = a.purchase_id
         WHERE a.event_id = ? AND p.status = 'paid' AND p.${column} IN (${placeholders})
         LIMIT 1`,
        eventId,
        ...batch,
        eventId,
        ...batch,
      )
      .toArray()
      .at(0);
    if (found) return true;
  }
  return false;
}

function promotionAudienceChangedByPurchase(
  storage: DurableObjectStorage,
  operation: z.infer<typeof sendOperationSchema>,
): boolean {
  const promotion = operation.message.eventPromotion;
  const excludedEventId = operation.message.audience.excludeTicketBuyersForEventId;
  if (!promotion || excludedEventId !== promotion.eventId) return false;

  const emailAddresses = [
    ...new Set(
      operation.recipients
        .map((recipient) => normalizeEmail(recipient.email))
        .filter((email) => email.length > 0),
    ),
  ];
  const contactIds = [
    ...new Set(
      operation.recipients.flatMap((recipient) => {
        const subject =
          recipient.subject ?? communicationRecipientSubjectFromLegacy(recipient.profileId);
        return subject.kind === "contact" ? [subject.contactId] : [];
      }),
    ),
  ];
  return (
    targetEventPurchaseExists(storage, excludedEventId, "normalized_buyer_email", emailAddresses) ||
    targetEventPurchaseExists(storage, excludedEventId, "contact_id", contactIds)
  );
}

export async function sendMessage(
  storage: DurableObjectStorage,
  operation: z.infer<typeof sendOperationSchema>,
  now: string,
): Promise<Response> {
  if (operation.dedupeKey) {
    const existing = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        "SELECT id FROM communication_messages WHERE dedupe_key = ? LIMIT 1",
        operation.dedupeKey,
      )
      .toArray()
      .at(0);
    if (existing) {
      const message = readMessage(storage, existing.id);
      if (!message) throw new Error("The deduplicated communication message could not be read.");
      return Response.json(message);
    }
  }
  const reach = communicationReach(
    operation.recipients,
    operation.message.channel,
    operation.undeliverableTicketBuyerPurchases,
    operation.ticketBuyerPurchasesOverLimit,
    operation.audienceOverLimit,
  );
  if (reach.total === 0)
    return Response.json({ code: "communication_has_no_recipients" }, { status: 409 });
  if (operation.message.eventPromotion && operation.message.messageId !== operation.messageId) {
    return Response.json({ code: "event_promotion_draft_required" }, { status: 409 });
  }
  const deliveries = deliveryRows(
    operation.message,
    operation.recipients,
    operation.messageId,
    now,
  );
  if (deliveries.length > MAX_COMMUNICATION_DELIVERIES) {
    return Response.json({ code: "communication_delivery_limit_exceeded" }, { status: 413 });
  }
  const inserted = storage.transactionSync(() => {
    const isPromotion = Boolean(operation.message.eventPromotion);
    if (isPromotion && promotionAudienceChangedByPurchase(storage, operation)) {
      return "promotion_review_stale";
    }
    const updatedPromotion = updatePromotionDraftForSend(storage, operation, reach, now);
    if (isPromotion && !updatedPromotion) return "draft_conflict";
    if (isPromotion) {
      storage.sql.exec(
        "UPDATE event_communication_links SET operation_key = NULL WHERE message_id = ?",
        operation.messageId,
      );
    }
    if (!isPromotion) insertQueuedMessage(storage, operation, reach, now);
    const persisted = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        operation.dedupeKey
          ? "SELECT id FROM communication_messages WHERE dedupe_key = ? LIMIT 1"
          : "SELECT id FROM communication_messages WHERE id = ? LIMIT 1",
        operation.dedupeKey ?? operation.messageId,
      )
      .toArray()
      .at(0);
    if (!persisted) throw new Error("The communication message was not persisted.");
    if (persisted.id !== operation.messageId) {
      return "dedupe_conflict";
    }
    for (const delivery of deliveries) {
      storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status,
           created_at, updated_at, unsubscribe_url, recipient_subject_json)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
        delivery.id,
        delivery.messageId,
        delivery.recipient.profileId,
        delivery.recipient.name,
        delivery.channel,
        delivery.destination,
        delivery.now,
        delivery.now,
        delivery.channel === "email" ? delivery.recipient.unsubscribeUrl : null,
        JSON.stringify(delivery.subject),
      );
    }
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'communication_delivery', ?, ?, ?)`,
      operation.jobId,
      `communication:${operation.messageId}:initial`,
      now,
      now,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.queued",
      operation.messageId,
      { channel: operation.message.channel, deliveryCount: deliveries.length, reach },
      now,
      "communication_message",
      operation.actorType,
    );
    return "queued";
  });
  if (inserted !== "queued") {
    if (inserted === "promotion_review_stale") {
      return Response.json({ code: "event_promotion_review_stale" }, { status: 409 });
    }
    if (operation.message.eventPromotion) {
      return Response.json({ code: "communication_draft_revision_conflict" }, { status: 409 });
    }
    const existing = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        "SELECT id FROM communication_messages WHERE dedupe_key = ? LIMIT 1",
        operation.dedupeKey,
      )
      .toArray()
      .at(0);
    if (!existing) throw new Error("The deduplicated communication message could not be read.");
    const message = readMessage(storage, existing.id);
    if (!message) throw new Error("The deduplicated communication message could not be read.");
    return Response.json(message);
  }
  await wakeOrganizationAlarm(storage);
  return Response.json(readMessage(storage, operation.messageId));
}

function updateDraftRevision(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveOperationSchema>,
  messageId: string,
  expectedRevision: number,
  promotion: z.infer<typeof communicationSendRequestSchema>["eventPromotion"],
  now: string,
): string {
  const current = storage.sql
    .exec<{
      readonly draftRevision: number;
      readonly eventPromotionJson: string | null;
      readonly status: string;
    }>(
      `SELECT status, draft_revision AS draftRevision,
        event_promotion_json AS eventPromotionJson
       FROM communication_messages WHERE id = ? LIMIT 1`,
      messageId,
    )
    .toArray()
    .at(0);
  if (current?.status !== "Draft" || current.draftRevision !== expectedRevision) {
    return "communication_draft_revision_conflict";
  }
  const currentPromotion = current.eventPromotionJson
    ? (JSON.parse(current.eventPromotionJson) as unknown)
    : null;
  if (JSON.stringify(currentPromotion) !== JSON.stringify(promotion)) {
    return "communication_draft_context_conflict";
  }
  storage.sql.exec(
    `UPDATE communication_messages SET channel = ?, subject = ?, content_markdown = ?,
      audience_json = ?, reach_json = ?, draft_revision = draft_revision + 1, updated_at = ?
     WHERE id = ? AND status = 'Draft' AND draft_revision = ?`,
    operation.message.channel,
    operation.message.subject,
    operation.message.contentMarkdown,
    JSON.stringify(operation.message.audience),
    JSON.stringify(operation.reach),
    now,
    messageId,
    expectedRevision,
  );
  return "saved";
}

function existingDraftOutcome(
  storage: DurableObjectStorage,
  messageId: string,
  promotion: z.infer<typeof communicationSendRequestSchema>["eventPromotion"],
): string | null {
  const existingDraft = storage.sql
    .exec<{
      readonly eventPromotionJson: string | null;
      readonly status: string;
    }>(
      `SELECT status, event_promotion_json AS eventPromotionJson
       FROM communication_messages WHERE id = ? LIMIT 1`,
      messageId,
    )
    .toArray()
    .at(0);
  if (!existingDraft) return null;
  const existingPromotion = existingDraft.eventPromotionJson
    ? (JSON.parse(existingDraft.eventPromotionJson) as unknown)
    : null;
  if (
    promotion &&
    existingDraft.status === "Draft" &&
    JSON.stringify(existingPromotion) === JSON.stringify(promotion)
  ) {
    return "existing";
  }
  return "communication_draft_revision_conflict";
}

function insertCommunicationDraft(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveOperationSchema>,
  messageId: string,
  promotion: z.infer<typeof communicationSendRequestSchema>["eventPromotion"],
  now: string,
): void {
  storage.sql.exec(
    `INSERT INTO communication_messages
      (id, channel, status, subject, content_markdown, audience_json, reach_json, event_promotion_json,
       created_by, created_at, updated_at)
     VALUES (?, ?, 'Draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
    messageId,
    operation.message.channel,
    operation.message.subject,
    operation.message.contentMarkdown,
    JSON.stringify(operation.message.audience),
    JSON.stringify(operation.reach),
    promotion ? JSON.stringify(promotion) : null,
    operation.actorUserId,
    now,
    now,
  );
  if (promotion) {
    const operationKey =
      promotion.announcementKind === "initial"
        ? `event-promotion-initial:${promotion.eventId}`
        : `event-promotion-follow-up:${promotion.eventId}:${promotion.parentMessageId ?? ""}`;
    storage.sql.exec(
      `INSERT INTO event_communication_links
        (event_id, message_id, announcement_kind, parent_message_id, operation_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      promotion.eventId,
      messageId,
      promotion.announcementKind,
      promotion.parentMessageId,
      operationKey,
      now,
    );
  }
  audit(
    storage,
    operation.actorUserId,
    operation.requestId,
    "organization.communication.draft.saved",
    messageId,
    { channel: operation.message.channel },
    now,
  );
}

function saveDraftTransaction(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveOperationSchema>,
  messageId: string,
  expectedRevision: number | null,
  promotion: z.infer<typeof communicationSendRequestSchema>["eventPromotion"],
  now: string,
): string | { readonly existingMessageId: string } {
  if (promotion && !eventPromotionIsEligible(storage, promotion.eventId, now)) {
    return "event_promotion_not_eligible";
  }
  if (expectedRevision !== null) {
    return updateDraftRevision(storage, operation, messageId, expectedRevision, promotion, now);
  }
  const existing = existingDraftOutcome(storage, messageId, promotion);
  if (existing) return existing;
  if (promotion) {
    const operationKey =
      promotion.announcementKind === "initial"
        ? `event-promotion-initial:${promotion.eventId}`
        : `event-promotion-follow-up:${promotion.eventId}:${promotion.parentMessageId ?? ""}`;
    const existingPromotionDraft = storage.sql
      .exec<{ readonly id: string }>(
        `SELECT l.message_id AS id FROM event_communication_links l
         JOIN communication_messages m ON m.id = l.message_id
         WHERE l.operation_key = ? AND m.status = 'Draft' LIMIT 1`,
        operationKey,
      )
      .toArray()
      .at(0);
    if (existingPromotionDraft) {
      return { existingMessageId: existingPromotionDraft.id };
    }
    const error = validateNewPromotionContext(storage, promotion);
    if (error) return error;
  }
  insertCommunicationDraft(storage, operation, messageId, promotion, now);
  return "saved";
}

export function saveDraft(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveOperationSchema>,
  now: string,
): Response {
  const messageId = operation.message.messageId ?? operation.messageId;
  const expectedRevision = operation.message.expectedRevision ?? null;
  const promotion = operation.message.eventPromotion ?? null;
  const outcome = storage.transactionSync(() =>
    saveDraftTransaction(storage, operation, messageId, expectedRevision, promotion, now),
  );
  if (outcome === "existing") {
    const existing = readMessage(storage, messageId);
    if (!existing) throw new Error("The idempotent event promotion draft could not be read.");
    return Response.json(existing);
  }
  if (typeof outcome === "object") {
    const existing = readMessage(storage, outcome.existingMessageId);
    if (!existing) throw new Error("The idempotent event promotion draft could not be read.");
    return Response.json(existing);
  }
  if (outcome !== "saved") {
    const status = outcome === "communication_draft_revision_conflict" ? 409 : 409;
    return Response.json({ code: outcome }, { status });
  }
  return Response.json(readMessage(storage, messageId));
}

export function saveTemplate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveTemplateOperationSchema>,
  now: string,
): Response {
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      operation.templateId,
      operation.template.title,
      operation.template.channel,
      operation.template.subject,
      operation.template.contentMarkdown,
      now,
      now,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.saved",
      operation.templateId,
      { channel: operation.template.channel, title: operation.template.title },
      now,
      "communication_template",
    );
  });
  const row = storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
        is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates WHERE id = ? LIMIT 1`,
      operation.templateId,
    )
    .one();
  return Response.json(communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }));
}

export function updateTemplate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof updateTemplateOperationSchema>,
  now: string,
): Response {
  const found = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM communication_templates WHERE id = ? LIMIT 1",
      operation.templateId,
    )
    .toArray()
    .at(0);
  if (!found) return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE communication_templates
       SET title = ?, channel = ?, subject = ?, content_markdown = ?, updated_at = ?
       WHERE id = ?`,
      operation.template.title,
      operation.template.channel,
      operation.template.subject,
      operation.template.contentMarkdown,
      now,
      operation.templateId,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.updated",
      operation.templateId,
      { channel: operation.template.channel, title: operation.template.title },
      now,
      "communication_template",
    );
  });
  const row = storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
        is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates WHERE id = ? LIMIT 1`,
      operation.templateId,
    )
    .one();
  return Response.json(communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }));
}

export function resetTemplateToSystemDefault(
  storage: DurableObjectStorage,
  operation: z.infer<typeof resetTemplateToSystemDefaultOperationSchema>,
  now: string,
): Response {
  const found = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly isSystem: number }>(
      "SELECT is_system AS isSystem FROM communication_templates WHERE id = ? LIMIT 1",
      operation.templateId,
    )
    .toArray()
    .at(0);
  if (!found) return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  if (found.isSystem !== 1) {
    return Response.json({ code: "communication_template_not_system" }, { status: 409 });
  }

  const template = getSystemCommunicationTemplateDefault(operation.templateId);
  if (!template) {
    return Response.json(
      { code: "communication_system_template_default_not_found" },
      { status: 409 },
    );
  }

  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE communication_templates
       SET title = ?, channel = ?, subject = ?, content_markdown = ?, updated_at = ?
       WHERE id = ? AND is_system = 1`,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      operation.templateId,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.reset_to_system_default",
      operation.templateId,
      { channel: template.channel, title: template.title },
      now,
      "communication_template",
    );
  });

  const row = storage.sql
    .exec<TemplateRow>(
      `SELECT id, title, channel, subject, content_markdown AS contentMarkdown,
        is_system AS isSystem, created_at AS createdAt, updated_at AS updatedAt
       FROM communication_templates WHERE id = ? LIMIT 1`,
      operation.templateId,
    )
    .one();
  return Response.json(communicationTemplateSchema.parse({ ...row, isSystem: row.isSystem === 1 }));
}

export function deleteTemplate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof deleteTemplateOperationSchema>,
  now: string,
): Response {
  const found = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly isSystem: number }>(
      "SELECT is_system AS isSystem FROM communication_templates WHERE id = ? LIMIT 1",
      operation.templateId,
    )
    .toArray()
    .at(0);
  if (!found) return Response.json({ code: "communication_template_not_found" }, { status: 404 });
  if (found.isSystem === 1)
    return Response.json({ code: "communication_system_template_protected" }, { status: 409 });
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM communication_templates WHERE id = ?", operation.templateId);
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.template.deleted",
      operation.templateId,
      {},
      now,
      "communication_template",
    );
  });
  return Response.json({ id: operation.templateId, status: "deleted" });
}

export function deleteDraft(
  storage: DurableObjectStorage,
  operation: z.infer<typeof deleteDraftOperationSchema>,
  now: string,
): Response {
  const message = readMessage(storage, operation.messageId);
  if (message?.status !== "Draft")
    return Response.json({ code: "communication_draft_not_found" }, { status: 404 });
  storage.transactionSync(() => {
    storage.sql.exec(
      "DELETE FROM event_communication_links WHERE message_id = ?",
      operation.messageId,
    );
    storage.sql.exec("DELETE FROM communication_messages WHERE id = ?", operation.messageId);
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.draft.deleted",
      operation.messageId,
      {},
      now,
    );
  });
  return Response.json({ id: operation.messageId, status: "deleted" });
}

export function cancelMessage(
  storage: DurableObjectStorage,
  operation: z.infer<typeof cancelOperationSchema>,
  now: string,
): Response {
  return storage.transactionSync(() => {
    const current = storage.sql
      .exec<{
        readonly canceledAt: string | null;
        readonly status: "Draft" | "Failed" | "Queued" | "Sent";
      }>(
        `SELECT status, canceled_at AS canceledAt
         FROM communication_messages WHERE id = ? LIMIT 1`,
        operation.messageId,
      )
      .toArray()
      .at(0);
    if (!current) {
      return Response.json({ code: "communication_message_not_found" }, { status: 404 });
    }
    if (current.canceledAt) {
      const message = readMessage(storage, operation.messageId);
      if (!message) {
        return Response.json({ code: "communication_message_not_found" }, { status: 404 });
      }
      return Response.json(message);
    }
    if (current.status !== "Queued") {
      return Response.json({ code: "communication_message_not_queued" }, { status: 409 });
    }
    const activeDeliveries = storage.sql
      .exec<{ readonly count: number }>(
        `SELECT COUNT(*) AS count FROM communication_deliveries
         WHERE message_id = ? AND status IN ('processing', 'sent')`,
        operation.messageId,
      )
      .one().count;
    if (activeDeliveries > 0) {
      return Response.json({ code: "communication_delivery_started" }, { status: 409 });
    }
    storage.sql.exec(
      `UPDATE communication_deliveries
       SET status = 'suppressed', failure_detail = 'Canceled before delivery', updated_at = ?
       WHERE message_id = ? AND status IN ('queued', 'failed')`,
      now,
      operation.messageId,
    );
    storage.sql.exec(
      `UPDATE communication_messages
       SET status = 'Failed', canceled_at = ?, sent_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'Queued' AND canceled_at IS NULL`,
      now,
      now,
      operation.messageId,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.canceled",
      operation.messageId,
      {},
      now,
    );
    const message = readMessage(storage, operation.messageId);
    if (!message) {
      return Response.json({ code: "communication_message_not_found" }, { status: 404 });
    }
    return Response.json(message);
  });
}

export async function retryMessage(
  storage: DurableObjectStorage,
  operation: z.infer<typeof retryOperationSchema>,
  now: string,
): Promise<Response> {
  const message = readMessage(storage, operation.messageId);
  if (!message || message.status === "Draft")
    return Response.json({ code: "communication_message_not_found" }, { status: 404 });
  const failed = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM communication_deliveries WHERE message_id = ? AND status = 'failed'",
      operation.messageId,
    )
    .one().count;
  if (failed === 0)
    return Response.json({ code: "communication_has_no_failed_deliveries" }, { status: 409 });
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE communication_deliveries SET status = 'queued', failure_detail = '', updated_at = ?
       WHERE message_id = ? AND status = 'failed'`,
      now,
      operation.messageId,
    );
    storage.sql.exec(
      "UPDATE communication_messages SET status = 'Queued', updated_at = ? WHERE id = ?",
      now,
      operation.messageId,
    );
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'communication_delivery', ?, ?, ?)`,
      operation.jobId,
      `communication:${operation.messageId}:retry:${operation.requestId}`,
      now,
      now,
    );
    audit(
      storage,
      operation.actorUserId,
      operation.requestId,
      "organization.communication.retry.queued",
      operation.messageId,
      { deliveryCount: failed },
      now,
    );
  });
  await wakeOrganizationAlarm(storage);
  return Response.json({ messageId: operation.messageId, retried: failed });
}

export function recordDeliveryResults(
  storage: DurableObjectStorage,
  operation: z.infer<typeof deliveryResultOperationSchema>,
  now: string,
): Response {
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'communication_delivery' LIMIT 1`,
      operation.jobId,
    )
    .toArray()
    .at(0);
  if (!job) return Response.json({ code: "communication_job_not_found" }, { status: 404 });
  const messageId = job.idempotencyKey.split(":")[1];
  if (!messageId) return Response.json({ code: "communication_job_invalid" }, { status: 409 });
  storage.transactionSync(() => {
    for (const result of operation.results) {
      storage.sql.exec(
        `UPDATE communication_deliveries
         SET status = ?, attempts = attempts + 1, provider_message_id = ?,
           provider_status = CASE
             WHEN ? = 'sent' AND ? IS NOT NULL AND provider_status IS NULL THEN 'accepted'
             ELSE provider_status END,
           failure_detail = ?,
           last_attempt_at = ?, updated_at = ?
         WHERE id = ? AND message_id = ? AND status IN ('queued', 'processing')`,
        result.status,
        result.providerMessageId,
        result.status,
        result.providerMessageId,
        result.failureDetail,
        now,
        now,
        result.deliveryId,
        messageId,
      );
    }
    const counts = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly failed: number;
        readonly remaining: number;
        readonly sent: number;
      }>(
        `SELECT SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS remaining,
          SUM(CASE WHEN status IN ('sent', 'suppressed') THEN 1 ELSE 0 END) AS sent
         FROM communication_deliveries WHERE message_id = ?`,
        messageId,
      )
      .one();
    const status = counts.remaining > 0 ? "Queued" : counts.sent > 0 ? "Sent" : "Failed";
    storage.sql.exec(
      `UPDATE communication_messages SET status = ?, sent_at = CASE WHEN ? = 'Sent' THEN ? ELSE sent_at END,
        updated_at = ? WHERE id = ? AND canceled_at IS NULL`,
      status,
      status,
      now,
      now,
      messageId,
    );
  });
  return Response.json({ recorded: true });
}
