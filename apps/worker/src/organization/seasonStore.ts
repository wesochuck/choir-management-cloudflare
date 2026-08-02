import {
  duesCashPaymentRequestSchema,
  duesCheckoutRequestSchema,
  seasonCreateRequestSchema,
  seasonUpdateRequestSchema,
} from "@choir/contracts";
import { transactionProcessingFeeCents } from "@choir/domain";
import { z } from "zod";

import { transactionFeeSettingsFromStore } from "./transactionFeeSettingsStore";
import { queuePaymentNotificationInStore } from "./paymentNotificationStore";
import { renderPaymentMessageTemplate } from "./paymentMessageTemplates";

const PENDING_DUES_EXPIRY_MS = 7 * 24 * 60 * 60 * 1_000;

const organizationContextSchema = z.object({
  organizationId: z.string().min(1).max(128),
});

const seasonCreateOperationSchema = organizationContextSchema.extend({
  action: z.literal("create_season"),
  actorUserId: z.string().min(1).max(128),
  requestId: z.uuid(),
  season: seasonCreateRequestSchema,
  seasonId: z.uuid(),
});

const seasonUpdateOperationSchema = organizationContextSchema.extend({
  action: z.literal("update_season"),
  actorUserId: z.string().min(1).max(128),
  requestId: z.uuid(),
  season: seasonUpdateRequestSchema,
  seasonId: z.uuid(),
});

const seasonActivateOperationSchema = organizationContextSchema.extend({
  action: z.literal("activate_season"),
  actorUserId: z.string().min(1).max(128),
  requestId: z.uuid(),
  seasonId: z.uuid(),
});

const seasonDeleteOperationSchema = organizationContextSchema.extend({
  action: z.literal("delete_season"),
  actorUserId: z.string().min(1).max(128),
  requestId: z.uuid(),
  seasonId: z.uuid(),
});

const createDuesCheckoutOperationSchema = organizationContextSchema.extend({
  action: z.literal("create_dues_checkout"),
  checkout: duesCheckoutRequestSchema,
  requestId: z.uuid(),
  origin: z.string(),
  recipientEmail: z.email().optional(),
  providerSessionId: z.string().trim().min(1).max(256).optional(),
});

const prepareDuesCheckoutOperationSchema = organizationContextSchema.extend({
  action: z.literal("prepare_dues_checkout"),
  checkout: duesCheckoutRequestSchema,
  requestId: z.uuid(),
  origin: z.string(),
  recipientEmail: z.email().optional(),
  providerSessionId: z.string().trim().min(1).max(256),
});

const attachDuesSessionOperationSchema = organizationContextSchema.extend({
  action: z.literal("attach_dues_session"),
  providerSessionId: z.string().trim().min(1).max(256),
  requestId: z.uuid(),
});

const refundOperationSchema = organizationContextSchema.extend({
  action: z.literal("refund_dues"),
  actorUserId: z.string().min(1).max(128),
  duesId: z.uuid(),
  requestId: z.uuid(),
});

const cashPaymentOperationSchema = organizationContextSchema.extend({
  action: z.literal("mark_dues_cash_paid"),
  actorUserId: z.string().min(1).max(128),
  cashPayment: duesCashPaymentRequestSchema,
  requestId: z.uuid(),
});

const stripeDuesOperationSchema = organizationContextSchema.extend({
  checkoutRequestId: z.uuid().optional(),
  providerPaymentId: z.string().trim().max(256),
  providerSessionId: z.string().trim().min(1).max(256),
  stripeEventId: z.string().trim().min(1).max(256),
});
const stripeDuesCompletedOperationSchema = stripeDuesOperationSchema.extend({
  action: z.literal("stripe_dues_completed"),
});
const stripeDuesExpiredOperationSchema = stripeDuesOperationSchema.extend({
  action: z.literal("stripe_dues_expired"),
});
const stripeDuesRefundedOperationSchema = organizationContextSchema.extend({
  action: z.literal("stripe_dues_refunded"),
  providerPaymentId: z.string().trim().min(1).max(256),
  stripeEventId: z.string().trim().min(1).max(256),
});

const operationSchema = z.discriminatedUnion("action", [
  seasonCreateOperationSchema,
  seasonUpdateOperationSchema,
  seasonActivateOperationSchema,
  seasonDeleteOperationSchema,
  createDuesCheckoutOperationSchema,
  prepareDuesCheckoutOperationSchema,
  attachDuesSessionOperationSchema,
  refundOperationSchema,
  cashPaymentOperationSchema,
  stripeDuesCompletedOperationSchema,
  stripeDuesExpiredOperationSchema,
  stripeDuesRefundedOperationSchema,
]);

interface SeasonRow {
  readonly [column: string]: SqlStorageValue;
  readonly createdAt: string;
  readonly duesAmountCents: number;
  readonly endsAt: string;
  readonly id: string;
  readonly isActive: number;
  readonly name: string;
  readonly startsAt: string;
  readonly updatedAt: string;
}

interface DuesRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountCents: number;
  readonly createdAt: string;
  readonly feeCents: number;
  readonly id: string;
  readonly paidAt: string | null;
  readonly payerEmail: string;
  readonly payerName: string;
  readonly paymentMethod: "cash" | "online";
  readonly profileId: string;
  readonly providerPaymentId: string;
  readonly providerSessionId: string;
  readonly refundRequested: number;
  readonly seasonId: string;
  readonly status: "expired" | "paid" | "pending" | "refunded";
  readonly updatedAt: string;
}

const seasonSelect = `SELECT s.id, s.name, s.starts_at AS startsAt, s.ends_at AS endsAt,
  s.dues_amount_cents AS duesAmountCents, s.is_active AS isActive,
  s.created_at AS createdAt, s.updated_at AS updatedAt
  FROM seasons s`;

const duesSelect = `SELECT d.id, d.season_id AS seasonId, d.profile_id AS profileId,
  d.amount_cents AS amountCents, d.fee_cents AS feeCents,
  CASE WHEN de.dues_id IS NOT NULL AND d.status = 'pending' THEN 'expired' ELSE d.status END AS status,
  d.paid_at AS paidAt,
  d.payment_method AS paymentMethod,
  d.payer_email AS payerEmail,
  COALESCE(p.display_name, 'Member') AS payerName,
  d.provider_payment_id AS providerPaymentId,
  d.provider_session_id AS providerSessionId,
  EXISTS (SELECT 1 FROM payment_attempts pa
    WHERE pa.payment_type = 'dues'
      AND pa.provider_payment_id = d.provider_payment_id
      AND pa.refund_requested_at IS NOT NULL) AS refundRequested,
  d.created_at AS createdAt, d.updated_at AS updatedAt
  FROM dues d
  LEFT JOIN profiles p ON p.id = d.profile_id
  LEFT JOIN dues_expirations de ON de.dues_id = d.id`;

function duesByStripeOperation(
  storage: DurableObjectStorage,
  providerSessionId: string,
  checkoutRequestId?: string,
): DuesRow[] {
  return storage.sql
    .exec<DuesRow>(
      `${duesSelect}
       WHERE d.provider_session_id = ?
          OR (
            ? IS NOT NULL AND EXISTS (
              SELECT 1 FROM payment_attempts pa
              WHERE pa.payment_type = 'dues'
                AND pa.checkout_request_id = ?
                AND (
                  pa.provider_session_id = d.provider_session_id
                  OR pa.resource_id = d.id
                )
            )
          )
       ORDER BY d.id`,
      providerSessionId,
      checkoutRequestId ?? null,
      checkoutRequestId ?? null,
    )
    .toArray();
}

interface DuesPaymentAttemptRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountCents: number;
  readonly providerSessionId: string;
  readonly status: "expired" | "paid" | "pending" | "refunded";
}

function paymentAttemptByCheckoutRequest(
  storage: DurableObjectStorage,
  checkoutRequestId: string,
): DuesPaymentAttemptRow | undefined {
  return storage.sql
    .exec<DuesPaymentAttemptRow>(
      `SELECT amount_cents AS amountCents, provider_session_id AS providerSessionId, status
       FROM payment_attempts
       WHERE payment_type = 'dues' AND checkout_request_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      checkoutRequestId,
    )
    .toArray()
    .at(0);
}

function duesForCheckoutRequest(
  storage: DurableObjectStorage,
  checkoutRequestId: string,
  providerSessionId: string,
): DuesRow[] {
  return duesByStripeOperation(storage, providerSessionId, checkoutRequestId);
}

function sameDuesCheckout(
  rows: readonly DuesRow[],
  checkout: z.infer<typeof duesCheckoutRequestSchema>,
  recipientEmail: string | undefined,
  amountCents: number,
  feeCents: number,
): boolean {
  if (rows.length !== checkout.profileIds.length) return false;
  const expectedProfiles = new Set(checkout.profileIds);
  return (
    new Set(rows.map((row) => row.profileId)).size === expectedProfiles.size &&
    rows.every(
      (row) =>
        row.seasonId === checkout.seasonId &&
        expectedProfiles.has(row.profileId) &&
        row.amountCents === amountCents &&
        row.feeCents === feeCents &&
        row.payerEmail === (recipientEmail ?? "").toLowerCase(),
    )
  );
}

function identity(storage: DurableObjectStorage): { readonly organizationId: string } | undefined {
  return storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
}

function releaseStalePendingDuesAttempt(storage: DurableObjectStorage, duesId: string): boolean {
  const pendingAttempt = storage.sql
    .exec<{ readonly createdAt: string; readonly id: string }>(
      `SELECT id, created_at AS createdAt FROM payment_attempts
       WHERE payment_type = 'dues' AND resource_id = ? AND status = 'pending'
       LIMIT 1`,
      duesId,
    )
    .toArray()
    .at(0);
  if (!pendingAttempt) return true;
  const createdAt = new Date(pendingAttempt.createdAt).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt < PENDING_DUES_EXPIRY_MS) {
    return false;
  }
  const expiredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT OR IGNORE INTO dues_expirations (dues_id, stripe_event_id, expired_at)
       VALUES (?, ?, ?)`,
      duesId,
      `stale-cash-release:${duesId}`,
      expiredAt,
    );
    storage.sql.exec(
      `UPDATE payment_attempts
       SET status = 'expired', expired_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
      expiredAt,
      expiredAt,
      pendingAttempt.id,
    );
  });
  return true;
}

function seasonResult(row: SeasonRow) {
  return {
    createdAt: row.createdAt,
    duesAmountCents: row.duesAmountCents,
    endsAt: row.endsAt,
    id: row.id,
    isActive: row.isActive === 1,
    name: row.name,
    startsAt: row.startsAt,
    updatedAt: row.updatedAt,
  };
}

function seasonById(storage: DurableObjectStorage, seasonId: string): SeasonRow | undefined {
  return storage.sql
    .exec<SeasonRow>(`${seasonSelect} WHERE s.id = ? LIMIT 1`, seasonId)
    .toArray()
    .at(0);
}

function validateSeasonInput(
  storage: DurableObjectStorage,
  season: z.infer<typeof seasonCreateRequestSchema>,
  excludedSeasonId?: string,
): Response | null {
  if (new Date(season.endsAt).getTime() < new Date(season.startsAt).getTime()) {
    return Response.json(
      { code: "season_dates_invalid", message: "End date cannot be before start date." },
      { status: 400 },
    );
  }
  const overlap = storage.sql
    .exec<SeasonRow>(`${seasonSelect} ORDER BY s.starts_at ASC, s.id ASC`)
    .toArray()
    .find(
      (candidate) =>
        candidate.id !== excludedSeasonId &&
        season.startsAt <= candidate.endsAt &&
        season.endsAt >= candidate.startsAt,
    );
  return overlap
    ? Response.json(
        {
          code: "season_overlap",
          message: `The selected dates overlap with ${overlap.name}.`,
        },
        { status: 409 },
      )
    : null;
}

function createSeason(
  storage: DurableObjectStorage,
  operation: z.infer<typeof seasonCreateOperationSchema>,
): Response {
  const validation = validateSeasonInput(storage, operation.season);
  if (validation) return validation;
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO seasons
        (id, name, starts_at, ends_at, dues_amount_cents, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      operation.seasonId,
      operation.season.name,
      operation.season.startsAt,
      operation.season.endsAt,
      operation.season.duesAmountCents,
      occurredAt,
      occurredAt,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'season.created', 'season', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      operation.actorUserId,
      operation.seasonId,
      operation.requestId,
      JSON.stringify(operation.season),
      occurredAt,
    );
  });
  const created = seasonById(storage, operation.seasonId);
  return created
    ? Response.json(seasonResult(created), { status: 201 })
    : Response.json({ code: "season_not_found" }, { status: 404 });
}

function updateSeason(
  storage: DurableObjectStorage,
  operation: z.infer<typeof seasonUpdateOperationSchema>,
): Response {
  if (!seasonById(storage, operation.seasonId)) {
    return Response.json({ code: "season_not_found" }, { status: 404 });
  }
  const validation = validateSeasonInput(storage, operation.season, operation.seasonId);
  if (validation) return validation;
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE seasons
       SET name = ?, starts_at = ?, ends_at = ?, dues_amount_cents = ?, updated_at = ?
       WHERE id = ?`,
      operation.season.name,
      operation.season.startsAt,
      operation.season.endsAt,
      operation.season.duesAmountCents,
      occurredAt,
      operation.seasonId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'season.updated', 'season', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      operation.actorUserId,
      operation.seasonId,
      operation.requestId,
      JSON.stringify(operation.season),
      occurredAt,
    );
  });
  const updated = seasonById(storage, operation.seasonId);
  return updated
    ? Response.json(seasonResult(updated))
    : Response.json({ code: "season_not_found" }, { status: 404 });
}

function activateSeason(
  storage: DurableObjectStorage,
  operation: z.infer<typeof seasonActivateOperationSchema>,
): Response {
  if (!seasonById(storage, operation.seasonId)) {
    return Response.json({ code: "season_not_found" }, { status: 404 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec("UPDATE seasons SET is_active = 0, updated_at = ?", occurredAt);
    storage.sql.exec(
      "UPDATE seasons SET is_active = 1, updated_at = ? WHERE id = ?",
      occurredAt,
      operation.seasonId,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'season.activated', 'season', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      operation.actorUserId,
      operation.seasonId,
      operation.requestId,
      JSON.stringify({ seasonId: operation.seasonId }),
      occurredAt,
    );
  });
  const activated = seasonById(storage, operation.seasonId);
  return activated
    ? Response.json(seasonResult(activated))
    : Response.json({ code: "season_not_found" }, { status: 404 });
}

function deleteSeason(
  storage: DurableObjectStorage,
  operation: z.infer<typeof seasonDeleteOperationSchema>,
): Response {
  if (!seasonById(storage, operation.seasonId)) {
    return Response.json({ code: "season_not_found" }, { status: 404 });
  }
  try {
    storage.transactionSync(() => {
      storage.sql.exec("DELETE FROM seasons WHERE id = ?", operation.seasonId);
      storage.sql.exec(
        `INSERT INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'organization_member', ?, 'season.deleted', 'season', ?, ?, ?, ?)`,
        crypto.randomUUID(),
        operation.actorUserId,
        operation.seasonId,
        operation.requestId,
        JSON.stringify({ seasonId: operation.seasonId }),
        new Date().toISOString(),
      );
    });
  } catch {
    return Response.json(
      {
        code: "season_has_dues",
        message: "This season has dues records and cannot be deleted.",
      },
      { status: 409 },
    );
  }
  return Response.json({ deleted: true, seasonId: operation.seasonId });
}

function duesResult(row: DuesRow) {
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
function createDuesCheckout(
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
  const feeCents = transactionProcessingFeeCents(
    season.duesAmountCents,
    transactionFeeSettingsFromStore(storage),
  );

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
        feeCents,
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
      for (const profileId of operation.checkout.profileIds) {
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
        if (
          existing?.status === "pending" &&
          existing.providerSessionId &&
          !existing.providerSessionId.startsWith("pending_")
        ) {
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
            feeCents,
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
            feeCents,
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
            feeCents,
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
          (season.duesAmountCents + feeCents) * operation.checkout.profileIds.length,
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

function attachDuesSession(
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

function refundDues(
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

function markDuesCashPaid(
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

function completeStripeDues(
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

function expireStripeDues(
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

function refundStripeDues(
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

export function listSeasonsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (identity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({
    seasons: storage.sql
      .exec<SeasonRow>(`${seasonSelect} ORDER BY s.created_at DESC, s.id DESC LIMIT 500`)
      .toArray()
      .map(seasonResult),
  });
}

export function listDuesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (identity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({
    dues: storage.sql
      .exec<DuesRow>(`${duesSelect} ORDER BY d.created_at DESC, d.id DESC LIMIT 500`)
      .toArray()
      .map(duesResult),
  });
}

export function readMemberActiveSeasonFromStore(
  storage: DurableObjectStorage,
  input: { readonly organizationId: string | null; readonly profileId: string | null },
): Response {
  if (identity(storage)?.organizationId !== input.organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const profileId = z.uuid().safeParse(input.profileId);
  if (!profileId.success) return Response.json({ code: "profile_not_found" }, { status: 404 });
  const season = storage.sql
    .exec<SeasonRow>(`${seasonSelect} WHERE s.is_active = 1 LIMIT 1`)
    .toArray()
    .at(0);
  if (!season) return Response.json({ activeSeason: null });
  const dues = storage.sql
    .exec<DuesRow>(
      `${duesSelect} WHERE d.season_id = ? AND d.profile_id = ? ORDER BY d.updated_at DESC LIMIT 1`,
      season.id,
      profileId.data,
    )
    .toArray()
    .at(0);
  return Response.json({
    activeSeason: {
      duesStatus: dues ? duesResult(dues).status : null,
      season: seasonResult(season),
    },
  });
}

// eslint-disable-next-line complexity -- dispatches the typed Organization season/payment operations.
export async function manageSeasonsInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const operation = operationSchema.safeParse(await request.json().catch(() => null));
  if (!operation.success) {
    return Response.json({ code: "invalid_season_operation" }, { status: 400 });
  }
  const organization = identity(storage);
  if (organization?.organizationId !== operation.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  switch (operation.data.action) {
    case "create_season":
      return createSeason(storage, operation.data);
    case "update_season":
      return updateSeason(storage, operation.data);
    case "activate_season":
      return activateSeason(storage, operation.data);
    case "delete_season":
      return deleteSeason(storage, operation.data);
    case "create_dues_checkout":
      return createDuesCheckout(storage, operation.data);
    case "prepare_dues_checkout":
      return createDuesCheckout(storage, operation.data);
    case "attach_dues_session":
      return attachDuesSession(storage, operation.data);
    case "refund_dues":
      return refundDues(storage, operation.data);
    case "mark_dues_cash_paid":
      return markDuesCashPaid(storage, operation.data);
    case "stripe_dues_completed":
      return completeStripeDues(storage, operation.data);
    case "stripe_dues_expired":
      return expireStripeDues(storage, operation.data);
    case "stripe_dues_refunded":
      return refundStripeDues(storage, operation.data);
  }
}
