import { publicTicketDiscountAvailabilityRequestSchema } from "@choir/contracts";
import { isValidTicketDiscountValue } from "@choir/domain";
import { z } from "zod";

import {
  purchaseSelect,
  type TicketBundleRow,
  type TicketPurchaseRow,
} from "../ticketingStore/contracts";
import {
  bundleResult,
  bundleEventIds,
  discountCodeResult,
  discountCodeRows,
  identity,
  purchaseResult,
  readTicketEvent,
  redemptionReservationCount,
  ticketEventIsOpen,
} from "./readModel";

interface DiscountCodeDefinition {
  readonly [column: string]: SqlStorageValue;
  readonly active: number;
  readonly bundleId: string | null;
  readonly displayCode: string;
  readonly discountType: "fixed" | "percentage";
  readonly discountValue: number;
  readonly eventId: string | null;
  readonly id: string;
  readonly redemptionLimit: number | null;
}

export function listDiscountCodesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (identity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({
    codes: discountCodeRows(storage).map(discountCodeResult),
  });
}

// eslint-disable-next-line complexity -- evaluates item availability and redeemable-code limits.
export function readPublicDiscountAvailabilityFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  target: unknown,
): Response {
  if (identity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const parsedTarget = publicTicketDiscountAvailabilityRequestSchema.safeParse(target);
  if (!parsedTarget.success) return Response.json({ code: "validation_failed" }, { status: 400 });
  const now = new Date();
  if (parsedTarget.data.eventId) {
    const event = readTicketEvent(storage, parsedTarget.data.eventId);
    if (!ticketEventIsOpen(event, now)) return Response.json({ hasRedeemableCode: false });
  } else if (parsedTarget.data.bundleId) {
    const bundle = storage.sql
      .exec<TicketBundleRow>(
        `SELECT id, title, price_cents AS priceCents, capacity,
          sale_end_at AS saleEndAt, is_active AS isActive,
          created_at AS createdAt, updated_at AS updatedAt
         FROM ticket_bundles WHERE id = ? LIMIT 1`,
        parsedTarget.data.bundleId,
      )
      .toArray()
      .at(0);
    const eventIds = bundle ? bundleEventIds(storage, bundle.id) : [];
    if (!bundle) return Response.json({ hasRedeemableCode: false });
    if (
      bundle.isActive !== 1 ||
      new Date(bundle.saleEndAt).getTime() <= now.getTime() ||
      eventIds.length === 0 ||
      eventIds.some((eventId) => !ticketEventIsOpen(readTicketEvent(storage, eventId), now))
    ) {
      return Response.json({ hasRedeemableCode: false });
    }
  }
  const itemType = parsedTarget.data.eventId ? "performance" : "bundle";
  const itemId = parsedTarget.data.eventId ?? parsedTarget.data.bundleId;
  const codes = storage.sql
    .exec<DiscountCodeDefinition>(
      `SELECT id, display_code AS displayCode, item_type AS itemType,
        event_id AS eventId, bundle_id AS bundleId,
        discount_type AS discountType, discount_value AS discountValue,
        redemption_limit AS redemptionLimit, active
       FROM discount_codes
       WHERE active = 1 AND item_type = ? AND ${itemType === "performance" ? "event_id" : "bundle_id"} = ?`,
      itemType,
      itemId,
    )
    .toArray();
  return Response.json({
    hasRedeemableCode: codes.some(
      (code) =>
        isValidTicketDiscountValue(code.discountType, code.discountValue) &&
        (code.redemptionLimit === null ||
          redemptionReservationCount(storage, code.id) < code.redemptionLimit),
    ),
  });
}

export function listTicketOrdersFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (identity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({
    orders: storage.sql
      .exec<TicketPurchaseRow>(`${purchaseSelect} ORDER BY created_at DESC, id DESC LIMIT 500`)
      .toArray()
      .map(purchaseResult),
  });
}

export function listTicketBundlesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (identity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({
    bundles: storage.sql
      .exec<TicketBundleRow>(
        `SELECT id, title, price_cents AS priceCents, capacity,
          sale_end_at AS saleEndAt, is_active AS isActive,
          created_at AS createdAt, updated_at AS updatedAt
         FROM ticket_bundles ORDER BY created_at DESC, id DESC LIMIT 100`,
      )
      .toArray()
      .map((row) => bundleResult(storage, row)),
  });
}

export function readTicketPurchaseFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  purchaseId: string | null,
): Response {
  const parsedPurchaseId = z.uuid().safeParse(purchaseId);
  if (identity(storage)?.organizationId !== organizationId || !parsedPurchaseId.success) {
    return Response.json({ code: "ticket_purchase_not_found" }, { status: 404 });
  }
  const row = storage.sql
    .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, parsedPurchaseId.data)
    .toArray()
    .at(0);
  return row
    ? Response.json(purchaseResult(row))
    : Response.json({ code: "ticket_purchase_not_found" }, { status: 404 });
}

export function readTicketWillCallFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  eventId: string | null,
): Response {
  const parsedEventId = z.uuid().safeParse(eventId);
  if (identity(storage)?.organizationId !== organizationId || !parsedEventId.success) {
    return Response.json({ code: "ticket_event_not_found" }, { status: 404 });
  }
  const event = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly title: string }>(
      "SELECT title FROM events WHERE id = ? LIMIT 1",
      parsedEventId.data,
    )
    .toArray()
    .at(0);
  if (!event) return Response.json({ code: "ticket_event_not_found" }, { status: 404 });
  return Response.json({
    eventTitle: event.title,
    rows: storage.sql
      .exec<TicketPurchaseRow>(
        `${purchaseSelect} WHERE status = 'paid' AND
          ((bundle_id IS NULL AND event_id = ?) OR id IN
            (SELECT purchase_id FROM ticket_bundle_allocations WHERE event_id = ?))
         ORDER BY created_at, id`,
        parsedEventId.data,
        parsedEventId.data,
      )
      .toArray()
      .map(purchaseResult),
  });
}

export function readTicketNotificationJobFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  jobId: string | null,
): Response {
  const parsedJobId = z.uuid().safeParse(jobId);
  if (identity(storage)?.organizationId !== organizationId || !parsedJobId.success) {
    return Response.json({ code: "ticket_notification_not_found" }, { status: 404 });
  }
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'ticket_notification' LIMIT 1`,
      parsedJobId.data,
    )
    .toArray()
    .at(0);
  const notificationId = job?.idempotencyKey.split(":")[1];
  if (!notificationId) {
    return Response.json({ code: "ticket_notification_not_found" }, { status: 404 });
  }
  const row = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly amountPaidCents: number;
      readonly buyerName: string;
      readonly bundleTitle: string | null;
      readonly contentMarkdown: string;
      readonly currency: string;
      readonly destination: string;
      readonly discountAmountCents: number;
      readonly discountCode: string | null;
      readonly discountedSubtotalCents: number;
      readonly eventStartsAt: string;
      readonly eventTitle: string;
      readonly feeCents: number;
      readonly id: string;
      readonly kind: "confirmation" | "reminder";
      readonly purchaseId: string;
      readonly quantity: number;
      readonly originalSubtotalCents: number;
      readonly status: string;
      readonly subject: string;
      readonly timezone: string;
      readonly providerEventAt: string | null;
      readonly providerMessageId: string | null;
      readonly providerReason: string;
      readonly providerStatus: string | null;
    }>(
      `SELECT n.id, n.purchase_id AS purchaseId, n.kind, n.destination, n.subject,
        n.content_markdown AS contentMarkdown, n.status, p.buyer_name AS buyerName,
        n.provider_event_at AS providerEventAt, n.provider_message_id AS providerMessageId,
        n.provider_reason AS providerReason, n.provider_status AS providerStatus,
        COALESCE(e.title, p.event_title) AS eventTitle,
        p.quantity, p.amount_paid_cents AS amountPaidCents,
        p.original_subtotal_cents AS originalSubtotalCents,
        p.discount_code AS discountCode,
        p.discount_amount_cents AS discountAmountCents,
        p.discounted_subtotal_cents AS discountedSubtotalCents,
        p.fee_cents AS feeCents,
        p.currency, p.bundle_title AS bundleTitle, p.event_timezone AS timezone,
        COALESCE(e.starts_at,
          (SELECT MAX(bundle_event.starts_at)
           FROM ticket_bundle_allocations allocation
           JOIN events bundle_event ON bundle_event.id = allocation.event_id
           WHERE allocation.purchase_id = p.id),
          p.event_starts_at) AS eventStartsAt
       FROM ticket_notifications n
       JOIN ticket_purchases p ON p.id = n.purchase_id
       LEFT JOIN events e ON e.id = n.event_id
       WHERE n.id = ? LIMIT 1`,
      notificationId,
    )
    .toArray()
    .at(0);
  if (!row || !["queued", "processing"].includes(row.status)) {
    return Response.json({ code: "ticket_notification_not_found" }, { status: 404 });
  }
  storage.sql.exec(
    "UPDATE ticket_notifications SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'queued'",
    new Date().toISOString(),
    row.id,
  );
  return Response.json(row);
}
