import {
  organizationEventSchema,
  organizationTicketOrderSchema,
  type OrganizationEvent,
  type OrganizationTicketOrder,
} from "@choir/contracts";
import { calculatePaymentFinancialSummary, type PaymentFinancialSummary } from "@choir/domain";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { WillCallPanel } from "./WillCallPanel";

const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const event: OrganizationEvent = organizationEventSchema.parse({
  callTime: "18:30",
  createdAt: "2026-07-01T00:00:00.000Z",
  details: "Autumn concert",
  endsAt: "2026-09-23T21:00:00.000Z",
  id: eventId,
  location: "Main Hall",
  rsvpDeadlineDate: "2026-09-20",
  rsvpDeadlinePassed: false,
  startsAt: "2026-09-23T19:00:00.000Z",
  title: "Autumn Concert",
  type: "Performance",
  updatedAt: "2026-07-01T00:00:00.000Z",
});

function ticketOrder(overrides: Partial<OrganizationTicketOrder>): OrganizationTicketOrder {
  return organizationTicketOrderSchema.parse({
    amountPaidCents: 2500,
    bundleId: null,
    bundleTitle: "",
    buyerEmail: "buyer@example.test",
    buyerName: "Paid Buyer",
    checkoutMode: "fake",
    createdAt: "2026-07-23T15:00:00.000Z",
    currency: "usd",
    discountAmountCents: 0,
    discountCode: null,
    discountType: null,
    discountValue: null,
    discountedSubtotalCents: 2500,
    eventId,
    eventStartsAt: "2026-09-23T19:00:00.000Z",
    eventTitle: "Autumn Concert",
    feeCents: 0,
    id: "11111111-2222-4333-8444-555555555555",
    includedEvents: [],
    location: "Main Hall",
    marketingOptIn: false,
    originalSubtotalCents: 2500,
    originalUnitPriceCents: 2500,
    providerPaymentId: "fake-payment",
    providerSessionId: "fake-session",
    quantity: 1,
    refundRequested: false,
    status: "paid",
    timezone: "America/New_York",
    unitPriceCents: 2500,
    updatedAt: "2026-07-23T15:00:00.000Z",
    venueAddress: "",
    venueName: "Main Hall",
    ...overrides,
  });
}

const refundedOrder = ticketOrder({
  buyerName: "Refunded Buyer",
  id: "22222222-3333-4444-8555-666666666666",
  status: "refunded",
});
const paidOrder = ticketOrder({});
const bundleOrder = ticketOrder({
  bundleId: "74e47064-75b9-47e9-97e6-c28f5430bee0",
  bundleTitle: "Season Pass",
  buyerName: "Bundle Buyer",
  id: "44444444-5555-4666-8777-888888888888",
});
const expiredOrder = ticketOrder({
  buyerName: "Expired Buyer",
  id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
  status: "expired",
});
const expiredBundleOrder = ticketOrder({
  ...bundleOrder,
  buyerName: "Expired Bundle Buyer",
  id: "88888888-9999-4aaa-8bbb-cccccccccccc",
  status: "expired",
});
const pendingOrder = ticketOrder({
  buyerName: "Pending Buyer",
  id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
  status: "pending",
});
const refundRequestedOrder = ticketOrder({
  buyerName: "Requested Buyer",
  id: "33333333-4444-4555-8666-777777777777",
  refundRequested: true,
});

interface WillCallPanelTestOptions {
  readonly activeTab?: "willcall" | "bundles" | "orders" | "share" | "confirmation" | "discounts";
  readonly clearDiscountCodeFilter?: () => void;
  readonly discountCodeFilter?: string | null;
  readonly navigate?: (href: string) => void;
  readonly refund?: (purchaseId: string) => Promise<void>;
  readonly selectedPerformance?: OrganizationEvent | undefined;
  readonly selectedPerformanceId?: string;
  readonly showRefunded?: boolean;
}

function WillCallPanelHarness({
  orders,
  options,
  financialSummary,
}: {
  readonly orders: readonly OrganizationTicketOrder[];
  readonly options: WillCallPanelTestOptions;
  readonly financialSummary?: PaymentFinancialSummary | undefined;
}) {
  const [showRefunded, setShowRefunded] = useState(options.showRefunded ?? false);
  const resolvedSummary = financialSummary ?? calculatePaymentFinancialSummary(orders);
  return (
    <WillCallPanel
      activeTab={options.activeTab ?? "willcall"}
      busy={false}
      clearDiscountCodeFilter={options.clearDiscountCodeFilter ?? vi.fn()}
      discountCodeFilter={options.discountCodeFilter ?? null}
      financialSummary={resolvedSummary}
      lastOrderRefreshAt={new Date("2026-07-23T15:00:00.000Z")}
      navigate={options.navigate}
      performanceOrders={orders}
      refreshOrders={vi.fn(() => Promise.resolve())}
      refreshingOrders={false}
      refund={options.refund ?? vi.fn(() => Promise.resolve())}
      resendConfirmation={vi.fn(() => Promise.resolve())}
      selectedPerformance={"selectedPerformance" in options ? options.selectedPerformance : event}
      selectedPerformanceId={options.selectedPerformanceId ?? eventId}
      setSelectedPerformanceId={vi.fn()}
      setShowRefunded={setShowRefunded}
      setWillCallSearch={vi.fn()}
      showRefunded={showRefunded}
      state={{ orders, status: "ready" }}
      ticketEvents={[event]}
      ticketSoldLabel="2"
      visibleOrders={orders}
      willCallSearch=""
    />
  );
}

function renderWillCallPanel(
  orders: readonly OrganizationTicketOrder[],
  options: WillCallPanelTestOptions = {},
  financialSummary?: PaymentFinancialSummary,
) {
  return render(
    <WillCallPanelHarness financialSummary={financialSummary} options={options} orders={orders} />,
  );
}

function getWillCallTable(): HTMLTableElement {
  const table = document.querySelector("table.data-table");
  if (!(table instanceof HTMLTableElement)) {
    throw new Error("Expected the will-call list to render the shared DataTable.");
  }
  return table;
}

describe("WillCallPanel refunded and expired orders", () => {
  it("shows the selected performance artwork and omits it when none is saved", () => {
    const view = renderWillCallPanel([], {
      selectedPerformance: { ...event, publicGraphicFileId: "poster-id" },
    });
    expect(screen.getByRole("img", { name: `Event artwork for ${event.title}` })).toHaveAttribute(
      "src",
      "/api/organization/files/poster-id",
    );
    view.unmount();
    renderWillCallPanel([]);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("hides refunded and expired purchases by default while retaining paid and pending orders", async () => {
    const user = userEvent.setup();
    renderWillCallPanel([
      paidOrder,
      refundedOrder,
      expiredOrder,
      expiredBundleOrder,
      pendingOrder,
      refundRequestedOrder,
    ]);

    const table = getWillCallTable();
    expect(within(table).queryByText("Refunded Buyer")).not.toBeInTheDocument();
    expect(within(table).queryByText("Expired Buyer")).not.toBeInTheDocument();
    expect(within(table).queryByText("Expired Bundle Buyer")).not.toBeInTheDocument();
    expect(within(table).getByText("Pending Buyer")).toBeInTheDocument();
    expect(within(table).getByText("Paid Buyer")).toBeInTheDocument();
    expect(within(table).getByText("Requested Buyer")).toBeInTheDocument();
    expect(within(table).getByText("Refund requested (simulation)")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show refunded and expired" }));
    expect(within(table).getByText("Refunded Buyer")).toBeInTheDocument();
    expect(within(table).getByText("Refunded (simulation)")).toBeInTheDocument();
    expect(within(table).getByText("Expired Buyer")).toBeInTheDocument();
    expect(within(table).getByText("Expired Bundle Buyer")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show refunded and expired" }));
    expect(within(table).queryByText("Refunded Buyer")).not.toBeInTheDocument();
    expect(within(table).queryByText("Expired Buyer")).not.toBeInTheDocument();
    expect(within(table).queryByText("Expired Bundle Buyer")).not.toBeInTheDocument();
  });

  it("shows bundle information in the expandable order details", async () => {
    const user = userEvent.setup();
    renderWillCallPanel([paidOrder, bundleOrder]);

    const table = getWillCallTable();
    const bundleRow = within(table).getByText("Bundle Buyer").closest("tr");
    if (!(bundleRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected the bundle buyer to be rendered in a table row.");
    }
    expect(within(bundleRow).queryByText("Bundle")).not.toBeInTheDocument();
    await user.click(
      within(bundleRow).getByRole("button", { name: "Show details for Bundle Buyer" }),
    );
    expect(within(table).getByText("Season Pass")).toBeInTheDocument();
    expect(within(table).getByText("Bundle", { selector: "dt" })).toBeInTheDocument();

    const standaloneRow = within(table).getByText("Paid Buyer").closest("tr");
    if (!(standaloneRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected the standalone buyer to be rendered in a table row.");
    }
    expect(within(standaloneRow).queryByText("Bundle")).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Bundle" })).not.toBeInTheDocument();
  });

  it.each([refundedOrder, expiredOrder, expiredBundleOrder])(
    "distinguishes a hidden $status purchase from a performance with no orders",
    async (order) => {
      const user = userEvent.setup();
      renderWillCallPanel([order]);

      expect(
        screen.getByText("All matching ticket orders are refunded or expired."),
      ).toBeInTheDocument();
      expect(screen.queryByText("No ticket orders yet.")).not.toBeInTheDocument();
      await user.click(screen.getByRole("checkbox", { name: "Show refunded and expired" }));
      expect(within(getWillCallTable()).getByText(order.buyerName)).toBeInTheDocument();
      expect(
        screen.queryByText("All matching ticket orders are refunded or expired."),
      ).not.toBeInTheDocument();
    },
  );
});

describe("WillCallPanel discount codes", () => {
  it("shows the discount snapshot in expanded details", async () => {
    const user = userEvent.setup();
    const discountedOrder = ticketOrder({
      buyerEmail: "alexandria.montgomery@example.test",
      buyerName: "Discounted Buyer",
      discountAmountCents: 300,
      discountCode: "SPRING10",
      discountType: "percentage",
      discountValue: 10,
      id: "55555555-6666-4777-8888-999999999999",
    });
    renderWillCallPanel([discountedOrder, paidOrder]);

    const table = getWillCallTable();
    const discountedRow = within(table).getByText("Discounted Buyer").closest("tr");
    const regularRow = within(table).getByText("Paid Buyer").closest("tr");
    if (
      !(discountedRow instanceof HTMLTableRowElement) ||
      !(regularRow instanceof HTMLTableRowElement)
    ) {
      throw new Error("Expected both orders to be rendered in table rows.");
    }
    expect(within(table).queryByRole("columnheader", { name: /Discount code/ })).toBeNull();
    await user.click(
      within(discountedRow).getByRole("button", { name: "Show details for Discounted Buyer" }),
    );
    expect(within(table).getByText("SPRING10 · $3.00 off")).toBeInTheDocument();
    const emailValues = within(table).getAllByText("alexandria.montgomery@example.test");
    expect(emailValues.length).toBeGreaterThan(1);
    expect(emailValues[0]).toHaveClass("ticket-sales-table__email-value");
    expect(within(regularRow).queryByText("SPRING10")).not.toBeInTheDocument();
  });

  it("shows the active filter, reveals refunded confirmations, and clears it", async () => {
    const user = userEvent.setup();
    const clearDiscountCodeFilter = vi.fn();
    const refundedDiscountOrder = ticketOrder({
      buyerName: "Refunded Discount Buyer",
      discountCode: "SPRING10",
      id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
      status: "refunded",
    });
    renderWillCallPanel([refundedDiscountOrder], {
      clearDiscountCodeFilter,
      discountCodeFilter: "SPRING10",
      showRefunded: true,
    });

    expect(screen.getByText("Filtering by discount code:")).toBeInTheDocument();
    const activeFilter = document.querySelector(".ticket-dashboard__active-filter");
    if (!(activeFilter instanceof HTMLElement)) {
      throw new Error("Expected the active discount filter indicator.");
    }
    expect(within(activeFilter).getByText("SPRING10", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Show refunded and expired" })).toBeChecked();
    expect(within(getWillCallTable()).getByText("Refunded Discount Buyer")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show refunded and expired" }));
    expect(screen.getByRole("checkbox", { name: "Show refunded and expired" })).not.toBeChecked();
    expect(screen.queryByText("Refunded Discount Buyer")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Show refunded and expired" }));
    expect(screen.getAllByText("Refunded Discount Buyer").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(clearDiscountCodeFilter).toHaveBeenCalledOnce();
  });
});

function getMetricCard(modifier: string): HTMLElement {
  const card = document.querySelector(`.ticket-dashboard__metric--${modifier}`);
  if (!(card instanceof HTMLElement)) {
    throw new Error(`Expected metric card with modifier --${modifier}`);
  }
  return card;
}

describe("WillCallPanel financial KPI cards and fee reconciliation", () => {
  it("renders all 6 refund-aware sales KPI cards with reconciled Stripe fees", () => {
    const reconciledPaidOrder = ticketOrder({
      amountPaidCents: 2600,
      checkoutMode: "stripe",
      feeCents: 100,
      processorFeeCents: 105,
      status: "paid",
    });

    renderWillCallPanel([reconciledPaidOrder]);

    // 1. Tickets sold
    const soldCard = getMetricCard("sold");
    expect(within(soldCard).getByText("Tickets sold")).toBeInTheDocument();

    // 2. Gross charged
    const grossCard = getMetricCard("gross");
    expect(within(grossCard).getByText("Gross charged")).toBeInTheDocument();
    expect(within(grossCard).getByText("$26.00")).toBeInTheDocument();

    // 3. Refunds
    const refundsCard = getMetricCard("refunds");
    expect(within(refundsCard).getByText("Refunds")).toBeInTheDocument();
    expect(within(refundsCard).getByText("$0.00")).toBeInTheDocument();

    // 4. Customer fees collected
    const feesCard = getMetricCard("fees");
    expect(within(feesCard).getByText("Customer fees collected")).toBeInTheDocument();
    expect(within(feesCard).getByText("$1.00")).toBeInTheDocument();

    // 5. Stripe processing fees paid by Organization
    const processorCard = getMetricCard("processor-fees");
    expect(
      within(processorCard).getByText("Stripe processing fees paid by Organization"),
    ).toBeInTheDocument();
    expect(within(processorCard).getByText("-$1.05")).toBeInTheDocument();

    // 6. Net Organization proceeds: $26.00 - $0 - $1.05 = $24.95
    const netCard = getMetricCard("net");
    expect(within(netCard).getByText("Net Organization proceeds")).toBeInTheDocument();
    expect(within(netCard).getByText("$24.95")).toBeInTheDocument();

    const cards = [soldCard, grossCard, refundsCard, feesCard, processorCard, netCard];
    for (const card of cards) {
      expect(card.querySelector(".summary-card__label")).not.toBeNull();
      expect(card.querySelector("strong")).not.toBeNull();
      expect(card.querySelector("small")).not.toBeNull();
    }

    // Helper text
    expect(
      screen.getByText(
        "If an order is refunded, the buyer receives a full refund while Stripe retains the original processing fee, which is paid by the Organization.",
      ),
    ).toBeInTheDocument();
  });

  it("shows negative net proceeds equal to retained Stripe fee for fully refunded orders", () => {
    const fullyRefundedOrder = ticketOrder({
      amountPaidCents: 5000,
      checkoutMode: "stripe",
      feeCents: 0,
      processorFeeCents: 175,
      status: "refunded",
    });

    renderWillCallPanel([fullyRefundedOrder]);

    const grossCard = getMetricCard("gross");
    expect(within(grossCard).getByText("$50.00")).toBeInTheDocument();

    const refundsCard = getMetricCard("refunds");
    expect(within(refundsCard).getByText("-$50.00")).toBeInTheDocument();

    const processorCard = getMetricCard("processor-fees");
    expect(within(processorCard).getByText("-$1.75")).toBeInTheDocument();

    const netCard = getMetricCard("net");
    expect(within(netCard).getByText("-$1.75")).toBeInTheDocument();
  });

  it("shows Pending for fees and net proceeds with helper text when fees are unreconciled", () => {
    const unreconciledOrder = ticketOrder({
      amountPaidCents: 3000,
      checkoutMode: "stripe",
      feeCents: 0,
      processorFeeCents: null,
      status: "paid",
    });

    renderWillCallPanel([unreconciledOrder]);

    const processorCard = getMetricCard("processor-fees");
    expect(within(processorCard).getByText("Pending")).toBeInTheDocument();

    const netCard = getMetricCard("net");
    expect(within(netCard).getByText("Pending")).toBeInTheDocument();

    expect(screen.getByText("Stripe fee reconciliation pending")).toBeInTheDocument();
    expect(screen.getByText("Pending Stripe fees")).toBeInTheDocument();
  });

  it("shows Pending for Stripe fees when there are mixed reconciled and unreconciled orders", () => {
    const reconciledOrder = ticketOrder({
      amountPaidCents: 2500,
      checkoutMode: "stripe",
      feeCents: 0,
      id: "55555555-6666-4777-8888-999999999999",
      processorFeeCents: 175,
      status: "paid",
    });
    const unreconciledOrder = ticketOrder({
      amountPaidCents: 3000,
      checkoutMode: "stripe",
      feeCents: 0,
      id: "66666666-7777-4888-8999-000000000000",
      processorFeeCents: null,
      status: "paid",
    });

    renderWillCallPanel([reconciledOrder, unreconciledOrder]);

    const processorCard = getMetricCard("processor-fees");
    // Unreconciled takes precedence: Pending rather than misleading partial -$1.75
    expect(within(processorCard).getByText("Pending")).toBeInTheDocument();

    const netCard = getMetricCard("net");
    expect(within(netCard).getByText("Pending")).toBeInTheDocument();

    expect(screen.getByText("Stripe fee reconciliation pending")).toBeInTheDocument();
    expect(screen.getByText("Pending Stripe fees")).toBeInTheDocument();
  });
});

describe("WillCallPanel edit ticket settings navigation", () => {
  it("renders Edit ticket settings link when a specific performance is selected", () => {
    renderWillCallPanel([], {
      selectedPerformance: event,
      selectedPerformanceId: eventId,
    });

    const link = screen.getByRole("link", { name: /Edit ticket settings/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      "href",
      `/admin/events?eventId=${eventId}&section=tickets&returnTo=%2Fadmin%2Ftickets%3FeventId%3D${eventId}`,
    );
    expect(
      screen.getByText("Edit the selected performance's ticket capacity and pricing."),
    ).toBeInTheDocument();
  });

  it("does not render Edit ticket settings link when all performances are selected", () => {
    renderWillCallPanel([], {
      selectedPerformance: undefined,
      selectedPerformanceId: "all",
    });

    expect(screen.queryByRole("link", { name: /Edit ticket settings/i })).not.toBeInTheDocument();
    expect(
      screen.queryByText("Edit the selected performance's ticket capacity and pricing."),
    ).not.toBeInTheDocument();
  });

  it("preserves a non-default tab in the returnTo URL", () => {
    renderWillCallPanel([], {
      activeTab: "discounts",
      selectedPerformance: event,
      selectedPerformanceId: eventId,
    });

    const link = screen.getByRole("link", { name: /Edit ticket settings/i });
    expect(link).toHaveAttribute(
      "href",
      `/admin/events?eventId=${eventId}&section=tickets&returnTo=%2Fadmin%2Ftickets%3FeventId%3D${eventId}%26tab%3Ddiscounts`,
    );
  });

  it("calls navigate when Edit ticket settings link is clicked", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();

    renderWillCallPanel([], {
      navigate,
      selectedPerformance: event,
      selectedPerformanceId: eventId,
    });

    const link = screen.getByRole("link", { name: /Edit ticket settings/i });
    await user.click(link);

    expect(navigate).toHaveBeenCalledWith(
      `/admin/events?eventId=${eventId}&section=tickets&returnTo=%2Fadmin%2Ftickets%3FeventId%3D${eventId}`,
    );
  });
});

describe("WillCallPanel refund confirmation dialog", () => {
  it("opens modal confirmation dialog before refunding and honors cancel", async () => {
    const user = userEvent.setup();
    const refundMock = vi.fn(() => Promise.resolve());
    renderWillCallPanel([paidOrder], { refund: refundMock });

    const table = getWillCallTable();
    await user.click(within(table).getByRole("button", { name: "Show details for Paid Buyer" }));
    const refundButton = within(table).getByRole("button", { name: "Refund order" });
    await user.click(refundButton);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Refund ticket order?")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Refund \$25\.00 to Paid Buyer for Autumn Concert\?/),
    ).toBeInTheDocument();

    const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
    await user.click(cancelButton);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(refundMock).not.toHaveBeenCalled();
  });

  it("calls refund when confirmed in modal dialog", async () => {
    const user = userEvent.setup();
    const refundMock = vi.fn(() => Promise.resolve());
    renderWillCallPanel([paidOrder], { refund: refundMock });

    const table = getWillCallTable();
    await user.click(within(table).getByRole("button", { name: "Show details for Paid Buyer" }));
    const refundButton = within(table).getByRole("button", { name: "Refund order" });
    await user.click(refundButton);
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Refund order" });
    await user.click(confirmButton);

    expect(refundMock).toHaveBeenCalledWith(paidOrder.id);
  });

  it("keeps Resend in the row and reveals Refund in expanded details", async () => {
    const user = userEvent.setup();
    renderWillCallPanel([paidOrder]);
    const actionsCell = screen
      .getAllByRole("cell")
      .find((cell) => cell.classList.contains("data-table__cell--actions"));
    expect(actionsCell).toBeDefined();
    const actionWrapper = actionsCell?.querySelector(".form-actions");
    expect(actionWrapper instanceof HTMLElement).toBe(true);
    if (!(actionWrapper instanceof HTMLElement)) {
      throw new Error("Expected actionWrapper to be an HTMLElement");
    }
    expect(within(actionWrapper).getByRole("button", { name: "Resend" })).toBeInTheDocument();
    expect(within(actionWrapper).getByRole("button", { name: "Resend" })).toHaveClass(
      "text-button",
    );
    expect(within(actionWrapper).queryByRole("button", { name: "Refund order" })).toBeNull();

    const table = getWillCallTable();
    await user.click(within(table).getByText("Paid Buyer").closest("tr") ?? table);
    const disclosureButton = within(table).getByRole("button", {
      name: "Hide details for Paid Buyer",
    });
    expect(disclosureButton).toHaveAttribute("aria-expanded", "true");
    await user.click(within(actionWrapper).getByRole("button", { name: "Resend" }));
    expect(disclosureButton).toHaveAttribute("aria-expanded", "true");
    expect(within(table).getByRole("button", { name: "Refund order" })).toBeInTheDocument();
  });

  it("renders the Download will-call CSV link for a selected performance and omits it for all performances", () => {
    const { unmount } = renderWillCallPanel([paidOrder], {
      selectedPerformance: event,
      selectedPerformanceId: eventId,
    });
    const exportLink = screen.getByRole("link", { name: "Download will-call CSV" });
    expect(exportLink).toBeInTheDocument();
    expect(exportLink).toHaveAttribute(
      "href",
      `/api/organization/tickets/will-call?eventId=${encodeURIComponent(eventId)}`,
    );

    unmount();

    renderWillCallPanel([paidOrder], {
      selectedPerformance: undefined,
      selectedPerformanceId: "all",
    });
    expect(screen.queryByRole("link", { name: "Download will-call CSV" })).not.toBeInTheDocument();
  });
});
