import { ticketCheckoutRequestSchema } from "@choir/contracts";
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

const operationSchema = z.discriminatedUnion("action", [
  createCheckoutOperationSchema,
  refundOperationSchema,
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
  readonly createdAt: string;
  readonly currency: "usd";
  readonly eventId: string;
  readonly eventStartsAt: string;
  readonly eventTitle: string;
  readonly feeCents: number;
  readonly id: string;
  readonly marketingOptIn: number;
  readonly providerPaymentId: string;
  readonly providerSessionId: string;
  readonly quantity: number;
  readonly status: "expired" | "paid" | "pending" | "refunded";
  readonly timezone: string;
  readonly unitPriceCents: number;
  readonly updatedAt: string;
}

const purchaseSelect = `SELECT id, event_id AS eventId, event_title AS eventTitle,
  event_starts_at AS eventStartsAt, event_timezone AS timezone,
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
  return {
    ...row,
    checkoutMode: row.providerSessionId.startsWith("fake_session_") ? "fake" : "stripe",
    marketingOptIn: row.marketingOptIn === 1,
  };
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
    existing.eventId === checkout.eventId &&
    existing.buyerName === checkout.buyerName &&
    existing.buyerEmail === checkout.buyerEmail.toLowerCase() &&
    existing.quantity === checkout.quantity &&
    existing.marketingOptIn === (checkout.marketingOptIn ? 1 : 0)
  );
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
  const event = storage.sql
    .exec<TicketEventRow>(
      `SELECT title, type, starts_at AS startsAt, is_archived AS isArchived,
        publish_on_website AS publishOnWebsite, is_ticketing_enabled AS isTicketingEnabled,
        advance_price_cents AS advancePriceCents, day_of_price_cents AS dayOfPriceCents,
        ticket_capacity AS ticketCapacity
       FROM events WHERE id = ? LIMIT 1`,
      operation.checkout.eventId,
    )
    .toArray()
    .at(0);
  const now = new Date();
  if (!ticketEventIsOpen(event, now)) {
    return Response.json({ code: "ticket_sales_closed" }, { status: 409 });
  }
  const committed = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly quantity: number }>(
      `SELECT COALESCE(SUM(quantity), 0) AS quantity FROM ticket_purchases
       WHERE event_id = ? AND status IN ('pending', 'paid')`,
      operation.checkout.eventId,
    )
    .one().quantity;
  if (
    event.ticketCapacity !== null &&
    committed + operation.checkout.quantity > event.ticketCapacity
  ) {
    return Response.json({ code: "ticket_capacity_exceeded" }, { status: 409 });
  }
  const unitPriceCents = ticketUnitPriceCents({
    advancePriceCents: event.advancePriceCents,
    dayOfPriceCents: event.dayOfPriceCents,
    now,
    startsAt: event.startsAt,
    timezone: organization.timezone,
  });
  const feeCents = ticketProcessingFeeCents(unitPriceCents, operation.checkout.quantity);
  const amountPaidCents = unitPriceCents * operation.checkout.quantity + feeCents;
  const occurredAt = now.toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO ticket_purchases
        (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
         buyer_name, buyer_email, quantity, unit_price_cents, fee_cents,
         amount_paid_cents, currency, provider_session_id, provider_payment_id,
         status, marketing_opt_in, created_at, updated_at, fulfilled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usd', ?, ?, 'paid', ?, ?, ?, ?)`,
      operation.purchaseId,
      operation.checkout.checkoutRequestId,
      operation.checkout.eventId,
      event.title,
      event.startsAt,
      organization.timezone,
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
        eventId: operation.checkout.eventId,
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
  return operation.data.action === "create_fake_checkout"
    ? createFakeCheckout(storage, operation.data, organization)
    : refundFakePurchase(storage, operation.data);
}
