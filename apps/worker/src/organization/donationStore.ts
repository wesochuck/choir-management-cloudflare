import { donationCheckoutRequestSchema, donationTributeTypeSchema } from "@choir/contracts";
import { transactionProcessingFeeCents } from "@choir/domain";
import { z } from "zod";

import { transactionFeeSettingsFromStore } from "./transactionFeeSettingsStore";

const organizationContextSchema = z.object({
  organizationId: z.string().min(1).max(128),
});

const createCheckoutOperationSchema = organizationContextSchema.extend({
  action: z.literal("create_donation_checkout"),
  checkout: donationCheckoutRequestSchema,
  donationId: z.uuid(),
  providerSessionId: z.string().min(1).max(256),
});

const refundOperationSchema = organizationContextSchema.extend({
  action: z.literal("refund_donation"),
  actorUserId: z.string().min(1).max(128),
  donationId: z.uuid(),
  requestId: z.uuid(),
});

const stripeDonationOperationSchema = organizationContextSchema.extend({
  providerPaymentId: z.string().trim().max(256),
  providerSessionId: z.string().trim().min(1).max(256),
  stripeEventId: z.string().trim().min(1).max(256),
});
const stripeDonationCompletedOperationSchema = stripeDonationOperationSchema.extend({
  action: z.literal("stripe_donation_completed"),
});
const stripeDonationExpiredOperationSchema = stripeDonationOperationSchema.extend({
  action: z.literal("stripe_donation_expired"),
});
const stripeDonationRefundedOperationSchema = organizationContextSchema.extend({
  action: z.literal("stripe_donation_refunded"),
  providerPaymentId: z.string().trim().min(1).max(256),
  stripeEventId: z.string().trim().min(1).max(256),
});

const operationSchema = z.discriminatedUnion("action", [
  createCheckoutOperationSchema,
  refundOperationSchema,
  stripeDonationCompletedOperationSchema,
  stripeDonationExpiredOperationSchema,
  stripeDonationRefundedOperationSchema,
]);

interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

interface DonationRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountCents: number;
  readonly anonymous: number;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly createdAt: string;
  readonly expiredAt: string | null;
  readonly feeCents: number;
  readonly id: string;
  readonly marketingConsent: number;
  readonly patronId: string | null;
  readonly providerPaymentId: string;
  readonly providerSessionId: string;
  readonly status: "expired" | "paid" | "pending" | "refunded";
  readonly tributeName: string;
  readonly tributeNotifyEmail: string;
  readonly tributeType: string;
  readonly updatedAt: string;
}

interface PatronRow {
  readonly [column: string]: SqlStorageValue;
  readonly donationCount: number;
  readonly email: string;
  readonly firstDonatedAt: string;
  readonly id: string;
  readonly lastDonatedAt: string;
  readonly name: string;
  readonly totalDonatedCents: number;
}

const donationSelect = `SELECT d.id,
  CASE WHEN de.donation_id IS NOT NULL AND d.status = 'pending' THEN 'expired' ELSE d.status END AS status,
  de.expired_at AS expiredAt, d.amount_cents AS amountCents,
  d.fee_cents AS feeCents,
  d.tribute_type AS tributeType, d.tribute_name AS tributeName,
  d.tribute_notify_email AS tributeNotifyEmail, d.anonymous,
  d.marketing_consent AS marketingConsent,
  d.buyer_name AS buyerName, d.buyer_email AS buyerEmail,
  d.patron_id AS patronId, d.provider_session_id AS providerSessionId,
  d.provider_payment_id AS providerPaymentId,
  d.created_at AS createdAt, d.updated_at AS updatedAt
  FROM donations d LEFT JOIN donation_expirations de ON de.donation_id = d.id`;

function identity(storage: DurableObjectStorage): IdentityRow | undefined {
  return storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
}

function donationResult(row: DonationRow) {
  const tributeTypeParsed = donationTributeTypeSchema.safeParse(row.tributeType);
  const tributeType = tributeTypeParsed.success ? tributeTypeParsed.data : "none";
  return {
    amountCents: row.amountCents,
    anonymous: row.anonymous === 1,
    buyerEmail: row.buyerEmail,
    buyerName: row.buyerName,
    createdAt: row.createdAt,
    expiredAt: row.expiredAt,
    feeCents: row.feeCents,
    id: row.id,
    marketingConsent: row.marketingConsent === 1,
    patronId: row.patronId,
    status: row.status,
    tributeName: row.tributeName,
    tributeNotifyEmail: row.tributeNotifyEmail,
    tributeType,
    updatedAt: row.updatedAt,
  };
}

function donationById(storage: DurableObjectStorage, donationId: string): DonationRow | undefined {
  return storage.sql
    .exec<DonationRow>(`${donationSelect} WHERE d.id = ? LIMIT 1`, donationId)
    .toArray()
    .at(0);
}

function donationByCheckoutRequest(
  storage: DurableObjectStorage,
  checkoutRequestId: string,
): DonationRow | undefined {
  return storage.sql
    .exec<DonationRow>(
      `${donationSelect} WHERE d.checkout_request_id = ? LIMIT 1`,
      checkoutRequestId,
    )
    .toArray()
    .at(0);
}

function sameCheckoutRequest(
  existing: DonationRow,
  checkout: z.infer<typeof createCheckoutOperationSchema>["checkout"],
): boolean {
  return (
    existing.buyerName === checkout.buyerName &&
    existing.buyerEmail === checkout.buyerEmail.toLowerCase() &&
    existing.amountCents === checkout.amountCents &&
    existing.anonymous === (checkout.anonymous ? 1 : 0) &&
    existing.marketingConsent === (checkout.marketingConsent ? 1 : 0) &&
    existing.tributeType === checkout.tributeType &&
    existing.tributeName === checkout.tributeName &&
    existing.tributeNotifyEmail === checkout.tributeNotifyEmail
  );
}

function findOrCreatePatron(
  storage: DurableObjectStorage,
  name: string,
  email: string,
  occurredAt: string,
): string {
  const lowerEmail = email.toLowerCase();
  const existing = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM patrons WHERE email = ? LIMIT 1",
      lowerEmail,
    )
    .toArray()
    .at(0);
  if (existing) return existing.id;
  const patronId = crypto.randomUUID();
  storage.sql.exec(
    `INSERT INTO patrons (id, name, email, total_donated_cents, donation_count,
      first_donated_at, last_donated_at, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)`,
    patronId,
    name,
    lowerEmail,
    occurredAt,
    occurredAt,
    occurredAt,
    occurredAt,
  );
  return patronId;
}

function upsertPatronAfterDonation(
  storage: DurableObjectStorage,
  patronId: string,
  amountCents: number,
  occurredAt: string,
): void {
  storage.sql.exec(
    `UPDATE patrons SET
      total_donated_cents = total_donated_cents + ?,
      donation_count = donation_count + 1,
      last_donated_at = ?,
      updated_at = ?
     WHERE id = ?`,
    amountCents,
    occurredAt,
    occurredAt,
    patronId,
  );
}

function createDonationCheckout(
  storage: DurableObjectStorage,
  operation: z.infer<typeof createCheckoutOperationSchema>,
): Response {
  const existing = donationByCheckoutRequest(storage, operation.checkout.checkoutRequestId);
  if (existing) {
    return sameCheckoutRequest(existing, operation.checkout)
      ? Response.json(donationResult(existing))
      : Response.json({ code: "donation_checkout_conflict" }, { status: 409 });
  }
  const now = new Date().toISOString();
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
       VALUES (?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      operation.donationId,
      operation.checkout.checkoutRequestId,
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
      `fake_payment_${operation.donationId}`,
      now,
      now,
    );
    upsertPatronAfterDonation(storage, patronId, operation.checkout.amountCents, now);
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'public_visitor', 'anonymous', 'donation.created',
        'donation', ?, ?, ?, ?)`,
      `donation:${operation.checkout.checkoutRequestId}`,
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
  return created
    ? Response.json(donationResult(created), { status: 201 })
    : Response.json({ code: "donation_not_created" }, { status: 503 });
}

function refundDonation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof refundOperationSchema>,
): Response {
  const row = donationById(storage, operation.donationId);
  if (!row) return Response.json({ code: "donation_not_found" }, { status: 404 });
  if (row.status === "refunded") return Response.json(donationResult(row));
  if (row.status !== "paid") {
    return Response.json({ code: "donation_not_refundable" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE donations SET status = 'refunded', updated_at = ? WHERE id = ?",
      occurredAt,
      operation.donationId,
    );
    if (row.patronId) {
      storage.sql.exec(
        `UPDATE patrons SET
          total_donated_cents = MAX(0, total_donated_cents - ?),
          donation_count = MAX(0, donation_count - 1),
          updated_at = ?
         WHERE id = ?`,
        row.amountCents,
        occurredAt,
        row.patronId,
      );
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'donation.refunded',
        'donation', ?, ?, ?, ?)`,
      `donation-refund:${operation.requestId}`,
      operation.actorUserId,
      operation.donationId,
      operation.requestId,
      JSON.stringify({ amountCents: row.amountCents }),
      occurredAt,
    );
  });
  return Response.json({ ...donationResult(row), status: "refunded", updatedAt: occurredAt });
}

function stripeDonationEventWasProcessed(
  storage: DurableObjectStorage,
  eventId: string,
  prefix = "stripe-event:",
): boolean {
  return (
    storage.sql
      .exec("SELECT id FROM audit_events WHERE id = ? LIMIT 1", `${prefix}${eventId}`)
      .toArray().length > 0
  );
}

function completeStripeDonation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeDonationCompletedOperationSchema>,
): Response {
  const row = storage.sql
    .exec<DonationRow>(
      `${donationSelect} WHERE d.provider_session_id = ? LIMIT 1`,
      operation.providerSessionId,
    )
    .toArray()
    .at(0);
  if (!row) return Response.json({ code: "donation_not_found" }, { status: 404 });
  if (stripeDonationEventWasProcessed(storage, operation.stripeEventId)) {
    return Response.json({ ...donationResult(row), duplicate: true });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    if (row.status === "pending" || row.status === "expired") {
      storage.sql.exec(
        `UPDATE donations SET status = 'paid', provider_payment_id = ?, updated_at = ?
         WHERE provider_session_id = ? AND status = 'pending'`,
        operation.providerPaymentId,
        occurredAt,
        operation.providerSessionId,
      );
      storage.sql.exec("DELETE FROM donation_expirations WHERE donation_id = ?", row.id);
      if (row.patronId)
        upsertPatronAfterDonation(storage, row.patronId, row.amountCents, occurredAt);
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'provider', 'stripe', 'stripe.webhook.processed', 'stripe_event', ?, ?, ?, ?)`,
      `stripe-event:${operation.stripeEventId}`,
      operation.stripeEventId,
      operation.stripeEventId,
      JSON.stringify({
        paymentType: "donation",
        providerPaymentId: operation.providerPaymentId,
        providerSessionId: operation.providerSessionId,
        status: row.status === "pending" || row.status === "expired" ? "paid" : row.status,
      }),
      occurredAt,
    );
  });
  const updated = donationById(storage, row.id);
  return updated
    ? Response.json(donationResult(updated))
    : Response.json({ code: "donation_not_found" }, { status: 404 });
}

function expireStripeDonation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeDonationExpiredOperationSchema>,
): Response {
  const row = storage.sql
    .exec<DonationRow>(
      `${donationSelect} WHERE d.provider_session_id = ? LIMIT 1`,
      operation.providerSessionId,
    )
    .toArray()
    .at(0);
  if (!row) return Response.json({ code: "donation_not_found" }, { status: 404 });
  if (stripeDonationEventWasProcessed(storage, operation.stripeEventId)) {
    return Response.json({ ...donationResult(row), duplicate: true });
  }
  if (row.status === "expired") {
    return Response.json({ ...donationResult(row), duplicate: true });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    if (row.status === "pending") {
      storage.sql.exec(
        `INSERT INTO donation_expirations (donation_id, stripe_event_id, expired_at)
         VALUES (?, ?, ?)`,
        row.id,
        operation.stripeEventId,
        occurredAt,
      );
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'provider', 'stripe', 'stripe.webhook.processed', 'stripe_event', ?, ?, ?, ?)`,
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

function refundStripeDonation(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeDonationRefundedOperationSchema>,
): Response {
  if (stripeDonationEventWasProcessed(storage, operation.stripeEventId, "stripe-refund:")) {
    return Response.json({ refunded: 0, duplicate: true });
  }
  const rows = storage.sql
    .exec<DonationRow>(
      `${donationSelect} WHERE d.provider_payment_id = ? ORDER BY d.created_at, d.id`,
      operation.providerPaymentId,
    )
    .toArray();
  const occurredAt = new Date().toISOString();
  let refunded = 0;
  storage.transactionSync(() => {
    for (const row of rows) {
      if (row.status !== "paid") continue;
      storage.sql.exec(
        "UPDATE donations SET status = 'refunded', updated_at = ? WHERE id = ?",
        occurredAt,
        row.id,
      );
      if (row.patronId) {
        storage.sql.exec(
          `UPDATE patrons SET total_donated_cents = MAX(0, total_donated_cents - ?), donation_count = MAX(0, donation_count - 1), updated_at = ? WHERE id = ?`,
          row.amountCents,
          occurredAt,
          row.patronId,
        );
      }
      refunded += 1;
    }
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'provider', 'stripe', 'stripe.webhook.processed', 'stripe_event', ?, ?, ?, ?)`,
      `stripe-refund:${operation.stripeEventId}`,
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
  return rows.length === 0
    ? Response.json({ code: "donation_not_found" }, { status: 404 })
    : Response.json({ refunded });
}

export function listDonationsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (identity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({
    donations: storage.sql
      .exec<DonationRow>(`${donationSelect} ORDER BY d.created_at DESC, d.id DESC LIMIT 500`)
      .toArray()
      .map(donationResult),
  });
}

export function listPatronsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (identity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({
    patrons: storage.sql
      .exec<PatronRow>(
        `SELECT id, name, email, total_donated_cents AS totalDonatedCents,
          donation_count AS donationCount,
          first_donated_at AS firstDonatedAt,
          last_donated_at AS lastDonatedAt
         FROM patrons
         ORDER BY total_donated_cents DESC, name COLLATE NOCASE ASC, id ASC LIMIT 500`,
      )
      .toArray(),
  });
}

export async function manageDonationsInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const operation = operationSchema.safeParse(await request.json().catch(() => null));
  if (!operation.success) {
    return Response.json({ code: "invalid_donation_operation" }, { status: 400 });
  }
  const organization = identity(storage);
  if (organization?.organizationId !== operation.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  switch (operation.data.action) {
    case "create_donation_checkout":
      return createDonationCheckout(storage, operation.data);
    case "refund_donation":
      return refundDonation(storage, operation.data);
    case "stripe_donation_completed":
      return completeStripeDonation(storage, operation.data);
    case "stripe_donation_expired":
      return expireStripeDonation(storage, operation.data);
    case "stripe_donation_refunded":
      return refundStripeDonation(storage, operation.data);
  }
}
