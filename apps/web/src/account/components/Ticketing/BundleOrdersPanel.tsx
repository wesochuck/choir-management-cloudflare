import type { OrganizationTicketOrder, TicketBundle } from "@choir/contracts";
import type { Dispatch, SetStateAction } from "react";
import { money, type OrderState } from "./shared";

export function BundleOrdersPanel({
  bundleOrders,
  bundles,
  busy,
  refund,
  refundId,
  resendConfirmation,
  setRefundId,
  state,
}: {
  readonly bundleOrders: readonly OrganizationTicketOrder[];
  readonly bundles: readonly TicketBundle[];
  readonly busy: boolean;
  readonly refund: (purchaseId: string) => Promise<void>;
  readonly refundId: string | null;
  readonly resendConfirmation: (purchaseId: string) => Promise<void>;
  readonly setRefundId: Dispatch<SetStateAction<string | null>>;
  readonly state: OrderState;
}) {
  return (
    <div
      aria-labelledby="ticketing-orders-tab"
      className="ticketing-tab-panel"
      id="ticketing-orders-panel"
      role="tabpanel"
    >
      {state.status === "loading" ? <p>Loading bundle orders…</p> : null}
      {state.status === "error" ? (
        <p className="notice notice--error">Bundle orders could not be loaded.</p>
      ) : null}
      {state.status === "ready" && bundleOrders.length === 0 ? (
        <div className="empty-state">
          <p>No bundle orders received yet.</p>
        </div>
      ) : null}
      {bundleOrders.length > 0 ? (
        <div className="table-scroll">
          <table className="table--actions">
            <thead>
              <tr>
                <th>Buyer</th>
                <th>Email</th>
                <th>Sale date</th>
                <th>Bundle</th>
                <th>Qty</th>
                <th>Amount paid</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bundleOrders.map((order) => {
                const bundle = bundles.find(({ id }) => id === order.bundleId);
                return (
                  <tr key={order.id}>
                    <td>{order.buyerName}</td>
                    <td>{order.buyerEmail}</td>
                    <td>{new Date(order.createdAt).toLocaleString()}</td>
                    <td>{bundle?.title ?? order.bundleTitle}</td>
                    <td>{order.quantity}</td>
                    <td>{money(order.amountPaidCents)}</td>
                    <td>{order.status}</td>
                    <td>
                      {refundId === order.id ? (
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
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
