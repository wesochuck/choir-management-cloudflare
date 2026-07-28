import type { OrganizationEvent, OrganizationTicketOrder, TicketBundle } from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useEffect, useState, type SyntheticEvent } from "react";

import {
  deleteTicketBundle,
  listOrganizationEvents,
  listOrganizationTicketOrders,
  listTicketBundles,
  refundOrganizationTicketOrder,
  resendTicketConfirmation,
  saveTicketBundle,
} from "../auth/api";
import { TicketScanner } from "./TicketScanner";

type OrderState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly orders: readonly OrganizationTicketOrder[]; readonly status: "ready" };

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

// This component coordinates three intentionally co-located manager tools and their shared state.
// eslint-disable-next-line complexity
export function TicketingManager({
  enabled,
  scanOnly = false,
}: {
  readonly enabled: boolean;
  readonly scanOnly?: boolean;
}) {
  const [state, setState] = useState<OrderState>({ status: "loading" });
  const [refundId, setRefundId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ticketEvents, setTicketEvents] = useState<readonly OrganizationEvent[]>([]);
  const [bundles, setBundles] = useState<readonly TicketBundle[]>([]);
  const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
  const [bundleTitle, setBundleTitle] = useState("");
  const [bundlePrice, setBundlePrice] = useState("");
  const [bundleCapacity, setBundleCapacity] = useState("");
  const [bundleSaleEnd, setBundleSaleEnd] = useState("");
  const [bundleEventIds, setBundleEventIds] = useState<readonly string[]>([]);
  const [bundleIsActive, setBundleIsActive] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const ordersRequest = scanOnly
      ? Promise.resolve<readonly OrganizationTicketOrder[]>([])
      : listOrganizationTicketOrders(controller.signal);
    const bundlesRequest = scanOnly
      ? Promise.resolve<readonly TicketBundle[]>([])
      : listTicketBundles(controller.signal);
    void Promise.allSettled([
      ordersRequest,
      listOrganizationEvents(controller.signal),
      bundlesRequest,
    ]).then(([ordersResult, eventsResult, bundlesResult]) => {
      if (controller.signal.aborted) return;
      if (ordersResult.status === "fulfilled") {
        setState({ orders: ordersResult.value, status: "ready" });
      } else {
        setState({ status: "error" });
      }
      if (eventsResult.status === "fulfilled") {
        setTicketEvents(
          eventsResult.value.filter(
            (event) => event.type === "Performance" && event.isTicketingEnabled,
          ),
        );
      }
      if (bundlesResult.status === "fulfilled") setBundles(bundlesResult.value);
    });
    return () => {
      controller.abort();
    };
  }, [enabled, scanOnly]);

  function clearBundleForm() {
    setEditingBundleId(null);
    setBundleTitle("");
    setBundlePrice("");
    setBundleCapacity("");
    setBundleSaleEnd("");
    setBundleEventIds([]);
    setBundleIsActive(true);
  }

  function closeBundleDialog(): void {
    if (busy) return;
    setBundleDialogOpen(false);
    clearBundleForm();
  }

  function openNewBundle(): void {
    clearBundleForm();
    setMessage(null);
    setBundleDialogOpen(true);
  }

  async function saveBundle(formEvent: SyntheticEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveTicketBundle(
        {
          capacity: bundleCapacity ? Number(bundleCapacity) : null,
          eventIds: [...bundleEventIds],
          isActive: bundleIsActive,
          priceCents: Math.round(Number(bundlePrice) * 100),
          saleEndAt: new Date(bundleSaleEnd).toISOString(),
          title: bundleTitle,
        },
        editingBundleId ?? undefined,
      );
      setBundles((current) => [saved, ...current.filter(({ id }) => id !== saved.id)]);
      clearBundleForm();
      setBundleDialogOpen(false);
      setMessage("Ticket bundle saved. Publish the public website to make it visible.");
    } catch {
      setMessage("The ticket bundle could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function editBundle(bundle: TicketBundle) {
    setEditingBundleId(bundle.id);
    setBundleTitle(bundle.title);
    setBundlePrice((bundle.priceCents / 100).toFixed(2));
    setBundleCapacity(bundle.capacity === null ? "" : String(bundle.capacity));
    const date = new Date(bundle.saleEndAt);
    setBundleSaleEnd(
      new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
    );
    setBundleEventIds(bundle.eventIds);
    setBundleIsActive(bundle.isActive);
    setBundleDialogOpen(true);
  }

  async function removeBundle(bundleId: string) {
    setBusy(true);
    setMessage(null);
    try {
      await deleteTicketBundle(bundleId);
      setBundles((current) => current.filter(({ id }) => id !== bundleId));
      if (editingBundleId === bundleId) {
        setBundleDialogOpen(false);
        clearBundleForm();
      }
      setMessage("Ticket bundle deleted.");
    } catch {
      setMessage("Bundles with orders cannot be deleted; edit or deactivate them instead.");
    } finally {
      setBusy(false);
    }
  }

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

  async function resendConfirmation(purchaseId: string) {
    setBusy(true);
    setMessage(null);
    try {
      await resendTicketConfirmation(purchaseId);
      setMessage("Ticket confirmation queued.");
    } catch {
      setMessage("The ticket confirmation could not be queued.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;
  if (scanOnly) {
    return (
      <section className="panel" aria-label="Ticket scanner">
        <p className="section-description">
          Scan a ticket QR code at the door or validate a ticket credential manually.
        </p>
        <TicketScanner events={ticketEvents} />
      </section>
    );
  }
  return (
    <section className="panel" aria-labelledby="ticketing-manager-heading">
      <p className="eyebrow">Manager tools</p>
      <h2 id="ticketing-manager-heading">Ticket Orders</h2>
      <p>Ticket prices and capacity are configured on each performance.</p>
      <div className="table-actions">
        <a className="button button--secondary" href="/admin/tickets/scan">
          Scan tickets
        </a>
      </div>
      {message ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}
      <div className="split-panel">
        <div>
          <h3>Ticket bundles</h3>
          <p>Create a bundle, pass, or ticket tier for one or more performances.</p>
          <button className="button button--primary" onClick={openNewBundle} type="button">
            New ticket bundle
          </button>
        </div>
        <Dialog
          description="Set pricing, capacity, sale timing, and included performances."
          onClose={closeBundleDialog}
          open={bundleDialogOpen}
          title={editingBundleId ? "Edit ticket bundle" : "New ticket bundle"}
        >
          <form className="form-stack" onSubmit={(formEvent) => void saveBundle(formEvent)}>
            <h3>{editingBundleId ? "Edit ticket bundle" : "New ticket bundle"}</h3>
            <label className="field">
              Bundle title
              <input
                required
                maxLength={500}
                value={bundleTitle}
                onChange={(event) => {
                  setBundleTitle(event.target.value);
                }}
              />
            </label>
            <div className="form-grid form-grid--two">
              <label className="field">
                Price (USD)
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={bundlePrice}
                  onChange={(event) => {
                    setBundlePrice(event.target.value);
                  }}
                />
              </label>
              <label className="field">
                Capacity (blank is unlimited)
                <input
                  min="1"
                  step="1"
                  type="number"
                  value={bundleCapacity}
                  onChange={(event) => {
                    setBundleCapacity(event.target.value);
                  }}
                />
              </label>
            </div>
            <label className="field">
              Sale ends
              <input
                required
                type="datetime-local"
                value={bundleSaleEnd}
                onChange={(event) => {
                  setBundleSaleEnd(event.target.value);
                }}
              />
            </label>
            <label>
              <input
                checked={bundleIsActive}
                type="checkbox"
                onChange={(event) => {
                  setBundleIsActive(event.target.checked);
                }}
              />{" "}
              Active for public sale
            </label>
            <fieldset className="field">
              <legend>Included performances</legend>
              {ticketEvents.length === 0 ? <p>Create ticketed performances first.</p> : null}
              {ticketEvents.map((event) => (
                <label key={event.id}>
                  <input
                    checked={bundleEventIds.includes(event.id)}
                    type="checkbox"
                    onChange={(change) => {
                      setBundleEventIds((current) =>
                        change.target.checked
                          ? [...current, event.id]
                          : current.filter((id) => id !== event.id),
                      );
                    }}
                  />{" "}
                  {event.title}
                </label>
              ))}
            </fieldset>
            <div className="form-actions">
              <button
                className="button button--primary"
                disabled={busy || bundleEventIds.length === 0}
                type="submit"
              >
                {busy ? "Saving…" : "Save bundle"}
              </button>
              {editingBundleId ? (
                <button
                  className="button button--secondary"
                  disabled={busy}
                  onClick={closeBundleDialog}
                  type="button"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </Dialog>
        <div>
          {bundles.length === 0 ? <p>No bundles yet.</p> : null}
          {bundles.map((bundle) => (
            <article className="compact-card" key={bundle.id}>
              <h4>{bundle.title}</h4>
              <p>
                {money(bundle.priceCents)} · {bundle.eventIds.length} performance
                {bundle.eventIds.length === 1 ? "" : "s"} ·{" "}
                {bundle.isActive ? "active" : "inactive"}
              </p>
              <div className="form-actions">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    editBundle(bundle);
                  }}
                  type="button"
                >
                  Edit
                </button>
                <button
                  className="text-button text-button--danger"
                  disabled={busy}
                  onClick={() => void removeBundle(bundle.id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
      <TicketScanner events={ticketEvents} />
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
                      <div className="form-actions">
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void resendConfirmation(order.id)}
                          type="button"
                        >
                          Resend confirmation
                        </button>
                        <button
                          className="text-button"
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
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
