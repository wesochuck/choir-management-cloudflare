import type {
  PlatformStripeReconciliationApplyResponse,
  PlatformStripeReconciliationPreviewResponse,
  PlatformStripeReconciliationRow,
} from "@choir/contracts";
import { DataTable, Dialog, type DataTableColumn } from "@choir/ui";
import { useState } from "react";

import {
  applyPlatformStripeReconciliation,
  previewPlatformStripeReconciliation,
} from "../../../api/platform";
import { AuthApiError } from "../../../auth/api";
import { displayDate } from "./shared";

function formatMoney(cents: number | null | undefined, currency: string | null = "usd"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat(undefined, {
    currency: currency ?? "usd",
    style: "currency",
  }).format(cents / 100);
}

function statusPillClass(status: string): string {
  switch (status) {
    case "paid":
    case "succeeded":
      return "status-pill--success";
    case "refunded":
    case "fully_refunded":
      return "status-pill--warning";
    case "partially_refunded":
      return "status-pill--error";
    default:
      return "status-pill--neutral";
  }
}

function classificationBadge(classification: PlatformStripeReconciliationRow["classification"]) {
  switch (classification) {
    case "matched":
      return <span className="status-pill status-pill--success">Matched</span>;
    case "refund_and_fee_mismatch":
      return <span className="status-pill status-pill--warning">Repair refund & fee</span>;
    case "refund_status_mismatch":
      return <span className="status-pill status-pill--warning">Repair refund</span>;
    case "processor_fee_missing":
    case "balance_transaction_missing":
      return <span className="status-pill status-pill--neutral">Backfill fee</span>;
    case "partial_refund_manual_review":
      return <span className="status-pill status-pill--error">Partial refund - manual review</span>;
    case "amount_mismatch_manual_review":
      return <span className="status-pill status-pill--error">Amount mismatch</span>;
    case "provider_payment_missing":
      return <span className="status-pill status-pill--error">Missing in Stripe</span>;
    case "provider_lookup_failed":
      return <span className="status-pill status-pill--error">Lookup failed</span>;
    case "local_inconsistency":
      return <span className="status-pill status-pill--error">Inconsistent</span>;
  }
}

function formatApplySuccessMessage(
  result: Pick<
    PlatformStripeReconciliationApplyResponse,
    "appliedCount" | "feeBackfilledCount" | "refundedCount"
  >,
): string {
  return `Applied reconciliation repairs: ${String(result.appliedCount)} record${result.appliedCount === 1 ? "" : "s"} updated (${String(result.refundedCount)} refund${result.refundedCount === 1 ? "" : "s"}, ${String(result.feeBackfilledCount)} fee${result.feeBackfilledCount === 1 ? "" : "s"} backfilled).`;
}

const reconciliationColumns: readonly DataTableColumn<PlatformStripeReconciliationRow>[] = [
  {
    header: "Date",
    id: "date",
    mobileLabel: "Date",
    render: (row) => displayDate(row.createdAt),
  },
  {
    header: "Type",
    id: "type",
    mobileLabel: "Type",
    render: (row) => (row.paymentType === "ticket" ? "Ticket purchase" : "Bundle purchase"),
  },
  {
    header: "Stripe Payment",
    id: "payment",
    mobileLabel: "Stripe payment",
    render: (row) => <code>{row.providerPaymentId}</code>,
  },
  {
    header: "Choir Status",
    id: "choir-status",
    mobileLabel: "Choir status",
    render: (row) => (
      <span className={`status-pill ${statusPillClass(row.localPaymentAttemptStatus)}`}>
        {row.localPaymentAttemptStatus}
      </span>
    ),
  },
  {
    header: "Stripe Status",
    id: "stripe-status",
    mobileLabel: "Stripe status",
    render: (row) => (
      <span className={`status-pill ${statusPillClass(row.stripeStatus ?? "unknown")}`}>
        {row.stripeStatus ?? "not found"}
      </span>
    ),
  },
  {
    header: "Charged",
    id: "charged",
    mobileLabel: "Charged",
    render: (row) => formatMoney(row.localAmountCents, row.currency),
  },
  {
    header: "Refunded",
    id: "refunded",
    mobileLabel: "Refunded",
    render: (row) => formatMoney(row.stripeAmountRefundedCents, row.currency),
  },
  {
    header: "Processor Fee",
    id: "fee",
    mobileLabel: "Processor fee",
    render: (row) =>
      row.localProcessorFeeCents !== null ? (
        formatMoney(row.localProcessorFeeCents, row.currency)
      ) : row.stripeProcessorFeeCents !== null ? (
        <em>{formatMoney(row.stripeProcessorFeeCents, row.currency)} (new)</em>
      ) : (
        "—"
      ),
  },
  {
    header: "Classification",
    id: "classification",
    mobileLabel: "Classification",
    render: (row) => (
      <div>
        {classificationBadge(row.classification)}
        {row.manualReviewReason ? <div className="field-help">{row.manualReviewReason}</div> : null}
      </div>
    ),
  },
];

function ReconciliationResults({
  canEdit,
  data,
  onOpenApply,
}: {
  readonly canEdit: boolean;
  readonly data: PlatformStripeReconciliationPreviewResponse;
  readonly onOpenApply: () => void;
}) {
  return (
    <div className="platform-reconciliation-results">
      <div className="platform-reconciliation-metrics">
        <div className="platform-reconciliation-metric">
          <span>Checked</span>
          <strong>{data.scannedCount}</strong>
        </div>
        <div className="platform-reconciliation-metric">
          <span>Already matched</span>
          <strong>{data.matchedCount}</strong>
        </div>
        <div className="platform-reconciliation-metric">
          <span>Repairable</span>
          <strong>{data.repairableCount}</strong>
        </div>
        <div className="platform-reconciliation-metric">
          <span>Needs review</span>
          <strong>{data.manualReviewCount}</strong>
        </div>
      </div>

      {data.hasMore ? (
        <p className="notice notice--warning" role="status">
          Only part of the payment history was scanned. Narrow the date range with “Only check
          payments since” and run the preview again to cover the remaining records.
        </p>
      ) : null}

      <div className="platform-reconciliation-actions">
        {data.repairableCount > 0 ? (
          canEdit ? (
            <button className="button button--primary" onClick={onOpenApply} type="button">
              Apply reconciliation repairs ({data.repairableCount})
            </button>
          ) : (
            <div className="notice notice--warning" role="alert">
              <strong>Platform elevation required:</strong> Enable Platform edits above to apply
              historical reconciliation repairs.
            </div>
          )
        ) : null}
      </div>

      {data.rows.length === 0 ? (
        <p className="empty-state">No payment records found matching the filter.</p>
      ) : (
        <DataTable
          columns={reconciliationColumns}
          keySelector={(row) => `${row.providerPaymentId}:${row.resourceId}`}
          rows={data.rows}
        />
      )}
    </div>
  );
}

export function StripePaymentReconciliation({
  canEdit,
  organizationId,
}: {
  readonly canEdit: boolean;
  readonly organizationId: string;
}) {
  const [sinceDate, setSinceDate] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] =
    useState<PlatformStripeReconciliationPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applyReason, setApplyReason] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  async function handleRunPreview(clearSuccess = true) {
    setLoadingPreview(true);
    setError(null);
    if (clearSuccess) {
      setSuccessMessage(null);
    }
    try {
      const sinceIso = sinceDate ? new Date(`${sinceDate}T00:00:00Z`).toISOString() : undefined;
      const data = await previewPlatformStripeReconciliation(organizationId, {
        since: sinceIso,
      });
      setPreviewData(data);
    } catch (err: unknown) {
      setError(
        err instanceof AuthApiError
          ? err.message
          : "Stripe payment reconciliation preview could not be loaded. Please try again.",
      );
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleApplySubmit() {
    const trimmedReason = applyReason.trim();
    if (trimmedReason.length < 3 || trimmedReason.length > 500) {
      setApplyError("Reason must be between 3 and 500 characters.");
      return;
    }

    setApplyBusy(true);
    setApplyError(null);
    try {
      const result = await applyPlatformStripeReconciliation(organizationId, {
        confirm: true,
        reason: trimmedReason,
      });
      setApplyDialogOpen(false);
      setApplyReason("");
      setSuccessMessage(formatApplySuccessMessage(result));
      // Automatically refresh the preview to reflect the repairs
      await handleRunPreview(false);
    } catch (err: unknown) {
      setApplyError(
        err instanceof AuthApiError
          ? err.message
          : "Failed to apply reconciliation repairs. Refresh and try again.",
      );
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <div
      className="platform-action platform-stripe-reconciliation"
      aria-labelledby="stripe-reconciliation-title"
    >
      <div className="section-heading section-heading--nested platform-operation__heading">
        <h4 id="stripe-reconciliation-title">Stripe payment reconciliation</h4>
        <p>
          Audit and repair historical payments against Stripe truth. Safely fixes missing refund
          records and backfills processor fees without notifying customers or issuing new Stripe
          charges.
        </p>
      </div>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      {successMessage ? (
        <p className="notice notice--success" role="status">
          {successMessage}
        </p>
      ) : null}

      <form
        className="form-row platform-reconciliation-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void handleRunPreview();
        }}
      >
        <div className="field">
          <label htmlFor="platform-reconciliation-since">Only check payments since</label>
          <input
            id="platform-reconciliation-since"
            onChange={(e) => {
              setSinceDate(e.target.value);
            }}
            type="date"
            value={sinceDate}
          />
        </div>
        <button className="button button--secondary" disabled={loadingPreview} type="submit">
          {loadingPreview ? "Scanning Stripe payments…" : "Run reconciliation preview"}
        </button>
      </form>

      {previewData ? (
        <ReconciliationResults
          canEdit={canEdit}
          data={previewData}
          onOpenApply={() => {
            setApplyError(null);
            setApplyReason("");
            setApplyDialogOpen(true);
          }}
        />
      ) : null}

      <Dialog
        description="Safely repairs historical payment records against Stripe source of truth."
        onClose={() => {
          if (!applyBusy) setApplyDialogOpen(false);
        }}
        open={applyDialogOpen}
        title="Apply Stripe payment reconciliation repairs?"
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void handleApplySubmit();
          }}
        >
          {applyError ? (
            <p className="notice notice--error" role="alert">
              {applyError}
            </p>
          ) : null}

          <div className="notice notice--info" role="status">
            <ul className="bullet-list">
              <li>
                <strong>No Stripe API charges or refunds:</strong> This will <em>not</em> trigger
                new refunds or chargebacks in Stripe.
              </li>
              <li>
                <strong>No customer emails:</strong> Customers will <em>not</em> receive receipt or
                refund emails for historical repairs.
              </li>
              <li>
                <strong>Accurate financial KPIs:</strong> Updates local payment and ticket status to
                reflect full refunds and backfills processor fees, restoring correct net proceeds.
              </li>
              <li>
                <strong>Audit logging:</strong> A permanent{" "}
                <code>payment.stripe_history.reconciled</code> audit event will be recorded with
                your operator identity.
              </li>
            </ul>
          </div>

          <p>
            <strong>{previewData?.repairableCount ?? 0}</strong> record
            {(previewData?.repairableCount ?? 0) === 1 ? "" : "s"} will be updated.
          </p>

          <label className="field" htmlFor="platform-reconciliation-reason">
            <span>Reason for applying reconciliation repairs</span>
            <textarea
              id="platform-reconciliation-reason"
              maxLength={500}
              minLength={3}
              onChange={(e) => {
                setApplyReason(e.target.value);
              }}
              placeholder="e.g. Repair historical refunded tickets and backfill processor fees for 2026 season"
              required
              rows={3}
              value={applyReason}
            />
          </label>

          <div className="dialog__actions">
            <button
              className="button button--secondary"
              disabled={applyBusy}
              onClick={() => {
                setApplyDialogOpen(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button--primary"
              disabled={applyBusy || applyReason.trim().length < 3}
              type="submit"
            >
              {applyBusy ? "Applying repairs…" : "Apply reconciliation repairs"}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
