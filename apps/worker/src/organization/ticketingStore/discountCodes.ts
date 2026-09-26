import type { discountCodeRequestSchema } from "@choir/contracts";
import { isValidTicketDiscountValue, normalizeDiscountCode } from "@choir/domain";
import type { z } from "zod";

import type {
  deactivateDiscountCodeOperationSchema,
  reactivateDiscountCodeOperationSchema,
  upsertDiscountCodeOperationSchema,
} from "./contracts";
import { discountCodeResult, discountCodeRows } from "./readModel";

function discountCodeItemExists(
  storage: DurableObjectStorage,
  code: z.infer<typeof discountCodeRequestSchema>,
): boolean {
  if (code.eventId) {
    return (
      storage.sql
        .exec(
          `SELECT id FROM events
           WHERE id = ? AND type = 'Performance' AND is_archived = 0 AND is_canceled = 0
           LIMIT 1`,
          code.eventId,
        )
        .toArray().length > 0
    );
  }
  return (
    code.bundleId !== null &&
    storage.sql.exec("SELECT id FROM ticket_bundles WHERE id = ? LIMIT 1", code.bundleId).toArray()
      .length > 0
  );
}

// eslint-disable-next-line complexity -- enforces target, uniqueness, immutability, persistence, and audit rules.
export function upsertDiscountCode(
  storage: DurableObjectStorage,
  operation: z.infer<typeof upsertDiscountCodeOperationSchema>,
): Response {
  if (!discountCodeItemExists(storage, operation.code)) {
    return Response.json({ code: "discount_code_target_invalid" }, { status: 409 });
  }
  const normalizedCode = normalizeDiscountCode(operation.code.code);
  if (
    !normalizedCode ||
    !isValidTicketDiscountValue(operation.code.discountType, operation.code.discountValue)
  ) {
    return Response.json({ code: "discount_code_invalid" }, { status: 400 });
  }
  const existing = storage.sql
    .exec<{
      readonly active: number;
      readonly bundleId: string | null;
      readonly deactivatedAt: string | null;
      readonly discountType: "fixed" | "percentage";
      readonly discountValue: number;
      readonly eventId: string | null;
      readonly firstRedeemedAt: string | null;
      readonly id: string;
      readonly normalizedCode: string;
      readonly redemptionLimit: number | null;
      readonly createdAt: string;
    }>(
      `SELECT id, normalized_code AS normalizedCode, event_id AS eventId,
        bundle_id AS bundleId, discount_type AS discountType, discount_value AS discountValue,
        redemption_limit AS redemptionLimit, active, deactivated_at AS deactivatedAt,
        first_redeemed_at AS firstRedeemedAt, created_at AS createdAt
       FROM discount_codes WHERE id = ? LIMIT 1`,
      operation.codeId,
    )
    .toArray()
    .at(0);
  if (!operation.allowCreate && !existing) {
    return Response.json({ code: "discount_code_not_found" }, { status: 404 });
  }
  const duplicate = storage.sql
    .exec<{ readonly id: string }>(
      "SELECT id FROM discount_codes WHERE normalized_code = ? AND id != ? LIMIT 1",
      normalizedCode,
      operation.codeId,
    )
    .toArray()
    .at(0);
  if (duplicate) return Response.json({ code: "discount_code_duplicate" }, { status: 409 });
  const confirmedCount = existing
    ? storage.sql
        .exec<{ readonly count: number }>(
          `SELECT COUNT(*) AS count FROM discount_code_redemptions
           WHERE discount_code_id = ? AND status = 'confirmed'`,
          operation.codeId,
        )
        .one().count
    : 0;
  const termsChanged = Boolean(
    existing &&
    (existing.normalizedCode !== normalizedCode ||
      existing.eventId !== operation.code.eventId ||
      existing.bundleId !== operation.code.bundleId ||
      existing.discountType !== operation.code.discountType ||
      existing.discountValue !== operation.code.discountValue ||
      existing.redemptionLimit !== operation.code.redemptionLimit),
  );
  if (existing && confirmedCount > 0 && termsChanged) {
    return Response.json({ code: "discount_code_immutable" }, { status: 409 });
  }
  if (existing && (operation.code.active ? 1 : 0) !== existing.active) {
    return Response.json(
      { code: "discount_code_availability_lifecycle_required" },
      { status: 400 },
    );
  }
  const occurredAt = new Date().toISOString();
  const itemType = operation.code.eventId ? "performance" : "bundle";
  const deactivatedAt = existing
    ? existing.deactivatedAt
    : operation.code.active
      ? null
      : occurredAt;
  const activeValue = existing ? existing.active : operation.code.active ? 1 : 0;
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO discount_codes
        (id, normalized_code, display_code, item_type, event_id, bundle_id,
         discount_type, discount_value, redemption_limit, active, first_redeemed_at,
         deactivated_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         normalized_code = excluded.normalized_code,
         display_code = excluded.display_code,
         item_type = excluded.item_type,
         event_id = excluded.event_id,
         bundle_id = excluded.bundle_id,
         discount_type = excluded.discount_type,
         discount_value = excluded.discount_value,
         redemption_limit = excluded.redemption_limit,
         active = excluded.active,
         deactivated_at = excluded.deactivated_at,
         updated_at = excluded.updated_at`,
      operation.codeId,
      normalizedCode,
      operation.code.code,
      itemType,
      operation.code.eventId,
      operation.code.bundleId,
      operation.code.discountType,
      operation.code.discountValue,
      operation.code.redemptionLimit,
      activeValue,
      deactivatedAt,
      operation.actorUserId,
      existing?.createdAt ?? occurredAt,
      occurredAt,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'ticket.discount_code.saved',
        'discount_code', ?, ?, ?, ?)`,
      `discount-code-saved:${operation.requestId}`,
      operation.actorUserId,
      operation.codeId,
      operation.requestId,
      JSON.stringify({
        active: Boolean(activeValue),
        discountType: operation.code.discountType,
        discountValue: operation.code.discountValue,
        itemType,
        redemptionLimit: operation.code.redemptionLimit,
      }),
      occurredAt,
    );
  });
  const saved = discountCodeRows(storage).find(({ id }) => id === operation.codeId);
  return saved
    ? Response.json(discountCodeResult(saved))
    : Response.json({ code: "discount_code_not_found" }, { status: 404 });
}

export function deactivateDiscountCode(
  storage: DurableObjectStorage,
  operation: z.infer<typeof deactivateDiscountCodeOperationSchema>,
): Response {
  const existing = storage.sql
    .exec<{ readonly id: string; readonly active: number }>(
      "SELECT id, active FROM discount_codes WHERE id = ? LIMIT 1",
      operation.codeId,
    )
    .toArray()
    .at(0);
  if (!existing) return Response.json({ code: "discount_code_not_found" }, { status: 404 });
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE discount_codes SET active = 0, deactivated_at = COALESCE(deactivated_at, ?),
       updated_at = ? WHERE id = ?`,
      occurredAt,
      occurredAt,
      operation.codeId,
    );
    storage.sql.exec(
      `INSERT OR IGNORE INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'ticket.discount_code.deactivated',
        'discount_code', ?, ?, '{}', ?)`,
      `discount-code-deactivated:${operation.requestId}`,
      operation.actorUserId,
      operation.codeId,
      operation.requestId,
      occurredAt,
    );
  });
  const saved = discountCodeRows(storage).find(({ id }) => id === operation.codeId);
  return saved
    ? Response.json(discountCodeResult(saved))
    : Response.json({ code: "discount_code_not_found" }, { status: 404 });
}

export function reactivateDiscountCode(
  storage: DurableObjectStorage,
  operation: z.infer<typeof reactivateDiscountCodeOperationSchema>,
): Response {
  const existing = storage.sql
    .exec<{ readonly id: string; readonly active: number }>(
      "SELECT id, active FROM discount_codes WHERE id = ? LIMIT 1",
      operation.codeId,
    )
    .toArray()
    .at(0);
  if (!existing) return Response.json({ code: "discount_code_not_found" }, { status: 404 });
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE discount_codes SET active = 1, deactivated_at = NULL,
       updated_at = ? WHERE id = ?`,
      occurredAt,
      operation.codeId,
    );
    storage.sql.exec(
      `INSERT OR IGNORE INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'ticket.discount_code.reactivated',
        'discount_code', ?, ?, '{}', ?)`,
      `discount-code-reactivated:${operation.requestId}`,
      operation.actorUserId,
      operation.codeId,
      operation.requestId,
      occurredAt,
    );
  });
  const saved = discountCodeRows(storage).find(({ id }) => id === operation.codeId);
  return saved
    ? Response.json(discountCodeResult(saved))
    : Response.json({ code: "discount_code_not_found" }, { status: 404 });
}
