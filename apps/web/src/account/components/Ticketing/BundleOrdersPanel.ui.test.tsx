import {
  organizationTicketOrderSchema,
  type OrganizationTicketOrder,
  type TicketBundle,
} from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { BundleOrdersPanel } from "./BundleOrdersPanel";

const eventId = "74e47064-75b9-47e9-97e6-c28f5430bee0";
const currentBundleId = "6ab6bf88-c618-4bcd-b452-3aadebd28aa6";
const archivedBundleId = "25fd0bbd-2438-458b-877b-5e5032e31cde";
const currentBundleTitle = "Current Season Pass";

function ticketOrder(overrides: Partial<OrganizationTicketOrder>): OrganizationTicketOrder {
  return organizationTicketOrderSchema.parse({
    amountPaidCents: 1574,
    bundleId: currentBundleId,
    bundleTitle: "Former Season Pass title",
    buyerEmail: "buyer@example.test",
    buyerName: "Alex Zulu",
    checkoutMode: "fake",
    createdAt: "2026-07-23T15:00:00.000Z",
    currency: "usd",
    discountAmountCents: 0,
    discountCode: null,
    discountType: null,
    discountValue: null,
    discountedSubtotalCents: 1500,
    eventId,
    eventStartsAt: "2026-09-23T19:00:00.000Z",
    eventTitle: "Autumn Concert",
    feeCents: 74,
    id: "8de2c455-72c5-4117-92a0-b2bc77b05706",
    includedEvents: [],
    location: "",
    marketingOptIn: false,
    originalSubtotalCents: 1500,
    originalUnitPriceCents: 1500,
    providerPaymentId: "fake-payment",
    providerSessionId: "fake-session",
    quantity: 1,
    refundRequested: false,
    status: "paid",
    timezone: "America/New_York",
    unitPriceCents: 1500,
    updatedAt: "2026-07-23T15:00:00.000Z",
    venueAddress: "",
    venueName: "",
    ...overrides,
  });
}

const bundleOrders: readonly OrganizationTicketOrder[] = [
  ticketOrder({
    bundleId: null,
    bundleTitle: "",
    buyerEmail: "jane@example.test",
    buyerName: "Jane Buyer",
    createdAt: "2026-07-23T14:00:00.000Z",
    id: "11111111-2222-4333-8444-555555555555",
  }),
  ticketOrder({
    buyerEmail: "alex@example.test",
    buyerName: "Alex Zulu",
    id: "22222222-3333-4444-8555-666666666666",
  }),
  ticketOrder({
    bundleId: archivedBundleId,
    bundleTitle: "Archived Bundle",
    buyerEmail: "zara@example.test",
    buyerName: "Zara Anderson",
    createdAt: "2026-07-23T16:00:00.000Z",
    id: "33333333-4444-4555-8666-777777777777",
    status: "pending",
  }),
];

const refundedBundleOrder = ticketOrder({
  buyerEmail: "refunded@example.test",
  buyerName: "Refunded Buyer",
  id: "44444444-5555-4666-8777-888888888888",
  status: "refunded",
});
const refundRequestedBundleOrder = ticketOrder({
  buyerEmail: "requested@example.test",
  buyerName: "Requested Buyer",
  id: "55555555-6666-4777-8888-999999999999",
  refundRequested: true,
});

const bundles: readonly TicketBundle[] = [
  {
    capacity: 100,
    createdAt: "2026-07-01T00:00:00.000Z",
    eventIds: [eventId],
    id: currentBundleId,
    isActive: true,
    priceCents: 2500,
    saleEndAt: "2026-09-01T00:00:00.000Z",
    title: currentBundleTitle,
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
];

describe("BundleOrdersPanel", () => {
  it("hides refunded orders by default and can show them without hiding refund requests", async () => {
    const user = userEvent.setup();
    render(
      <BundleOrdersPanel
        bundleOrders={[...bundleOrders, refundedBundleOrder, refundRequestedBundleOrder]}
        bundles={bundles}
        busy={false}
        refreshOrders={vi.fn(() => Promise.resolve())}
        refreshingOrders={false}
        refund={vi.fn(() => Promise.resolve())}
        refundId={null}
        resendConfirmation={vi.fn(() => Promise.resolve())}
        setRefundId={vi.fn()}
        state={{ orders: [], status: "ready" }}
      />,
    );

    const table = document.querySelector("table.data-table");
    expect(table).not.toBeNull();
    if (!(table instanceof HTMLTableElement)) return;
    expect(within(table).queryByText("Refunded Buyer")).not.toBeInTheDocument();
    expect(within(table).getByText("Requested Buyer")).toBeInTheDocument();
    expect(within(table).getByText("Refund requested (simulation)")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show refunded" }));
    expect(within(table).getByText("Refunded Buyer")).toBeInTheDocument();
    expect(within(table).getByText("Refunded (simulation)")).toBeInTheDocument();
  });

  it("distinguishes an all-refunded list from an empty bundle-orders list", async () => {
    const user = userEvent.setup();
    render(
      <BundleOrdersPanel
        bundleOrders={[refundedBundleOrder]}
        bundles={bundles}
        busy={false}
        refreshOrders={vi.fn(() => Promise.resolve())}
        refreshingOrders={false}
        refund={vi.fn(() => Promise.resolve())}
        refundId={null}
        resendConfirmation={vi.fn(() => Promise.resolve())}
        setRefundId={vi.fn()}
        state={{ orders: [], status: "ready" }}
      />,
    );

    expect(screen.getByText("All bundle orders are refunded.")).toBeInTheDocument();
    expect(screen.queryByText("No bundle orders received yet.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Show refunded" }));
    const table = document.querySelector("table.data-table");
    expect(table).not.toBeNull();
    if (!(table instanceof HTMLTableElement)) return;
    expect(within(table).getByText("Refunded Buyer")).toBeInTheDocument();
    expect(screen.queryByText("All bundle orders are refunded.")).not.toBeInTheDocument();
  });

  it("renders sortable data columns, uses surname sorting, and resolves current bundle titles", async () => {
    const user = userEvent.setup();
    render(
      <BundleOrdersPanel
        bundleOrders={bundleOrders}
        bundles={bundles}
        busy={false}
        refreshOrders={vi.fn(() => Promise.resolve())}
        refreshingOrders={false}
        refund={vi.fn(() => Promise.resolve())}
        refundId={null}
        resendConfirmation={vi.fn(() => Promise.resolve())}
        setRefundId={vi.fn()}
        state={{ orders: bundleOrders, status: "ready" }}
      />,
    );

    const table = document.querySelector("table.data-table");
    expect(table).not.toBeNull();
    if (!(table instanceof HTMLTableElement)) {
      throw new Error("Bundle orders did not render a table.");
    }

    const scopedTable = within(table);
    expect(scopedTable.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Buyer ↕",
      "Email ↕",
      "Sale date ↓",
      "Bundle ↕",
      "Qty ↕",
      "Amount paid ↕",
      "Status ↕",
      "Actions",
    ]);
    for (const header of [
      "Buyer",
      "Email",
      "Sale date",
      "Bundle",
      "Qty",
      "Amount paid",
      "Status",
    ]) {
      expect(scopedTable.getByRole("button", { name: `Sort by ${header}` })).toBeInTheDocument();
    }
    expect(scopedTable.queryByRole("button", { name: "Sort by Actions" })).not.toBeInTheDocument();

    const rows = scopedTable.getAllByRole("row").slice(1);
    expect(rows[0]?.textContent).toContain("Zara Anderson");
    expect(rows[1]?.textContent).toContain("Alex Zulu");
    expect(rows[2]?.textContent).toContain("Jane Buyer");

    const currentBundleRow = rows[1];
    const archivedBundleRow = rows[0];
    const regularOrderRow = rows[2];
    expect(currentBundleRow).toBeDefined();
    expect(archivedBundleRow).toBeDefined();
    expect(regularOrderRow).toBeDefined();
    if (!currentBundleRow || !archivedBundleRow || !regularOrderRow) return;

    expect(within(currentBundleRow).getByText(currentBundleTitle)).toBeInTheDocument();
    expect(within(archivedBundleRow).getByText("Archived Bundle")).toBeInTheDocument();
    expect(within(currentBundleRow).getByText("Bundle", { selector: "span" })).toHaveClass(
      "ticketing-bundle-order-pill",
    );
    expect(
      within(regularOrderRow).queryByText("Bundle", { selector: "span" }),
    ).not.toBeInTheDocument();
    expect(within(currentBundleRow).getByText("Paid (simulation)")).toHaveClass(
      "status-pill--success",
    );
    expect(within(archivedBundleRow).getByText("pending (simulation)")).toBeInTheDocument();

    await user.click(scopedTable.getByRole("button", { name: "Sort by Buyer" }));
    expect(table.querySelector("th[aria-sort='ascending']")).toHaveTextContent("Buyer");
    expect(scopedTable.getAllByRole("row")[1]?.textContent).toContain("Zara Anderson");
  });
});
