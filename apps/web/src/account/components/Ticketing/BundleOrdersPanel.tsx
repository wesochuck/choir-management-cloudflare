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
          <DataTable
            columns={[
              {
                header: "Buyer",
                id: "buyer",
                render: (order) => (
                  <>
                    {order.buyerName}
                    {order.bundleId !== null ? (
                      <span className="status-pill status-pill--neutral ticketing-bundle-order-pill">
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
                header: "Bundle",
                id: "bundle",
                render: bundleTitle,
                sortValue: bundleTitle,
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
      </div>
    </>
  );
}
