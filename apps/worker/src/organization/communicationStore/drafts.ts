import type { communicationSendRequestSchema } from "@choir/contracts";
import type { communicationReach } from "@choir/domain";
import type { z } from "zod";

import type {
  deleteDraftOperationSchema,
  saveOperationSchema,
  sendOperationSchema,
} from "./contracts";
import { audit, eventPromotionIsEligible, readMessage } from "./shared";

export function updateReviewedDraftForSend(
  storage: DurableObjectStorage,
  operation: z.infer<typeof sendOperationSchema>,
  reach: ReturnType<typeof communicationReach>,
  now: string,
): boolean {
  const promotion = operation.message.eventPromotion;
  if (promotion && !eventPromotionIsEligible(storage, promotion.eventId, now)) return false;
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
    JSON.stringify(storedPromotion) !== JSON.stringify(promotion ?? null)
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

export function insertQueuedMessage(
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

export function targetEventPurchaseExists(
  storage: DurableObjectStorage,
  eventId: string,
  column: "contact_id" | "normalized_buyer_email",
  values: readonly string[],
): boolean {
  // Each value is bound twice, plus two event IDs: 49 * 2 + 2 = 100.
  const batchSize = 49;
  for (let offset = 0; offset < values.length; offset += batchSize) {
    const batch = values.slice(offset, offset + batchSize);
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
