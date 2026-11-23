import type { OrganizationEvent, OrganizationTicketOrder } from "@choir/contracts";
import type { PaymentFinancialSummary } from "@choir/domain";
import { DataTable, useConfirmation } from "@choir/ui";
import { useState, type Dispatch, type SetStateAction } from "react";
import {
  buyerLastName,
  canRefundTicketOrder,
  money,
  ticketOrderStatusDisplay,
  type OrderState,
  type TicketingTab,
  type WillCallSourceFilter,
  type WillCallSourceTicketCounts,
} from "./shared";
import { AppLink } from "../AuthenticatedShell/navigation";

function compactSaleDate(value: string): string {
  const date = new Date(value);
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  };
  if (date.getFullYear() !== new Date().getFullYear()) {
    options.year = "numeric";
  }
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function willCallEmptyMessage({
  discountCodeFilter,
  displayedOrderCount,
  performanceOrderCount,
  sourceFilter,
  sourceFilteredOrderCount,
  status,
  visibleOrderCount,
}: {
  readonly discountCodeFilter: string | null;
  readonly displayedOrderCount: number;
  readonly performanceOrderCount: number;
  readonly sourceFilter: WillCallSourceFilter;
  readonly sourceFilteredOrderCount: number;
  readonly status: OrderState["status"];
  readonly visibleOrderCount: number;
}): string | null {
  if (status !== "ready") return null;
  if (visibleOrderCount === 0) {
    if (performanceOrderCount === 0) return "No ticket orders yet.";
    if (sourceFilteredOrderCount === 0) {
      return sourceFilter === "bundle"
        ? "No bundle ticket orders for this selection."
        : "No single-concert ticket orders for this selection.";
    }
    if (discountCodeFilter !== null) {
      return `No ticket orders match discount code ${discountCodeFilter}.`;
    }
    return "No ticket buyers match this search.";
  }
  if (displayedOrderCount === 0) return "All matching ticket orders are refunded or expired.";
  return null;
}

function sourceScopeNote(
  sourceFilter: WillCallSourceFilter,
  selectedPerformance: OrganizationEvent | undefined,
): string {
  if (selectedPerformance) {
    if (sourceFilter === "single") {
      return `Excluding bundled ticket sales — showing only direct ${selectedPerformance.title} orders.`;
    }
    if (sourceFilter === "bundle") {
      return `Showing only bundle orders that include ${selectedPerformance.title}.`;
    }
    return `Showing single-concert and bundle sales for ${selectedPerformance.title}.`;
  }
  if (sourceFilter === "single") {
    return "Excluding bundled ticket sales — showing only single-concert orders.";
  }
  if (sourceFilter === "bundle") {
    return "Showing only bundle orders across all performances.";
  }
  return "Showing single-concert and bundle sales across all performances.";
}

function WillCallSourceFilterBar({
  selectedPerformance,
  setSourceFilter,
  sourceFilter,
  sourceTicketCounts,
}: {
  readonly selectedPerformance: OrganizationEvent | undefined;
  readonly setSourceFilter: Dispatch<SetStateAction<WillCallSourceFilter>>;
  readonly sourceFilter: WillCallSourceFilter;
  readonly sourceTicketCounts: WillCallSourceTicketCounts;
}) {
  const options: readonly {
    readonly count: number;
    readonly label: string;
    readonly value: WillCallSourceFilter;
  }[] = [
    { count: sourceTicketCounts.all, label: "All sales", value: "all" },
    { count: sourceTicketCounts.single, label: "Single-concert only", value: "single" },
    { count: sourceTicketCounts.bundle, label: "Bundle sales only", value: "bundle" },
  ];

  return (
    <div className="ticket-dashboard__source-bar">
      <div className="ticket-dashboard__source-controls">
        <span className="ticket-dashboard__source-label" id="will-call-source-filter-label">
          Ticket source
        </span>
        <div
          aria-labelledby="will-call-source-filter-label"
          className="ticket-dashboard__source-group"
          role="group"
        >
          {options.map((option) => (
            <button
              aria-pressed={sourceFilter === option.value}
              className="ticket-dashboard__source-button"
              key={option.value}
              onClick={() => {
                setSourceFilter(option.value);
              }}
              type="button"
            >
              <span>{option.label}</span>
              <span className="ticket-dashboard__source-count">({option.count})</span>
            </button>
          ))}
        </div>
      </div>
      <p className="ticket-dashboard__source-note">
        {sourceScopeNote(sourceFilter, selectedPerformance)}
      </p>
    </div>
  );
}

function WillCallPerformanceMetrics({
  financialSummary,
  selectedPerformance,
  sourceFilter,
  sourceTicketCounts,
  ticketSoldLabel,
}: {
  readonly financialSummary: PaymentFinancialSummary;
  readonly selectedPerformance: OrganizationEvent | undefined;
  readonly sourceFilter: WillCallSourceFilter;
  readonly sourceTicketCounts: WillCallSourceTicketCounts;
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

  const soldBreakdownLabel =
    sourceFilter === "all"
      ? `${String(sourceTicketCounts.single)} single · ${String(sourceTicketCounts.bundle)} bundle`
      : sourceFilter === "single"
        ? "Single-concert sales only"
        : "Bundle sales only";

  const grossSubtitle =
    sourceFilter === "single"
      ? "Single-concert charges"
      : sourceFilter === "bundle"
        ? "Full bundle order charges"
        : "Original charges";

  return (
    <div className="ticket-dashboard__metrics">
      <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--sold">
        <span className="summary-card__label">Tickets sold</span>
        <strong>{ticketSoldLabel}</strong>
        <small className="ticket-dashboard__metric-detail">
          <span>{selectedPerformance ? selectedPerformance.title : "All performances"}</span>
          <span className="ticket-dashboard__metric-breakdown">{soldBreakdownLabel}</span>
        </small>
      </article>
      <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--gross">
        <span className="summary-card__label">Gross charged</span>
        <strong>{money(financialSummary.grossChargedCents)}</strong>
        <small>{grossSubtitle}</small>
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
  setSourceFilter,
  setWillCallSearch,
  showRefunded,
  sourceFilter,
  sourceFilteredOrderCount,
  sourceTicketCounts,
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
  readonly setSourceFilter: Dispatch<SetStateAction<WillCallSourceFilter>>;
  readonly setWillCallSearch: Dispatch<SetStateAction<string>>;
  readonly sourceFilter: WillCallSourceFilter;
  readonly sourceFilteredOrderCount: number;
  readonly sourceTicketCounts: WillCallSourceTicketCounts;
  readonly state: OrderState;
  readonly ticketEvents: readonly OrganizationEvent[];
  readonly ticketSoldLabel: string;
  readonly visibleOrders: readonly OrganizationTicketOrder[];
  readonly willCallSearch: string;
  readonly showRefunded: boolean;
}) {
  const { confirm, confirmationDialog } = useConfirmation();
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

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
    sourceFilter,
    sourceFilteredOrderCount,
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
            <div className="ticket-dashboard__performance-context">
              <p>Choose a performance to view ticket sales, revenue, and will-call activity.</p>
              {selectedPerformance?.publicGraphicFileId ? (
                <img
                  alt={`Event artwork for ${selectedPerformance.title}`}
                  className="ticket-dashboard__event-image"
                  src={`/api/organization/files/${encodeURIComponent(selectedPerformance.publicGraphicFileId)}`}
                />
              ) : null}
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
          <WillCallSourceFilterBar
            selectedPerformance={selectedPerformance}
            setSourceFilter={setSourceFilter}
            sourceFilter={sourceFilter}
            sourceTicketCounts={sourceTicketCounts}
          />
          <WillCallPerformanceMetrics
            financialSummary={financialSummary}
            selectedPerformance={selectedPerformance}
            sourceFilter={sourceFilter}
            sourceTicketCounts={sourceTicketCounts}
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
        {sourceFilter !== "all" ? (
          <div aria-live="polite" className="ticket-dashboard__active-filter">
            <span>
              Filtering by ticket source:{" "}
              <strong>
                {sourceFilter === "single" ? "Single-concert only" : "Bundle sales only"}
              </strong>
            </span>
            <button
              className="text-button"
              onClick={() => {
                setSourceFilter("all");
              }}
              type="button"
            >
              Show all
            </button>
          </div>
        ) : null}
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
          <div className="ticketing-sales-table">
            <DataTable
              columns={[
                {
                  className: "ticket-sales-table__disclosure",
                  header: "",
                  headerContent: <span className="sr-only">Order details</span>,
                  id: "disclosure",
                  mobileLabel: "Details",
                  render: (order, { presentation }) => {
                    const isExpanded = expandedOrderId === order.id;
                    const detailsId = `ticket-order-details-${order.id}-${presentation}`;
                    return (
                      <button
                        aria-controls={isExpanded ? detailsId : undefined}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? "Hide" : "Show"} details for ${order.buyerName}`}
                        className="ticket-sales-table__disclosure-button"
                        onClick={() => {
                          setExpandedOrderId((current) => (current === order.id ? null : order.id));
                        }}
                        type="button"
                      >
                        <span aria-hidden="true" className="ticket-sales-table__chevron" />
                      </button>
                    );
                  },
                },
                {
                  className: "ticket-sales-table__buyer",
                  header: "Buyer name",
                  id: "buyerName",
                  render: (order) => <strong>{order.buyerName}</strong>,
                  sortValue: (order) => buyerLastName(order.buyerName),
                },
                {
                  className: "ticket-sales-table__email",
                  header: "Email",
                  id: "email",
                  render: (order) => (
                    <span className="ticket-sales-table__email-value" title={order.buyerEmail}>
                      {order.buyerEmail}
                    </span>
                  ),
                  sortValue: (order) => order.buyerEmail,
                },
                {
                  className: "ticket-sales-table__type",
                  header: "Type",
                  id: "type",
                  render: (order) =>
                    order.bundleId !== null ? (
                      <span
                        className="status-pill ticket-sales-table__type-pill ticket-sales-table__type-pill--bundle"
                        title={order.bundleTitle || "Bundle"}
                      >
                        Bundle
                      </span>
                    ) : (
                      <span className="status-pill status-pill--neutral ticket-sales-table__type-pill ticket-sales-table__type-pill--single">
                        Single
                      </span>
                    ),
                  sortValue: (order) =>
                    order.bundleId !== null ? `Bundle ${order.bundleTitle}` : "Single",
                },
                {
                  className: "ticket-sales-table__sale-date",
                  header: "Sale date",
                  id: "saleDate",
                  render: (order, { presentation }) => (
                    <time dateTime={order.createdAt}>
                      {presentation === "table"
                        ? compactSaleDate(order.createdAt)
                        : new Date(order.createdAt).toLocaleString()}
                    </time>
                  ),
                  sortValue: (order) => order.createdAt,
                },
                {
                  align: "center",
                  className: "ticket-sales-table__quantity",
                  header: "Qty",
                  id: "quantity",
                  render: (order) => order.quantity,
                  sortValue: (order) => order.quantity,
                },
                {
                  align: "right",
                  className: "ticket-sales-table__amount",
                  header: "Amount paid",
                  id: "amountPaid",
                  render: (order) => money(order.amountPaidCents),
                  sortValue: (order) => order.amountPaidCents,
                },
                {
                  className: "ticket-sales-table__status",
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
                  className: "ticket-sales-table__actions",
                  header: "Actions",
                  id: "actions",
                  render: (order) =>
                    order.status === "paid" ? (
                      <div className="form-actions form-actions--inline">
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void resendConfirmation(order.id)}
                          type="button"
                        >
                          Resend
                        </button>
                      </div>
                    ) : null,
                },
              ]}
              expandedRowId={expandedOrderId}
              isRowInteractive={(_, context) => context.presentation === "table"}
              initialSort={{ columnId: "saleDate", direction: "desc" }}
              keySelector={(order) => order.id}
              onRowClick={(order) => {
                setExpandedOrderId((current) => (current === order.id ? null : order.id));
              }}
              renderExpandedRow={(order, presentation) => {
                const detailsId = `ticket-order-details-${order.id}-${presentation}`;
                const status = ticketOrderStatusDisplay(order);
                return (
                  <div className="ticket-sales-details" id={detailsId}>
                    <dl className="ticket-sales-details__item">
                      <dt>Full email</dt>
                      <dd className="ticket-sales-details__email">{order.buyerEmail}</dd>
                    </dl>
                    <dl className="ticket-sales-details__item">
                      <dt>{order.bundleId !== null ? "Bundle" : "Performance"}</dt>
                      <dd>{order.bundleTitle || order.eventTitle}</dd>
                    </dl>
                    {order.discountCode !== null ? (
                      <dl className="ticket-sales-details__item">
                        <dt>Discount code</dt>
                        <dd>
                          {order.discountCode}
                          {order.discountAmountCents > 0
                            ? ` · ${money(order.discountAmountCents)} off`
                            : ""}
                        </dd>
                      </dl>
                    ) : null}
                    <dl className="ticket-sales-details__item">
                      <dt>Status</dt>
                      <dd>{status.label}</dd>
                    </dl>
                    <dl className="ticket-sales-details__item">
                      <dt>Sold</dt>
                      <dd>
                        <time dateTime={order.createdAt}>
                          {new Date(order.createdAt).toLocaleString()}
                        </time>
                      </dd>
                    </dl>
                    {canRefundTicketOrder(order) ? (
                      <div className="ticket-sales-details__actions">
                        <button
                          className="text-button text-button--danger"
                          disabled={busy}
                          onClick={() => {
                            void handleRefundClick(order);
                          }}
                          type="button"
                        >
                          Refund order
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              }}
              rowLabel={(order) =>
                `${expandedOrderId === order.id ? "Hide" : "Show"} details for ${order.buyerName}`
              }
              rows={displayedOrders}
            />
          </div>
        ) : null}
      </fieldset>
    </>
  );
}
