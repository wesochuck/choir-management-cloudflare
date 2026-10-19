import type { OrganizationEvent, OrganizationTicketOrder } from "@choir/contracts";
import type { PaymentFinancialSummary } from "@choir/domain";
import { DataTable, useConfirmation } from "@choir/ui";
import type { Dispatch, SetStateAction } from "react";
import {
  buyerLastName,
  canRefundTicketOrder,
  money,
  ticketOrderStatusDisplay,
  type OrderState,
  type TicketingTab,
} from "./shared";
import { AppLink } from "../AuthenticatedShell/navigation";

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
  if (displayedOrderCount === 0) return "All matching ticket orders are refunded or expired.";
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

function WillCallPerformanceSelector({
  activeTab,
  navigate,
  selectedPerformance,
  selectedPerformanceId,
  setSelectedPerformanceId,
  ticketEvents,
}: {
  readonly activeTab: TicketingTab;
  readonly navigate?: ((href: string) => void) | undefined;
  readonly selectedPerformance: OrganizationEvent | undefined;
  readonly selectedPerformanceId: string;
  readonly setSelectedPerformanceId: Dispatch<SetStateAction<string>>;
  readonly ticketEvents: readonly OrganizationEvent[];
}) {
  const returnToPath =
    typeof window !== "undefined" && window.location.pathname.startsWith("/admin/ticketing")
      ? "/admin/ticketing"
      : "/admin/tickets";
  // Preserve the originating tab across the Events round trip so the admin
  // lands back where they started. Transient Will-Call search/filter text is
  // intentionally not serialized (it can contain buyer PII).
  const returnToParams = new URLSearchParams({ eventId: selectedPerformance?.id ?? "" });
  if (!selectedPerformance) returnToParams.delete("eventId");
  if (activeTab !== "willcall") returnToParams.set("tab", activeTab);
  const returnToUrl = selectedPerformance
    ? `${returnToPath}?${returnToParams.toString()}`
    : returnToPath;
  const editTicketSettingsHref = selectedPerformance
    ? `/admin/events?${new URLSearchParams({
        eventId: selectedPerformance.id,
        section: "tickets",
        returnTo: returnToUrl,
      }).toString()}`
    : "";

  return (
    <div className="field ticket-dashboard__performance-field">
      <label htmlFor="will-call-select-performance">Select performance</label>
      <div className="ticket-dashboard__performance-control-row">
        <select
          id="will-call-select-performance"
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
        {selectedPerformance ? (
          <>
            <a
              className="button button--secondary button--control-height ticket-dashboard__will-call-export-button"
              href={`/api/organization/tickets/will-call?eventId=${encodeURIComponent(selectedPerformance.id)}`}
            >
              Download will-call CSV
            </a>
            <AppLink
              className="button button--secondary button--control-height ticket-dashboard__edit-settings-button"
              href={editTicketSettingsHref}
              onNavigate={
                navigate ??
                ((href) => {
                  window.location.assign(href);
                })
              }
            >
              Edit ticket settings →
            </AppLink>
          </>
        ) : null}
      </div>
      {selectedPerformance ? (
        <span className="field-help">
          Edit the selected performance&apos;s ticket capacity and pricing.
        </span>
      ) : null}
    </div>
  );
}

export function WillCallPanel({
  activeTab,
  busy,
  clearDiscountCodeFilter,
  discountCodeFilter,
  financialSummary,
  lastOrderRefreshAt,
  navigate,
  performanceOrders,
  refreshOrders,
  refreshingOrders,
  refund,
  resendConfirmation,
  selectedPerformance,
  selectedPerformanceId,
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
  readonly activeTab: TicketingTab;
  readonly busy: boolean;
  readonly clearDiscountCodeFilter: () => void;
  readonly discountCodeFilter: string | null;
  readonly financialSummary: PaymentFinancialSummary;
  readonly lastOrderRefreshAt: Date | null;
  readonly navigate?: ((href: string) => void) | undefined;
  readonly performanceOrders: readonly OrganizationTicketOrder[];
  readonly refreshOrders: () => Promise<void>;
  readonly refreshingOrders: boolean;
  readonly refund: (purchaseId: string) => Promise<void>;
  readonly resendConfirmation: (purchaseId: string) => Promise<void>;
  readonly selectedPerformance: OrganizationEvent | undefined;
  readonly selectedPerformanceId: string;
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
  const { confirm, confirmationDialog } = useConfirmation();

  async function handleRefundClick(order: OrganizationTicketOrder) {
    const formattedAmount = money(order.amountPaidCents);
    const itemTitle = order.eventTitle || order.bundleTitle || "this ticket order";
    const confirmed = await confirm({
      confirmLabel: "Refund order",
      description: `Refund ${formattedAmount} to ${order.buyerName} for ${itemTitle}? This financial refund cannot be undone.`,
      destructive: true,
      title: "Refund ticket order?",
    });
    if (!confirmed) return;
    await refund(order.id);
  }

  const displayedOrders = showRefunded
    ? visibleOrders
    : visibleOrders.filter((order) => order.status !== "refunded" && order.status !== "expired");
  const emptyMessage = willCallEmptyMessage({
    discountCodeFilter,
    displayedOrderCount: displayedOrders.length,
    performanceOrderCount: performanceOrders.length,
    status: state.status,
    visibleOrderCount: visibleOrders.length,
  });

  return (
    <>
      {confirmationDialog}
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
            <WillCallPerformanceSelector
              activeTab={activeTab}
              navigate={navigate}
              selectedPerformance={selectedPerformance}
              selectedPerformanceId={selectedPerformanceId}
              setSelectedPerformanceId={setSelectedPerformanceId}
              ticketEvents={ticketEvents}
            />
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
          <div className="field">
            <label htmlFor="will-call-search">Search</label>
            <input
              id="will-call-search"
              onChange={(event) => {
                setWillCallSearch(event.target.value);
              }}
              placeholder="Search buyer name or email…"
              type="search"
              value={willCallSearch}
            />
          </div>
          <label className="checkbox-row">
            <input
              checked={showRefunded}
              onChange={(event) => {
                setShowRefunded(event.target.checked);
              }}
              type="checkbox"
            />
            Show refunded and expired
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
                  order.status === "paid" ? (
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
                          className="text-button text-button--danger"
                          disabled={busy}
                          onClick={() => {
                            void handleRefundClick(order);
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
