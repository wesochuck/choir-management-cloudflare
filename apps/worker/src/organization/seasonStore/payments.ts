import { transactionProcessingFeeCents } from "@choir/domain";
import type { z } from "zod";

import { queuePaymentNotificationInStore } from "../paymentNotificationStore";
import { renderPaymentMessageTemplate } from "../paymentMessageTemplates";
import { transactionFeeSettingsFromStore } from "../transactionFeeSettingsStore";
import { duesSelect, seasonSelect } from "./contracts";
import type {
  DuesRow,
  SeasonRow,
  attachDuesSessionOperationSchema,
  cashPaymentOperationSchema,
  createDuesCheckoutOperationSchema,
  prepareDuesCheckoutOperationSchema,
  refundOperationSchema,
  stripeDuesCompletedOperationSchema,
  stripeDuesExpiredOperationSchema,
  stripeDuesRefundedOperationSchema,
} from "./contracts";
import {
  duesByStripeOperation,
  duesForCheckoutRequest,
  identity,
  paymentAttemptByCheckoutRequest,
  releaseStalePendingDuesAttempt,
  sameDuesCheckout,
} from "./shared";

export function duesResult(row: DuesRow) {
  return {
    amountCents: row.amountCents,
    createdAt: row.createdAt,
    feeCents: row.feeCents,
    id: row.id,
    paidAt: row.paidAt,
    paymentMethod: row.paymentMethod,
    profileId: row.profileId,
    refundRequested: row.refundRequested === 1,
    seasonId: row.seasonId,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

function queueDuesConfirmation(storage: DurableObjectStorage, dues: DuesRow): void {
  if (dues.status !== "paid" || dues.paymentMethod !== "online" || !dues.payerEmail) return;
  const organizationName =
    storage.sql
      .exec<{ readonly name: string }>("SELECT name FROM organization_metadata LIMIT 1")
      .toArray()
      .at(0)?.name ?? "the Organization";
  const message = renderPaymentMessageTemplate(storage, "dues_confirmation", dues.payerName, {
    organizationName,
    paymentAmount: `$${((dues.amountCents + dues.feeCents) / 100).toFixed(2)}`,
    paymentStatus: "Paid",
  });
  queuePaymentNotificationInStore(storage, {
    action: "queue_payment_notification",
    contentMarkdown: message.contentMarkdown,
    dedupeKey: `dues-confirmation:${dues.id}`,
    destination: dues.payerEmail,
    organizationId: identity(storage)?.organizationId ?? "",
    paymentType: "dues",
    recipientName: dues.payerName,
    resourceId: dues.id,
    subject: message.subject,
  });
}

// eslint-disable-next-line complexity -- coordinates idempotent multi-profile dues checkout state.
export function createDuesCheckout(
  storage: DurableObjectStorage,
  operation:
    | z.infer<typeof createDuesCheckoutOperationSchema>
    | z.infer<typeof prepareDuesCheckoutOperationSchema>,
): Response {
  const season = storage.sql
    .exec<SeasonRow>(`${seasonSelect} WHERE s.id = ? LIMIT 1`, operation.checkout.seasonId)
    .toArray()
    .at(0);
  if (!season) return Response.json({ code: "season_not_found" }, { status: 404 });

  const now = new Date().toISOString();
  const sessionId = operation.providerSessionId ?? `fake_session_${crypto.randomUUID()}`;
  const pendingCheckout = operation.action === "prepare_dues_checkout";
  const checkoutRequestId = operation.checkout.checkoutRequestId || operation.requestId;
  const totalBaseAmountCents = season.duesAmountCents * operation.checkout.profileIds.length;
  const totalFeeCents = transactionProcessingFeeCents(
    totalBaseAmountCents,
    transactionFeeSettingsFromStore(storage),
  );
  const baseFeePerProfileCents = Math.floor(totalFeeCents / operation.checkout.profileIds.length);
  const feeRemainderCents = totalFeeCents % operation.checkout.profileIds.length;

  const existingAttempt = paymentAttemptByCheckoutRequest(storage, checkoutRequestId);
  if (existingAttempt) {
    const existingRows = duesForCheckoutRequest(
      storage,
      checkoutRequestId,
      existingAttempt.providerSessionId,
    );
    if (
      !sameDuesCheckout(
        existingRows,
        operation.checkout,
        operation.recipientEmail,
        season.duesAmountCents,
        totalFeeCents,
      )
    ) {
      return Response.json({ code: "checkout_request_conflict" }, { status: 409 });
    }
    return Response.json({
      checkoutMode: existingAttempt.providerSessionId.startsWith("fake_session_")
        ? "fake"
        : "stripe",
      sessionId: existingAttempt.providerSessionId,
      url: new URL("/dues?checkout=success", operation.origin).href,
    });
  }

  const createdDuesIds: string[] = [];
  try {
    // eslint-disable-next-line complexity -- validates and records one atomic multi-profile dues attempt.
    storage.transactionSync(() => {
      for (const [profileIndex, profileId] of operation.checkout.profileIds.entries()) {
        const profileFeeCents = baseFeePerProfileCents + (profileIndex < feeRemainderCents ? 1 : 0);
        const existing = storage.sql
          .exec<DuesRow>(
            `${duesSelect} WHERE d.season_id = ? AND d.profile_id = ? LIMIT 1`,
            operation.checkout.seasonId,
            profileId,
          )
          .toArray()
          .at(0);
        if (existing?.status === "paid") {
          throw new Error("dues_already_paid");
        }
        if (existing?.status === "refunded") {
          throw new Error("dues_refunded");
        }
        if (existing?.status === "pending" && existing.providerSessionId) {
          // A dues row may belong to a multi-profile checkout. Repointing only
          // its first payment_attempt resource would make late webhooks for the
          // other profiles impossible to reconcile without a schema change.
          throw new Error("dues_checkout_in_progress");
        }

        const duesId = existing?.id ?? crypto.randomUUID();
        createdDuesIds.push(duesId);
        if (existing) {
          storage.sql.exec(
            `UPDATE dues
           SET fee_cents = ?, payer_email = COALESCE(NULLIF(?, ''), payer_email),
             provider_session_id = ?, provider_payment_id = ?, status = ?,
             payment_method = 'online', paid_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
            profileFeeCents,
            operation.recipientEmail ?? "",
            sessionId,
            pendingCheckout ? "" : `fake_payment_${operation.requestId}`,
            pendingCheckout ? "pending" : "paid",
            pendingCheckout ? null : now,
            now,
            duesId,
          );
          storage.sql.exec("DELETE FROM dues_expirations WHERE dues_id = ?", duesId);
        } else {
          storage.sql.exec(
            `INSERT INTO dues
            (id, season_id, profile_id, amount_cents, fee_cents, provider_session_id,
             provider_payment_id, payer_email, status, paid_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            duesId,
            operation.checkout.seasonId,
            profileId,
            season.duesAmountCents,
            profileFeeCents,
            sessionId,
            pendingCheckout ? "" : `fake_payment_${operation.requestId}`,
            operation.recipientEmail ?? "",
            pendingCheckout ? "pending" : "paid",
            pendingCheckout ? null : now,
            now,
            now,
          );
        }
        storage.sql.exec(
          `INSERT INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'organization_member', ?, 'dues.created', 'dues', ?, ?, ?, ?)`,
          `dues-created:${operation.requestId}:${duesId}`,
          "system",
          duesId,
          operation.requestId,
          JSON.stringify({
            amountCents: season.duesAmountCents,
            feeCents: profileFeeCents,
            profileId,
            seasonId: operation.checkout.seasonId,
          }),
          now,
        );
      }
      if (createdDuesIds.length > 0) {
        storage.sql.exec(
          `INSERT INTO payment_attempts
            (id, payment_type, resource_id, checkout_request_id, provider_session_id,
             provider_payment_id, status, amount_cents, created_at, updated_at)
           VALUES (?, 'dues', ?, ?, ?, ?, ?, ?, ?, ?)`,
          `payment-attempt:${checkoutRequestId}`,
          createdDuesIds[0] ?? operation.requestId,
          checkoutRequestId,
          sessionId,
          pendingCheckout ? "" : `fake_payment_${operation.requestId}`,
          pendingCheckout ? "pending" : "paid",
          totalBaseAmountCents + totalFeeCents,
          now,
          now,
        );
      }
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === "dues_already_paid") {
        return Response.json({ code: "dues_already_paid" }, { status: 409 });
      }
      if (error.message === "dues_refunded") {
        return Response.json({ code: "dues_refunded" }, { status: 409 });
      }
      if (error.message === "dues_checkout_in_progress") {
        return Response.json({ code: "dues_checkout_in_progress" }, { status: 409 });
      }
    }
    throw error;
  }

  if (!pendingCheckout) {
    for (const duesId of createdDuesIds) {
      const created = storage.sql
        .exec<DuesRow>(`${duesSelect} WHERE d.id = ? LIMIT 1`, duesId)
        .toArray()
        .at(0);
      if (created) queueDuesConfirmation(storage, created);
    }
  }

  const url = new URL("/dues?checkout=success", operation.origin);
  return Response.json({
    checkoutMode: sessionId.startsWith("fake_session_") ? "fake" : "stripe",
    sessionId,
    url: url.href,
  });
}

export function attachDuesSession(
  storage: DurableObjectStorage,
  operation: z.infer<typeof attachDuesSessionOperationSchema>,
): Response {
  const rows = storage.sql
    .exec<DuesRow>(
      `${duesSelect} WHERE d.provider_session_id = ?`,
      `pending_${operation.requestId}`,
    )
    .toArray();
  if (rows.length === 0) {
    const alreadyAttached = storage.sql
      .exec<DuesRow>(`${duesSelect} WHERE d.provider_session_id = ?`, operation.providerSessionId)
      .toArray();
    return alreadyAttached.length > 0
      ? Response.json({
          checkoutMode: "stripe",
          sessionId: operation.providerSessionId,
          url: "https://checkout.stripe.com/attached",
        })
      : Response.json({ code: "dues_not_found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE dues SET provider_session_id = ?, updated_at = ?
       WHERE provider_session_id = ? AND status = 'pending'`,
      operation.providerSessionId,
      now,
      `pending_${operation.requestId}`,
    );
    storage.sql.exec(
      `UPDATE payment_attempts SET provider_session_id = ?, updated_at = ?
       WHERE checkout_request_id = ? AND status = 'pending'`,
      operation.providerSessionId,
      now,
      operation.requestId,
    );
  });
  return Response.json({
    checkoutMode: "stripe",
    sessionId: operation.providerSessionId,
    url: "https://checkout.stripe.com/attached",
  });
}

export function refundDues(
  storage: DurableObjectStorage,
  operation: z.infer<typeof refundOperationSchema>,
): Response {
  const row = storage.sql
    .exec<DuesRow>(`${duesSelect} WHERE d.id = ? LIMIT 1`, operation.duesId)
    .toArray()
    .at(0);
  if (!row) return Response.json({ code: "dues_not_found" }, { status: 404 });
  if (row.status === "refunded") return Response.json(duesResult(row));
  if (row.status !== "paid") {
    return Response.json({ code: "dues_not_refundable" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE dues SET status = 'refunded', updated_at = ? WHERE id = ?",
      occurredAt,
      operation.duesId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'dues.refunded',
        'dues', ?, ?, ?, ?)`,
      `dues-refund:${operation.requestId}`,
      operation.actorUserId,
      operation.duesId,
      operation.requestId,
      JSON.stringify({ amountCents: row.amountCents }),
      occurredAt,
    );
  });
  return Response.json({ ...duesResult(row), status: "refunded", updatedAt: occurredAt });
}

export function markDuesCashPaid(
  storage: DurableObjectStorage,
  operation: z.infer<typeof cashPaymentOperationSchema>,
): Response {
  const profile = storage.sql
    .exec<{ readonly id: string }>(
      "SELECT id FROM profiles WHERE id = ? LIMIT 1",
      operation.cashPayment.profileId,
    )
    .toArray()
    .at(0);
  if (!profile) return Response.json({ code: "profile_not_found" }, { status: 404 });

  const season = storage.sql
    .exec<SeasonRow>(`${seasonSelect} WHERE s.id = ? LIMIT 1`, operation.cashPayment.seasonId)
    .toArray()
    .at(0);
  if (!season) return Response.json({ code: "season_not_found" }, { status: 404 });

  const existing = storage.sql
    .exec<DuesRow>(
      `${duesSelect} WHERE d.season_id = ? AND d.profile_id = ? LIMIT 1`,
      operation.cashPayment.seasonId,
      operation.cashPayment.profileId,
    )
    .toArray()
    .at(0);
  if (existing?.status === "paid") {
    return existing.paymentMethod === "cash"
      ? Response.json(duesResult(existing))
      : Response.json({ code: "dues_already_paid" }, { status: 409 });
  }
  if (existing?.status === "refunded") {
    return Response.json({ code: "dues_refunded" }, { status: 409 });
  }
  if (existing?.paymentMethod === "online") {
    if (!releaseStalePendingDuesAttempt(storage, existing.id)) {
      return Response.json({ code: "dues_checkout_in_progress" }, { status: 409 });
    }
  }

  const occurredAt = new Date().toISOString();
  const duesId = existing?.id ?? crypto.randomUUID();
  storage.transactionSync(() => {
    if (existing) {
      storage.sql.exec(
        `UPDATE dues
         SET fee_cents = 0, payment_method = 'cash', paid_at = ?, status = 'paid', updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        occurredAt,
        occurredAt,
        existing.id,
      );
      storage.sql.exec(
        `UPDATE payment_attempts
         SET status = 'expired', expired_at = ?, updated_at = ?
         WHERE payment_type = 'dues' AND resource_id = ? AND status = 'pending'`,
        occurredAt,
        occurredAt,
        existing.id,
      );
      storage.sql.exec("DELETE FROM dues_expirations WHERE dues_id = ?", existing.id);
    } else {
      storage.sql.exec(
        `INSERT INTO dues
          (id, season_id, profile_id, amount_cents, fee_cents, provider_session_id,
           payment_method, status, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, '', 'cash', 'paid', ?, ?, ?)`,
        duesId,
        operation.cashPayment.seasonId,
        operation.cashPayment.profileId,
        season.duesAmountCents,
        occurredAt,
        occurredAt,
        occurredAt,
      );
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'dues.cash_paid', 'dues', ?, ?, ?, ?)`,
      `dues-cash-paid:${operation.requestId}`,
      operation.actorUserId,
      duesId,
      operation.requestId,
      JSON.stringify({
        amountCents: existing?.amountCents ?? season.duesAmountCents,
        paymentMethod: "cash",
        profileId: operation.cashPayment.profileId,
        seasonId: operation.cashPayment.seasonId,
      }),
      occurredAt,
    );
  });

  const updated = storage.sql
    .exec<DuesRow>(`${duesSelect} WHERE d.id = ? LIMIT 1`, duesId)
    .toArray()
    .at(0);
  return updated
    ? Response.json(duesResult(updated))
    : Response.json({ code: "dues_not_found" }, { status: 404 });
}

function stripeDuesEventWasProcessed(storage: DurableObjectStorage, eventId: string): boolean {
  return (
    storage.sql
      .exec("SELECT id FROM audit_events WHERE id = ? LIMIT 1", `stripe-event:${eventId}`)
      .toArray().length > 0
  );
}

export function completeStripeDues(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeDuesCompletedOperationSchema>,
): Response {
  const rows = duesByStripeOperation(
    storage,
    operation.providerSessionId,
    operation.checkoutRequestId,
  );
  if (rows.length === 0) return Response.json({ code: "dues_not_found" }, { status: 404 });
  if (stripeDuesEventWasProcessed(storage, operation.stripeEventId)) {
    return Response.json({ dues: rows.map(duesResult), duplicate: true });
  }
  const occurredAt = new Date().toISOString();
  const transitioned = rows.filter(
    (row) =>
      row.paymentMethod === "online" && (row.status === "pending" || row.status === "expired"),
  );
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE payment_attempts
       SET provider_session_id = ?, provider_payment_id = ?, status = 'paid',
           expired_at = NULL, updated_at = ?
       WHERE payment_type = 'dues' AND status IN ('pending', 'expired')
         AND EXISTS (
           SELECT 1 FROM dues d
           WHERE d.id = payment_attempts.resource_id
             AND d.payment_method = 'online'
             AND d.status IN ('pending', 'expired')
         )
         AND (
           provider_session_id = ?
           OR (? IS NOT NULL AND checkout_request_id = ?)
         )`,
      operation.providerSessionId,
      operation.providerPaymentId,
      occurredAt,
      operation.providerSessionId,
      operation.checkoutRequestId ?? null,
      operation.checkoutRequestId ?? null,
    );
    for (const row of rows) {
      if (!transitioned.some((candidate) => candidate.id === row.id)) continue;
      storage.sql.exec(
        `UPDATE dues
         SET provider_session_id = ?, status = 'paid', provider_payment_id = ?, paid_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'expired') AND payment_method = 'online'`,
        operation.providerSessionId,
        operation.providerPaymentId,
        occurredAt,
        occurredAt,
        row.id,
      );
      storage.sql.exec("DELETE FROM dues_expirations WHERE dues_id = ?", row.id);
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'provider', 'stripe', 'stripe.webhook.processed', 'stripe_event', ?, ?, ?, ?)`,
      `stripe-event:${operation.stripeEventId}`,
      operation.stripeEventId,
      operation.stripeEventId,
      JSON.stringify({
        paymentType: "dues",
        providerPaymentId: operation.providerPaymentId,
        providerSessionId: operation.providerSessionId,
        duesCount: rows.length,
      }),
      occurredAt,
    );
  });
  const updated = duesByStripeOperation(
    storage,
    operation.providerSessionId,
    operation.checkoutRequestId,
  );
  for (const row of updated) {
    if (transitioned.some((candidate) => candidate.id === row.id))
      queueDuesConfirmation(storage, row);
  }
  return Response.json({ dues: updated.map(duesResult) });
}

export function expireStripeDues(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeDuesExpiredOperationSchema>,
): Response {
  const rows = duesByStripeOperation(
    storage,
    operation.providerSessionId,
    operation.checkoutRequestId,
  );
  if (rows.length === 0) return Response.json({ code: "dues_not_found" }, { status: 404 });
  if (stripeDuesEventWasProcessed(storage, operation.stripeEventId)) {
    return Response.json({ dues: rows.map(duesResult), duplicate: true });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    for (const row of rows) {
      if (row.status === "pending") {
        storage.sql.exec(
          `INSERT OR IGNORE INTO dues_expirations (dues_id, stripe_event_id, expired_at)
           VALUES (?, ?, ?)`,
          row.id,
          operation.stripeEventId,
          occurredAt,
        );
        storage.sql.exec(
          `UPDATE dues SET provider_session_id = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
          operation.providerSessionId,
          occurredAt,
          row.id,
        );
      }
    }
    storage.sql.exec(
      `UPDATE payment_attempts
       SET provider_session_id = ?, status = 'expired', expired_at = ?, updated_at = ?
       WHERE status = 'pending'
         AND (
           provider_session_id = ?
           OR (? IS NOT NULL AND checkout_request_id = ?)
         )`,
      operation.providerSessionId,
      occurredAt,
      occurredAt,
      operation.providerSessionId,
      operation.checkoutRequestId ?? null,
      operation.checkoutRequestId ?? null,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'provider', 'stripe', 'stripe.webhook.processed', 'stripe_event', ?, ?, ?, ?)`,
      `stripe-event:${operation.stripeEventId}`,
      operation.stripeEventId,
      operation.stripeEventId,
      JSON.stringify({
        paymentType: "dues",
        providerSessionId: operation.providerSessionId,
        status: "expired",
      }),
      occurredAt,
    );
  });
  return Response.json({ dues: rows.map(duesResult) });
}

export function refundStripeDues(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeDuesRefundedOperationSchema>,
): Response {
  const auditId = `stripe-refund:dues:${operation.stripeEventId}`;
  if (
    storage.sql
      .exec(
        "SELECT id FROM audit_events WHERE id IN (?, ?) LIMIT 1",
        auditId,
        `stripe-refund:${operation.stripeEventId}`,
      )
      .toArray().length > 0
  ) {
    return Response.json({ refunded: 0, duplicate: true });
  }
  const rows = storage.sql
    .exec<DuesRow>(`${duesSelect} WHERE d.provider_payment_id = ?`, operation.providerPaymentId)
    .toArray();
  if (rows.length === 0) {
    return Response.json({ code: "dues_not_found" }, { status: 404 });
  }
  const refundableRows = rows.filter((row) => row.status === "paid");
  if (refundableRows.length === 0) {
    return Response.json({ code: "dues_not_found" }, { status: 404 });
  }
  const occurredAt = new Date().toISOString();
  let refunded = 0;
  storage.transactionSync(() => {
    for (const row of refundableRows) {
      storage.sql.exec(
        "UPDATE dues SET status = 'refunded', updated_at = ? WHERE id = ?",
        occurredAt,
        row.id,
      );
      refunded += 1;
    }
    storage.sql.exec(
      `UPDATE payment_attempts SET status = 'refunded', refunded_at = ?, updated_at = ?
       WHERE provider_payment_id = ?`,
      occurredAt,
      occurredAt,
      operation.providerPaymentId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'provider', 'stripe', 'stripe.webhook.processed', 'stripe_event', ?, ?, ?, ?)`,
      auditId,
      operation.stripeEventId,
      operation.stripeEventId,
      JSON.stringify({
        paymentType: "dues",
        providerPaymentId: operation.providerPaymentId,
        refunded,
      }),
      occurredAt,
    );
  });
  return Response.json({ refunded });
}
