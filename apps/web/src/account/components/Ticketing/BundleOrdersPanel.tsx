import type { OrganizationTicketOrder, TicketBundle } from "@choir/contracts";
import { DataTable, useConfirmation } from "@choir/ui";
import { useMemo, useState } from "react";
import {
  buyerLastName,
  canRefundTicketOrder,
  money,
  ticketOrderStatusDisplay,
  type OrderState,
} from "./shared";

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

export function BundleOrdersPanel({
  bundleOrders,
  bundles,
  busy,
  refreshOrders,
  refreshingOrders,
  refund,
  resendConfirmation,
  state,
}: {
  readonly bundleOrders: readonly OrganizationTicketOrder[];
  readonly bundles: readonly TicketBundle[];
  readonly busy: boolean;
  readonly refreshOrders: () => Promise<void>;
  readonly refreshingOrders: boolean;
  readonly refund: (purchaseId: string) => Promise<void>;
  readonly resendConfirmation: (purchaseId: string) => Promise<void>;
  readonly state: OrderState;
}) {
  const { confirm, confirmationDialog } = useConfirmation();
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [showRefunded, setShowRefunded] = useState(false);
  const bundleTitlesById = useMemo(
    () => new Map(bundles.map(({ id, title }) => [id, title])),
    [bundles],
  );

  function bundleTitle(order: OrganizationTicketOrder): string {
    return (
      (order.bundleId === null ? undefined : bundleTitlesById.get(order.bundleId)) ??
      order.bundleTitle
    );
  }

  async function handleRefundClick(order: OrganizationTicketOrder) {
    const formattedAmount = money(order.amountPaidCents);
    const itemTitle = bundleTitle(order) || "this bundle order";
    const confirmed = await confirm({
      confirmLabel: "Refund order",
      description: `Refund ${formattedAmount} to ${order.buyerName} for ${itemTitle}? This financial refund cannot be undone.`,
      destructive: true,
      title: "Refund bundle order?",
    });
    if (!confirmed) return;
    await refund(order.id);
  }

  const displayedOrders = showRefunded
    ? bundleOrders
    : bundleOrders.filter((order) => order.status !== "refunded");

  return (
    <>
      {confirmationDialog}
      <div
        aria-labelledby="ticketing-orders-tab"
        className="ticketing-tab-panel"
        id="ticketing-orders-panel"
        role="tabpanel"
      >
        <fieldset className="ticket-dashboard__will-call">
          <legend>Bundle orders</legend>
          <div className="ticket-dashboard__section-heading">
            <div>
              <p>Review sales and manage bundle fulfillment.</p>
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
            </div>
          </div>
          <div className="ticket-dashboard__filters ticket-dashboard__filters--search">
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
          {state.status === "loading" ? <p>Loading bundle orders…</p> : null}
          {state.status === "error" ? (
            <p className="notice notice--error">Bundle orders could not be loaded.</p>
          ) : null}
          {state.status === "ready" && bundleOrders.length === 0 ? (
            <div className="empty-state">
              <p>No bundle orders received yet.</p>
            </div>
          ) : null}
          {state.status === "ready" && bundleOrders.length > 0 && displayedOrders.length === 0 ? (
            <div className="empty-state">
              <p>All bundle orders are refunded.</p>
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
                      const detailsId = `bundle-order-details-${order.id}-${presentation}`;
                      return (
                        <button
                          aria-controls={isExpanded ? detailsId : undefined}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Hide" : "Show"} details for ${order.buyerName}`}
                          className="ticket-sales-table__disclosure-button"
                          onClick={() => {
                            setExpandedOrderId((current) =>
                              current === order.id ? null : order.id,
                            );
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
                      return (
                        <span className={statusDisplay.badgeClass}>{statusDisplay.label}</span>
                      );
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
                  const detailsId = `bundle-order-details-${order.id}-${presentation}`;
                  const status = ticketOrderStatusDisplay(order);
                  return (
                    <div className="ticket-sales-details" id={detailsId}>
                      <dl className="ticket-sales-details__item">
                        <dt>Full email</dt>
                        <dd className="ticket-sales-details__email">{order.buyerEmail}</dd>
                      </dl>
                      <dl className="ticket-sales-details__item">
                        <dt>Bundle</dt>
                        <dd>{bundleTitle(order)}</dd>
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
      </div>
    </>
  );
}
