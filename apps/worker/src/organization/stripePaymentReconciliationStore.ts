import type { LocalPaymentCandidate } from "@choir/domain";

const candidateQuery = `SELECT
  pa.id AS paymentAttemptId,
  pa.payment_type AS paymentType,
  pa.resource_id AS resourceId,
  pa.provider_payment_id AS providerPaymentId,
  pa.provider_session_id AS providerSessionId,
  pa.amount_cents AS amountCents,
  pa.status AS paymentAttemptStatus,
  p.status AS resourceStatus,
  p.currency AS currency,
  pa.refund_requested_at AS refundRequestedAt,
  COALESCE(pa.refunded_at, p.refunded_at) AS refundedAt,
  pa.processor_fee_cents AS processorFeeCents,
  pa.processor_fee_reconciled_at AS processorFeeReconciledAt,
  pa.provider_balance_transaction_id AS providerBalanceTransactionId,
  pa.created_at AS createdAt
FROM payment_attempts pa
JOIN ticket_purchases p ON pa.payment_type IN ('ticket', 'bundle') AND pa.resource_id = p.id
WHERE pa.payment_type IN ('ticket', 'bundle')
  AND (pa.status IN ('paid', 'refunded') OR p.status IN ('paid', 'refunded'))
  AND pa.provider_payment_id NOT LIKE 'fake_%'
  AND pa.provider_payment_id <> ''
  AND pa.amount_cents > 0
  AND (? IS NULL OR pa.created_at >= ?)
ORDER BY pa.created_at DESC, pa.id DESC
LIMIT ?`;

interface CandidateDbRow {
  readonly [column: string]: SqlStorageValue;
  readonly amountCents: number;
  readonly createdAt: string;
  readonly currency: string | null;
  readonly paymentAttemptId: string;
  readonly paymentAttemptStatus: string;
  readonly paymentType: "ticket" | "bundle";
  readonly processorFeeCents: number | null;
  readonly processorFeeReconciledAt: string | null;
  readonly providerBalanceTransactionId: string | null;
  readonly providerPaymentId: string;
  readonly providerSessionId: string;
  readonly refundRequestedAt: string | null;
  readonly refundedAt: string | null;
  readonly resourceId: string;
  readonly resourceStatus: string;
}

export function listStripePaymentReconciliationCandidatesInStore(
  storage: DurableObjectStorage,
  input: {
    readonly limit?: number | null | undefined;
    readonly organizationId: string;
    readonly since?: string | null | undefined;
  },
): { readonly candidates: readonly LocalPaymentCandidate[]; readonly hasMore: boolean } {
  const actualOrganizationId = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;

  if (actualOrganizationId !== input.organizationId) {
    return { candidates: [], hasMore: false };
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = storage.sql
    .exec<CandidateDbRow>(candidateQuery, input.since ?? null, input.since ?? null, limit + 1)
    .toArray();

  const hasMore = rows.length > limit;
  const candidates: LocalPaymentCandidate[] = rows.slice(0, limit).map((row) => ({
    amountCents: row.amountCents,
    createdAt: row.createdAt,
    currency: row.currency,
    paymentAttemptId: row.paymentAttemptId,
    paymentAttemptStatus: row.paymentAttemptStatus,
    paymentType: row.paymentType,
    processorFeeCents: row.processorFeeCents,
    processorFeeReconciledAt: row.processorFeeReconciledAt,
    providerBalanceTransactionId: row.providerBalanceTransactionId,
    providerPaymentId: row.providerPaymentId,
    providerSessionId: row.providerSessionId,
    refundRequestedAt: row.refundRequestedAt,
    refundedAt: row.refundedAt,
    resourceId: row.resourceId,
    resourceStatus: row.resourceStatus,
  }));

  return { candidates, hasMore };
}

export interface ApplyHistoricalStripeReconciliationInput {
  readonly actions: readonly ("mark_refunded" | "backfill_fee")[];
  readonly adminUserId: string;
  readonly organizationId: string;
  readonly providerPaymentId: string;
  readonly reason: string;
  readonly stripeSnapshot: {
    readonly amountChargedCents: number;
    readonly amountRefundedCents: number;
    readonly fullyRefunded: boolean;
    readonly processorFeeCents: number | null;
    readonly providerBalanceTransactionId: string | null;
    readonly refundCompletedAt: string | null;
  };
}

export interface ApplyHistoricalStripeReconciliationResult {
  readonly actionsApplied: readonly ("mark_refunded" | "backfill_fee")[];
  readonly message?: string;
  readonly status: "applied" | "skipped" | "failed";
}

export function applyHistoricalStripeReconciliationInStore(
  storage: DurableObjectStorage,
  input: ApplyHistoricalStripeReconciliationInput,
): ApplyHistoricalStripeReconciliationResult {
  const actualOrganizationId = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;

  if (actualOrganizationId !== input.organizationId) {
    return {
      actionsApplied: [],
      message: "Organization identity conflict.",
      status: "failed",
    };
  }

  const existingPurchases = storage.sql
    .exec<{
      readonly amountPaidCents: number;
      readonly bundleId: string | null;
      readonly id: string;
      readonly status: string;
    }>(
      `SELECT id, status, amount_paid_cents AS amountPaidCents, bundle_id AS bundleId
       FROM ticket_purchases WHERE provider_payment_id = ?`,
      input.providerPaymentId,
    )
    .toArray();

  const existingAttempts = storage.sql
    .exec<{
      readonly id: string;
      readonly processorFeeCents: number | null;
      readonly providerBalanceTransactionId: string | null;
      readonly status: string;
    }>(
      `SELECT id, status, processor_fee_cents AS processorFeeCents,
        provider_balance_transaction_id AS providerBalanceTransactionId
       FROM payment_attempts WHERE provider_payment_id = ?`,
      input.providerPaymentId,
    )
    .toArray();

  if (existingPurchases.length === 0 && existingAttempts.length === 0) {
    return {
      actionsApplied: [],
      message: "No payment records found for provider payment ID.",
      status: "failed",
    };
  }

  const occurredAt = new Date().toISOString();
  const refundTimestamp = input.stripeSnapshot.refundCompletedAt ?? occurredAt;
  const actionsApplied: ("mark_refunded" | "backfill_fee")[] = [];
  const changes: string[] = [];

  storage.transactionSync(() => {
    if (input.actions.includes("mark_refunded")) {
      let purchaseUpdated = false;
      for (const purchase of existingPurchases) {
        if (purchase.status === "paid") {
          storage.sql.exec(
            `UPDATE ticket_purchases
             SET status = 'refunded', refunded_at = ?, updated_at = ?
             WHERE id = ? AND status = 'paid'`,
            refundTimestamp,
            occurredAt,
            purchase.id,
          );
          purchaseUpdated = true;
        }
      }

      let attemptUpdated = false;
      for (const attempt of existingAttempts) {
        if (attempt.status !== "refunded") {
          storage.sql.exec(
            `UPDATE payment_attempts
             SET status = 'refunded', refunded_at = ?, updated_at = ?
             WHERE id = ? AND status <> 'refunded'`,
            refundTimestamp,
            occurredAt,
            attempt.id,
          );
          attemptUpdated = true;
        }
      }

      if (purchaseUpdated || attemptUpdated) {
        actionsApplied.push("mark_refunded");
        if (purchaseUpdated) changes.push("resource_status");
        if (attemptUpdated) changes.push("payment_attempt_status");
      }
    }

    if (input.actions.includes("backfill_fee")) {
      if (input.stripeSnapshot.processorFeeCents !== null) {
        let feeUpdated = false;
        for (const attempt of existingAttempts) {
          if (
            attempt.processorFeeCents === null ||
            (attempt.providerBalanceTransactionId === null &&
              input.stripeSnapshot.providerBalanceTransactionId !== null)
          ) {
            storage.sql.exec(
              `UPDATE payment_attempts
               SET processor_fee_cents = COALESCE(processor_fee_cents, ?),
                   provider_balance_transaction_id = COALESCE(provider_balance_transaction_id, ?),
                   processor_fee_reconciled_at = COALESCE(processor_fee_reconciled_at, ?),
                   updated_at = ?
               WHERE id = ?`,
              input.stripeSnapshot.processorFeeCents,
              input.stripeSnapshot.providerBalanceTransactionId,
              occurredAt,
              occurredAt,
              attempt.id,
            );
            feeUpdated = true;
          }
        }
        if (feeUpdated) {
          actionsApplied.push("backfill_fee");
          changes.push("processor_fee", "balance_transaction");
        }
      }
    }

    if (actionsApplied.length > 0) {
      const primaryPurchase = existingPurchases[0];
      const auditSummary = {
        amountChargedCents: input.stripeSnapshot.amountChargedCents,
        amountRefundedCents: input.stripeSnapshot.amountRefundedCents,
        changes,
        newResourceStatus: input.actions.includes("mark_refunded")
          ? "refunded"
          : (primaryPurchase?.status ?? "unknown"),
        paymentType: primaryPurchase?.bundleId ? "bundle" : "ticket",
        previousResourceStatus: primaryPurchase?.status ?? "unknown",
        processorFeeCents: input.stripeSnapshot.processorFeeCents,
        providerBalanceTransactionId: input.stripeSnapshot.providerBalanceTransactionId,
        providerPaymentId: input.providerPaymentId,
        reason: input.reason,
        resourceId: primaryPurchase?.id ?? existingAttempts[0]?.id,
        source: "stripe_historical_reconciliation",
        stripeRefundCompletedAt: input.stripeSnapshot.refundCompletedAt,
      };

      storage.sql.exec(
        `INSERT OR IGNORE INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id, request_id, change_summary, occurred_at)
         VALUES (?, 'platform_administrator', ?, 'payment.stripe_history.reconciled', 'payment', ?, ?, ?, ?)`,
        `stripe-history-reconciled:${input.providerPaymentId}:${[...actionsApplied].sort().join("+")}`,
        input.adminUserId,
        input.providerPaymentId,
        crypto.randomUUID(),
        JSON.stringify(auditSummary),
        occurredAt,
      );
    }
  });

  return {
    actionsApplied,
    status: actionsApplied.length > 0 ? "applied" : "skipped",
  };
}
