import type { z } from "zod";

import type { deleteBundleOperationSchema, upsertBundleOperationSchema } from "./contracts";
import { type TicketBundleRow } from "./contracts";
import { bundleResult, readTicketEvent } from "./readModel";

export function upsertTicketBundle(
  storage: DurableObjectStorage,
  operation: z.infer<typeof upsertBundleOperationSchema>,
): Response {
  if (new Set(operation.bundle.eventIds).size !== operation.bundle.eventIds.length) {
    return Response.json({ code: "ticket_bundle_events_invalid" }, { status: 409 });
  }
  const validEventCount = operation.bundle.eventIds.reduce((count, eventId) => {
    const event = readTicketEvent(storage, eventId);
    return (
      count +
      (event?.type === "Performance" && event.isArchived === 0 && event.isCanceled === 0 ? 1 : 0)
    );
  }, 0);
  if (validEventCount !== operation.bundle.eventIds.length) {
    return Response.json({ code: "ticket_bundle_events_invalid" }, { status: 409 });
  }
  const committed = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly quantity: number }>(
      `SELECT COALESCE(SUM(quantity), 0) AS quantity FROM ticket_purchases
       WHERE bundle_id = ? AND status IN ('pending', 'paid')`,
      operation.bundleId,
    )
    .one().quantity;
  if (operation.bundle.capacity !== null && operation.bundle.capacity < committed) {
    return Response.json({ code: "ticket_bundle_capacity_committed" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO ticket_bundles
        (id, title, price_cents, capacity, sale_end_at, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, price_cents = excluded.price_cents,
        capacity = excluded.capacity, sale_end_at = excluded.sale_end_at,
        is_active = excluded.is_active, updated_at = excluded.updated_at`,
      operation.bundleId,
      operation.bundle.title,
      operation.bundle.priceCents,
      operation.bundle.capacity,
      operation.bundle.saleEndAt,
      operation.bundle.isActive ? 1 : 0,
      occurredAt,
      occurredAt,
    );
    storage.sql.exec("DELETE FROM ticket_bundle_events WHERE bundle_id = ?", operation.bundleId);
    operation.bundle.eventIds.forEach((eventId, index) => {
      storage.sql.exec(
        `INSERT INTO ticket_bundle_events (bundle_id, event_id, sort_order) VALUES (?, ?, ?)`,
        operation.bundleId,
        eventId,
        index,
      );
    });
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'ticket.bundle.saved',
        'ticket_bundle', ?, ?, ?, ?)`,
      `ticket-bundle-saved:${operation.requestId}`,
      operation.actorUserId,
      operation.bundleId,
      operation.requestId,
      JSON.stringify({ eventIds: operation.bundle.eventIds, isActive: operation.bundle.isActive }),
      occurredAt,
    );
  });
  const row = storage.sql
    .exec<TicketBundleRow>(
      `SELECT id, title, price_cents AS priceCents, capacity,
        sale_end_at AS saleEndAt, is_active AS isActive,
        created_at AS createdAt, updated_at AS updatedAt
       FROM ticket_bundles WHERE id = ?`,
      operation.bundleId,
    )
    .one();
  return Response.json(bundleResult(storage, row));
}

export function deleteTicketBundle(
  storage: DurableObjectStorage,
  operation: z.infer<typeof deleteBundleOperationSchema>,
): Response {
  const purchases = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      "SELECT COUNT(*) AS count FROM ticket_purchases WHERE bundle_id = ?",
      operation.bundleId,
    )
    .one().count;
  if (purchases > 0) {
    return Response.json({ code: "ticket_bundle_has_orders" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  const existing = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM ticket_bundles WHERE id = ?",
      operation.bundleId,
    )
    .toArray()
    .at(0);
  if (!existing) return Response.json({ code: "ticket_bundle_not_found" }, { status: 404 });
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM ticket_bundle_events WHERE bundle_id = ?", operation.bundleId);
    storage.sql.exec("DELETE FROM ticket_bundles WHERE id = ?", operation.bundleId);
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'ticket.bundle.deleted',
        'ticket_bundle', ?, ?, '{}', ?)`,
      `ticket-bundle-deleted:${operation.requestId}`,
      operation.actorUserId,
      operation.bundleId,
      operation.requestId,
      occurredAt,
    );
  });
  return Response.json({ deleted: true });
}
