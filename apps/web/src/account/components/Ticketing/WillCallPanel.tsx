import type { OrganizationEvent, OrganizationTicketOrder } from "@choir/contracts";
import { DataTable } from "@choir/ui";
import { useState, type Dispatch, type SetStateAction } from "react";
import {
  buyerLastName,
  canRefundTicketOrder,
  money,
  ticketOrderStatusDisplay,
  type OrderState,
} from "./shared";

function willCallEmptyMessage({
  displayedOrderCount,
  performanceOrderCount,
  status,
  visibleOrderCount,
}: {
  readonly displayedOrderCount: number;
  readonly performanceOrderCount: number;
  readonly status: OrderState["status"];
  readonly visibleOrderCount: number;
}): string | null {
  if (status !== "ready") return null;
  if (performanceOrderCount === 0) return "No ticket orders yet.";
  if (visibleOrderCount === 0) return "No ticket buyers match this search.";
  if (displayedOrderCount === 0) return "All matching ticket orders are refunded.";
  return null;
}

export function WillCallPanel({
  busy,
  feesCollectedCents,
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
  setWillCallSearch,
  state,
  ticketEvents,
  ticketSalesCents,
  ticketSoldLabel,
  totalRevenueCents,
  visibleOrders,
  willCallSearch,
}: {
  readonly busy: boolean;
  readonly feesCollectedCents: number;
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
  readonly setWillCallSearch: Dispatch<SetStateAction<string>>;
  readonly state: OrderState;
  readonly ticketEvents: readonly OrganizationEvent[];
  readonly ticketSalesCents: number;
  readonly ticketSoldLabel: string;
  readonly totalRevenueCents: number;
  readonly visibleOrders: readonly OrganizationTicketOrder[];
  readonly willCallSearch: string;
}) {
  const [showRefunded, setShowRefunded] = useState(false);
  const displayedOrders = showRefunded
    ? visibleOrders
    : visibleOrders.filter((order) => order.status !== "refunded");
  const emptyMessage = willCallEmptyMessage({
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
          <div className="ticket-dashboard__metrics">
            <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--sold">
              <span className="summary-card__label">Tickets sold</span>
              <strong>{ticketSoldLabel}</strong>
              <small>{selectedPerformance ? selectedPerformance.title : "All performances"}</small>
            </article>
            <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--sales">
              <span className="summary-card__label">Ticket sales</span>
              <strong>{money(ticketSalesCents)}</strong>
              <small>Before processing fees</small>
            </article>
            <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--fees">
              <span className="summary-card__label">Fees collected</span>
              <strong>{money(feesCollectedCents)}</strong>
              <small>Paid orders</small>
            </article>
            <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--revenue">
              <span className="summary-card__label">Total revenue</span>
              <strong>{money(totalRevenueCents)}</strong>
              <small>Including processing fees</small>
            </article>
          </div>
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
                render: (order) => <strong>{order.buyerName}</strong>,
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
