import {
  duesCheckoutRequestSchema,
  seasonCreateRequestSchema,
  seasonUpdateRequestSchema,
} from "@choir/contracts";
import { transactionProcessingFeeCents } from "@choir/domain";
import { z } from "zod";

import { transactionFeeSettingsFromStore } from "./transactionFeeSettingsStore";

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
});

const refundOperationSchema = organizationContextSchema.extend({
  action: z.literal("refund_dues"),
  actorUserId: z.string().min(1).max(128),
  duesId: z.uuid(),
  requestId: z.uuid(),
});

const stripeDuesOperationSchema = organizationContextSchema.extend({
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

const operationSchema = z.discriminatedUnion("action", [
  seasonCreateOperationSchema,
  seasonUpdateOperationSchema,
  seasonActivateOperationSchema,
  seasonDeleteOperationSchema,
  createDuesCheckoutOperationSchema,
  refundOperationSchema,
  stripeDuesCompletedOperationSchema,
  stripeDuesExpiredOperationSchema,
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
  readonly profileId: string;
  readonly providerSessionId: string;
  readonly seasonId: string;
  readonly status: "paid" | "pending" | "refunded";
  readonly updatedAt: string;
}

const seasonSelect = `SELECT s.id, s.name, s.starts_at AS startsAt, s.ends_at AS endsAt,
  s.dues_amount_cents AS duesAmountCents, s.is_active AS isActive,
  s.created_at AS createdAt, s.updated_at AS updatedAt
  FROM seasons s`;

const duesSelect = `SELECT d.id, d.season_id AS seasonId, d.profile_id AS profileId,
  d.amount_cents AS amountCents, d.fee_cents AS feeCents, d.status, d.paid_at AS paidAt,
  d.provider_session_id AS providerSessionId,
  d.created_at AS createdAt, d.updated_at AS updatedAt
  FROM dues d`;

function identity(storage: DurableObjectStorage): { readonly organizationId: string } | undefined {
  return storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
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
    profileId: row.profileId,
    seasonId: row.seasonId,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

function createDuesCheckout(
  storage: DurableObjectStorage,
  operation: z.infer<typeof createDuesCheckoutOperationSchema>,
): Response {
  const season = storage.sql
    .exec<SeasonRow>(`${seasonSelect} WHERE s.id = ? LIMIT 1`, operation.checkout.seasonId)
    .toArray()
    .at(0);
  if (!season) return Response.json({ code: "season_not_found" }, { status: 404 });

  const now = new Date().toISOString();
  const sessionId = `fake_session_${crypto.randomUUID()}`;
  const feeCents = transactionProcessingFeeCents(
    season.duesAmountCents,
    transactionFeeSettingsFromStore(storage),
  );

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
      if (existing) continue;

      const duesId = crypto.randomUUID();
      storage.sql.exec(
        `INSERT INTO dues
          (id, season_id, profile_id, amount_cents, fee_cents, provider_session_id,
           status, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
        duesId,
        operation.checkout.seasonId,
        profileId,
        season.duesAmountCents,
        feeCents,
        sessionId,
        now,
        now,
      );
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
  });

  const url = new URL("/dues/success", operation.origin);
  return Response.json({
    checkoutMode: "fake",
    sessionId,
    url: url.href,
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
  const rows = storage.sql
    .exec<DuesRow>(
      `${duesSelect} WHERE d.provider_session_id = ? ORDER BY d.id`,
      operation.providerSessionId,
    )
    .toArray();
  if (rows.length === 0) return Response.json({ code: "dues_not_found" }, { status: 404 });
  if (stripeDuesEventWasProcessed(storage, operation.stripeEventId)) {
    return Response.json({ dues: rows.map(duesResult), duplicate: true });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    for (const row of rows) {
      if (row.status !== "pending") continue;
      storage.sql.exec(
        `UPDATE dues SET status = 'paid', paid_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
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
      JSON.stringify({
        paymentType: "dues",
        providerPaymentId: operation.providerPaymentId,
        providerSessionId: operation.providerSessionId,
        duesCount: rows.length,
      }),
      occurredAt,
    );
  });
  const updated = storage.sql
    .exec<DuesRow>(
      `${duesSelect} WHERE d.provider_session_id = ? ORDER BY d.id`,
      operation.providerSessionId,
    )
    .toArray();
  return Response.json({ dues: updated.map(duesResult) });
}

function expireStripeDues(
  storage: DurableObjectStorage,
  operation: z.infer<typeof stripeDuesExpiredOperationSchema>,
): Response {
  const rows = storage.sql
    .exec<DuesRow>(
      `${duesSelect} WHERE d.provider_session_id = ? ORDER BY d.id`,
      operation.providerSessionId,
    )
    .toArray();
  if (rows.length === 0) return Response.json({ code: "dues_not_found" }, { status: 404 });
  if (stripeDuesEventWasProcessed(storage, operation.stripeEventId)) {
    return Response.json({ dues: rows.map(duesResult), duplicate: true });
  }
  const occurredAt = new Date().toISOString();
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
  return Response.json({ dues: rows.map(duesResult) });
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
    case "refund_dues":
      return refundDues(storage, operation.data);
    case "stripe_dues_completed":
      return completeStripeDues(storage, operation.data);
    case "stripe_dues_expired":
      return expireStripeDues(storage, operation.data);
  }
}
