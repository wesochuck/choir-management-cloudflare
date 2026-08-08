import type {
  DiscountCode,
  DiscountCodeRequest,
  OrganizationEvent,
  OrganizationTicketOrder,
  TicketBundle,
  TicketConfirmationSettings,
} from "@choir/contracts";
import { DataTable, Dialog } from "@choir/ui";
import { useEffect, useState, type SyntheticEvent } from "react";

import {
  deleteTicketBundle,
  deactivateOrganizationDiscountCode,
  getOrganizationTicketConfirmationSettings,
  listOrganizationEvents,
  listOrganizationTicketOrders,
  listOrganizationDiscountCodes,
  listTicketBundles,
  refundOrganizationTicketOrder,
  resendTicketConfirmation,
  saveTicketBundle,
  saveOrganizationDiscountCode,
  updateOrganizationTicketConfirmationSettings,
} from "../auth/api";
import { TicketScanner } from "./TicketScanner";
import { QRCodeShareCard } from "./QRCodeShareCard";

type OrderState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly orders: readonly OrganizationTicketOrder[]; readonly status: "ready" };

type TicketingTab = "willcall" | "bundles" | "orders" | "share" | "confirmation" | "discounts";

interface DiscountDraft {
  readonly active: boolean;
  readonly bundleId: string | null;
  readonly code: string;
  readonly discountType: DiscountCodeRequest["discountType"];
  readonly discountValue: string;
  readonly eventId: string | null;
  readonly redemptionLimit: string;
}

const EMPTY_DISCOUNT_DRAFT: DiscountDraft = {
  active: true,
  bundleId: null,
  code: "",
  discountType: "percentage",
  discountValue: "",
  eventId: null,
  redemptionLimit: "",
};

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

function buyerLastName(name: string): string {
  return name.trim().split(/\s+/).slice(-1)[0] ?? name;
}

const DEFAULT_TICKET_CONFIRMATION_SETTINGS: TicketConfirmationSettings = {
  pendingMessage:
    "We could not load the full ticket details yet. Your purchase may still be processing. Please refresh this page in a moment, or contact the box office if this continues.",
  qrCodeInstructions:
    "Print or screenshot this entire page and bring it with you. We also sent a confirmation email with a link back to this page.",
  successMessage: "Your purchase has been successfully processed.",
  willCallInstructions:
    "A confirmation email has been sent with a link back to this page. Your tickets will be held at Will Call on show day. Please bring a photo ID matching the buyer’s name.",
};

const WILL_CALL_REFRESH_INTERVAL_MS = 5_000;

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
  const [selectedPerformanceId, setSelectedPerformanceId] = useState("all");
  const [willCallSearch, setWillCallSearch] = useState("");
  const [lastOrderRefreshAt, setLastOrderRefreshAt] = useState<Date | null>(null);
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
  const [confirmationDraft, setConfirmationDraft] = useState<TicketConfirmationSettings>(
    DEFAULT_TICKET_CONFIRMATION_SETTINGS,
  );
  const [confirmationLoaded, setConfirmationLoaded] = useState(false);
  const [confirmationLoadError, setConfirmationLoadError] = useState<string | null>(null);
  const [confirmationSaving, setConfirmationSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TicketingTab>("willcall");
  const [discountCodes, setDiscountCodes] = useState<readonly DiscountCode[]>([]);
  const [discountCodesLoading, setDiscountCodesLoading] = useState(false);
  const [discountCodesLoadError, setDiscountCodesLoadError] = useState<string | null>(null);
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false);
  const [editingDiscountCodeId, setEditingDiscountCodeId] = useState<string | null>(null);
  const [discountDraft, setDiscountDraft] = useState<DiscountDraft>(EMPTY_DISCOUNT_DRAFT);
  const [deactivateDiscountCodeId, setDeactivateDiscountCodeId] = useState<string | null>(null);

  function selectTicketingTab(value: TicketingTab): void {
    setActiveTab(value);
    if (value === "discounts") {
      setDiscountCodesLoading(true);
      setDiscountCodesLoadError(null);
    }
  }

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const ordersRequest = scanOnly
      ? Promise.resolve<readonly OrganizationTicketOrder[]>([])
      : listOrganizationTicketOrders(controller.signal);
    const bundlesRequest = scanOnly
      ? Promise.resolve<readonly TicketBundle[]>([])
      : listTicketBundles(controller.signal);
    const confirmationRequest = scanOnly
      ? Promise.resolve<TicketConfirmationSettings | null>(null)
      : getOrganizationTicketConfirmationSettings(controller.signal);
    void Promise.allSettled([
      ordersRequest,
      listOrganizationEvents(controller.signal),
      bundlesRequest,
      confirmationRequest,
    ]).then(([ordersResult, eventsResult, bundlesResult, confirmationResult]) => {
      if (controller.signal.aborted) return;
      if (ordersResult.status === "fulfilled") {
        setState({ orders: ordersResult.value, status: "ready" });
        setLastOrderRefreshAt(new Date());
      } else {
        setState({ status: "error" });
      }
      if (eventsResult.status === "fulfilled") {
        const ticketedEvents = eventsResult.value.filter(
          (event) => event.type === "Performance" && event.isTicketingEnabled,
        );
        setTicketEvents(ticketedEvents);
        const firstTicketedEvent = ticketedEvents[0];
        if (firstTicketedEvent)
          setSelectedPerformanceId((current) =>
            current === "all" ? firstTicketedEvent.id : current,
          );
      }
      if (bundlesResult.status === "fulfilled") setBundles(bundlesResult.value);
      if (confirmationResult.status === "fulfilled") {
        setConfirmationLoaded(true);
        setConfirmationLoadError(null);
        if (confirmationResult.value) setConfirmationDraft(confirmationResult.value);
      } else {
        setConfirmationLoaded(false);
        setConfirmationLoadError(
          "Ticket confirmation wording could not be loaded. Try again before editing or saving it.",
        );
      }
    });
    return () => {
      controller.abort();
    };
  }, [enabled, scanOnly]);

  useEffect(() => {
    if (!enabled || scanOnly || activeTab !== "discounts") return;
    const controller = new AbortController();
    void listOrganizationDiscountCodes(controller.signal)
      .then((codes) => {
        if (!controller.signal.aborted) setDiscountCodes(codes);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDiscountCodesLoadError("Discount codes could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDiscountCodesLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [activeTab, enabled, scanOnly]);

  useEffect(() => {
    if (!enabled || scanOnly) return;
    let active = true;
    const refreshOrders = async () => {
      try {
        const orders = await listOrganizationTicketOrders();
        if (!active) return;
        setState({ orders, status: "ready" });
        setLastOrderRefreshAt(new Date());
      } catch {
        // Keep the last successful will-call list visible during a transient refresh failure.
      }
    };
    const interval = window.setInterval(() => {
      void refreshOrders();
    }, WILL_CALL_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
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

  async function saveConfirmationSettings(formEvent: SyntheticEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setConfirmationSaving(true);
    setMessage(null);
    try {
      const saved = await updateOrganizationTicketConfirmationSettings(confirmationDraft);
      setConfirmationDraft(saved);
      setMessage("Ticket confirmation wording saved.");
    } catch {
      setMessage("Ticket confirmation wording could not be saved.");
    } finally {
      setConfirmationSaving(false);
    }
  }

  function openNewDiscountCode(): void {
    setEditingDiscountCodeId(null);
    setDiscountDraft({
      ...EMPTY_DISCOUNT_DRAFT,
      eventId: ticketEvents[0]?.id ?? null,
    });
    setDiscountDialogOpen(true);
    setMessage(null);
  }

  function editDiscountCode(code: DiscountCode): void {
    if (!code.editable) return;
    setEditingDiscountCodeId(code.id);
    setDiscountDraft({
      active: code.active,
      bundleId: code.bundleId,
      code: code.code,
      discountType: code.discountType,
      discountValue: String(code.discountValue),
      eventId: code.eventId,
      redemptionLimit: code.redemptionLimit === null ? "" : String(code.redemptionLimit),
    });
    setDiscountDialogOpen(true);
    setMessage(null);
  }

  function closeDiscountDialog(): void {
    if (busy) return;
    setDiscountDialogOpen(false);
    setEditingDiscountCodeId(null);
    setDiscountDraft(EMPTY_DISCOUNT_DRAFT);
  }

  async function saveDiscountCode(formEvent: SyntheticEvent<HTMLFormElement>): Promise<void> {
    formEvent.preventDefault();
    const discountValue = Number(discountDraft.discountValue);
    const redemptionLimit = discountDraft.redemptionLimit
      ? Number(discountDraft.redemptionLimit)
      : null;
    const request: DiscountCodeRequest = {
      active: discountDraft.active,
      bundleId: discountDraft.bundleId,
      code: discountDraft.code,
      discountType: discountDraft.discountType,
      discountValue,
      eventId: discountDraft.eventId,
      redemptionLimit,
    };
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveOrganizationDiscountCode(request, editingDiscountCodeId ?? undefined);
      setDiscountCodes((current) => [saved, ...current.filter(({ id }) => id !== saved.id)]);
      closeDiscountDialog();
      setMessage("Discount code saved.");
    } catch (failure: unknown) {
      setMessage(
        failure instanceof Error ? failure.message : "The discount code could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deactivateDiscountCode(codeId: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await deactivateOrganizationDiscountCode(codeId);
      setDiscountCodes((current) => current.map((code) => (code.id === saved.id ? saved : code)));
      setDeactivateDiscountCodeId(null);
      setMessage("Discount code deactivated.");
    } catch (failure: unknown) {
      setMessage(
        failure instanceof Error ? failure.message : "The discount code could not be deactivated.",
      );
    } finally {
      setBusy(false);
    }
  }

  const selectedPerformance = ticketEvents.find(({ id }) => id === selectedPerformanceId);
  const performanceOrders =
    state.status === "ready"
      ? state.orders.filter(
          (order) =>
            selectedPerformanceId === "all" ||
            order.eventId === selectedPerformanceId ||
            order.includedEvents.some(({ id }) => id === selectedPerformanceId),
        )
      : [];
  const normalizedSearch = willCallSearch.trim().toLocaleLowerCase();
  const visibleOrders = performanceOrders.filter(
    (order) =>
      !normalizedSearch ||
      order.buyerName.toLocaleLowerCase().includes(normalizedSearch) ||
      order.buyerEmail.toLocaleLowerCase().includes(normalizedSearch),
  );
  const paidOrders = performanceOrders.filter((order) => order.status === "paid");
  const ticketsSold = paidOrders.reduce((total, order) => total + order.quantity, 0);
  const ticketSalesCents = paidOrders.reduce(
    (total, order) => total + Math.max(0, order.amountPaidCents - order.feeCents),
    0,
  );
  const feesCollectedCents = paidOrders.reduce((total, order) => total + order.feeCents, 0);
  const totalRevenueCents = paidOrders.reduce((total, order) => total + order.amountPaidCents, 0);
  const ticketCapacity = selectedPerformance?.ticketCapacity ?? null;
  const ticketSoldLabel =
    ticketCapacity === null
      ? String(ticketsSold)
      : `${String(ticketsSold)}/${String(ticketCapacity)}`;
  const bundleOrders =
    state.status === "ready" ? state.orders.filter((order) => order.bundleId !== null) : [];

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
      <header className="ticketing-page-header">
        <div>
          <p className="eyebrow">Manager tools</p>
          <h2 id="ticketing-manager-heading">Ticketing Dashboard</h2>
          <p>Manage ticket sales, bundles, and check-in.</p>
        </div>
        <a className="button button--primary" href="/admin/tickets/scan">
          Scan tickets
        </a>
      </header>
      <nav aria-label="Ticketing sections" className="ticketing-tabs" role="tablist">
        {(
          [
            ["willcall", "Concert Will Call"],
            ["bundles", "Season Bundles"],
            ["orders", "Bundle Orders"],
            ["discounts", "Discount Codes"],
            ["share", "Share & QR Codes"],
            ["confirmation", "Confirmation Page"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={activeTab === value}
            className={activeTab === value ? "is-active" : undefined}
            key={value}
            onClick={() => {
              selectTicketingTab(value);
            }}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>
      {activeTab === "share" ? (
        <div className="ticketing-tab-panel">
          <div>
            <p className="eyebrow">Share & QR codes</p>
            <h3>Public ticketing links</h3>
            <p>Share these links with your audience. Each page includes a ready-to-scan QR code.</p>
          </div>
          <div className="ticketing-share-grid">
            <QRCodeShareCard
              description="Share this page so your audience can see available performances and buy tickets."
              path="/tickets"
              title="All ticketing"
            />
            {ticketEvents.map((event) => (
              <QRCodeShareCard
                description={`Tickets for ${event.title}.`}
                key={event.id}
                path={`/tickets/${event.id}`}
                title={event.title}
              />
            ))}
            {bundles
              .filter((bundle) => bundle.isActive)
              .map((bundle) => (
                <QRCodeShareCard
                  description={`${money(bundle.priceCents)} bundle covering ${String(bundle.eventIds.length)} performance${bundle.eventIds.length === 1 ? "" : "s"}.`}
                  key={bundle.id}
                  path={`/tickets/bundles/${bundle.id}`}
                  title={bundle.title}
                />
              ))}
          </div>
        </div>
      ) : null}
      {activeTab === "confirmation" ? (
        confirmationLoaded ? (
          <form
            className="ticket-confirmation-settings"
            onSubmit={(event) => {
              void saveConfirmationSettings(event);
            }}
          >
            <div>
              <p className="eyebrow">Confirmation page</p>
              <h3>Ticket sales wording</h3>
              <p>Customize the messages shown to buyers after they purchase tickets.</p>
            </div>
            <div className="ticket-confirmation-settings__grid">
              <label className="field">
                Success Message
                <textarea
                  onChange={(event) => {
                    setConfirmationDraft((current) => ({
                      ...current,
                      successMessage: event.target.value,
                    }));
                  }}
                  rows={3}
                  value={confirmationDraft.successMessage}
                />
              </label>
              <label className="field">
                Pending / Unverified Message
                <textarea
                  onChange={(event) => {
                    setConfirmationDraft((current) => ({
                      ...current,
                      pendingMessage: event.target.value,
                    }));
                  }}
                  rows={3}
                  value={confirmationDraft.pendingMessage}
                />
              </label>
              <label className="field">
                Will Call Instructions
                <textarea
                  onChange={(event) => {
                    setConfirmationDraft((current) => ({
                      ...current,
                      willCallInstructions: event.target.value,
                    }));
                  }}
                  rows={4}
                  value={confirmationDraft.willCallInstructions}
                />
              </label>
              <label className="field">
                QR Code Instructions
                <textarea
                  onChange={(event) => {
                    setConfirmationDraft((current) => ({
                      ...current,
                      qrCodeInstructions: event.target.value,
                    }));
                  }}
                  rows={4}
                  value={confirmationDraft.qrCodeInstructions}
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                className="button button--primary"
                disabled={confirmationSaving}
                type="submit"
              >
                {confirmationSaving ? "Saving…" : "Save ticket wording"}
              </button>
            </div>
          </form>
        ) : (
          <p className="notice notice--error" role="alert">
            {confirmationLoadError ?? "Loading ticket confirmation wording…"}
          </p>
        )
      ) : null}
      {message ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}
      {activeTab === "discounts" ? (
        <div className="ticketing-tab-panel">
          <div className="ticketing-page-header">
            <div>
              <p className="eyebrow">Discount codes</p>
              <h3>Create and monitor ticket discounts</h3>
              <p>
                Codes apply to one performance or bundle. After the first confirmed redemption,
                their terms can only be deactivated.
              </p>
            </div>
            <button className="button button--primary" onClick={openNewDiscountCode} type="button">
              New discount code
            </button>
          </div>
          <Dialog
            description="Set the eligible item, discount, and optional Organization-wide redemption limit."
            onClose={closeDiscountDialog}
            open={discountDialogOpen}
            title={editingDiscountCodeId ? "Edit discount code" : "New discount code"}
          >
            <form className="form-stack" onSubmit={(event) => void saveDiscountCode(event)}>
              <label className="field">
                Code
                <input
                  required
                  maxLength={64}
                  value={discountDraft.code}
                  onChange={(event) => {
                    setDiscountDraft((current) => ({ ...current, code: event.target.value }));
                  }}
                />
              </label>
              <label className="field">
                Eligible item
                <select
                  required
                  value={
                    discountDraft.eventId
                      ? "event:" + discountDraft.eventId
                      : discountDraft.bundleId
                        ? "bundle:" + discountDraft.bundleId
                        : ""
                  }
                  onChange={(event) => {
                    const [kind, id] = event.target.value.split(":");
                    setDiscountDraft((current) => ({
                      ...current,
                      bundleId: kind === "bundle" ? (id ?? null) : null,
                      eventId: kind === "event" ? (id ?? null) : null,
                    }));
                  }}
                >
                  <option value="">Choose a performance or bundle</option>
                  <optgroup label="Performances">
                    {ticketEvents.map((event) => (
                      <option key={event.id} value={"event:" + event.id}>
                        {event.title}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Ticket bundles">
                    {bundles.map((bundle) => (
                      <option key={bundle.id} value={"bundle:" + bundle.id}>
                        {bundle.title}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <div className="form-grid form-grid--two">
                <label className="field">
                  Discount type
                  <select
                    value={discountDraft.discountType}
                    onChange={(event) => {
                      const type = event.target.value === "fixed" ? "fixed" : "percentage";
                      setDiscountDraft((current) => ({
                        ...current,
                        discountType: type,
                      }));
                    }}
                  >
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed amount per unit</option>
                  </select>
                </label>
                <label className="field">
                  {discountDraft.discountType === "percentage"
                    ? "Percentage (1–100)"
                    : "Amount per unit (USD)"}
                  <input
                    required
                    min={discountDraft.discountType === "percentage" ? 1 : 0}
                    max={discountDraft.discountType === "percentage" ? 100 : undefined}
                    step={discountDraft.discountType === "percentage" ? 1 : 0.01}
                    type="number"
                    value={
                      discountDraft.discountType === "fixed" &&
                      discountDraft.discountValue &&
                      !discountDraft.discountValue.includes(".")
                        ? (Number(discountDraft.discountValue) / 100).toFixed(2)
                        : discountDraft.discountValue
                    }
                    onChange={(event) => {
                      setDiscountDraft((current) => ({
                        ...current,
                        discountValue:
                          current.discountType === "fixed"
                            ? String(Math.round(Number(event.target.value) * 100))
                            : event.target.value,
                      }));
                    }}
                  />
                </label>
              </div>
              <label className="field">
                Redemption limit (blank is unlimited)
                <input
                  min="1"
                  step="1"
                  type="number"
                  value={discountDraft.redemptionLimit}
                  onChange={(event) => {
                    setDiscountDraft((current) => ({
                      ...current,
                      redemptionLimit: event.target.value,
                    }));
                  }}
                />
              </label>
              <label>
                <input
                  checked={discountDraft.active}
                  type="checkbox"
                  onChange={(event) => {
                    setDiscountDraft((current) => ({
                      ...current,
                      active: event.target.checked,
                    }));
                  }}
                />{" "}
                Available for redemption
              </label>
              <div className="form-actions">
                <button
                  className="button button--primary"
                  disabled={
                    busy ||
                    (!discountDraft.eventId && !discountDraft.bundleId) ||
                    !discountDraft.discountValue
                  }
                  type="submit"
                >
                  {busy ? "Saving…" : "Save discount code"}
                </button>
                <button
                  className="button button--secondary"
                  disabled={busy}
                  onClick={closeDiscountDialog}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          </Dialog>
          {discountCodesLoading ? <p>Loading discount codes…</p> : null}
          {discountCodesLoadError ? (
            <p className="notice notice--error" role="alert">
              {discountCodesLoadError}
            </p>
          ) : null}
          {!discountCodesLoading && !discountCodesLoadError && discountCodes.length === 0 ? (
            <p className="empty-state">No discount codes yet.</p>
          ) : null}
          {discountCodes.length > 0 ? (
            <DataTable
              columns={[
                {
                  header: "Code",
                  id: "code",
                  render: (code) => <strong>{code.code}</strong>,
                  sortValue: (code) => code.code,
                },
                {
                  header: "Eligible item",
                  id: "item",
                  render: (code) => code.itemTitle + " (" + code.itemType + ")",
                  sortValue: (code) => code.itemTitle,
                },
                {
                  header: "Discount",
                  id: "discount",
                  render: (code) =>
                    code.discountType === "percentage"
                      ? String(code.discountValue) + "%"
                      : money(code.discountValue),
                  sortValue: (code) => code.discountValue,
                },
                {
                  header: "Redemptions",
                  id: "redemptions",
                  render: (code) =>
                    String(code.redemptionCount) +
                    (code.redemptionLimit === null ? "" : "/" + String(code.redemptionLimit)),
                  sortValue: (code) => code.redemptionCount,
                },
                {
                  header: "Discounted revenue",
                  id: "revenue",
                  render: (code) => money(code.revenueCents),
                  sortValue: (code) => code.revenueCents,
                },
                {
                  header: "Status",
                  id: "status",
                  render: (code) => (code.active ? "Active" : "Inactive"),
                  sortValue: (code) => (code.active ? 1 : 0),
                },
                {
                  header: "Actions",
                  id: "actions",
                  render: (code) =>
                    deactivateDiscountCodeId === code.id ? (
                      <div className="danger-confirmation">
                        <p>Deactivate this code?</p>
                        <div className="form-actions">
                          <button
                            className="button button--secondary"
                            disabled={busy}
                            onClick={() => {
                              setDeactivateDiscountCodeId(null);
                            }}
                            type="button"
                          >
                            Cancel
                          </button>
                          <button
                            className="button button--danger"
                            disabled={busy}
                            onClick={() => void deactivateDiscountCode(code.id)}
                            type="button"
                          >
                            {busy ? "Deactivating…" : "Confirm"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="form-actions">
                        <button
                          className="text-button"
                          disabled={busy || !code.editable}
                          onClick={() => {
                            editDiscountCode(code);
                          }}
                          title={
                            code.editable
                              ? undefined
                              : "Terms are locked after the first confirmed redemption."
                          }
                          type="button"
                        >
                          Edit
                        </button>
                        {code.active ? (
                          <button
                            className="text-button text-button--danger"
                            disabled={busy}
                            onClick={() => {
                              setDeactivateDiscountCodeId(code.id);
                            }}
                            type="button"
                          >
                            Deactivate
                          </button>
                        ) : null}
                      </div>
                    ),
                },
              ]}
              initialSort={{ columnId: "code", direction: "asc" }}
              keySelector={(code) => code.id}
              rows={discountCodes}
            />
          ) : null}
        </div>
      ) : null}
      {activeTab === "willcall" ? (
        <>
          <div className="ticket-dashboard">
            <div className="ticket-dashboard__intro">
              <div>
                <h3>Performance summary</h3>
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
                <small>
                  {selectedPerformance ? selectedPerformance.title : "All performances"}
                </small>
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
          </div>
          <div className="ticket-dashboard__will-call">
            <div className="ticket-dashboard__section-heading">
              <div>
                <h3>Will call checklist</h3>
                <p>Search ticket buyers, confirm payment status, and process refunds.</p>
              </div>
              <span className="field-help" role="status">
                {lastOrderRefreshAt ? "Updates automatically every 5 seconds." : "Loading updates…"}
              </span>
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
            </div>
            {state.status === "loading" ? <p>Loading ticket orders…</p> : null}
            {state.status === "error" ? (
              <p className="notice notice--error">Ticket orders could not be loaded.</p>
            ) : null}
            {state.status === "ready" && performanceOrders.length === 0 ? (
              <p className="empty-state">No ticket orders yet.</p>
            ) : null}
            {state.status === "ready" &&
            performanceOrders.length > 0 &&
            visibleOrders.length === 0 ? (
              <p className="empty-state">No ticket buyers match this search.</p>
            ) : null}
            {visibleOrders.length > 0 ? (
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
                    render: (order) =>
                      `${order.status}${order.checkoutMode === "fake" ? " (simulation)" : ""}`,
                    sortValue: (order) => order.status,
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
                      ) : null,
                  },
                ]}
                initialSort={{ columnId: "saleDate", direction: "desc" }}
                keySelector={(order) => order.id}
                rows={visibleOrders}
              />
            ) : null}
          </div>
        </>
      ) : null}
      {activeTab === "bundles" ? (
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
      ) : null}
      {activeTab === "orders" ? (
        <div className="ticketing-tab-panel">
          <div>
            <p className="eyebrow">Bundle orders</p>
            <h3>Season bundle orders</h3>
            <p>Review bundle purchases, resend confirmations, or issue refunds.</p>
          </div>
          {state.status === "loading" ? <p>Loading bundle orders…</p> : null}
          {state.status === "error" ? (
            <p className="notice notice--error">Bundle orders could not be loaded.</p>
          ) : null}
          {state.status === "ready" && bundleOrders.length === 0 ? (
            <p className="empty-state">No bundle orders yet.</p>
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
      ) : null}
    </section>
  );
}
