import { transactionProcessingFeeCents } from "@choir/domain";
import type { z } from "zod";

import { transactionFeeSettingsFromStore } from "../transactionFeeSettingsStore";
import { findOrCreatePatron, upsertPatronAfterDonation } from "./patrons";
import {
  donationByCheckoutRequest,
  donationById,
  donationResult,
  sameCheckoutRequest,
} from "./queries";
import { queueDonationConfirmation } from "./stripeLifecycle";
import type {
  createFakeCheckoutOperationSchema,
  createPendingCheckoutOperationSchema,
} from "./types";

export function createDonationCheckout(
  storage: DurableObjectStorage,
  operation:
    | z.infer<typeof createFakeCheckoutOperationSchema>
    | z.infer<typeof createPendingCheckoutOperationSchema>,
): Response {
  const existing = donationByCheckoutRequest(storage, operation.checkout.checkoutRequestId);
  if (existing) {
    return sameCheckoutRequest(existing, operation.checkout)
      ? Response.json(donationResult(existing))
      : Response.json({ code: "donation_checkout_conflict" }, { status: 409 });
  }
  const now = new Date().toISOString();
  const pending = operation.action === "create_stripe_pending_donation";
  const transactionFeeSettings = transactionFeeSettingsFromStore(storage);
  const feeCents = transactionFeeSettings.passFeeToDonor
    ? transactionProcessingFeeCents(operation.checkout.amountCents, transactionFeeSettings)
    : 0;
  const patronId = findOrCreatePatron(
    storage,
    operation.checkout.buyerName,
    operation.checkout.buyerEmail,
    now,
  );
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO donations
        (id, checkout_request_id, status, amount_cents,
         fee_cents,
         tribute_type, tribute_name, tribute_notify_email,
         anonymous, marketing_consent,
         buyer_name, buyer_email, patron_id,
         provider_session_id, provider_payment_id,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      operation.donationId,
      operation.checkout.checkoutRequestId,
      pending ? "pending" : "paid",
      operation.checkout.amountCents,
      feeCents,
      operation.checkout.tributeType,
      operation.checkout.tributeName,
      operation.checkout.tributeNotifyEmail,
      operation.checkout.anonymous ? 1 : 0,
      operation.checkout.marketingConsent ? 1 : 0,
      operation.checkout.buyerName,
      operation.checkout.buyerEmail.toLowerCase(),
      patronId,
      operation.providerSessionId,
      pending ? "" : `fake_payment_${operation.donationId}`,
      now,
      now,
    );
    storage.sql.exec(
      `INSERT INTO payment_attempts
        (id, payment_type, resource_id, checkout_request_id, provider_session_id,
         provider_payment_id, status, amount_cents, created_at, updated_at)
       VALUES (?, 'donation', ?, ?, ?, ?, ?, ?, ?, ?)`,
      `payment-attempt:${operation.donationId}`,
      operation.donationId,
      operation.checkout.checkoutRequestId,
      operation.providerSessionId,
      pending ? "" : `fake_payment_${operation.donationId}`,
      pending ? "pending" : "paid",
      operation.checkout.amountCents + feeCents,
      now,
      now,
    );
    if (!pending) upsertPatronAfterDonation(storage, patronId, operation.checkout.amountCents, now);
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'public_visitor', 'anonymous', ?,
        'donation', ?, ?, ?, ?)`,
      `donation:${operation.checkout.checkoutRequestId}`,
      pending ? "donation.pending" : "donation.created",
      operation.donationId,
      operation.checkout.checkoutRequestId,
      JSON.stringify({
        amountCents: operation.checkout.amountCents,
        feeCents,
        tributeType: operation.checkout.tributeType,
        anonymous: operation.checkout.anonymous,
      }),
      now,
    );
  });
  const created = donationById(storage, operation.donationId);
  if (created && !pending) queueDonationConfirmation(storage, created);
  return created
    ? Response.json(donationResult(created), { status: 201 })
    : Response.json({ code: "donation_not_created" }, { status: 503 });
}
