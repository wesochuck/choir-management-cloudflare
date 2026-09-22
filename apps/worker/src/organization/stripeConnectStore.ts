import { z } from "zod";
import type { SqlStorageValue } from "@cloudflare/workers-types";
import { parseActivations } from "./paymentSettingsStore";

const stripeConnectOperationSchema = z.object({
  accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  actorUserId: z.string().min(1).max(128),
  cardPaymentsStatus: z.string().min(1).max(64).default("inactive"),
  chargesEnabled: z.boolean().default(false),
  dashboardType: z.string().min(1).max(64).default("full"),
  detailsSubmitted: z.boolean().default(false),
  feesCollector: z.string().min(1).max(64).default("stripe"),
  lossesCollector: z.string().min(1).max(64).default("stripe"),
  organizationId: z.string().min(1).max(128),
  payoutsEnabled: z.boolean().default(false),
  payoutsStatus: z.string().min(1).max(64).default("inactive"),
  requestId: z.uuid(),
  requirementsDue: z.array(z.string().min(1).max(200)).max(100).default([]),
  status: z.enum(["not_started", "onboarding", "restricted", "ready"]).default("onboarding"),
});

interface StripeConnectRow {
  readonly [column: string]: SqlStorageValue;
  readonly accountId: string;
  readonly cardPaymentsStatus: string | null;
  readonly chargesEnabled: number;
  readonly createdAt: string;
  readonly dashboardType: string | null;
  readonly detailsSubmitted: number;
  readonly feesCollector: string | null;
  readonly lastSyncedAt: string | null;
  readonly lossesCollector: string | null;
  readonly organizationId: string;
  readonly payoutsEnabled: number;
  readonly payoutsStatus: string | null;
  readonly requirementsDueJson: string;
  readonly status: string | null;
  readonly updatedAt: string;
}

export interface StripeConnectStatus {
  readonly accountId: string | null;
  readonly cardPaymentsStatus: string;
  readonly chargesEnabled: boolean;
  readonly dashboardType: string;
  readonly detailsSubmitted: boolean;
  readonly feesCollector: string;
  readonly lastSyncedAt: string | null;
  readonly lossesCollector: string;
  readonly payoutsEnabled: boolean;
  readonly payoutsStatus: string;
  readonly requirementsDue: string[];
  readonly status: "not_started" | "onboarding" | "restricted" | "ready";
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
         card_payments_status AS cardPaymentsStatus, payouts_status AS payoutsStatus,
         dashboard_type AS dashboardType, fees_collector AS feesCollector,
         losses_collector AS lossesCollector, last_synced_at AS lastSyncedAt,
         status AS status, created_at AS createdAt, updated_at AS updatedAt
       FROM stripe_connect_accounts LIMIT 1`,
    )
    .toArray()
    .at(0);
}

function computeStoreStatus(
  row: StripeConnectRow,
  chargesEnabled: boolean,
  payoutsEnabled: boolean,
  requirementsDue: string[],
): StripeConnectStatus["status"] {
  if (row.status === "ready" || row.status === "restricted" || row.status === "onboarding") {
    return row.status;
  }
  if (chargesEnabled && payoutsEnabled && requirementsDue.length === 0) {
    return "ready";
  }
  if (row.detailsSubmitted === 1 || row.cardPaymentsStatus === "restricted") {
    return "restricted";
  }
  return "onboarding";
}

function mapStoreRow(row: StripeConnectRow | undefined): StripeConnectStatus {
  if (!row?.accountId) {
    return {
      accountId: null,
      cardPaymentsStatus: "inactive",
      chargesEnabled: false,
      dashboardType: "full",
      detailsSubmitted: false,
      feesCollector: "stripe",
      lastSyncedAt: null,
      lossesCollector: "stripe",
      payoutsEnabled: false,
      payoutsStatus: "inactive",
      requirementsDue: [],
      status: "not_started",
    };
  }

  const requirementsDue = parseRequirements(row.requirementsDueJson);
  const cardPaymentsStatus =
    row.cardPaymentsStatus ?? (row.chargesEnabled === 1 ? "active" : "inactive");
  const payoutsStatus = row.payoutsStatus ?? (row.payoutsEnabled === 1 ? "active" : "inactive");
  const chargesEnabled = cardPaymentsStatus === "active" || row.chargesEnabled === 1;
  const payoutsEnabled = payoutsStatus === "active" || row.payoutsEnabled === 1;
  const detailsSubmitted = row.detailsSubmitted === 1;
  const status = computeStoreStatus(row, chargesEnabled, payoutsEnabled, requirementsDue);

  return {
    accountId: row.accountId,
    cardPaymentsStatus,
    chargesEnabled,
    dashboardType: row.dashboardType ?? "full",
    detailsSubmitted,
    feesCollector: row.feesCollector ?? "stripe",
    lastSyncedAt: row.lastSyncedAt ?? row.updatedAt,
    lossesCollector: row.lossesCollector ?? "stripe",
    payoutsEnabled,
    payoutsStatus,
    requirementsDue,
    status,
  };
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
  const status = mapStoreRow(row);
  return Response.json(status satisfies StripeConnectStatus);
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
         requirements_due_json, card_payments_status, payouts_status, dashboard_type,
         fees_collector, losses_collector, last_synced_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organization_id) DO UPDATE SET
         account_id = excluded.account_id,
         details_submitted = excluded.details_submitted,
         charges_enabled = excluded.charges_enabled,
         payouts_enabled = excluded.payouts_enabled,
         requirements_due_json = excluded.requirements_due_json,
         card_payments_status = excluded.card_payments_status,
         payouts_status = excluded.payouts_status,
         dashboard_type = excluded.dashboard_type,
         fees_collector = excluded.fees_collector,
         losses_collector = excluded.losses_collector,
         last_synced_at = excluded.last_synced_at,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      parsed.data.organizationId,
      parsed.data.accountId,
      parsed.data.detailsSubmitted ? 1 : 0,
      parsed.data.chargesEnabled ? 1 : 0,
      parsed.data.payoutsEnabled ? 1 : 0,
      JSON.stringify(parsed.data.requirementsDue),
      parsed.data.cardPaymentsStatus,
      parsed.data.payoutsStatus,
      parsed.data.dashboardType,
      parsed.data.feesCollector,
      parsed.data.lossesCollector,
      occurredAt,
      parsed.data.status,
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
        cardPaymentsStatus: parsed.data.cardPaymentsStatus,
        chargesEnabled: parsed.data.chargesEnabled,
        dashboardType: parsed.data.dashboardType,
        detailsSubmitted: parsed.data.detailsSubmitted,
        feesCollector: parsed.data.feesCollector,
        lossesCollector: parsed.data.lossesCollector,
        payoutsEnabled: parsed.data.payoutsEnabled,
        payoutsStatus: parsed.data.payoutsStatus,
        requirementsDue: parsed.data.requirementsDue,
        status: parsed.data.status,
      }),
      occurredAt,
    );
  });
  return readStripeConnectStatusFromStore(storage, parsed.data.organizationId);
}

export interface StripeConnectEligibility {
  readonly accountId: string | null;
  readonly activations: {
    readonly donations: boolean;
    readonly dues: boolean;
    readonly tickets: boolean;
  };
  readonly eligibleForReset: boolean;
  readonly hasPaymentHistory: boolean;
  readonly hasPendingPayments: boolean;
  readonly ineligibilityReason:
    "not_connected" | "has_payment_history" | "has_pending_payments" | null;
  readonly status: StripeConnectStatus["status"];
}

function computeEligibility(
  storage: DurableObjectStorage,
  organizationId: string,
): StripeConnectEligibility | null {
  const identity = storage.sql
    .exec<{
      readonly organizationId: string;
      readonly paymentActivationJson: string;
    }>(
      `SELECT organization_id AS organizationId, payment_activation_json AS paymentActivationJson
       FROM organization_metadata LIMIT 1`,
    )
    .toArray()
    .at(0);
  if (identity?.organizationId !== organizationId) return null;

  const row = readRow(storage);
  const status = mapStoreRow(row);
  const activations = parseActivations(identity.paymentActivationJson);

  if (!status.accountId) {
    return {
      accountId: null,
      activations,
      eligibleForReset: false,
      hasPaymentHistory: false,
      hasPendingPayments: false,
      ineligibilityReason: "not_connected",
      status: "not_started",
    };
  }

  const nowIso = new Date().toISOString();

  const countQuery = (sql: string, ...params: (string | number)[]) => {
    try {
      const res = storage.sql
        .exec<{ readonly count: number }>(sql, ...params)
        .toArray()
        .at(0);
      return res?.count ?? 0;
    } catch {
      return 0;
    }
  };

  const realPaidTickets = countQuery(
    "SELECT COUNT(*) AS count FROM ticket_purchases WHERE provider_session_id NOT LIKE 'fake_%' AND status IN ('paid', 'refunded')",
  );
  const realPaidDonations = countQuery(
    "SELECT COUNT(*) AS count FROM donations WHERE provider_session_id NOT LIKE 'fake_%' AND status IN ('paid', 'refunded')",
  );
  const realPaidDues = countQuery(
    "SELECT COUNT(*) AS count FROM dues WHERE provider_session_id != '' AND provider_session_id NOT LIKE 'fake_%' AND status IN ('paid', 'refunded')",
  );
  const realPaidAttempts = countQuery(
    "SELECT COUNT(*) AS count FROM payment_attempts WHERE provider_session_id NOT LIKE 'fake_%' AND provider_payment_id NOT LIKE 'fake_%' AND status IN ('paid', 'refunded')",
  );

  const hasPaymentHistory =
    realPaidTickets > 0 || realPaidDonations > 0 || realPaidDues > 0 || realPaidAttempts > 0;

  const pendingTickets = countQuery(
    "SELECT COUNT(*) AS count FROM ticket_purchases WHERE provider_session_id NOT LIKE 'fake_%' AND status = 'pending' AND (expires_at IS NULL OR expires_at > ?)",
    nowIso,
  );
  const pendingDonations = countQuery(
    "SELECT COUNT(*) AS count FROM donations WHERE provider_session_id NOT LIKE 'fake_%' AND status = 'pending' AND (expires_at IS NULL OR expires_at > ?)",
    nowIso,
  );
  const pendingDues = countQuery(
    "SELECT COUNT(*) AS count FROM dues WHERE provider_session_id != '' AND provider_session_id NOT LIKE 'fake_%' AND status = 'pending'",
  );
  const pendingAttempts = countQuery(
    "SELECT COUNT(*) AS count FROM payment_attempts WHERE provider_session_id NOT LIKE 'fake_%' AND status = 'pending' AND (expired_at IS NULL OR expired_at > ?)",
    nowIso,
  );

  const hasPendingPayments =
    pendingTickets > 0 || pendingDonations > 0 || pendingDues > 0 || pendingAttempts > 0;

  let ineligibilityReason: StripeConnectEligibility["ineligibilityReason"] = null;
  if (hasPaymentHistory) {
    ineligibilityReason = "has_payment_history";
  } else if (hasPendingPayments) {
    ineligibilityReason = "has_pending_payments";
  }

  return {
    accountId: status.accountId,
    activations,
    eligibleForReset: ineligibilityReason === null,
    hasPaymentHistory,
    hasPendingPayments,
    ineligibilityReason,
    status: status.status,
  };
}

export function readStripeConnectEligibilityFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const eligibility = computeEligibility(storage, organizationId);
  if (!eligibility) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json(eligibility);
}

export const stripeConnectResetOperationSchema = z.object({
  action: z.literal("reset_stripe_connect"),
  actorUserId: z.string().min(1).max(128),
  confirm: z.literal(true),
  expectedAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  organizationId: z.string().min(1).max(128),
  reason: z.string().min(3).max(500),
  requestId: z.uuid(),
});

export async function resetStripeConnectAccountInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = stripeConnectResetOperationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ code: "validation_failed" }, { status: 400 });
  }

  const eligibility = computeEligibility(storage, parsed.data.organizationId);
  if (!eligibility) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }

  if (!eligibility.accountId) {
    return Response.json({ code: "stripe_connect_not_connected" }, { status: 409 });
  }

  if (eligibility.accountId !== parsed.data.expectedAccountId) {
    return Response.json({ code: "stripe_connect_account_changed" }, { status: 409 });
  }

  if (eligibility.hasPaymentHistory) {
    return Response.json({ code: "stripe_connect_reset_has_payment_history" }, { status: 409 });
  }

  if (eligibility.hasPendingPayments) {
    return Response.json({ code: "stripe_connect_reset_has_pending_payments" }, { status: 409 });
  }

  const occurredAt = new Date().toISOString();
  const resetActivations = { donations: false, dues: false, tickets: false };

  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE organization_metadata
       SET payment_activation_json = ?, updated_at = ?
       WHERE organization_id = ?`,
      JSON.stringify(resetActivations),
      occurredAt,
      parsed.data.organizationId,
    );

    storage.sql.exec(
      `DELETE FROM stripe_connect_accounts WHERE organization_id = ?`,
      parsed.data.organizationId,
    );

    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
       VALUES (?, 'platform_administrator', ?, 'stripe_connect.reset',
         'stripe_connect_account', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      parsed.data.actorUserId,
      parsed.data.expectedAccountId,
      parsed.data.requestId,
      JSON.stringify({
        accountId: parsed.data.expectedAccountId,
        previousActivations: eligibility.activations,
        previousStatus: eligibility.status,
        reason: parsed.data.reason,
      }),
      occurredAt,
    );
  });

  return Response.json({
    accountId: null,
    activations: resetActivations,
    status: "not_started",
  });
}
