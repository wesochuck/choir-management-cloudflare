import type { OrganizationEvent, OrganizationTicketOrder } from "@choir/contracts";
import type { PaymentFinancialSummary } from "@choir/domain";
import { DataTable } from "@choir/ui";
import type { Dispatch, SetStateAction } from "react";
import {
  buyerLastName,
  canRefundTicketOrder,
  money,
  ticketOrderStatusDisplay,
  type OrderState,
} from "./shared";

function willCallEmptyMessage({
  discountCodeFilter,
  displayedOrderCount,
  performanceOrderCount,
  status,
  visibleOrderCount,
}: {
  readonly discountCodeFilter: string | null;
  readonly displayedOrderCount: number;
  readonly performanceOrderCount: number;
  readonly status: OrderState["status"];
  readonly visibleOrderCount: number;
}): string | null {
  if (status !== "ready") return null;
  if (visibleOrderCount === 0) {
    if (discountCodeFilter !== null) {
      return `No ticket orders match discount code ${discountCodeFilter}.`;
    }
    if (performanceOrderCount === 0) return "No ticket orders yet.";
    return "No ticket buyers match this search.";
  }
  if (displayedOrderCount === 0) return "All matching ticket orders are refunded.";
  return null;
}

function WillCallPerformanceMetrics({
  financialSummary,
  selectedPerformance,
  ticketSoldLabel,
}: {
  readonly financialSummary: PaymentFinancialSummary;
  readonly selectedPerformance: OrganizationEvent | undefined;
  readonly ticketSoldLabel: string;
}) {
  const processorFeeDisplay =
    financialSummary.unreconciledProcessorFeeCount > 0
      ? "Pending"
      : financialSummary.processorFeeCents > 0
        ? `-${money(financialSummary.processorFeeCents)}`
        : "$0.00";

  const netProceedsDisplay =
    financialSummary.netProceedsCents !== null
      ? financialSummary.netProceedsCents < 0
        ? `-${money(Math.abs(financialSummary.netProceedsCents))}`
        : money(financialSummary.netProceedsCents)
      : "Pending";

  return (
    <div className="ticket-dashboard__metrics">
      <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--sold">
        <span className="summary-card__label">Tickets sold</span>
        <strong>{ticketSoldLabel}</strong>
        <small>{selectedPerformance ? selectedPerformance.title : "All performances"}</small>
      </article>
      <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--gross">
        <span className="summary-card__label">Gross charged</span>
        <strong>{money(financialSummary.grossChargedCents)}</strong>
        <small>Original charges</small>
      </article>
      <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--refunds">
        <span className="summary-card__label">Refunds</span>
        <strong>
          {financialSummary.refundCents > 0 ? `-${money(financialSummary.refundCents)}` : "$0.00"}
        </strong>
        <small>Returned to buyers</small>
      </article>
      <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--fees">
        <span className="summary-card__label">Customer fees collected</span>
        <strong>{money(financialSummary.customerFeeCents)}</strong>
        <small>Checkout service fees</small>
      </article>
      <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--processor-fees">
        <span className="summary-card__label">Stripe processing fees paid by Organization</span>
        <strong>{processorFeeDisplay}</strong>
        <small>
          {financialSummary.unreconciledProcessorFeeCount > 0
            ? "Stripe fee reconciliation pending"
            : "Retained by Stripe"}
        </small>
      </article>
      <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--net">
        <span className="summary-card__label">Net Organization proceeds</span>
        <strong>{netProceedsDisplay}</strong>
        <small>
          {financialSummary.unreconciledProcessorFeeCount > 0
            ? "Pending Stripe fees"
            : "Gross minus refunds and Stripe fees"}
        </small>
      </article>
    </div>
  );
}

export function WillCallPanel({
  busy,
  clearDiscountCodeFilter,
  discountCodeFilter,
  financialSummary,
  lastOrderRefreshAt,
  performanceOrders,
  refreshOrders,
  refreshingOrders,
  refund,
  refundId,
  resendConfirmation,
  selectedPerformance,
  selectedPerformanceId,
  setRefundId,
  setSelectedPerformanceId,
  setShowRefunded,
  setWillCallSearch,
  showRefunded,
  state,
  ticketEvents,
  ticketSoldLabel,
  visibleOrders,
  willCallSearch,
}: {
  readonly busy: boolean;
  readonly clearDiscountCodeFilter: () => void;
  readonly discountCodeFilter: string | null;
  readonly financialSummary: PaymentFinancialSummary;
  readonly lastOrderRefreshAt: Date | null;
  readonly performanceOrders: readonly OrganizationTicketOrder[];
  readonly refreshOrders: () => Promise<void>;
  readonly refreshingOrders: boolean;
  readonly refund: (purchaseId: string) => Promise<void>;
  readonly refundId: string | null;
  readonly resendConfirmation: (purchaseId: string) => Promise<void>;
  readonly selectedPerformance: OrganizationEvent | undefined;
  readonly selectedPerformanceId: string;
  readonly setRefundId: Dispatch<SetStateAction<string | null>>;
  readonly setSelectedPerformanceId: Dispatch<SetStateAction<string>>;
  readonly setShowRefunded: Dispatch<SetStateAction<boolean>>;
  readonly setWillCallSearch: Dispatch<SetStateAction<string>>;
  readonly state: OrderState;
  readonly ticketEvents: readonly OrganizationEvent[];
  readonly ticketSoldLabel: string;
  readonly visibleOrders: readonly OrganizationTicketOrder[];
  readonly willCallSearch: string;
  readonly showRefunded: boolean;
}) {
  const displayedOrders = showRefunded
    ? visibleOrders
    : visibleOrders.filter((order) => order.status !== "refunded");
  const emptyMessage = willCallEmptyMessage({
    discountCodeFilter,
    displayedOrderCount: displayedOrders.length,
    performanceOrderCount: performanceOrders.length,
    status: state.status,
    visibleOrderCount: visibleOrders.length,
  });

  return (
    <>
      <div
        aria-labelledby="ticketing-willcall-tab"
        className="ticket-dashboard__tabpanel"
        id="ticketing-willcall-panel"
        role="tabpanel"
      >
        <fieldset className="ticket-dashboard">
          <legend>Performance summary</legend>
          <div className="ticket-dashboard__intro">
            <div>
              <p>Choose a performance to view ticket sales, revenue, and will-call activity.</p>
            </div>
            <label className="field">
              Select performance
              <select
                onChange={(event) => {
                  setSelectedPerformanceId(event.target.value);
                }}
                value={selectedPerformanceId}
              >
                <option value="all">All ticketed performances</option>
                {ticketEvents.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <WillCallPerformanceMetrics
            financialSummary={financialSummary}
            selectedPerformance={selectedPerformance}
            ticketSoldLabel={ticketSoldLabel}
          />
          <p className="ticket-dashboard__helper-text">
            If an order is refunded, the buyer receives a full refund while Stripe retains the
            original processing fee, which is paid by the Organization.
          </p>
        </fieldset>
      </div>
      <fieldset className="ticket-dashboard__will-call">
        <legend>Will call checklist</legend>
        <div className="ticket-dashboard__section-heading">
          <div>
            <p>Search ticket buyers, confirm payment status, and process refunds.</p>
          </div>
          <div className="form-actions">
            <button
              className="button button--secondary"
              disabled={busy || refreshingOrders}
              onClick={() => void refreshOrders()}
              type="button"
            >
              {refreshingOrders ? "Refreshing…" : "Refresh status"}
            </button>
            <span className="field-help" role="status">
              {lastOrderRefreshAt ? "Updates automatically every 5 seconds." : "Loading updates…"}
            </span>
          </div>
        </div>
        <div className="ticket-dashboard__filters ticket-dashboard__filters--search">
          <label className="field">
            Search
            <input
              onChange={(event) => {
                setWillCallSearch(event.target.value);
              }}
              placeholder="Search buyer name or email…"
              type="search"
              value={willCallSearch}
            />
          </label>
          <label className="checkbox-row">
            <input
              checked={showRefunded}
              onChange={(event) => {
                setShowRefunded(event.target.checked);
              }}
              type="checkbox"
            />
            Show refunded
          </label>
        </div>
        {discountCodeFilter !== null ? (
          <div aria-live="polite" className="ticket-dashboard__active-filter">
            <span>
              Filtering by discount code: <strong>{discountCodeFilter}</strong>
            </span>
            <button className="text-button" onClick={clearDiscountCodeFilter} type="button">
              Clear filter
            </button>
          </div>
        ) : null}
        {state.status === "loading" ? <p>Loading ticket orders…</p> : null}
        {state.status === "error" ? (
          <p className="notice notice--error">Ticket orders could not be loaded.</p>
        ) : null}
        {emptyMessage ? (
          <div className="empty-state">
            <p>{emptyMessage}</p>
          </div>
        ) : null}
        {displayedOrders.length > 0 ? (
          <DataTable
            columns={[
              {
                header: "Buyer name",
                id: "buyerName",
                render: (order) => (
                  <>
                    <strong>{order.buyerName}</strong>
                    {order.bundleId !== null ? (
                      <span
                        className="status-pill status-pill--neutral ticketing-bundle-order-pill"
                        title={
                          order.bundleTitle
                            ? `Bundle purchase: ${order.bundleTitle}`
                            : "Bundle purchase"
                        }
                      >
                        Bundle
                      </span>
                    ) : null}
                  </>
                ),
                sortValue: (order) => buyerLastName(order.buyerName),
              },
              {
                header: "Email",
                id: "email",
                render: (order) => order.buyerEmail,
                sortValue: (order) => order.buyerEmail,
              },
              {
                header: "Sale date",
                id: "saleDate",
                render: (order) => new Date(order.createdAt).toLocaleString(),
                sortValue: (order) => order.createdAt,
              },
              {
                header: "Qty",
                id: "quantity",
                render: (order) => order.quantity,
                sortValue: (order) => order.quantity,
              },
              {
                header: "Amount paid",
                id: "amountPaid",
                render: (order) => money(order.amountPaidCents),
                sortValue: (order) => order.amountPaidCents,
              },
              {
                header: "Discount code",
                id: "discountCode",
                render: (order) =>
                  order.discountCode !== null ? (
                    <span
                      className="ticket-discount-code-pill"
                      title={
                        order.discountAmountCents > 0
                          ? `${order.discountCode} · Discount: ${money(order.discountAmountCents)}`
                          : undefined
                      }
                    >
                      {order.discountCode}
                    </span>
                  ) : (
                    <span aria-label="No discount code">—</span>
                  ),
                sortValue: (order) => order.discountCode ?? "",
              },
              {
                header: "Status",
                id: "status",
                render: (order) => {
                  const statusDisplay = ticketOrderStatusDisplay(order);
                  return <span className={statusDisplay.badgeClass}>{statusDisplay.label}</span>;
                },
                sortValue: (order) =>
                  order.status === "paid" && order.refundRequested
                    ? "refund_requested"
                    : order.status,
              },
              {
                header: "Actions",
                id: "actions",
                render: (order) =>
                  refundId === order.id ? (
                    <div className="danger-confirmation">
                      <p>Refund this complete order?</p>
                      <div className="form-actions">
                        <button
                          className="button button--secondary"
                          disabled={busy}
                          onClick={() => {
                            setRefundId(null);
                          }}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button
                          className="button button--danger"
                          disabled={busy}
                          onClick={() => void refund(order.id)}
                          type="button"
                        >
                          {busy ? "Refunding…" : "Confirm refund"}
                        </button>
                      </div>
                    </div>
                  ) : order.status === "paid" ? (
                    <div className="form-actions">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void resendConfirmation(order.id)}
                        type="button"
                      >
                        Resend
                      </button>
                      {canRefundTicketOrder(order) ? (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setRefundId(order.id);
                          }}
                          type="button"
                        >
                          Refund
                        </button>
                      ) : null}
                    </div>
                  ) : null,
              },
            ]}
            initialSort={{ columnId: "saleDate", direction: "desc" }}
            keySelector={(order) => order.id}
            rows={displayedOrders}
          />
        ) : null}
      </fieldset>
    </>
  );
}
