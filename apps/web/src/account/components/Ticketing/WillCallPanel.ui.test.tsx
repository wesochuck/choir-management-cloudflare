import {
  organizationEventSchema,
  organizationTicketOrderSchema,
  type OrganizationEvent,
  type OrganizationTicketOrder,
} from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
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

function renderWillCallPanel(orders: readonly OrganizationTicketOrder[]) {
  return render(
    <WillCallPanel
      busy={false}
      feesCollectedCents={0}
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
      setWillCallSearch={vi.fn()}
      state={{ orders, status: "ready" }}
      ticketEvents={[event]}
      ticketSalesCents={2500}
      ticketSoldLabel="2"
      totalRevenueCents={2500}
      visibleOrders={orders}
      willCallSearch=""
    />,
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
