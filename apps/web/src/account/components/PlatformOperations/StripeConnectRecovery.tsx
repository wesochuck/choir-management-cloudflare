import type { PlatformStripeConnectStatusResponse } from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useCallback, useEffect, useState } from "react";

import {
  getPlatformOrganizationStripeConnect,
  resetPlatformOrganizationStripeConnect,
} from "../../../api/platform";
import { AuthApiError } from "../../../auth/api";

function StripeResetConfirmDialog({
  actionError,
  busy,
  confirmAccountId,
  expectedAccountId,
  onClose,
  onConfirmAccountIdChange,
  onReasonChange,
  onSubmit,
  open,
  reason,
}: {
  readonly actionError: string | null;
  readonly busy: boolean;
  readonly confirmAccountId: string;
  readonly expectedAccountId: string;
  readonly onClose: () => void;
  readonly onConfirmAccountIdChange: (value: string) => void;
  readonly onReasonChange: (value: string) => void;
  readonly onSubmit: () => Promise<void>;
  readonly open: boolean;
  readonly reason: string;
}) {
  return (
    <Dialog
      description="Destructive configuration recovery for this Organization's Stripe Connect integration."
      onClose={() => {
        if (!busy) onClose();
      }}
      open={open}
      title="Reset Stripe connection?"
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        {actionError ? (
          <p className="notice notice--error" role="alert">
            {actionError}
          </p>
        ) : null}

        <div className="notice notice--warning" role="alert">
          <ul className="bullet-list">
            <li>
              Choir Management will stop using account <code>{expectedAccountId}</code>.
            </li>
            <li>Tickets, Donations, and Dues payment activations will be immediately disabled.</li>
            <li>Control-plane webhook routing for this account will be removed.</li>
            <li>
              The Stripe account itself will <strong>not</strong> be deleted or closed in Stripe.
            </li>
            <li>
              The Organization will return to &quot;Connect Stripe account&quot; to begin fresh
              onboarding.
            </li>
          </ul>
        </div>

        <label className="field" htmlFor="platform-stripe-reset-confirm">
          <span>
            Type the account ID (<code>{expectedAccountId}</code>) to confirm
          </span>
          <input
            autoFocus
            id="platform-stripe-reset-confirm"
            onChange={(event) => {
              onConfirmAccountIdChange(event.target.value);
            }}
            placeholder={expectedAccountId}
            required
            type="text"
            value={confirmAccountId}
          />
        </label>

        <label className="field" htmlFor="platform-stripe-reset-reason">
          <span>Reason for resetting this Stripe connection</span>
          <textarea
            id="platform-stripe-reset-reason"
            maxLength={500}
            minLength={3}
            onChange={(event) => {
              onReasonChange(event.target.value);
            }}
            placeholder="e.g., Wrong account linked during setup; onboarding needs to be restarted"
            required
            rows={3}
            value={reason}
          />
        </label>

        <div className="dialog__actions">
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--danger"
            disabled={
              busy || confirmAccountId.trim() !== expectedAccountId || reason.trim().length < 3
            }
            type="submit"
          >
            {busy ? "Resetting connection…" : "Reset Stripe connection"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function IneligibilityNotice({ reason }: { readonly reason: string | null }) {
  let message = "This connection is not currently eligible for reset.";
  if (reason === "has_payment_history") {
    message =
      "This Organization has completed real Stripe payments. The connection cannot be reset safely until historical payments retain their Stripe account of origin.";
  } else if (reason === "has_pending_payments") {
    message =
      "One or more Stripe checkouts are still pending. Wait for them to complete or expire before resetting the connection.";
  }
  return (
    <div className="notice notice--warning" role="alert">
      <strong>Reset blocked:</strong> {message}
    </div>
  );
}

function StripeConnectStatusGrid({ data }: { readonly data: PlatformStripeConnectStatusResponse }) {
  const statusLabel =
    data.status === "ready"
      ? "Connected & Ready"
      : data.status === "onboarding"
        ? "Onboarding"
        : data.status === "restricted"
          ? "Restricted"
          : "Not connected";
  return (
    <div className="status-grid">
      <div>
        <strong>Status:</strong> <span className="status-pill">{statusLabel}</span>
      </div>
      <div>
        <strong>Account ID:</strong> <code>{data.accountId ?? "None"}</code>
      </div>
      <div>
        <strong>Payment activations:</strong> Tickets (
        {data.activations.tickets ? "Enabled" : "Disabled"}), Donations (
        {data.activations.donations ? "Enabled" : "Disabled"}), Dues (
        {data.activations.dues ? "Enabled" : "Disabled"})
      </div>
    </div>
  );
}

function StripeConnectResetTrigger({
  data,
  onOpenDialog,
}: {
  readonly data: PlatformStripeConnectStatusResponse;
  readonly onOpenDialog: () => void;
}) {
  if (!data.accountId) {
    return (
      <p className="empty-state">No Stripe account is currently connected to this Organization.</p>
    );
  }
  if (!data.eligibleForReset) {
    return <IneligibilityNotice reason={data.ineligibilityReason} />;
  }
  return (
    <div className="platform-stripe-recovery__actions">
      <button className="button button--danger" onClick={onOpenDialog} type="button">
        Reset Stripe connection
      </button>
    </div>
  );
}

export function StripeConnectRecovery({ organizationId }: { readonly organizationId: string }) {
  const [connectStatus, setConnectStatus] = useState<
    | { readonly status: "loading" }
    | { readonly status: "error"; readonly message?: string }
    | { readonly status: "ready"; readonly data: PlatformStripeConnectStatusResponse }
  >({ status: "loading" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmAccountId, setConfirmAccountId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadStatus = useCallback(
    (signal?: AbortSignal) => {
      getPlatformOrganizationStripeConnect(organizationId, signal)
        .then((data) => {
          setConnectStatus({ data, status: "ready" });
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setConnectStatus({
              message:
                error instanceof AuthApiError
                  ? error.message
                  : "Stripe Connect status could not be loaded.",
              status: "error",
            });
          }
        });
    },
    [organizationId],
  );

  useEffect(() => {
    const abortController = new AbortController();
    loadStatus(abortController.signal);
    return () => {
      abortController.abort();
    };
  }, [loadStatus]);

  async function handleReset() {
    if (connectStatus.status !== "ready" || !connectStatus.data.accountId) return;
    const expectedAccountId = connectStatus.data.accountId;
    if (confirmAccountId.trim() !== expectedAccountId) {
      setActionError(`Type "${expectedAccountId}" to confirm.`);
      return;
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3 || trimmedReason.length > 500) {
      setActionError("Enter a reason between 3 and 500 characters.");
      return;
    }

    setBusy(true);
    setActionError(null);
    try {
      await resetPlatformOrganizationStripeConnect(organizationId, {
        confirm: true,
        expectedAccountId,
        reason: trimmedReason,
      });
      setDialogOpen(false);
      setConfirmAccountId("");
      setReason("");
      setSuccessMessage(
        "Stripe connection has been reset. Payment activations are disabled and fresh onboarding can begin.",
      );
      loadStatus();
    } catch (error: unknown) {
      setActionError(
        error instanceof AuthApiError
          ? error.message
          : "Stripe connection could not be reset. Refresh and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="platform-action platform-stripe-recovery"
      aria-labelledby="stripe-recovery-title"
    >
      <div className="section-heading section-heading--nested platform-operation__heading">
        <h4 id="stripe-recovery-title">Stripe Connect recovery</h4>
        <p>
          Inspect and safely reset this Organization’s Stripe Connect account if onboarding must be
          restarted or the wrong account was linked. Reset is strictly blocked if real payment
          history exists.
        </p>
      </div>

      {successMessage ? (
        <p className="notice notice--success" role="status">
          {successMessage}
        </p>
      ) : null}

      {connectStatus.status === "loading" ? <p>Checking Stripe Connect status…</p> : null}
      {connectStatus.status === "error" ? (
        <p className="notice notice--error" role="alert">
          {connectStatus.message ?? "Stripe Connect status could not be loaded."}
        </p>
      ) : null}

      {connectStatus.status === "ready" ? (
        <div className="platform-stripe-recovery__details">
          <StripeConnectStatusGrid data={connectStatus.data} />
          <StripeConnectResetTrigger
            data={connectStatus.data}
            onOpenDialog={() => {
              setActionError(null);
              setConfirmAccountId("");
              setReason("");
              setDialogOpen(true);
            }}
          />

          {connectStatus.data.accountId ? (
            <StripeResetConfirmDialog
              actionError={actionError}
              busy={busy}
              confirmAccountId={confirmAccountId}
              expectedAccountId={connectStatus.data.accountId}
              onClose={() => {
                setDialogOpen(false);
              }}
              onConfirmAccountIdChange={setConfirmAccountId}
              onReasonChange={setReason}
              onSubmit={handleReset}
              open={dialogOpen}
              reason={reason}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
