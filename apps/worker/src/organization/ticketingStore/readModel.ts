import { discountCodeSchema, ticketBundleSchema } from "@choir/contracts";
import { z } from "zod";

import {
  type DiscountCodeRow,
  type IdentityRow,
  type TicketBundleRow,
  type TicketEventRow,
  type TicketPurchaseRow,
} from "./contracts";

export function identity(storage: DurableObjectStorage): IdentityRow | undefined {
  return storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId, timezone FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
}

// eslint-disable-next-line complexity -- maps the immutable checkout snapshot to public/admin DTOs.
export function purchaseResult(row: TicketPurchaseRow) {
  const parsedIncludedEvents = (() => {
    try {
      const value: unknown = JSON.parse(row.includedEventsJson);
      return z
        .array(
          z.object({
            id: z.uuid(),
            location: z.string().default(""),
            startsAt: z.iso.datetime(),
            title: z.string().min(1).max(500),
            venueAddress: z.string().default(""),
            venueName: z.string().default(""),
          }),
        )
        .max(100)
        .parse(value);
    } catch {
      return [];
    }
  })();
  const includedEvents =
    parsedIncludedEvents.length > 0
      ? parsedIncludedEvents
      : [
          {
            id: row.eventId,
            location: "",
            startsAt: row.eventStartsAt,
            title: row.eventTitle,
            venueAddress: "",
            venueName: "",
          },
        ];
  const hasDiscountSnapshot = row.discountCode.trim().length > 0;
  const originalUnitPriceCents =
    row.originalUnitPriceCents > 0 || row.unitPriceCents === 0
      ? row.originalUnitPriceCents || row.unitPriceCents
      : row.unitPriceCents;
  const originalSubtotalCents =
    row.originalSubtotalCents > 0 || originalUnitPriceCents === 0
      ? row.originalSubtotalCents || originalUnitPriceCents * row.quantity
      : originalUnitPriceCents * row.quantity;
  const discountedSubtotalCents =
    row.discountedSubtotalCents > 0 || row.amountPaidCents - row.feeCents === 0
      ? row.discountedSubtotalCents || Math.max(0, row.amountPaidCents - row.feeCents)
      : Math.max(0, row.amountPaidCents - row.feeCents);
  return {
    amountPaidCents: row.amountPaidCents,
    buyerEmail: row.buyerEmail,
    buyerName: row.buyerName,
    bundleId: row.bundleId,
    bundleTitle: row.bundleTitle,
    checkoutMode: row.providerSessionId.startsWith("free_session_")
      ? "free"
      : row.providerSessionId.startsWith("fake_session_")
        ? "fake"
        : "stripe",
    currency: row.currency,
    createdAt: row.createdAt,
    discountAmountCents: hasDiscountSnapshot
      ? row.discountAmountCents
      : Math.max(0, originalSubtotalCents - discountedSubtotalCents),
    discountCode: hasDiscountSnapshot ? row.discountCode : null,
    discountType: hasDiscountSnapshot ? row.discountType : null,
    discountValue: hasDiscountSnapshot ? row.discountValue : null,
    discountedSubtotalCents,
    eventId: row.eventId,
    eventStartsAt: row.eventStartsAt,
    eventTitle: row.eventTitle,
    feeCents: row.feeCents,
    id: row.id,
    includedEvents,
    location: "",
    marketingOptIn: row.marketingOptIn === 1,
    originalSubtotalCents,
    originalUnitPriceCents,
    processorFeeCents: row.processorFeeCents ?? null,
    processorFeeReconciledAt: row.processorFeeReconciledAt ?? null,
    providerBalanceTransactionId: row.providerBalanceTransactionId ?? null,
    providerPaymentId: row.providerPaymentId,
    providerSessionId: row.providerSessionId,
    quantity: row.quantity,
    refundRequested: row.refundRequested === 1,
    refundedAt: row.refundedAt,
    status: row.status,
    timezone: row.timezone,
    unitPriceCents: row.unitPriceCents,
    updatedAt: row.updatedAt,
    venueAddress: "",
    venueName: "",
  };
}

export function enrichPurchaseWithCurrentVenue<T extends ReturnType<typeof purchaseResult>>(
  storage: DurableObjectStorage,
  purchase: T,
): T {
  const eventIds = [
    ...new Set(
      [purchase.eventId, ...purchase.includedEvents.map((event) => event.id)].filter(Boolean),
    ),
  ];
  if (eventIds.length === 0) return purchase;

  const placeholders = eventIds.map(() => "?").join(", ");
  const rows = storage.sql
    .exec<{
      readonly id: string;
      readonly location: string;
      readonly venueAddress: string;
      readonly venueName: string;
    }>(
      `SELECT e.id, e.location,
              COALESCE(v.name, '') AS venueName,
              COALESCE(v.address, '') AS venueAddress
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.id IN (${placeholders})`,
      ...eventIds,
    )
    .toArray();

  const venuesById = new Map(rows.map((row) => [row.id, row]));
  const primaryVenue = venuesById.get(purchase.eventId);

  const includedEvents = purchase.includedEvents.map((event) => {
    const venue = venuesById.get(event.id);
    return {
      ...event,
      location: venue?.location ?? event.location,
      venueAddress: venue?.venueAddress ?? event.venueAddress,
      venueName: venue?.venueName ?? event.venueName,
    };
  });

  return {
    ...purchase,
    includedEvents,
    location: primaryVenue?.location ?? purchase.location,
    venueAddress: primaryVenue?.venueAddress ?? purchase.venueAddress,
    venueName: primaryVenue?.venueName ?? purchase.venueName,
  };
}

export function bundleEventIds(storage: DurableObjectStorage, bundleId: string): string[] {
  return storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly eventId: string }>(
      `SELECT event_id AS eventId FROM ticket_bundle_events
       WHERE bundle_id = ? ORDER BY sort_order, event_id`,
      bundleId,
    )
    .toArray()
    .map(({ eventId }) => eventId);
}

export function bundleResult(storage: DurableObjectStorage, row: TicketBundleRow) {
  return ticketBundleSchema.parse({
    ...row,
    eventIds: bundleEventIds(storage, row.id),
    isActive: row.isActive === 1,
  });
}

export function discountCodeRows(storage: DurableObjectStorage): DiscountCodeRow[] {
  return storage.sql
    .exec<DiscountCodeRow>(
      `SELECT c.id, c.display_code AS code, c.item_type AS itemType,
        c.event_id AS eventId, c.bundle_id AS bundleId,
        c.discount_type AS discountType, c.discount_value AS discountValue,
        c.redemption_limit AS redemptionLimit, c.active,
        c.first_redeemed_at AS firstRedeemedAt, c.deactivated_at AS deactivatedAt,
        c.created_at AS createdAt, c.updated_at AS updatedAt,
        COALESCE(e.title, b.title, '') AS itemTitle,
        COALESCE((SELECT COUNT(*) FROM discount_code_redemptions r
          WHERE r.discount_code_id = c.id AND r.status = 'confirmed'), 0) AS redemptionCount,
        COALESCE((SELECT COUNT(*) FROM discount_code_redemptions r
          WHERE r.discount_code_id = c.id AND r.status = 'pending'), 0) AS pendingReservationCount,
        COALESCE((SELECT SUM(p.original_subtotal_cents)
          FROM discount_code_redemptions r JOIN ticket_purchases p ON p.id = r.purchase_id
          WHERE r.discount_code_id = c.id AND r.status = 'confirmed' AND p.status = 'paid'), 0)
          AS originalRevenueCents,
        COALESCE((SELECT SUM(p.discount_amount_cents)
          FROM discount_code_redemptions r JOIN ticket_purchases p ON p.id = r.purchase_id
          WHERE r.discount_code_id = c.id AND r.status = 'confirmed' AND p.status = 'paid'), 0)
          AS discountAmountCents,
        COALESCE((SELECT SUM(p.amount_paid_cents)
          FROM discount_code_redemptions r JOIN ticket_purchases p ON p.id = r.purchase_id
          WHERE r.discount_code_id = c.id AND r.status = 'confirmed' AND p.status = 'paid'), 0)
          AS revenueCents
       FROM discount_codes c
       LEFT JOIN events e ON e.id = c.event_id
       LEFT JOIN ticket_bundles b ON b.id = c.bundle_id
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT 500`,
    )
    .toArray();
}

export function discountCodeResult(row: DiscountCodeRow) {
  return discountCodeSchema.parse({
    ...row,
    active: row.active === 1,
    editable: row.redemptionCount === 0,
    itemType: row.itemType,
  });
}

export function readTicketEvent(
  storage: DurableObjectStorage,
  eventId: string,
): TicketEventRow | undefined {
  return storage.sql
    .exec<TicketEventRow>(
      `SELECT title, type, starts_at AS startsAt, is_archived AS isArchived,
        is_canceled AS isCanceled,
        publish_on_website AS publishOnWebsite, is_ticketing_enabled AS isTicketingEnabled,
        advance_price_cents AS advancePriceCents, day_of_price_cents AS dayOfPriceCents,
        ticket_capacity AS ticketCapacity
       FROM events WHERE id = ? LIMIT 1`,
      eventId,
    )
    .toArray()
    .at(0);
}

export function ticketEventIsOpen(
  event: TicketEventRow | undefined,
  now: Date,
): event is TicketEventRow {
  return (
    event?.type === "Performance" &&
    event.isArchived === 0 &&
    event.isCanceled === 0 &&
    event.isTicketingEnabled === 1 &&
    new Date(event.startsAt).getTime() > now.getTime()
  );
}

export function redemptionReservationCount(storage: DurableObjectStorage, codeId: string): number {
  return storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
      `SELECT COUNT(*) AS count FROM discount_code_redemptions
       WHERE discount_code_id = ? AND status IN ('pending', 'confirmed')`,
      codeId,
    )
    .one().count;
}
