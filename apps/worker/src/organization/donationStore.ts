import { donationCheckoutRequestSchema, donationTributeTypeSchema } from "@choir/contracts";
import { z } from "zod";

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

const operationSchema = z.discriminatedUnion("action", [
  createCheckoutOperationSchema,
  refundOperationSchema,
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
  readonly id: string;
  readonly marketingConsent: number;
  readonly patronId: string | null;
  readonly status: "paid" | "pending" | "refunded";
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

const donationSelect = `SELECT d.id, d.status, d.amount_cents AS amountCents,
  d.tribute_type AS tributeType, d.tribute_name AS tributeName,
  d.tribute_notify_email AS tributeNotifyEmail, d.anonymous,
  d.marketing_consent AS marketingConsent,
  d.buyer_name AS buyerName, d.buyer_email AS buyerEmail,
  d.patron_id AS patronId, d.created_at AS createdAt, d.updated_at AS updatedAt
  FROM donations d`;

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
         tribute_type, tribute_name, tribute_notify_email,
         anonymous, marketing_consent,
         buyer_name, buyer_email, patron_id,
         provider_session_id, provider_payment_id,
         created_at, updated_at)
       VALUES (?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      operation.donationId,
      operation.checkout.checkoutRequestId,
      operation.checkout.amountCents,
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
  }
}
