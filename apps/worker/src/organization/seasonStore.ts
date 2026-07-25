import { duesCheckoutRequestSchema } from "@choir/contracts";
import { z } from "zod";

const organizationContextSchema = z.object({
  organizationId: z.string().min(1).max(128),
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

const operationSchema = z.discriminatedUnion("action", [
  createDuesCheckoutOperationSchema,
  refundOperationSchema,
]);

interface SeasonRow {
  readonly [column: string]: SqlStorageValue;
  readonly createdAt: string;
  readonly duesAmountCents: number;
  readonly endsAt: string;
  readonly id: string;
  readonly name: string;
  readonly startsAt: string;
  readonly updatedAt: string;
}

interface DuesRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountCents: number;
  readonly createdAt: string;
  readonly id: string;
  readonly paidAt: string | null;
  readonly profileId: string;
  readonly seasonId: string;
  readonly status: "paid" | "pending" | "refunded";
  readonly updatedAt: string;
}

const seasonSelect = `SELECT s.id, s.name, s.starts_at AS startsAt, s.ends_at AS endsAt,
  s.dues_amount_cents AS duesAmountCents, s.created_at AS createdAt, s.updated_at AS updatedAt
  FROM seasons s`;

const duesSelect = `SELECT d.id, d.season_id AS seasonId, d.profile_id AS profileId,
  d.amount_cents AS amountCents, d.status, d.paid_at AS paidAt,
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
    name: row.name,
    startsAt: row.startsAt,
    updatedAt: row.updatedAt,
  };
}

function duesResult(row: DuesRow) {
  return {
    amountCents: row.amountCents,
    createdAt: row.createdAt,
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
          (id, season_id, profile_id, amount_cents, provider_session_id, status, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
        duesId,
        operation.checkout.seasonId,
        profileId,
        season.duesAmountCents,
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
    case "create_dues_checkout":
      return createDuesCheckout(storage, operation.data);
    case "refund_dues":
      return refundDues(storage, operation.data);
  }
}
