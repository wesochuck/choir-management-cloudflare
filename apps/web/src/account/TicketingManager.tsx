import type { OrganizationTicketOrder } from "@choir/contracts";
import { useEffect, useState } from "react";

import { listOrganizationTicketOrders, refundOrganizationTicketOrder } from "../auth/api";

type OrderState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly orders: readonly OrganizationTicketOrder[]; readonly status: "ready" };

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

export function TicketingManager({ enabled }: { readonly enabled: boolean }) {
  const [state, setState] = useState<OrderState>({ status: "loading" });
  const [refundId, setRefundId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    listOrganizationTicketOrders(controller.signal)
      .then((orders) => {
        setState({ orders, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  async function refund(purchaseId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const refunded = await refundOrganizationTicketOrder(purchaseId);
      setState((current) =>
        current.status === "ready"
          ? {
              orders: current.orders.map((order) => (order.id === refunded.id ? refunded : order)),
              status: "ready",
            }
          : current,
      );
      setRefundId(null);
      setMessage("Ticket order refunded.");
    } catch {
      setMessage("The ticket order could not be refunded.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;
  return (
    <section className="panel" aria-labelledby="ticketing-manager-heading">
      <p className="eyebrow">Manager tools</p>
      <h2 id="ticketing-manager-heading">Ticket Orders</h2>
      <p>Ticket prices and capacity are configured on each performance.</p>
      {message ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}
      {state.status === "loading" ? <p>Loading ticket orders…</p> : null}
      {state.status === "error" ? (
        <p className="notice notice--error">Ticket orders could not be loaded.</p>
      ) : null}
      {state.status === "ready" && state.orders.length === 0 ? <p>No ticket orders yet.</p> : null}
      {state.status === "ready" && state.orders.length > 0 ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Buyer</th>
                <th>Performance</th>
                <th>Quantity</th>
                <th>Total</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {state.orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    {order.buyerName}
                    <br />
                    <small>{order.buyerEmail}</small>
                  </td>
                  <td>{order.eventTitle}</td>
                  <td>{order.quantity}</td>
                  <td>{money(order.amountPaidCents)}</td>
                  <td>
                    {order.status}
                    {order.checkoutMode === "fake" ? " (simulation)" : ""}
                  </td>
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
                      <button
                        className="text-button"
                        onClick={() => {
                          setRefundId(order.id);
                        }}
                        type="button"
                      >
                        Refund
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
