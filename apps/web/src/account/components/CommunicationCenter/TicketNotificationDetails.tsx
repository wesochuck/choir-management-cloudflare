import { useState } from "react";
import type { z } from "zod";
import type { ticketNotificationDetailsSchema } from "@choir/contracts";
import { Dialog, DialogClose, useConfirmation } from "@choir/ui";
import { getTicketNotificationDetails } from "../../../api/communications";
import { failureMessage } from "./utils";

export function TicketNotificationDetails({
  notificationId,
  onCancel,
  timezone,
}: {
  readonly notificationId: string;
  readonly timezone?: string | undefined;
  readonly onCancel: (id: string, reason?: string) => Promise<void>;
}) {
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(value));
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<z.infer<typeof ticketNotificationDetailsSchema> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const { confirm, confirmationDialog } = useConfirmation();
  const load = async () => {
    setOpen(true);
    setBusy(true);
    setError(null);
    setDetails(null);
    setReason("");
    try {
      setDetails(await getTicketNotificationDetails(notificationId));
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (
      !reason.trim() ||
      !(await confirm({
        title: "Cancel ticket notification",
        description:
          "Stop this notification from being delivered? The order and delivery history will be preserved.",
        confirmLabel: "Cancel notification",
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await onCancel(`ticket:${notificationId}`, reason.trim());
      setReason("");
      setOpen(false);
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="button button--secondary button--sm"
        onClick={() => void load()}
      >
        View details
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Ticket notification details"
        dirty={reason.trim().length > 0}
        footer={
          <DialogClose asChild>
            <button type="button" className="button button--secondary" disabled={busy}>
              Close
            </button>
          </DialogClose>
        }
      >
        {busy ? <p role="status">Loading notification…</p> : null}
        {error ? (
          <p role="alert" className="notice notice--error">
            {error}
          </p>
        ) : null}
        {!busy && error && !details ? (
          <button type="button" className="button button--secondary" onClick={() => void load()}>
            Try again
          </button>
        ) : null}
        {details ? (
          <>
            <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-[var(--spacing-md)] gap-y-[var(--spacing-sm)] [&_dt]:font-semibold [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
              <dt>Buyer</dt>
              <dd>{details.buyerName}</dd>
              <dt>Recipient</dt>
              <dd>{details.recipientEmail}</dd>
              <dt>Order</dt>
              <dd>{details.purchaseId}</dd>
              <dt>Order status</dt>
              <dd>{details.purchaseStatus}</dd>
              {details.refundedAt ? (
                <>
                  <dt>Refunded</dt>
                  <dd>{formatDate(details.refundedAt)}</dd>
                </>
              ) : null}
              <dt>Notification status</dt>
              <dd>{details.status === "suppressed" ? "Skipped" : details.status}</dd>
              <dt>Delivery job</dt>
              <dd>{details.jobStatus ?? "Not started"}</dd>
              <dt>Delivery attempts</dt>
              <dd>{details.jobAttempts ?? 0}</dd>
              <dt>Provider status</dt>
              <dd>{details.providerStatus ?? "No provider result recorded"}</dd>
              <dt>Last updated</dt>
              <dd>{formatDate(details.updatedAt)}</dd>
              {details.failureDetail ? (
                <>
                  <dt>Reason</dt>
                  <dd>{details.failureDetail}</dd>
                </>
              ) : null}
            </dl>
            <a className="button button--secondary button--sm" href="/admin/tickets">
              View ticket orders
            </a>
            {details.canCancel ? (
              <div className="form-grid">
                <label className="field">
                  Cancellation reason
                  <textarea
                    value={reason}
                    maxLength={500}
                    disabled={busy}
                    onChange={(event) => {
                      setReason(event.target.value);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="button button--danger"
                  disabled={busy || !reason.trim()}
                  onClick={() => void cancel()}
                >
                  Cancel notification
                </button>
              </div>
            ) : (
              <p>Completed notifications and active deliveries cannot be canceled.</p>
            )}
          </>
        ) : null}
      </Dialog>
      {confirmationDialog}
    </>
  );
}
