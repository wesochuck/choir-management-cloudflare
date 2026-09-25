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
const refundRequestedOrder = ticketOrder({
  buyerName: "Requested Buyer",
  id: "33333333-4444-4555-8666-777777777777",
  refundRequested: true,
});

interface WillCallPanelTestOptions {
  readonly clearDiscountCodeFilter?: () => void;
  readonly discountCodeFilter?: string | null;
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
      busy={false}
      clearDiscountCodeFilter={options.clearDiscountCodeFilter ?? vi.fn()}
      discountCodeFilter={options.discountCodeFilter ?? null}
      financialSummary={resolvedSummary}
      lastOrderRefreshAt={new Date("2026-07-23T15:00:00.000Z")}
      performanceOrders={orders}
      refreshOrders={vi.fn(() => Promise.resolve())}
      refreshingOrders={false}
      refund={vi.fn(() => Promise.resolve())}
      refundId={null}
      resendConfirmation={vi.fn(() => Promise.resolve())}
      selectedPerformance={event}
      selectedPerformanceId={eventId}
      setRefundId={vi.fn()}
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

describe("WillCallPanel refunded orders", () => {
  it("hides refunded orders by default while retaining refund-requested paid orders", async () => {
    const user = userEvent.setup();
    renderWillCallPanel([paidOrder, refundedOrder, refundRequestedOrder]);

    const table = getWillCallTable();
    expect(within(table).queryByText("Refunded Buyer")).not.toBeInTheDocument();
    expect(within(table).getByText("Paid Buyer")).toBeInTheDocument();
    expect(within(table).getByText("Requested Buyer")).toBeInTheDocument();
    expect(within(table).getByText("Refund requested (simulation)")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show refunded" }));
    expect(within(table).getByText("Refunded Buyer")).toBeInTheDocument();
    expect(within(table).getByText("Refunded (simulation)")).toBeInTheDocument();
  });

  it("shows the Bundle pill inline for bundle buyers without adding a column", () => {
    renderWillCallPanel([paidOrder, bundleOrder]);

    const table = getWillCallTable();
    const bundleRow = within(table).getByText("Bundle Buyer").closest("tr");
    if (!(bundleRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected the bundle buyer to be rendered in a table row.");
    }
    expect(within(bundleRow).getByText("Bundle")).toHaveAttribute(
      "title",
      "Bundle purchase: Season Pass",
    );

    const standaloneRow = within(table).getByText("Paid Buyer").closest("tr");
    if (!(standaloneRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected the standalone buyer to be rendered in a table row.");
    }
    expect(within(standaloneRow).queryByText("Bundle")).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Bundle" })).not.toBeInTheDocument();
  });

  it("distinguishes orders filtered as refunded from a performance with no orders", async () => {
    const user = userEvent.setup();
    renderWillCallPanel([refundedOrder]);

    expect(screen.getByText("All matching ticket orders are refunded.")).toBeInTheDocument();
    expect(screen.queryByText("No ticket orders yet.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Show refunded" }));
    expect(within(getWillCallTable()).getByText("Refunded Buyer")).toBeInTheDocument();
    expect(screen.queryByText("All matching ticket orders are refunded.")).not.toBeInTheDocument();
  });
});

describe("WillCallPanel discount codes", () => {
  it("shows the order snapshot and a quiet empty value", () => {
    const discountedOrder = ticketOrder({
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
    const discountPill = within(discountedRow).getByText("SPRING10");
    expect(discountPill).toHaveClass("ticket-discount-code-pill");
    expect(discountPill).not.toHaveClass("status-pill");
    expect(within(discountedRow).getByText("SPRING10")).toHaveAttribute(
      "title",
      "SPRING10 · Discount: $3.00",
    );
    expect(within(regularRow).getByLabelText("No discount code")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Sort by Discount code" })).toBeInTheDocument();
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
    expect(screen.getByRole("checkbox", { name: "Show refunded" })).toBeChecked();
    expect(within(getWillCallTable()).getByText("Refunded Discount Buyer")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show refunded" }));
    expect(screen.getByRole("checkbox", { name: "Show refunded" })).not.toBeChecked();
    expect(screen.queryByText("Refunded Discount Buyer")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Show refunded" }));
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

    // Helper text
    expect(
      screen.getByText(
        "The buyer receives a full refund. Stripe retains the original processing fee, which is paid by the Organization.",
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
});
