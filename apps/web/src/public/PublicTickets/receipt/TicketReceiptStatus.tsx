import type { PublicTicketReceipt, TicketConfirmationSettings } from "@choir/contracts";
import { DEFAULT_TICKET_CONFIRMATION_SETTINGS, getRefundedAmountCents, money } from "../shared";

function getReceiptHeading(status: PublicTicketReceipt["status"]): string {
  switch (status) {
    case "pending":
      return "Ticket order processing";
    case "paid":
      return "You're all set. Your tickets are ready.";
    case "refunded":
      return "Refund complete";
    case "expired":
      return "Ticket order expired";
  }
}

function getReceiptMessage(
  status: PublicTicketReceipt["status"],
  settings: TicketConfirmationSettings,
): string {
  switch (status) {
    case "pending":
      return settings.pendingMessage;
    case "paid":
      return "Keep this page or save a PDF. Your confirmation email includes a link back to your ticket.";
    case "refunded":
      return "Your ticket order has been refunded.";
    case "expired":
      return "This ticket order has expired because payment was not completed.";
  }
}

export function RefundedTicketGraphic() {
  return (
    <svg
      aria-hidden="true"
      className="ticket-refund-status__graphic"
      focusable="false"
      viewBox="0 0 120 120"
    >
      <path
        d="M24 51h72v8a8 8 0 0 0 0 16v8H24v-8a8 8 0 0 1 0-16v-8Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="4"
      />
      <path
        d="M69 54v7m0 10v8"
        fill="none"
        stroke="currentColor"
        strokeDasharray="3 4"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <path
        d="M82 34a22 22 0 0 0-39-5m-1 0 1 10 9-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="4"
      />
      <path
        d="m40 68 6 6 12-13"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="4"
      />
    </svg>
  );
}

export function TicketReceiptStatus({
  purchase,
  settings,
}: {
  readonly purchase: PublicTicketReceipt;
  readonly settings: TicketConfirmationSettings;
}) {
  if (purchase.status !== "refunded") {
    const isPaid = purchase.status === "paid";
    const customSuccessMessage =
      isPaid &&
      settings.successMessage &&
      settings.successMessage !== DEFAULT_TICKET_CONFIRMATION_SETTINGS.successMessage
        ? settings.successMessage
        : null;

    return (
      <div className="ticket-confirmation-hero__header no-print">
        <div
          className={
            isPaid
              ? "ticket-confirmation-badge ticket-confirmation-badge--success"
              : "ticket-confirmation-badge ticket-confirmation-badge--neutral"
          }
        >
          {isPaid ? (
            <svg
              aria-hidden="true"
              className="ticket-confirmation-badge__icon"
              fill="none"
              focusable="false"
              height="16"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
              width="16"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          ) : null}
          {isPaid ? "Purchase complete" : purchase.status === "pending" ? "Processing" : "Expired"}
        </div>
        <h1 className="ticket-confirmation-hero__title">{getReceiptHeading(purchase.status)}</h1>
        <p className="ticket-confirmation-hero__description">
          {getReceiptMessage(purchase.status, settings)}
        </p>
        {customSuccessMessage ? (
          <p className="ticket-confirmation-hero__custom-message">{customSuccessMessage}</p>
        ) : null}
      </div>
    );
  }

  return (
    <section aria-labelledby="ticket-refund-status-heading" className="ticket-refund-status">
      <div className="ticket-refund-status__illustration">
        <RefundedTicketGraphic />
      </div>
      <div className="ticket-refund-status__content">
        <h1 id="ticket-refund-status-heading">{getReceiptHeading(purchase.status)}</h1>
        <p>{getReceiptMessage(purchase.status, settings)}</p>
        <p className="ticket-refund-status__amount">
          <span>Refunded amount</span>
          <strong>{money(getRefundedAmountCents(purchase))}</strong>
        </p>
        <p className="ticket-refund-status__admission-note">
          This ticket is no longer valid for admission.
        </p>
        {purchase.checkoutMode === "stripe" ? (
          <p className="ticket-refund-status__provider-note">
            Your refund has been processed. Your bank or card provider may take additional time to
            post the credit.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function TicketReceiptStatusNotice({
  isTimedOut,
  onRefresh,
  purchase,
}: {
  readonly isTimedOut: boolean;
  readonly onRefresh: () => void;
  readonly purchase: PublicTicketReceipt;
}) {
  return (
    <>
      {purchase.status === "pending" && isTimedOut ? (
        <div className="notice notice--info">
          <p>
            We are still waiting for confirmation from the payment provider. Your order details are
            below.
          </p>
          <button
            className="button button--secondary"
            onClick={() => {
              onRefresh();
            }}
            type="button"
          >
            Check status again
          </button>
        </div>
      ) : null}
      {purchase.checkoutMode === "free" ? (
        <p className="notice notice--info">Complimentary order — no payment was collected.</p>
      ) : purchase.checkoutMode === "fake" ? (
        <p
          className={
            purchase.status === "refunded" ? "notice notice--info" : "notice notice--warning"
          }
        >
          Staging simulation: no payment card was charged.
        </p>
      ) : null}
    </>
  );
}
