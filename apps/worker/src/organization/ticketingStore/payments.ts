import type { z } from "zod";

import type {
  attachStripeSessionOperationSchema,
  refundOperationSchema,
  stripeTicketCompletedOperationSchema,
  stripeTicketExpiredOperationSchema,
  stripeTicketRefundedOperationSchema,
} from "./contracts";
import { purchaseSelect, type TicketPurchaseRow } from "./contracts";
import { linkPaidTicketPurchaseContact } from "../commerceContacts";
import { queueTicketConfirmation, queueTicketRefundNotification } from "./notifications";
import { purchaseResult } from "./readModel";

export interface TicketRefundMutationResult {
  readonly response: Response;
  readonly schedulerWorkQueued: boolean;
}

function purchaseByStripeOperation(
  storage: DurableObjectStorage,
  providerSessionId: string,
  checkoutRequestId?: string,
): TicketPurchaseRow | undefined {
  return storage.sql
    .exec<TicketPurchaseRow>(
      `${purchaseSelect}
       WHERE provider_session_id = ?
          OR (? IS NOT NULL AND checkout_request_id = ?)
       LIMIT 1`,
      providerSessionId,
      checkoutRequestId ?? null,
      checkoutRequestId ?? null,
    )
    .toArray()
    .at(0);
}

export function attachStripeSession(
  storage: DurableObjectStorage,
  operation: z.infer<typeof attachStripeSessionOperationSchema>,
): Response {
  const purchase = storage.sql
    .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, operation.purchaseId)
    .toArray()
    .at(0);
  if (!purchase) return Response.json({ code: "ticket_purchase_not_found" }, { status: 404 });
  if (purchase.status !== "pending") return Response.json(purchaseResult(purchase));
  try {
    storage.transactionSync(() => {
      storage.sql.exec(
        `UPDATE ticket_purchases SET provider_session_id = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        operation.providerSessionId,
        new Date().toISOString(),
        operation.purchaseId,
      );
      storage.sql.exec(
        `UPDATE payment_attempts SET provider_session_id = ?, updated_at = ?
         WHERE resource_id = ? AND status = 'pending'`,
        operation.providerSessionId,
        new Date().toISOString(),
        operation.purchaseId,
      );
    });
  } catch {
    return Response.json({ code: "ticket_checkout_attach_failed" }, { status: 409 });
  }
  const updated = storage.sql
    .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, operation.purchaseId)
    .toArray()
    .at(0);
  return updated
    ? Response.json(purchaseResult(updated))
    : Response.json({ code: "ticket_purchase_not_found" }, { status: 404 });
}

export function refundFakePurchase(
  storage: DurableObjectStorage,
  operation: z.infer<typeof refundOperationSchema>,
): TicketRefundMutationResult {
  const row = storage.sql
    .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, operation.purchaseId)
    .toArray()
    .at(0);
  if (!row) {
    return {
      response: Response.json({ code: "ticket_purchase_not_found" }, { status: 404 }),
      schedulerWorkQueued: false,
    };
  }
  if (row.status === "refunded") {
    return { response: Response.json(purchaseResult(row)), schedulerWorkQueued: false };
  }
  if (row.status !== "paid") {
    return {
      response: Response.json({ code: "ticket_purchase_not_refundable" }, { status: 409 }),
      schedulerWorkQueued: false,
    };
  }
  const occurredAt = new Date().toISOString();
  let schedulerWorkQueued = false;
  const transition = { changed: false };
  storage.transactionSync(() => {
    transition.changed =
      storage.sql
        .exec<{ readonly id: string }>(
          `UPDATE ticket_purchases SET status = 'refunded', refunded_at = ?, updated_at = ?
       WHERE id = ? AND status = 'paid'
       RETURNING id`,
          occurredAt,
          occurredAt,
          operation.purchaseId,
        )
        .toArray().length > 0;
    if (!transition.changed) return;
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
    schedulerWorkQueued = queueTicketRefundNotification(storage, row, occurredAt, {
      actorId: operation.actorUserId,
      actorType: "organization_member",
      requestId: operation.requestId,
    });
  });
  if (!transition.changed) {
    const current = storage.sql
      .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, operation.purchaseId)
      .toArray()
      .at(0);
    return {
      response: current
        ? Response.json(purchaseResult(current))
        : Response.json({ code: "ticket_purchase_not_found" }, { status: 404 }),
      schedulerWorkQueued: false,
    };
  }
  return {
    response: Response.json({
      ...purchaseResult(row),
      refundedAt: occurredAt,
      status: "refunded",
      updatedAt: occurredAt,
    }),
    schedulerWorkQueued,
  };
}

function stripeEventWasProcessed(storage: DurableObjectStorage, eventId: string): boolean {
  return (
    storage.sql
      .exec("SELECT id FROM audit_events WHERE id = ? LIMIT 1", `stripe-event:${eventId}`)
      .toArray().length > 0
  );
}

export interface StripeTicketCompletionResult {
  readonly response: Response;
  readonly schedulerWorkQueued: boolean;
}

export function completeStripeTicketPurchase(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeTicketCompletedOperationSchema>,
): StripeTicketCompletionResult {
  const row = purchaseByStripeOperation(
    storage,
    operation.providerSessionId,
    operation.checkoutRequestId,
  );
  if (!row) {
    return {
      response: Response.json({ code: "ticket_purchase_not_found" }, { status: 404 }),
      schedulerWorkQueued: false,
    };
  }
  if (stripeEventWasProcessed(storage, operation.stripeEventId)) {
    return {
      response: Response.json({ ...purchaseResult(row), duplicate: true }),
      schedulerWorkQueued: false,
    };
  }
  const occurredAt = new Date().toISOString();
  const shouldFulfill = row.status === "pending" || row.status === "expired";
  let schedulerWorkQueued = false;
  storage.transactionSync(() => {
    if (shouldFulfill) {
      storage.sql.exec(
        `UPDATE ticket_purchases
         SET status = 'paid', provider_payment_id = ?, fulfilled_at = ?, expired_at = NULL, expires_at = NULL, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'expired')`,
        operation.providerPaymentId,
        occurredAt,
        occurredAt,
        row.id,
      );
      storage.sql.exec(
        `UPDATE payment_attempts
         SET provider_session_id = ?, provider_payment_id = ?, status = 'paid',
             expired_at = NULL, updated_at = ?
         WHERE resource_id = ? AND status IN ('pending', 'expired')`,
        operation.providerSessionId,
        operation.providerPaymentId,
        occurredAt,
        row.id,
      );
      storage.sql.exec(
        `UPDATE discount_code_redemptions
         SET status = 'confirmed', confirmed_at = ?, updated_at = ?
         WHERE purchase_id = ? AND status = 'pending'`,
        occurredAt,
        occurredAt,
        row.id,
      );
      storage.sql.exec(
        `UPDATE discount_codes SET first_redeemed_at = COALESCE(first_redeemed_at, ?), updated_at = ?
         WHERE id IN (SELECT discount_code_id FROM discount_code_redemptions WHERE purchase_id = ?)`,
        occurredAt,
        occurredAt,
        row.id,
      );
      schedulerWorkQueued = queueTicketConfirmation(storage, row, occurredAt);
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'provider', 'stripe', 'stripe.webhook.processed', 'stripe_event', ?, ?, ?, ?)`,
      `stripe-event:${operation.stripeEventId}`,
      operation.stripeEventId,
      operation.stripeEventId,
      JSON.stringify({
        paymentType: row.bundleId ? "bundle" : "ticket",
        providerPaymentId: operation.providerPaymentId,
        providerSessionId: operation.providerSessionId,
        status: shouldFulfill ? "paid" : row.status,
      }),
      occurredAt,
    );
    if (shouldFulfill) {
      storage.sql.exec(
        `INSERT OR IGNORE INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
         VALUES (?, 'provider', 'stripe', 'ticket.purchase.fulfilled', 'ticket_purchase', ?, ?, ?, ?)`,
        `stripe-ticket-fulfilled:${operation.stripeEventId}`,
        row.id,
        operation.stripeEventId,
        JSON.stringify({
          amountPaidCents: row.amountPaidCents,
          providerPaymentId: operation.providerPaymentId,
        }),
        occurredAt,
      );
    }
  });
  const updated = storage.sql
    .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, row.id)
    .toArray()
    .at(0);
  // Phase 8: a purchase that just became paid (or an older paid row meeting a
  // duplicate webhook) links its Contact after the fulfillment transaction.
  if (updated?.status === "paid") linkPaidTicketPurchaseContact(storage, updated.id);
  return {
    response: updated
      ? Response.json(purchaseResult(updated))
      : Response.json({ code: "ticket_purchase_not_found" }, { status: 404 }),
    schedulerWorkQueued,
  };
}

export function expireStripeTicketPurchase(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeTicketExpiredOperationSchema>,
): Response {
  const row = purchaseByStripeOperation(
    storage,
    operation.providerSessionId,
    operation.checkoutRequestId,
  );
  if (!row) return Response.json({ code: "ticket_purchase_not_found" }, { status: 404 });
  if (stripeEventWasProcessed(storage, operation.stripeEventId)) {
    return Response.json({ ...purchaseResult(row), duplicate: true });
  }
  const occurredAt = new Date().toISOString();
  const isUnattachedCleanupMismatch =
    operation.providerSessionId.startsWith("pending_") &&
    row.providerSessionId !== operation.providerSessionId;
  storage.transactionSync(() => {
    if (row.status === "pending" && !isUnattachedCleanupMismatch) {
      storage.sql.exec(
        `UPDATE ticket_purchases
         SET status = 'expired', provider_session_id = ?, expired_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        operation.providerSessionId,
        occurredAt,
        occurredAt,
        row.id,
      );
      storage.sql.exec(
        `UPDATE payment_attempts
         SET provider_session_id = ?, status = 'expired', expired_at = ?, updated_at = ?
         WHERE resource_id = ? AND status = 'pending'`,
        operation.providerSessionId,
        occurredAt,
        occurredAt,
        row.id,
      );
      storage.sql.exec(
        `UPDATE discount_code_redemptions
         SET status = 'released', released_at = ?, updated_at = ?
         WHERE purchase_id = ? AND status = 'pending'`,
        occurredAt,
        occurredAt,
        row.id,
      );
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'provider', 'stripe', 'stripe.webhook.processed', 'stripe_event', ?, ?, ?, ?)`,
      `stripe-event:${operation.stripeEventId}`,
      operation.stripeEventId,
      operation.stripeEventId,
      JSON.stringify({ providerSessionId: operation.providerSessionId, status: "expired" }),
      occurredAt,
    );
  });
  const updated = storage.sql
    .exec<TicketPurchaseRow>(`${purchaseSelect} WHERE id = ? LIMIT 1`, row.id)
    .toArray()
    .at(0);
  return updated
    ? Response.json(purchaseResult(updated))
    : Response.json({ code: "ticket_purchase_not_found" }, { status: 404 });
}

export function refundStripeTicketPurchases(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeTicketRefundedOperationSchema>,
): TicketRefundMutationResult {
  const marker = `stripe-refund:ticket:${operation.stripeEventId}`;
  if (
    storage.sql
      .exec(
        "SELECT id FROM audit_events WHERE id IN (?, ?) LIMIT 1",
        marker,
        `stripe-refund:${operation.stripeEventId}`,
      )
      .toArray().length > 0
  ) {
    return {
      response: Response.json({ refunded: 0, duplicate: true }),
      schedulerWorkQueued: false,
    };
  }
  const rows = storage.sql
    .exec<TicketPurchaseRow>(
      `${purchaseSelect} WHERE provider_payment_id = ? ORDER BY created_at, id`,
      operation.providerPaymentId,
    )
    .toArray();
  if (rows.length === 0) {
    return {
      response: Response.json({ code: "ticket_purchase_not_found" }, { status: 404 }),
      schedulerWorkQueued: false,
    };
  }
  const refundableRows = rows.filter((row) => row.status === "paid");
  if (refundableRows.length === 0) {
    return {
      response: Response.json({ code: "ticket_purchase_not_found" }, { status: 404 }),
      schedulerWorkQueued: false,
    };
  }
  const occurredAt = new Date().toISOString();
  let refunded = 0;
  let schedulerWorkQueued = false;
  storage.transactionSync(() => {
    for (const row of refundableRows) {
      const transitioned =
        storage.sql
          .exec<{ readonly id: string }>(
            `UPDATE ticket_purchases
           SET status = 'refunded', refunded_at = ?, updated_at = ?
           WHERE id = ? AND status = 'paid'
           RETURNING id`,
            occurredAt,
            occurredAt,
            row.id,
          )
          .toArray().length > 0;
      if (!transitioned) continue;
      schedulerWorkQueued =
        queueTicketRefundNotification(storage, row, occurredAt, {
          actorId: "stripe",
          actorType: "provider",
          requestId: operation.stripeEventId,
        }) || schedulerWorkQueued;
      refunded += 1;
    }
    if (refunded > 0) {
      storage.sql.exec(
        `UPDATE payment_attempts SET status = 'refunded', refunded_at = ?, updated_at = ?
         WHERE provider_payment_id = ?`,
        occurredAt,
        occurredAt,
        operation.providerPaymentId,
      );
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'provider', 'stripe', 'stripe.webhook.processed', 'stripe_event', ?, ?, ?, ?)`,
      marker,
      operation.stripeEventId,
      operation.stripeEventId,
      JSON.stringify({
        paymentType: "ticket",
        providerPaymentId: operation.providerPaymentId,
        refunded,
      }),
      occurredAt,
    );
  });
  return { response: Response.json({ refunded }), schedulerWorkQueued };
}
