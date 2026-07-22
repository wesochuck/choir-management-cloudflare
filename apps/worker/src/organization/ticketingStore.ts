import {
  ticketBundleRequestSchema,
  ticketBundleSchema,
  ticketCheckoutRequestSchema,
  ticketScanResultSchema,
} from "@choir/contracts";
import { ticketProcessingFeeCents, ticketUnitPriceCents } from "@choir/domain";
import { z } from "zod";

const organizationContextSchema = z.object({
  organizationId: z.string().min(1).max(128),
});

const createCheckoutOperationSchema = organizationContextSchema.extend({
  action: z.literal("create_fake_checkout"),
  checkout: ticketCheckoutRequestSchema,
  purchaseId: z.uuid(),
  providerSessionId: z.string().min(1).max(256),
});

const refundOperationSchema = organizationContextSchema.extend({
  action: z.literal("refund_fake_purchase"),
  actorUserId: z.string().min(1).max(128),
  purchaseId: z.uuid(),
  requestId: z.uuid(),
});

const validateScanOperationSchema = organizationContextSchema.extend({
  action: z.literal("validate_ticket_scan"),
  actorUserId: z.string().min(1).max(128),
  eventId: z.uuid(),
  purchaseId: z.uuid(),
  requestId: z.uuid(),
});

const bundleActorSchema = organizationContextSchema.extend({
  actorUserId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

const upsertBundleOperationSchema = bundleActorSchema.extend({
  action: z.literal("upsert_ticket_bundle"),
  bundle: ticketBundleRequestSchema,
  bundleId: z.uuid(),
});

const deleteBundleOperationSchema = bundleActorSchema.extend({
  action: z.literal("delete_ticket_bundle"),
  bundleId: z.uuid(),
});

const ticketNotificationResultOperationSchema = organizationContextSchema.extend({
  action: z.literal("record_ticket_notification_result"),
  failureDetail: z.string().max(2_000),
  jobId: z.uuid(),
  providerMessageId: z.string().max(512).nullable(),
  status: z.enum(["failed", "sent", "suppressed"]),
});

const resendConfirmationOperationSchema = bundleActorSchema.extend({
  action: z.literal("resend_ticket_confirmation"),
  purchaseId: z.uuid(),
});

const operationSchema = z.discriminatedUnion("action", [
  createCheckoutOperationSchema,
  refundOperationSchema,
  validateScanOperationSchema,
  upsertBundleOperationSchema,
  deleteBundleOperationSchema,
  ticketNotificationResultOperationSchema,
  resendConfirmationOperationSchema,
]);

interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
  readonly timezone: string;
}

interface TicketEventRow {
  readonly [column: string]: SqlStorageValue;
  readonly advancePriceCents: number;
  readonly dayOfPriceCents: number;
  readonly isArchived: number;
  readonly isTicketingEnabled: number;
  readonly publishOnWebsite: number;
  readonly startsAt: string;
  readonly ticketCapacity: number | null;
  readonly title: string;
  readonly type: string;
}

interface TicketPurchaseRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountPaidCents: number;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly bundleId: string | null;
  readonly bundleTitle: string;
  readonly createdAt: string;
  readonly currency: "usd";
  readonly eventId: string;
  readonly eventStartsAt: string;
  readonly eventTitle: string;
  readonly feeCents: number;
  readonly id: string;
  readonly includedEventsJson: string;
  readonly marketingOptIn: number;
  readonly providerPaymentId: string;
  readonly providerSessionId: string;
  readonly quantity: number;
  readonly status: "expired" | "paid" | "pending" | "refunded";
  readonly timezone: string;
  readonly unitPriceCents: number;
  readonly updatedAt: string;
}

interface TicketBundleRow {
  readonly [column: string]: SqlStorageValue;
  readonly capacity: number | null;
  readonly createdAt: string;
  readonly id: string;
  readonly isActive: number;
  readonly priceCents: number;
  readonly saleEndAt: string;
  readonly title: string;
  readonly updatedAt: string;
}

const purchaseSelect = `SELECT id, event_id AS eventId, event_title AS eventTitle,
  event_starts_at AS eventStartsAt, event_timezone AS timezone,
  bundle_id AS bundleId, bundle_title AS bundleTitle,
  included_events_json AS includedEventsJson,
  buyer_name AS buyerName, buyer_email AS buyerEmail,
  quantity, unit_price_cents AS unitPriceCents, fee_cents AS feeCents,
  amount_paid_cents AS amountPaidCents, currency,
  provider_session_id AS providerSessionId, provider_payment_id AS providerPaymentId,
  status, marketing_opt_in AS marketingOptIn, created_at AS createdAt, updated_at AS updatedAt
  FROM ticket_purchases`;

function identity(storage: DurableObjectStorage): IdentityRow | undefined {
  return storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId, timezone FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
}

function purchaseResult(row: TicketPurchaseRow) {
  const parsedIncludedEvents = (() => {
    try {
      const value: unknown = JSON.parse(row.includedEventsJson);
      return z
        .array(
          z.object({ id: z.uuid(), startsAt: z.iso.datetime(), title: z.string().min(1).max(500) }),
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
      : [{ id: row.eventId, startsAt: row.eventStartsAt, title: row.eventTitle }];
  return {
    ...row,
    includedEvents,
    checkoutMode: row.providerSessionId.startsWith("fake_session_") ? "fake" : "stripe",
    marketingOptIn: row.marketingOptIn === 1,
  };
}

function bundleEventIds(storage: DurableObjectStorage, bundleId: string): string[] {
  return storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly eventId: string }>(
      `SELECT event_id AS eventId FROM ticket_bundle_events
       WHERE bundle_id = ? ORDER BY sort_order, event_id`,
      bundleId,
    )
    .toArray()
    .map(({ eventId }) => eventId);
}

function bundleResult(storage: DurableObjectStorage, row: TicketBundleRow) {
  return ticketBundleSchema.parse({
    ...row,
    eventIds: bundleEventIds(storage, row.id),
    isActive: row.isActive === 1,
  });
}

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
  checkout: z.infer<typeof createCheckoutOperationSchema>["checkout"],
): boolean {
  return (
    existing.eventId === ("eventId" in checkout ? checkout.eventId : existing.eventId) &&
    existing.bundleId === ("bundleId" in checkout ? checkout.bundleId : null) &&
    existing.buyerName === checkout.buyerName &&
    existing.buyerEmail === checkout.buyerEmail.toLowerCase() &&
    existing.quantity === checkout.quantity &&
    existing.marketingOptIn === (checkout.marketingOptIn ? 1 : 0)
  );
}

function committedEventQuantity(storage: DurableObjectStorage, eventId: string): number {
  return storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly quantity: number }>(
      `SELECT
        (SELECT COALESCE(SUM(quantity), 0) FROM ticket_purchases
         WHERE event_id = ? AND bundle_id IS NULL AND status IN ('pending', 'paid')) +
        (SELECT COALESCE(SUM(a.quantity), 0) FROM ticket_bundle_allocations a
         JOIN ticket_purchases p ON p.id = a.purchase_id
         WHERE a.event_id = ? AND p.status IN ('pending', 'paid')) AS quantity`,
      eventId,
      eventId,
    )
    .one().quantity;
}

function ticketEventIsOpen(event: TicketEventRow | undefined, now: Date): event is TicketEventRow {
  return (
    event?.type === "Performance" &&
    event.isArchived === 0 &&
    event.publishOnWebsite === 1 &&
    event.isTicketingEnabled === 1 &&
    new Date(event.startsAt).getTime() > now.getTime()
  );
}

function readTicketEvent(
  storage: DurableObjectStorage,
  eventId: string,
): TicketEventRow | undefined {
  return storage.sql
    .exec<TicketEventRow>(
      `SELECT title, type, starts_at AS startsAt, is_archived AS isArchived,
        publish_on_website AS publishOnWebsite, is_ticketing_enabled AS isTicketingEnabled,
        advance_price_cents AS advancePriceCents, day_of_price_cents AS dayOfPriceCents,
        ticket_capacity AS ticketCapacity
       FROM events WHERE id = ? LIMIT 1`,
      eventId,
    )
    .toArray()
    .at(0);
}

// Checkout atomically coordinates idempotency, two product types, and shared event capacity.
// eslint-disable-next-line complexity
function createFakeCheckout(
  storage: DurableObjectStorage,
  operation: z.infer<typeof createCheckoutOperationSchema>,
  organization: IdentityRow,
): Response {
  const existing = purchaseByRequest(storage, operation.checkout.checkoutRequestId);
  if (existing) {
    return sameCheckoutRequest(existing, operation.checkout)
      ? Response.json(purchaseResult(existing))
      : Response.json({ code: "checkout_request_conflict" }, { status: 409 });
  }
  const now = new Date();
  let bundleId: string | null = null;
  let bundleTitle = "";
  let events: readonly (TicketEventRow & { readonly id: string })[];
  let unitPriceCents: number;
  if ("bundleId" in operation.checkout) {
    const bundle = storage.sql
      .exec<TicketBundleRow>(
        `SELECT id, title, price_cents AS priceCents, capacity,
          sale_end_at AS saleEndAt, is_active AS isActive,
          created_at AS createdAt, updated_at AS updatedAt
         FROM ticket_bundles WHERE id = ? LIMIT 1`,
        operation.checkout.bundleId,
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
    const bundleCommitted = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly quantity: number }>(
        `SELECT COALESCE(SUM(quantity), 0) AS quantity FROM ticket_purchases
         WHERE bundle_id = ? AND status IN ('pending', 'paid')`,
        bundle.id,
      )
      .one().quantity;
    if (
      (bundle.capacity !== null &&
        bundleCommitted + operation.checkout.quantity > bundle.capacity) ||
      events.some(
        (event) =>
          event.ticketCapacity !== null &&
          committedEventQuantity(storage, event.id) + operation.checkout.quantity >
            event.ticketCapacity,
      )
    ) {
      return Response.json({ code: "ticket_capacity_exceeded" }, { status: 409 });
    }
    bundleId = bundle.id;
    bundleTitle = bundle.title;
    unitPriceCents = bundle.priceCents;
  } else {
    const event = readTicketEvent(storage, operation.checkout.eventId);
    if (!ticketEventIsOpen(event, now)) {
      return Response.json({ code: "ticket_sales_closed" }, { status: 409 });
    }
    if (
      event.ticketCapacity !== null &&
      committedEventQuantity(storage, operation.checkout.eventId) + operation.checkout.quantity >
        event.ticketCapacity
    ) {
      return Response.json({ code: "ticket_capacity_exceeded" }, { status: 409 });
    }
    events = [{ ...event, id: operation.checkout.eventId }];
    unitPriceCents = ticketUnitPriceCents({
      advancePriceCents: event.advancePriceCents,
      dayOfPriceCents: event.dayOfPriceCents,
      now,
      startsAt: event.startsAt,
      timezone: organization.timezone,
    });
  }
  const primaryEvent = events[0];
  if (!primaryEvent) return Response.json({ code: "ticket_sales_closed" }, { status: 409 });
  const includedEvents = events.map((event) => ({
    id: event.id,
    startsAt: event.startsAt,
    title: event.title,
  }));
  const feeCents = ticketProcessingFeeCents(unitPriceCents, operation.checkout.quantity);
  const amountPaidCents = unitPriceCents * operation.checkout.quantity + feeCents;
  const occurredAt = now.toISOString();
  const confirmationId = crypto.randomUUID();
  const confirmationJobId = crypto.randomUUID();
  const purchaseLabel = bundleId ? bundleTitle : primaryEvent.title;
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO ticket_purchases
        (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
         bundle_id, bundle_title, included_events_json,
         buyer_name, buyer_email, quantity, unit_price_cents, fee_cents,
         amount_paid_cents, currency, provider_session_id, provider_payment_id,
         status, marketing_opt_in, created_at, updated_at, fulfilled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usd', ?, ?, 'paid', ?, ?, ?, ?)`,
      operation.purchaseId,
      operation.checkout.checkoutRequestId,
      primaryEvent.id,
      primaryEvent.title,
      primaryEvent.startsAt,
      organization.timezone,
      bundleId,
      bundleTitle,
      JSON.stringify(includedEvents),
      operation.checkout.buyerName,
      operation.checkout.buyerEmail.toLowerCase(),
      operation.checkout.quantity,
      unitPriceCents,
      feeCents,
      amountPaidCents,
      operation.providerSessionId,
      `fake_payment_${operation.purchaseId}`,
      operation.checkout.marketingOptIn ? 1 : 0,
      occurredAt,
      occurredAt,
      occurredAt,
    );
    if (bundleId) {
      for (const event of events) {
        storage.sql.exec(
          `INSERT INTO ticket_bundle_allocations (purchase_id, event_id, quantity)
           VALUES (?, ?, ?)`,
          operation.purchaseId,
          event.id,
          operation.checkout.quantity,
        );
      }
    }
    storage.sql.exec(
      `INSERT INTO ticket_notifications
        (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
         content_markdown, status, scheduled_for, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'confirmation', ?, ?, ?, 'queued', ?, ?, ?)`,
      confirmationId,
      operation.purchaseId,
      bundleId ? null : primaryEvent.id,
      `ticket-confirmation:${operation.purchaseId}`,
      operation.checkout.buyerEmail.toLowerCase(),
      `Your ${purchaseLabel} tickets`,
      `Hello ${operation.checkout.buyerName},\n\nYour order for ${String(operation.checkout.quantity)} ${bundleId ? "pass(es)" : "ticket(s)"} to ${purchaseLabel} is confirmed.`,
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
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'public_visitor', 'anonymous', 'ticket.purchase.fulfilled',
        'ticket_purchase', ?, ?, ?, ?)`,
      `ticket-purchase:${operation.checkout.checkoutRequestId}`,
      operation.purchaseId,
      operation.checkout.checkoutRequestId,
      JSON.stringify({
        amountPaidCents,
        bundleId,
        eventId: primaryEvent.id,
        quantity: operation.checkout.quantity,
      }),
      occurredAt,
    );
  });
  const created = purchaseByRequest(storage, operation.checkout.checkoutRequestId);
  return created
    ? Response.json(purchaseResult(created), { status: 201 })
    : Response.json({ code: "ticket_purchase_not_created" }, { status: 503 });
}

function refundFakePurchase(
  storage: DurableObjectStorage,
  operation: z.infer<typeof refundOperationSchema>,
): Response {
  const row = storage.sql
    .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, operation.purchaseId)
    .toArray()
    .at(0);
  if (!row) return Response.json({ code: "ticket_purchase_not_found" }, { status: 404 });
  if (row.status === "refunded") return Response.json(purchaseResult(row));
  if (row.status !== "paid") {
    return Response.json({ code: "ticket_purchase_not_refundable" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE ticket_purchases SET status = 'refunded', refunded_at = ?, updated_at = ? WHERE id = ?",
      occurredAt,
      occurredAt,
      operation.purchaseId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'ticket.purchase.refunded',
        'ticket_purchase', ?, ?, ?, ?)`,
      `ticket-refund:${operation.requestId}`,
      operation.actorUserId,
      operation.purchaseId,
      operation.requestId,
      JSON.stringify({ amountCents: row.amountPaidCents }),
      occurredAt,
    );
  });
  return Response.json({ ...purchaseResult(row), status: "refunded", updatedAt: occurredAt });
}

function validateTicketScan(
  storage: DurableObjectStorage,
  operation: z.infer<typeof validateScanOperationSchema>,
): Response {
  const row = storage.sql
    .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, operation.purchaseId)
    .toArray()
    .at(0);
  const purchase = row ? purchaseResult(row) : null;
  const scannedEvent = purchase?.includedEvents.find(({ id }) => id === operation.eventId);
  const result = !row
    ? ticketScanResultSchema.parse({ reason: "not_found", valid: false })
    : row.status !== "paid"
      ? ticketScanResultSchema.parse({ reason: "not_paid", valid: false })
      : !scannedEvent
        ? ticketScanResultSchema.parse({ reason: "wrong_event", valid: false })
        : ticketScanResultSchema.parse({
            buyerName: row.buyerName,
            eventId: scannedEvent.id,
            eventStartsAt: scannedEvent.startsAt,
            eventTitle: scannedEvent.title,
            purchaseId: row.id,
            quantity: row.quantity,
            valid: true,
          });
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO ticket_scan_events
        (id, purchase_id, event_id, actor_user_id, result, request_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      operation.purchaseId,
      operation.eventId,
      operation.actorUserId,
      result.valid ? "valid" : result.reason,
      operation.requestId,
      occurredAt,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'ticket.scan.validated',
        'ticket_purchase', ?, ?, ?, ?)`,
      `ticket-scan:${operation.requestId}`,
      operation.actorUserId,
      operation.purchaseId,
      operation.requestId,
      JSON.stringify({
        eventId: operation.eventId,
        result: result.valid ? "valid" : result.reason,
      }),
      occurredAt,
    );
  });
  return Response.json(result);
}

function upsertTicketBundle(
  storage: DurableObjectStorage,
  operation: z.infer<typeof upsertBundleOperationSchema>,
): Response {
  if (new Set(operation.bundle.eventIds).size !== operation.bundle.eventIds.length) {
    return Response.json({ code: "ticket_bundle_events_invalid" }, { status: 409 });
  }
  const validEventCount = operation.bundle.eventIds.reduce(
    (count, eventId) => count + (readTicketEvent(storage, eventId)?.type === "Performance" ? 1 : 0),
    0,
  );
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

function deleteTicketBundle(
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

function recordTicketNotificationResult(
  storage: DurableObjectStorage,
  operation: z.infer<typeof ticketNotificationResultOperationSchema>,
): Response {
  const job = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey FROM scheduled_job_outbox
       WHERE job_id = ? AND kind = 'ticket_notification' LIMIT 1`,
      operation.jobId,
    )
    .toArray()
    .at(0);
  const notificationId = job?.idempotencyKey.split(":")[1];
  if (!notificationId) {
    return Response.json({ code: "ticket_notification_not_found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  storage.sql.exec(
    `UPDATE ticket_notifications SET status = ?, attempts = attempts + 1,
      provider_message_id = ?, failure_detail = ?, updated_at = ?,
      sent_at = CASE WHEN ? IN ('sent', 'suppressed') THEN ? ELSE sent_at END
     WHERE id = ?`,
    operation.status,
    operation.providerMessageId,
    operation.failureDetail,
    now,
    operation.status,
    now,
    notificationId,
  );
  return Response.json({ recorded: true });
}

function resendTicketConfirmation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof resendConfirmationOperationSchema>,
): Response {
  const row = storage.sql
    .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, operation.purchaseId)
    .toArray()
    .at(0);
  if (!row) return Response.json({ code: "ticket_purchase_not_found" }, { status: 404 });
  if (row.status !== "paid") {
    return Response.json({ code: "ticket_purchase_not_confirmable" }, { status: 409 });
  }
  const notificationId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const label = row.bundleId ? row.bundleTitle : row.eventTitle;
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO ticket_notifications
        (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
         content_markdown, status, scheduled_for, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'confirmation', ?, ?, ?, 'queued', ?, ?, ?)`,
      notificationId,
      row.id,
      row.bundleId ? null : row.eventId,
      `ticket-confirmation-resend:${row.id}:${operation.requestId}`,
      row.buyerEmail,
      `Your ${label} tickets`,
      `Hello ${row.buyerName},\n\nYour order for ${String(row.quantity)} ${row.bundleId ? "pass(es)" : "ticket(s)"} to ${label} is confirmed.`,
      now,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'ticket_notification', ?, ?, ?)`,
      jobId,
      `ticket-notification:${notificationId}`,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'ticket.confirmation.queued',
        'ticket_purchase', ?, ?, '{}', ?)`,
      `ticket-confirmation-resend:${operation.requestId}`,
      operation.actorUserId,
      row.id,
      operation.requestId,
      now,
    );
  });
  return Response.json({ queued: true });
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
      readonly buyerName: string;
      readonly contentMarkdown: string;
      readonly destination: string;
      readonly eventStartsAt: string;
      readonly id: string;
      readonly purchaseId: string;
      readonly status: string;
      readonly subject: string;
    }>(
      `SELECT n.id, n.purchase_id AS purchaseId, n.destination, n.subject,
        n.content_markdown AS contentMarkdown, n.status, p.buyer_name AS buyerName,
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

export async function manageTicketingInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const operation = operationSchema.safeParse(await request.json().catch(() => null));
  if (!operation.success) {
    return Response.json({ code: "invalid_ticketing_operation" }, { status: 400 });
  }
  const organization = identity(storage);
  if (organization?.organizationId !== operation.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  switch (operation.data.action) {
    case "create_fake_checkout": {
      const response = createFakeCheckout(storage, operation.data, organization);
      if (response.ok) await storage.setAlarm(Date.now() + 1);
      return response;
    }
    case "refund_fake_purchase":
      return refundFakePurchase(storage, operation.data);
    case "validate_ticket_scan":
      return validateTicketScan(storage, operation.data);
    case "upsert_ticket_bundle":
      return upsertTicketBundle(storage, operation.data);
    case "delete_ticket_bundle":
      return deleteTicketBundle(storage, operation.data);
    case "record_ticket_notification_result":
      return recordTicketNotificationResult(storage, operation.data);
    case "resend_ticket_confirmation": {
      const response = resendTicketConfirmation(storage, operation.data);
      if (response.ok) await storage.setAlarm(Date.now() + 1);
      return response;
    }
  }
}
