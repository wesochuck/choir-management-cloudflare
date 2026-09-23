import { ticketCheckoutQuoteSchema } from "@choir/contracts";
import {
  isSupportedPaidCheckoutAmount,
  isValidTicketDiscountValue,
  normalizeDiscountCode,
  ticketOrderQuote,
  ticketUnitPriceCents,
} from "@choir/domain";
import type { z } from "zod";

import { readTicketMessageTemplate } from "../ticketMessageTemplates";
import type {
  createFakeCheckoutOperationSchema,
  createPendingCheckoutOperationSchema,
  quoteTicketCheckoutOperationSchema,
} from "./contracts";
import {
  purchaseSelect,
  type IdentityRow,
  type TicketBundleRow,
  type TicketEventRow,
  type TicketPurchaseRow,
} from "./contracts";
import { transactionFeeSettingsFromStore } from "../transactionFeeSettingsStore";
import { resolveOrCreateContactForCommerce } from "../commerceContacts";
import {
  bundleEventIds,
  enrichPurchaseWithCurrentVenue,
  purchaseResult,
  readTicketEvent,
  redemptionReservationCount,
  ticketEventIsOpen,
} from "./readModel";

function purchaseByRequest(
  storage: DurableObjectStorage,
  checkoutRequestId: string,
): TicketPurchaseRow | undefined {
  return storage.sql
    .exec<TicketPurchaseRow>(
      `${purchaseSelect} WHERE checkout_request_id = ? LIMIT 1`,
      checkoutRequestId,
    )
    .toArray()
    .at(0);
}

function sameCheckoutRequest(
  existing: TicketPurchaseRow,
  checkout: z.infer<typeof createFakeCheckoutOperationSchema>["checkout"],
): boolean {
  return (
    existing.eventId === ("eventId" in checkout ? checkout.eventId : existing.eventId) &&
    existing.bundleId === ("bundleId" in checkout ? checkout.bundleId : null) &&
    existing.buyerName === checkout.buyerName &&
    existing.buyerEmail === checkout.buyerEmail.toLowerCase() &&
    existing.quantity === checkout.quantity &&
    existing.marketingOptIn === (checkout.marketingOptIn ? 1 : 0) &&
    existing.discountCode === normalizeDiscountCode(checkout.discountCode ?? "")
  );
}

function committedEventQuantity(
  storage: DurableObjectStorage,
  eventId: string,
  nowIso = new Date().toISOString(),
): number {
  return storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly quantity: number }>(
      `SELECT
        (SELECT COALESCE(SUM(quantity), 0) FROM ticket_purchases
         WHERE event_id = ? AND bundle_id IS NULL AND (
           status = 'paid' OR (status = 'pending' AND (expires_at IS NULL OR expires_at = '' OR expires_at >= ?))
         )) +
        (SELECT COALESCE(SUM(a.quantity), 0) FROM ticket_bundle_allocations a
         JOIN ticket_purchases p ON p.id = a.purchase_id
         WHERE a.event_id = ? AND (
           p.status = 'paid' OR (p.status = 'pending' AND (p.expires_at IS NULL OR p.expires_at = '' OR p.expires_at >= ?))
         )) AS quantity`,
      eventId,
      nowIso,
      eventId,
      nowIso,
    )
    .one().quantity;
}

interface CheckoutResolution {
  readonly bundleCapacity: number | null;
  readonly bundleId: string | null;
  readonly bundleTitle: string;
  readonly events: readonly (TicketEventRow & { readonly id: string })[];
  readonly unitPriceCents: number;
}

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

class DiscountCodeRejectedError extends Error {
  constructor() {
    super("This code is not valid for this purchase.");
    this.name = "DiscountCodeRejectedError";
  }
}

class CheckoutCapacityExceededError extends Error {
  constructor() {
    super("Ticket capacity was exceeded.");
    this.name = "CheckoutCapacityExceededError";
  }
}

// eslint-disable-next-line complexity -- validates one performance or bundle and its capacity.
function resolveCheckoutItem(
  storage: DurableObjectStorage,
  checkout:
    | z.infer<typeof createFakeCheckoutOperationSchema>["checkout"]
    | z.infer<typeof quoteTicketCheckoutOperationSchema>["checkout"],
  organization: IdentityRow,
  now: Date,
  checkCapacity: boolean,
): CheckoutResolution | Response {
  let bundleId: string | null = null;
  let bundleCapacity: number | null = null;
  let bundleTitle = "";
  let events: readonly (TicketEventRow & { readonly id: string })[];
  let unitPriceCents: number;
  if ("bundleId" in checkout && checkout.bundleId) {
    const bundle = storage.sql
      .exec<TicketBundleRow>(
        `SELECT id, title, price_cents AS priceCents, capacity,
          sale_end_at AS saleEndAt, is_active AS isActive,
          created_at AS createdAt, updated_at AS updatedAt
         FROM ticket_bundles WHERE id = ? LIMIT 1`,
        checkout.bundleId,
      )
      .toArray()
      .at(0);
    const eventIds = bundle ? bundleEventIds(storage, bundle.id) : [];
    events = eventIds
      .map((id) => {
        const event = readTicketEvent(storage, id);
        return event ? { ...event, id } : null;
      })
      .filter((event): event is TicketEventRow & { readonly id: string } => event !== null);
    if (
      bundle?.isActive !== 1 ||
      new Date(bundle.saleEndAt).getTime() <= now.getTime() ||
      events.length !== eventIds.length ||
      events.length === 0 ||
      events.some((event) => !ticketEventIsOpen(event, now))
    ) {
      return Response.json({ code: "ticket_sales_closed" }, { status: 409 });
    }
    const bundleReservedQuantity = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly quantity: number }>(
        `SELECT COALESCE(SUM(quantity), 0) AS quantity FROM ticket_purchases
         WHERE bundle_id = ? AND status IN ('pending', 'paid')`,
        bundle.id,
      )
      .one().quantity;
    const bundleCapacityExceeded =
      bundle.capacity !== null && bundleReservedQuantity + checkout.quantity > bundle.capacity;
    const eventCapacityExceeded = events.some(
      (event) =>
        event.ticketCapacity !== null &&
        committedEventQuantity(storage, event.id) + checkout.quantity > event.ticketCapacity,
    );
    if (checkCapacity && (bundleCapacityExceeded || eventCapacityExceeded)) {
      return Response.json({ code: "ticket_capacity_exceeded" }, { status: 409 });
    }
    bundleId = bundle.id;
    bundleCapacity = bundle.capacity;
    bundleTitle = bundle.title;
    unitPriceCents = bundle.priceCents;
  } else {
    const eventId = "eventId" in checkout ? checkout.eventId : null;
    if (!eventId) return Response.json({ code: "ticket_sales_closed" }, { status: 409 });
    const event = eventId ? readTicketEvent(storage, eventId) : undefined;
    if (!ticketEventIsOpen(event, now)) {
      return Response.json({ code: "ticket_sales_closed" }, { status: 409 });
    }
    if (
      checkCapacity &&
      event.ticketCapacity !== null &&
      committedEventQuantity(storage, eventId) + checkout.quantity > event.ticketCapacity
    ) {
      return Response.json({ code: "ticket_capacity_exceeded" }, { status: 409 });
    }
    events = [{ ...event, id: eventId }];
    unitPriceCents = ticketUnitPriceCents({
      advancePriceCents: event.advancePriceCents,
      dayOfPriceCents: event.dayOfPriceCents,
      now,
      startsAt: event.startsAt,
      timezone: organization.timezone,
    });
  }
  return { bundleCapacity, bundleId, bundleTitle, events, unitPriceCents };
}

function discountCodeDefinition(
  storage: DurableObjectStorage,
  normalizedCode: string,
  resolution: CheckoutResolution,
): DiscountCodeDefinition | undefined {
  return storage.sql
    .exec<DiscountCodeDefinition>(
      `SELECT id, display_code AS displayCode, item_type AS itemType,
        event_id AS eventId, bundle_id AS bundleId,
        discount_type AS discountType, discount_value AS discountValue,
        redemption_limit AS redemptionLimit, active
       FROM discount_codes
       WHERE normalized_code = ?
         AND ((item_type = 'performance' AND event_id = ?)
           OR (item_type = 'bundle' AND bundle_id = ?))
       LIMIT 1`,
      normalizedCode,
      resolution.bundleId ? null : (resolution.events[0]?.id ?? null),
      resolution.bundleId,
    )
    .toArray()
    .at(0);
}

function redeemableDiscountCode(
  storage: DurableObjectStorage,
  normalizedCode: string,
  resolution: CheckoutResolution,
): DiscountCodeDefinition | undefined {
  const code = discountCodeDefinition(storage, normalizedCode, resolution);
  if (!code) return undefined;
  if (code.active !== 1 || !isValidTicketDiscountValue(code.discountType, code.discountValue)) {
    return undefined;
  }
  if (
    code.redemptionLimit !== null &&
    redemptionReservationCount(storage, code.id) >= code.redemptionLimit
  ) {
    return undefined;
  }
  return code;
}

function checkoutQuote(
  storage: DurableObjectStorage,
  checkout:
    | z.infer<typeof createFakeCheckoutOperationSchema>["checkout"]
    | z.infer<typeof quoteTicketCheckoutOperationSchema>["checkout"],
  resolution: CheckoutResolution,
): z.infer<typeof ticketCheckoutQuoteSchema> {
  const requestedCode = normalizeDiscountCode(checkout.discountCode ?? "");
  const code = requestedCode
    ? redeemableDiscountCode(storage, requestedCode, resolution)
    : undefined;
  if (requestedCode && !code) throw new DiscountCodeRejectedError();
  const quote = ticketOrderQuote(
    {
      discountType: code?.discountType ?? "fixed",
      discountValue: code?.discountValue ?? 0,
      quantity: checkout.quantity,
      unitPriceCents: resolution.unitPriceCents,
    },
    transactionFeeSettingsFromStore(storage),
  );
  return ticketCheckoutQuoteSchema.parse({
    discountAmountCents: quote.discountAmountCents,
    discountCode: code?.displayCode ?? null,
    discountType: code?.discountType ?? null,
    discountValue: code?.discountValue ?? null,
    discountedSubtotalCents: quote.discountedSubtotalCents,
    feeCents: quote.feeCents,
    originalSubtotalCents: quote.originalSubtotalCents,
    originalUnitPriceCents: quote.unitPriceCents,
    quantity: quote.quantity,
    totalCents: quote.totalCents,
  });
}

function reserveDiscountCode(
  storage: DurableObjectStorage,
  normalizedCode: string,
  resolution: CheckoutResolution,
  checkoutRequestId: string,
  purchaseId: string,
  status: "pending" | "confirmed",
  occurredAt: string,
): DiscountCodeDefinition | undefined {
  if (!normalizedCode) return undefined;
  const code = redeemableDiscountCode(storage, normalizedCode, resolution);
  if (!code) throw new DiscountCodeRejectedError();
  storage.sql.exec(
    `INSERT INTO discount_code_redemptions
      (id, discount_code_id, checkout_request_id, purchase_id, status, created_at, updated_at,
       confirmed_at, released_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    crypto.randomUUID(),
    code.id,
    checkoutRequestId,
    purchaseId,
    status,
    occurredAt,
    occurredAt,
    status === "confirmed" ? occurredAt : null,
  );
  if (status === "confirmed") {
    storage.sql.exec(
      `UPDATE discount_codes SET first_redeemed_at = COALESCE(first_redeemed_at, ?), updated_at = ?
       WHERE id = ?`,
      occurredAt,
      occurredAt,
      code.id,
    );
  }
  return code;
}

// Checkout atomically coordinates idempotency, two product types, and shared event capacity.
// eslint-disable-next-line complexity
export function createFakeCheckout(
  storage: DurableObjectStorage,
  operation:
    | z.infer<typeof createFakeCheckoutOperationSchema>
    | z.infer<typeof createPendingCheckoutOperationSchema>,
  organization: IdentityRow,
): Response {
  const existing = purchaseByRequest(storage, operation.checkout.checkoutRequestId);
  if (existing) {
    return sameCheckoutRequest(existing, operation.checkout)
      ? Response.json(enrichPurchaseWithCurrentVenue(storage, purchaseResult(existing)))
      : Response.json({ code: "checkout_request_conflict" }, { status: 409 });
  }
  const now = new Date();
  const resolution = resolveCheckoutItem(storage, operation.checkout, organization, now, true);
  if (resolution instanceof Response) return resolution;
  let quote: z.infer<typeof ticketCheckoutQuoteSchema>;
  try {
    quote = checkoutQuote(storage, operation.checkout, resolution);
  } catch (error: unknown) {
    if (error instanceof DiscountCodeRejectedError) {
      return Response.json({ code: "discount_code_invalid" }, { status: 422 });
    }
    throw error;
  }
  // The final quote includes discounts and any configured processing fee. Reject
  // unsupported paid totals before capacity, redemption, purchase, payment, or
  // notification state can be reserved.
  if (!isSupportedPaidCheckoutAmount(quote.totalCents)) {
    return Response.json({ code: "ticket_checkout_amount_too_small" }, { status: 422 });
  }
  const pending = operation.action === "create_stripe_pending" && quote.totalCents > 0;
  const primaryEvent = resolution.events[0];
  if (!primaryEvent) return Response.json({ code: "ticket_sales_closed" }, { status: 409 });
  const normalizedCode = normalizeDiscountCode(operation.checkout.discountCode ?? "");
  const includedEvents = resolution.events.map((event) => ({
    id: event.id,
    startsAt: event.startsAt,
    title: event.title,
  }));
  const effectiveProviderSessionId =
    quote.totalCents === 0 ? `free_session_${operation.purchaseId}` : operation.providerSessionId;
  const providerPaymentId = pending
    ? ""
    : quote.totalCents === 0
      ? ""
      : `fake_payment_${operation.purchaseId}`;
  const status = pending ? "pending" : "paid";
  const occurredAt = now.toISOString();
  // Phase 8 commerce → Contact linkage: paid purchases resolve a Contact
  // before the insert transaction so contact creation never nests inside it.
  // Snapshots stay untouched; pending rows link at Stripe fulfillment.
  const purchaseContactId = pending
    ? null
    : resolveOrCreateContactForCommerce(storage, {
        buyerEmail: operation.checkout.buyerEmail,
        buyerName: operation.checkout.buyerName,
        existingContactId: null,
        marketingOptIn: operation.checkout.marketingOptIn,
        occurredAt,
        source: "ticket_purchase",
      });
  const confirmationId = crypto.randomUUID();
  const confirmationJobId = crypto.randomUUID();
  const notificationTemplate = readTicketMessageTemplate(
    storage,
    resolution.bundleId ? "bundle_confirmation" : "confirmation",
  );
  let reservedCode: DiscountCodeDefinition | undefined;
  try {
    // eslint-disable-next-line complexity -- atomically reserves capacity, redemption, payment, and audit rows.
    storage.transactionSync(() => {
      reservedCode = reserveDiscountCode(
        storage,
        normalizedCode,
        resolution,
        operation.checkout.checkoutRequestId,
        operation.purchaseId,
        pending ? "pending" : "confirmed",
        occurredAt,
      );
      for (const event of resolution.events) {
        if (
          event.ticketCapacity !== null &&
          committedEventQuantity(storage, event.id) + operation.checkout.quantity >
            event.ticketCapacity
        ) {
          throw new CheckoutCapacityExceededError();
        }
      }
      if (resolution.bundleId && resolution.bundleCapacity !== null) {
        const committedBundles = storage.sql
          .exec<{ readonly [column: string]: SqlStorageValue; readonly quantity: number }>(
            `SELECT COALESCE(SUM(quantity), 0) AS quantity FROM ticket_purchases
             WHERE bundle_id = ? AND (
               status = 'paid' OR (status = 'pending' AND (expires_at IS NULL OR expires_at = '' OR expires_at >= ?))
             )`,
            resolution.bundleId,
            occurredAt,
          )
          .one().quantity;
        if (committedBundles + operation.checkout.quantity > resolution.bundleCapacity) {
          throw new CheckoutCapacityExceededError();
        }
      }
      const expiresAt = pending
        ? new Date(new Date(occurredAt).getTime() + 30 * 60 * 1_000).toISOString()
        : null;
      storage.sql.exec(
        `INSERT INTO ticket_purchases
        (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
         bundle_id, bundle_title, included_events_json,
         buyer_name, buyer_email, quantity, unit_price_cents, fee_cents,
         amount_paid_cents, currency, provider_session_id, provider_payment_id,
         status, marketing_opt_in, created_at, updated_at, fulfilled_at,
         discount_code_id, discount_code, discount_type, discount_value,
         original_unit_price_cents, original_subtotal_cents, discount_amount_cents,
         discounted_subtotal_cents, contact_id, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usd', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        operation.purchaseId,
        operation.checkout.checkoutRequestId,
        primaryEvent.id,
        primaryEvent.title,
        primaryEvent.startsAt,
        organization.timezone,
        resolution.bundleId,
        resolution.bundleTitle,
        JSON.stringify(includedEvents),
        operation.checkout.buyerName,
        operation.checkout.buyerEmail.toLowerCase(),
        operation.checkout.quantity,
        resolution.unitPriceCents,
        quote.feeCents,
        quote.totalCents,
        effectiveProviderSessionId,
        providerPaymentId,
        status,
        operation.checkout.marketingOptIn ? 1 : 0,
        occurredAt,
        occurredAt,
        pending ? null : occurredAt,
        reservedCode?.id ?? null,
        quote.discountCode ?? "",
        quote.discountType ?? "",
        quote.discountValue ?? 0,
        quote.originalUnitPriceCents,
        quote.originalSubtotalCents,
        quote.discountAmountCents,
        quote.discountedSubtotalCents,
        purchaseContactId,
        expiresAt,
      );
      storage.sql.exec(
        `INSERT INTO payment_attempts
        (id, payment_type, resource_id, checkout_request_id, provider_session_id,
         provider_payment_id, status, amount_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `payment-attempt:${operation.purchaseId}`,
        resolution.bundleId ? "bundle" : "ticket",
        operation.purchaseId,
        operation.checkout.checkoutRequestId,
        effectiveProviderSessionId,
        providerPaymentId,
        status,
        quote.totalCents,
        occurredAt,
        occurredAt,
      );
      if (resolution.bundleId) {
        for (const event of resolution.events) {
          storage.sql.exec(
            `INSERT INTO ticket_bundle_allocations (purchase_id, event_id, quantity)
           VALUES (?, ?, ?)`,
            operation.purchaseId,
            event.id,
            operation.checkout.quantity,
          );
        }
      }
      if (!pending) {
        storage.sql.exec(
          `INSERT INTO ticket_notifications
          (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
           content_markdown, status, scheduled_for, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'confirmation', ?, ?, ?, 'queued', ?, ?, ?)`,
          confirmationId,
          operation.purchaseId,
          resolution.bundleId ? null : primaryEvent.id,
          `ticket-confirmation:${operation.purchaseId}`,
          operation.checkout.buyerEmail.toLowerCase(),
          notificationTemplate.subject,
          notificationTemplate.contentMarkdown,
          occurredAt,
          occurredAt,
          occurredAt,
        );
        storage.sql.exec(
          `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, 'ticket_notification', ?, ?, ?)`,
          confirmationJobId,
          `ticket-notification:${confirmationId}`,
          occurredAt,
          occurredAt,
        );
      }
      storage.sql.exec(
        `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'public_visitor', 'anonymous', ?,
        'ticket_purchase', ?, ?, ?, ?)`,
        `ticket-purchase:${operation.checkout.checkoutRequestId}`,
        pending ? "ticket.purchase.pending" : "ticket.purchase.fulfilled",
        operation.purchaseId,
        operation.checkout.checkoutRequestId,
        JSON.stringify({
          amountPaidCents: quote.totalCents,
          bundleId: resolution.bundleId,
          eventId: primaryEvent.id,
          quantity: operation.checkout.quantity,
        }),
        occurredAt,
      );
    });
  } catch (error: unknown) {
    if (error instanceof DiscountCodeRejectedError) {
      return Response.json({ code: "discount_code_invalid" }, { status: 422 });
    }
    if (error instanceof CheckoutCapacityExceededError) {
      return Response.json({ code: "ticket_capacity_exceeded" }, { status: 409 });
    }
    throw error;
  }
  const created = purchaseByRequest(storage, operation.checkout.checkoutRequestId);
  return created
    ? Response.json(enrichPurchaseWithCurrentVenue(storage, purchaseResult(created)), {
        status: 201,
      })
    : Response.json({ code: "ticket_purchase_not_created" }, { status: 503 });
}

export function quoteTicketCheckout(
  storage: DurableObjectStorage,
  operation: z.infer<typeof quoteTicketCheckoutOperationSchema>,
  organization: IdentityRow,
): Response {
  const resolution = resolveCheckoutItem(
    storage,
    operation.checkout,
    organization,
    new Date(),
    true,
  );
  if (resolution instanceof Response) return resolution;
  try {
    return Response.json(checkoutQuote(storage, operation.checkout, resolution));
  } catch (error: unknown) {
    if (error instanceof DiscountCodeRejectedError) {
      return Response.json({ code: "discount_code_invalid" }, { status: 422 });
    }
    throw error;
  }
}
