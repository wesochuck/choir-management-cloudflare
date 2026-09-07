import type { z } from "zod";

import { resolveOrCreateContactForCommerce } from "../commerceContacts";
import { findOrCreatePatron, upsertPatronAfterDonation } from "./patrons";
import { donationById, donationResult } from "./queries";
import type { createManualDonationOperationSchema } from "./types";

export function createManualDonation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof createManualDonationOperationSchema>,
): Response {
  const donation = operation.donation;
  const occurredAt = donation.receivedAt ?? new Date().toISOString();
  const now = new Date().toISOString();
  const thankYouSentAt = donation.thankYouSent ? now : null;
  const buyerEmail = donation.buyerEmail.trim().toLowerCase();

  // Phase 8: manual donations are recorded paid, so they link a Contact up
  // front. A missing email yields null (no bogus contact) and stores NULL.
  const manualContactId = resolveOrCreateContactForCommerce(storage, {
    buyerEmail,
    buyerName: donation.buyerName,
    existingContactId: null,
    marketingOptIn: donation.marketingConsent,
    occurredAt: now,
    source: "donation",
  });

  storage.transactionSync(() => {
    let patronId: string | null = null;
    if (buyerEmail) {
      patronId = findOrCreatePatron(storage, donation.buyerName, buyerEmail, occurredAt);
      upsertPatronAfterDonation(storage, patronId, donation.amountCents, occurredAt);
    }
    const checkoutRequestId = crypto.randomUUID();
    const providerSessionId = `manual_${operation.donationId}`;
    storage.sql.exec(
      `INSERT INTO donations (
        id, checkout_request_id, status, amount_cents, fee_cents,
        payment_method, payment_reference, thank_you_sent_at,
        tribute_type, tribute_name, tribute_notify_email,
        anonymous, marketing_consent, buyer_name, buyer_email,
        patron_id, provider_session_id, provider_payment_id,
        created_at, updated_at, contact_id
      ) VALUES (?, ?, 'paid', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
      operation.donationId,
      checkoutRequestId,
      donation.amountCents,
      donation.paymentMethod,
      donation.paymentReference,
      thankYouSentAt,
      donation.tributeType,
      donation.tributeName,
      donation.tributeNotifyEmail,
      donation.anonymous ? 1 : 0,
      donation.marketingConsent ? 1 : 0,
      donation.buyerName,
      buyerEmail,
      patronId,
      providerSessionId,
      occurredAt,
      now,
      manualContactId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'donation.manual_created', 'donation', ?, ?, ?, ?)`,
      `manual-donation:${operation.requestId}`,
      operation.actorUserId,
      operation.donationId,
      operation.requestId,
      JSON.stringify({
        amountCents: donation.amountCents,
        buyerName: donation.buyerName,
        paymentMethod: donation.paymentMethod,
      }),
      now,
    );
  });
  const created = donationById(storage, operation.donationId);
  return created
    ? Response.json(donationResult(created), { status: 201 })
    : Response.json({ code: "donation_not_created" }, { status: 503 });
}
