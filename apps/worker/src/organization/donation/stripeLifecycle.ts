import type { z } from "zod";

import { insertPaymentNotificationRecord } from "../paymentNotificationStore";
import { renderPaymentMessageTemplate } from "../paymentMessageTemplates";
import { linkPaidDonationContact, resolveOrCreateContactForCommerce } from "../commerceContacts";
import { upsertPatronAfterDonation } from "./patrons";
import { donationById, donationByStripeOperation, donationResult } from "./queries";
import type {
  attachStripeSessionOperationSchema,
  stripeDonationCompletedOperationSchema,
  stripeDonationExpiredOperationSchema,
  stripeDonationRefundedOperationSchema,
} from "./types";
import { type DonationRow, donationSelect } from "./types";

export function insertDonationConfirmation(
  storage: DurableObjectStorage,
  donation: DonationRow,
  occurredAt = new Date().toISOString(),
): boolean {
  if (donation.status !== "paid") return false;
  const dedupeKey = `donation-confirmation:${donation.id}`;
  const existing = storage.sql
    .exec<{ readonly id: string }>(
      "SELECT id FROM payment_notifications WHERE dedupe_key = ? LIMIT 1",
      dedupeKey,
    )
    .toArray()
    .at(0);
  if (existing) return false;

  const organizationName =
    storage.sql
      .exec<{ readonly name: string }>("SELECT name FROM organization_metadata LIMIT 1")
      .toArray()
      .at(0)?.name ?? "the Organization";
  const message = renderPaymentMessageTemplate(
    storage,
    "donation_confirmation",
    donation.buyerName,
    {
      organizationName,
      paymentAmount: `$${(donation.amountCents / 100).toFixed(2)}`,
      paymentStatus: "Paid",
    },
  );
  const result = insertPaymentNotificationRecord(
    storage,
    {
      contentMarkdown: message.contentMarkdown,
      dedupeKey,
      destination: donation.buyerEmail,
      paymentType: "donation",
      recipientName: donation.buyerName,
      resourceId: donation.id,
      subject: message.subject,
    },
    occurredAt,
  );
  return result.queued;
}

export function queueDonationConfirmation(
  storage: DurableObjectStorage,
  donation: DonationRow,
): void {
  storage.transactionSync(() => {
    insertDonationConfirmation(storage, donation);
  });
}

export function stripeDonationEventWasProcessed(
  storage: DurableObjectStorage,
  eventId: string,
  prefix = "stripe-event:",
): boolean {
  const auditIds =
    prefix === "stripe-refund:"
      ? [`stripe-refund:donation:${eventId}`, `stripe-refund:${eventId}`]
      : [`${prefix}${eventId}`];
  return (
    storage.sql
      .exec(
        `SELECT id FROM audit_events WHERE id IN (${auditIds.map(() => "?").join(", ")}) LIMIT 1`,
        ...auditIds,
      )
      .toArray().length > 0
  );
}

export function attachStripeDonationSession(
  storage: DurableObjectStorage,
  operation: z.infer<typeof attachStripeSessionOperationSchema>,
): Response {
  const donation = donationById(storage, operation.donationId);
  if (!donation) return Response.json({ code: "donation_not_found" }, { status: 404 });
  if (donation.status !== "pending") return Response.json(donationResult(donation));
  try {
    storage.transactionSync(() => {
      const now = new Date().toISOString();
      storage.sql.exec(
        `UPDATE donations SET provider_session_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
        operation.providerSessionId,
        now,
        operation.donationId,
      );
      storage.sql.exec(
        `UPDATE payment_attempts SET provider_session_id = ?, updated_at = ? WHERE resource_id = ? AND status = 'pending'`,
        operation.providerSessionId,
        now,
        operation.donationId,
      );
    });
  } catch {
    return Response.json({ code: "donation_checkout_attach_failed" }, { status: 409 });
  }
  const updated = donationById(storage, operation.donationId);
  return updated
    ? Response.json(donationResult(updated))
    : Response.json({ code: "donation_not_found" }, { status: 404 });
}

export function completeStripeDonation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeDonationCompletedOperationSchema>,
): Response {
  const row = donationByStripeOperation(
    storage,
    operation.providerSessionId,
    operation.checkoutRequestId,
  );
  if (!row) return Response.json({ code: "donation_not_found" }, { status: 404 });
  const occurredAt = new Date().toISOString();

  if (stripeDonationEventWasProcessed(storage, operation.stripeEventId)) {
    // Idempotent duplicate reconciliation:
    // If the event was already processed, repair missing confirmation or contact linkage
    // without replaying financial fulfillment or double-counting patron aggregates.
    if (row.status === "paid") {
      const existingNotification = storage.sql
        .exec<{ readonly id: string }>(
          "SELECT id FROM payment_notifications WHERE dedupe_key = ? LIMIT 1",
          `donation-confirmation:${row.id}`,
        )
        .toArray()
        .at(0);
      if (!existingNotification) {
        storage.transactionSync(() => {
          insertDonationConfirmation(storage, row, occurredAt);
        });
      }
      if (row.contactId === null) {
        linkPaidDonationContact(storage, row.id);
      }
    }
    const current = donationById(storage, row.id) ?? row;
    return Response.json({ ...donationResult(current), duplicate: true });
  }

  const shouldFulfill = row.status === "pending" || row.status === "expired";
  // Resolve contact ID before transaction to avoid nested transactionSync calls
  const donationContactId = shouldFulfill
    ? (row.contactId ??
      resolveOrCreateContactForCommerce(storage, {
        buyerEmail: row.buyerEmail,
        buyerName: row.buyerName,
        existingContactId: row.contactId,
        marketingOptIn: row.marketingConsent === 1,
        occurredAt,
        source: "donation",
      }))
    : row.contactId;

  storage.transactionSync(() => {
    if (shouldFulfill) {
      storage.sql.exec(
        `UPDATE donations
         SET status = 'paid', provider_payment_id = ?, updated_at = ?, expires_at = NULL,
             contact_id = COALESCE(contact_id, ?)
         WHERE id = ? AND status IN ('pending', 'expired')`,
        operation.providerPaymentId,
        occurredAt,
        donationContactId,
        row.id,
      );
      storage.sql.exec("DELETE FROM donation_expirations WHERE donation_id = ?", row.id);
      storage.sql.exec(
        `UPDATE payment_attempts
         SET provider_session_id = ?, provider_payment_id = ?, status = 'paid', updated_at = ?
         WHERE resource_id = ? AND status IN ('pending', 'expired')`,
        operation.providerSessionId,
        operation.providerPaymentId,
        occurredAt,
        row.id,
      );
      if (row.patronId) {
        upsertPatronAfterDonation(storage, row.patronId, row.amountCents, occurredAt);
      }
      insertDonationConfirmation(
        storage,
        { ...row, contactId: donationContactId, status: "paid" },
        occurredAt,
      );
    }
    storage.sql.exec(
      `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at) VALUES (?, 'provider', 'stripe', 'stripe.webhook.processed', 'stripe_event', ?, ?, ?, ?)`,
      `stripe-event:${operation.stripeEventId}`,
      operation.stripeEventId,
      operation.stripeEventId,
      JSON.stringify({
        paymentType: "donation",
        providerPaymentId: operation.providerPaymentId,
        providerSessionId: operation.providerSessionId,
        status: shouldFulfill ? "paid" : row.status,
      }),
      occurredAt,
    );
  });

  if (!shouldFulfill && row.status === "paid") {
    const existingNotification = storage.sql
      .exec<{ readonly id: string }>(
        "SELECT id FROM payment_notifications WHERE dedupe_key = ? LIMIT 1",
        `donation-confirmation:${row.id}`,
      )
      .toArray()
      .at(0);
    if (!existingNotification) {
      storage.transactionSync(() => {
        insertDonationConfirmation(storage, row, occurredAt);
      });
    }
    if (row.contactId === null) {
      linkPaidDonationContact(storage, row.id);
    }
  }

  const updated = donationById(storage, row.id);
  return updated
    ? Response.json(donationResult(updated))
    : Response.json({ code: "donation_not_found" }, { status: 404 });
}

export function expireStripeDonation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeDonationExpiredOperationSchema>,
): Response {
  const row = donationByStripeOperation(
    storage,
    operation.providerSessionId,
    operation.checkoutRequestId,
  );
  if (!row) return Response.json({ code: "donation_not_found" }, { status: 404 });
  if (stripeDonationEventWasProcessed(storage, operation.stripeEventId))
    return Response.json({ ...donationResult(row), duplicate: true });
  if (row.status === "expired") return Response.json({ ...donationResult(row), duplicate: true });
  const occurredAt = new Date().toISOString();
  const isUnattachedCleanupMismatch =
    operation.providerSessionId.startsWith("pending_") &&
    row.providerSessionId !== operation.providerSessionId;
  storage.transactionSync(() => {
    if (row.status === "pending" && !isUnattachedCleanupMismatch) {
      storage.sql.exec(
        `INSERT INTO donation_expirations (donation_id, stripe_event_id, expired_at) VALUES (?, ?, ?)`,
        row.id,
        operation.stripeEventId,
        occurredAt,
      );
      storage.sql.exec(
        `UPDATE donations SET provider_session_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
        operation.providerSessionId,
        occurredAt,
        row.id,
      );
      storage.sql.exec(
        `UPDATE payment_attempts SET provider_session_id = ?, status = 'expired', expired_at = ?, updated_at = ? WHERE resource_id = ? AND status = 'pending'`,
        operation.providerSessionId,
        occurredAt,
        occurredAt,
        row.id,
      );
    }
    storage.sql.exec(
      `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at) VALUES (?, 'provider', 'stripe', 'stripe.webhook.processed', 'stripe_event', ?, ?, ?, ?)`,
      `stripe-event:${operation.stripeEventId}`,
      operation.stripeEventId,
      operation.stripeEventId,
      JSON.stringify({
        paymentType: "donation",
        providerSessionId: operation.providerSessionId,
        status: row.status === "pending" ? "expired" : row.status,
      }),
      occurredAt,
    );
  });
  const updated = donationById(storage, row.id);
  if (!updated) return Response.json({ code: "donation_not_found" }, { status: 404 });
  return Response.json(donationResult(updated));
}

export function refundStripeDonation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeDonationRefundedOperationSchema>,
): Response {
  if (stripeDonationEventWasProcessed(storage, operation.stripeEventId, "stripe-refund:"))
    return Response.json({ refunded: 0, duplicate: true });
  const rows = storage.sql
    .exec<DonationRow>(
      `${donationSelect} WHERE d.provider_payment_id = ? ORDER BY d.created_at, d.id`,
      operation.providerPaymentId,
    )
    .toArray();
  if (rows.length === 0) return Response.json({ code: "donation_not_found" }, { status: 404 });
  const refundableRows = rows.filter((row: DonationRow) => row.status === "paid");
  if (refundableRows.length === 0)
    return Response.json({ code: "donation_not_found" }, { status: 404 });
  const occurredAt = new Date().toISOString();
  let refunded = 0;
  storage.transactionSync(() => {
    for (const row of refundableRows) {
      storage.sql.exec(
        "UPDATE donations SET status = 'refunded', updated_at = ? WHERE id = ?",
        occurredAt,
        row.id,
      );
      if (row.patronId)
        storage.sql.exec(
          `UPDATE patrons SET total_donated_cents = MAX(0, total_donated_cents - ?), donation_count = MAX(0, donation_count - 1), updated_at = ? WHERE id = ?`,
          row.amountCents,
          occurredAt,
          row.patronId,
        );
      storage.sql.exec(
        `UPDATE payment_attempts SET status = 'refunded', refunded_at = ?, updated_at = ? WHERE provider_payment_id = ?`,
        occurredAt,
        occurredAt,
        operation.providerPaymentId,
      );
      refunded += 1;
    }
    storage.sql.exec(
      `INSERT INTO audit_events (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at) VALUES (?, 'provider', 'stripe', 'stripe.webhook.processed', 'stripe_event', ?, ?, ?, ?)`,
      `stripe-refund:donation:${operation.stripeEventId}`,
      operation.stripeEventId,
      operation.stripeEventId,
      JSON.stringify({
        paymentType: "donation",
        providerPaymentId: operation.providerPaymentId,
        refunded,
      }),
      occurredAt,
    );
  });
  return Response.json({ refunded });
}
