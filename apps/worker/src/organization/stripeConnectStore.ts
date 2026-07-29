import { z } from "zod";
import type { SqlStorageValue } from "@cloudflare/workers-types";

const stripeConnectOperationSchema = z.object({
  accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  actorUserId: z.string().min(1).max(128),
  chargesEnabled: z.boolean(),
  detailsSubmitted: z.boolean(),
  organizationId: z.string().min(1).max(128),
  payoutsEnabled: z.boolean(),
  requestId: z.uuid(),
  requirementsDue: z.array(z.string().min(1).max(200)).max(100),
});

interface StripeConnectRow {
  readonly [column: string]: SqlStorageValue;
  readonly accountId: string;
  readonly chargesEnabled: number;
  readonly createdAt: string;
  readonly detailsSubmitted: number;
  readonly organizationId: string;
  readonly payoutsEnabled: number;
  readonly requirementsDueJson: string;
  readonly updatedAt: string;
}

export interface StripeConnectStatus {
  readonly accountId: string | null;
  readonly chargesEnabled: boolean;
  readonly detailsSubmitted: boolean;
  readonly payoutsEnabled: boolean;
  readonly requirementsDue: string[];
  readonly status: "not_started" | "onboarding" | "restricted" | "ready";
}

function statusFor(row: {
  readonly accountId: string | null;
  readonly chargesEnabled: boolean;
  readonly detailsSubmitted: boolean;
  readonly payoutsEnabled: boolean;
  readonly requirementsDue: string[];
}): StripeConnectStatus["status"] {
  if (!row.accountId) return "not_started";
  if (row.chargesEnabled && row.payoutsEnabled && row.requirementsDue.length === 0) {
    return "ready";
  }
  return row.detailsSubmitted ? "restricted" : "onboarding";
}

function parseRequirements(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return z.array(z.string().min(1).max(200)).max(100).catch([]).parse(parsed);
}

function readRow(storage: DurableObjectStorage): StripeConnectRow | undefined {
  return storage.sql
    .exec<StripeConnectRow>(
      `SELECT organization_id AS organizationId, account_id AS accountId,
         details_submitted AS detailsSubmitted, charges_enabled AS chargesEnabled,
         payouts_enabled AS payoutsEnabled, requirements_due_json AS requirementsDueJson,
         created_at AS createdAt, updated_at AS updatedAt
       FROM stripe_connect_accounts LIMIT 1`,
    )
    .toArray()
    .at(0);
}

export function readStripeConnectStatusFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (!organizationId || identity?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const row = readRow(storage);
  const accountId = row?.accountId ?? null;
  const requirementsDue = row ? parseRequirements(row.requirementsDueJson) : [];
  const detailsSubmitted = row?.detailsSubmitted === 1;
  const chargesEnabled = row?.chargesEnabled === 1;
  const payoutsEnabled = row?.payoutsEnabled === 1;
  return Response.json({
    accountId,
    chargesEnabled,
    detailsSubmitted,
    payoutsEnabled,
    requirementsDue,
    status: statusFor({
      accountId,
      chargesEnabled,
      detailsSubmitted,
      payoutsEnabled,
      requirementsDue,
    }),
  } satisfies StripeConnectStatus);
}

export async function upsertStripeConnectAccountInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = stripeConnectOperationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "validation_failed" }, { status: 400 });
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (identity?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const previous = readRow(storage);
  if (previous && previous.accountId !== parsed.data.accountId) {
    return Response.json({ code: "stripe_account_conflict" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `INSERT INTO stripe_connect_accounts
        (organization_id, account_id, details_submitted, charges_enabled, payouts_enabled,
         requirements_due_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organization_id) DO UPDATE SET
         account_id = excluded.account_id,
         details_submitted = excluded.details_submitted,
         charges_enabled = excluded.charges_enabled,
         payouts_enabled = excluded.payouts_enabled,
         requirements_due_json = excluded.requirements_due_json,
         updated_at = excluded.updated_at`,
      parsed.data.organizationId,
      parsed.data.accountId,
      parsed.data.detailsSubmitted ? 1 : 0,
      parsed.data.chargesEnabled ? 1 : 0,
      parsed.data.payoutsEnabled ? 1 : 0,
      JSON.stringify(parsed.data.requirementsDue),
      previous?.createdAt ?? occurredAt,
      occurredAt,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'stripe_connect.account_updated',
         'stripe_connect_account', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      parsed.data.actorUserId,
      parsed.data.accountId,
      parsed.data.requestId,
      JSON.stringify({
        chargesEnabled: parsed.data.chargesEnabled,
        detailsSubmitted: parsed.data.detailsSubmitted,
        payoutsEnabled: parsed.data.payoutsEnabled,
        requirementsDue: parsed.data.requirementsDue,
      }),
      occurredAt,
    );
  });
  return readStripeConnectStatusFromStore(storage, parsed.data.organizationId);
}
