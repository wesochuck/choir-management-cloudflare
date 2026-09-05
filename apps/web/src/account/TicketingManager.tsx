import type {
  DiscountCode,
  DiscountCodeRequest,
  OrganizationEvent,
  OrganizationTicketOrder,
  TicketBundle,
  TicketConfirmationSettings,
} from "@choir/contracts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@choir/ui";
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
import { BundleOrdersPanel } from "./components/Ticketing/BundleOrdersPanel";
import { BundlePanel } from "./components/Ticketing/BundlePanel";
import { ConfirmationPanel } from "./components/Ticketing/ConfirmationPanel";
import { DiscountCodesPanel } from "./components/Ticketing/DiscountCodesPanel";
import { SharePanel } from "./components/Ticketing/SharePanel";
import { WillCallPanel } from "./components/Ticketing/WillCallPanel";
import {
  DEFAULT_TICKET_CONFIRMATION_SETTINGS,
  EMPTY_DISCOUNT_DRAFT,
  WILL_CALL_REFRESH_INTERVAL_MS,
  type DiscountDraft,
  type OrderState,
  type TicketingTab,
} from "./components/Ticketing/shared";
import { TicketScanner } from "./TicketScanner";

// This component coordinates three intentionally co-located manager tools and their shared state.
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
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [discountError, setDiscountError] = useState<string | null>(null);
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
    setBundleError(null);
    clearBundleForm();
  }

  function openNewBundle(): void {
    clearBundleForm();
    setMessage(null);
    setBundleError(null);
    setBundleDialogOpen(true);
  }

  async function saveBundle(formEvent: SyntheticEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setBusy(true);
    setMessage(null);
    setBundleError(null);
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
    } catch (failure: unknown) {
      setBundleError(
        failure instanceof Error ? failure.message : "The ticket bundle could not be saved.",
      );
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
    setBundleError(null);
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
    setDiscountError(null);
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
    setDiscountError(null);
    setDiscountDialogOpen(true);
    setMessage(null);
  }

  function closeDiscountDialog(): void {
    if (busy) return;
    setDiscountDialogOpen(false);
    setDiscountError(null);
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
    setDiscountError(null);
    try {
      const saved = await saveOrganizationDiscountCode(request, editingDiscountCodeId ?? undefined);
      setDiscountCodes((current) => [saved, ...current.filter(({ id }) => id !== saved.id)]);
      closeDiscountDialog();
      setMessage("Discount code saved.");
    } catch (failure: unknown) {
      setDiscountError(
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
    <section className="panel" aria-label="Ticket sales and check-in management">
      <header className="ticketing-page-header">
        <a className="button button--primary" href="/admin/tickets/scan">
          Scan tickets
        </a>
      </header>
      <Tabs onValueChange={selectTicketingTab} value={activeTab}>
        <TabsList aria-label="Ticketing sections" as="nav" className="ticketing-tabs">
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
            <TabsTrigger
              aria-controls={"ticketing-" + value + "-panel"}
              id={"ticketing-" + value + "-tab"}
              key={value}
              value={value}
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {message && !bundleDialogOpen && !discountDialogOpen ? (
          <p className="notice notice--info" role="status">
            {message}
          </p>
        ) : null}
        <TabsContent aria-labelledby="ticketing-share-tab" id="ticketing-share-panel" value="share">
          <SharePanel bundles={bundles} ticketEvents={ticketEvents} />
        </TabsContent>
        <TabsContent
          aria-labelledby="ticketing-confirmation-tab"
          id="ticketing-confirmation-panel"
          value="confirmation"
        >
          <ConfirmationPanel
            confirmationDraft={confirmationDraft}
            confirmationLoadError={confirmationLoadError}
            confirmationLoaded={confirmationLoaded}
            confirmationSaving={confirmationSaving}
            onSubmit={(event) => {
              void saveConfirmationSettings(event);
            }}
            setConfirmationDraft={setConfirmationDraft}
          />
        </TabsContent>
        <TabsContent
          aria-labelledby="ticketing-discounts-tab"
          id="ticketing-discounts-panel"
          value="discounts"
        >
          <DiscountCodesPanel
            bundles={bundles}
            busy={busy}
            closeDiscountDialog={closeDiscountDialog}
            deactivateDiscountCode={deactivateDiscountCode}
            deactivateDiscountCodeId={deactivateDiscountCodeId}
            discountCodes={discountCodes}
            discountCodesLoadError={discountCodesLoadError}
            discountCodesLoading={discountCodesLoading}
            discountDialogOpen={discountDialogOpen}
            discountDraft={discountDraft}
            discountError={discountError}
            editDiscountCode={editDiscountCode}
            editingDiscountCodeId={editingDiscountCodeId}
            openNewDiscountCode={openNewDiscountCode}
            saveDiscountCode={saveDiscountCode}
            setDeactivateDiscountCodeId={setDeactivateDiscountCodeId}
            setDiscountDraft={setDiscountDraft}
            ticketEvents={ticketEvents}
          />
        </TabsContent>
        <TabsContent
          aria-labelledby="ticketing-willcall-tab"
          id="ticketing-willcall-panel"
          value="willcall"
        >
          <WillCallPanel
            busy={busy}
            feesCollectedCents={feesCollectedCents}
            lastOrderRefreshAt={lastOrderRefreshAt}
            performanceOrders={performanceOrders}
            refund={refund}
            refundId={refundId}
            resendConfirmation={resendConfirmation}
            selectedPerformance={selectedPerformance}
            selectedPerformanceId={selectedPerformanceId}
            setRefundId={setRefundId}
            setSelectedPerformanceId={setSelectedPerformanceId}
            setWillCallSearch={setWillCallSearch}
            state={state}
            ticketEvents={ticketEvents}
            ticketSalesCents={ticketSalesCents}
            ticketSoldLabel={ticketSoldLabel}
            totalRevenueCents={totalRevenueCents}
            visibleOrders={visibleOrders}
            willCallSearch={willCallSearch}
          />
        </TabsContent>
        <TabsContent
          aria-labelledby="ticketing-bundles-tab"
          id="ticketing-bundles-panel"
          value="bundles"
        >
          <BundlePanel
            bundleCapacity={bundleCapacity}
            bundleDialogOpen={bundleDialogOpen}
            bundleError={bundleError}
            bundleEventIds={bundleEventIds}
            bundleIsActive={bundleIsActive}
            bundlePrice={bundlePrice}
            bundleSaleEnd={bundleSaleEnd}
            bundleTitle={bundleTitle}
            bundles={bundles}
            busy={busy}
            closeBundleDialog={closeBundleDialog}
            editBundle={editBundle}
            editingBundleId={editingBundleId}
            openNewBundle={openNewBundle}
            removeBundle={removeBundle}
            saveBundle={saveBundle}
            setBundleCapacity={setBundleCapacity}
            setBundleEventIds={setBundleEventIds}
            setBundleIsActive={setBundleIsActive}
            setBundlePrice={setBundlePrice}
            setBundleSaleEnd={setBundleSaleEnd}
            setBundleTitle={setBundleTitle}
            ticketEvents={ticketEvents}
          />
        </TabsContent>
        <TabsContent
          aria-labelledby="ticketing-orders-tab"
          id="ticketing-orders-panel"
          value="orders"
        >
          <BundleOrdersPanel
            bundleOrders={bundleOrders}
            bundles={bundles}
            busy={busy}
            refund={refund}
            refundId={refundId}
            resendConfirmation={resendConfirmation}
            setRefundId={setRefundId}
            state={state}
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}
