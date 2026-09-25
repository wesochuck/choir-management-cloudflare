import type { DonationRecord } from "@choir/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DonationHistoryTab } from "./DonationHistoryTab";

const DONATION_IDS = {
  alma: "00000000-0000-4000-8000-000000000001",
  bea: "00000000-0000-4000-8000-000000000002",
  zoe: "00000000-0000-4000-8000-000000000003",
  paidPending: "00000000-0000-4000-8000-000000000004",
  paidSent: "00000000-0000-4000-8000-000000000005",
  refundedPending: "00000000-0000-4000-8000-000000000006",
  refundedSent: "00000000-0000-4000-8000-000000000007",
} as const;

function makeDonation(
  overrides: Partial<DonationRecord> & Pick<DonationRecord, "buyerName" | "createdAt" | "id">,
): DonationRecord {
  const { buyerName, createdAt, id, ...optionalOverrides } = overrides;
  return {
    amountCents: 2_500,
    anonymous: false,
    buyerEmail: `${buyerName.toLocaleLowerCase().replaceAll(" ", ".")}@example.org`,
    buyerName,
    createdAt,
    expiredAt: null,
    feeCents: 0,
    id,
    marketingConsent: false,
    patronId: null,
    paymentMethod: "stripe",
    paymentReference: "",
    processorFeeCents: null,
    processorFeeReconciledAt: null,
    providerBalanceTransactionId: null,
    refundRequested: false,
    status: "paid",
    thankYouSentAt: null,
    tributeName: "",
    tributeNotifyEmail: "",
    tributeType: "none",
    updatedAt: createdAt,
    ...optionalOverrides,
  };
}

const SORTING_DONATIONS: readonly DonationRecord[] = [
  makeDonation({
    amountCents: 10_000,
    buyerName: "Zoe Zodiac",
    createdAt: "2026-04-10T12:00:00.000Z",
    id: DONATION_IDS.zoe,
    paymentMethod: "stripe",
    refundRequested: true,
    status: "paid",
    thankYouSentAt: "2026-04-20T12:00:00.000Z",
    tributeName: "Zoe",
    tributeType: "honor",
  }),
  makeDonation({
    amountCents: 100,
    buyerName: "Bea Baker",
    createdAt: "2026-04-01T12:00:00.000Z",
    id: DONATION_IDS.bea,
    paymentMethod: "check",
    status: "refunded",
    tributeName: "Bea",
    tributeType: "memory",
  }),
  makeDonation({
    amountCents: 5_000,
    buyerName: "Alma Archer",
    createdAt: "2026-05-03T12:00:00.000Z",
    id: DONATION_IDS.alma,
    paymentMethod: "cash",
    thankYouSentAt: "2026-04-10T12:00:00.000Z",
  }),
];

interface DonationHistoryHarnessProps {
  readonly busy: boolean;
  readonly donations: readonly DonationRecord[];
  readonly onOpenManualModal: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onRefund: (donationId: string) => Promise<void>;
  readonly onUpdateThankYou: (donationId: string, sent: boolean) => Promise<void>;
}

function DonationHistoryHarness({
  busy,
  donations: initialDonations,
  onOpenManualModal,
  onRefresh,
  onRefund,
  onUpdateThankYou,
}: DonationHistoryHarnessProps) {
  const [donations, setDonations] = useState(initialDonations);
  const [refundId, setRefundId] = useState<string | null>(null);

  async function refund(donationId: string): Promise<void> {
    await onRefund(donationId);
    setDonations((current) =>
      current.map((donation) =>
        donation.id === donationId
          ? { ...donation, refundRequested: false, status: "refunded" }
          : donation,
      ),
    );
    setRefundId(null);
  }

  async function updateThankYou(donationId: string, sent: boolean): Promise<void> {
    await onUpdateThankYou(donationId, sent);
    setDonations((current) =>
      current.map((donation) =>
        donation.id === donationId
          ? { ...donation, thankYouSentAt: sent ? "2026-06-01T12:00:00.000Z" : null }
          : donation,
      ),
    );
  }

  return (
    <DonationHistoryTab
      busy={busy}
      donationState={{ donations, status: "ready" }}
      onOpenManualModal={onOpenManualModal}
      onRefresh={onRefresh}
      patronState={{ patrons: [], status: "ready" }}
      refreshing={false}
      refund={refund}
      refundId={refundId}
      setRefundId={setRefundId}
      timezone="UTC"
      updateThankYou={updateThankYou}
    />
  );
}

interface RenderHistoryOptions {
  readonly busy?: boolean;
  readonly donations?: readonly DonationRecord[];
  readonly onRefresh?: () => Promise<void>;
  readonly onRefund?: (donationId: string) => Promise<void>;
  readonly onUpdateThankYou?: (donationId: string, sent: boolean) => Promise<void>;
}

function renderHistory(options: RenderHistoryOptions = {}) {
  const props: DonationHistoryHarnessProps = {
    busy: options.busy ?? false,
    donations: options.donations ?? SORTING_DONATIONS,
    onOpenManualModal: vi.fn(),
    onRefresh: options.onRefresh ?? vi.fn((): Promise<void> => Promise.resolve()),
    onRefund: options.onRefund ?? vi.fn((): Promise<void> => Promise.resolve()),
    onUpdateThankYou: options.onUpdateThankYou ?? vi.fn((): Promise<void> => Promise.resolve()),
  };
  const view = render(<DonationHistoryHarness {...props} />);
  return { ...view, props };
}

function getDonationTable(container: HTMLElement = document.body): HTMLTableElement {
  const table = container.querySelector("table.data-table");
  if (!(table instanceof HTMLTableElement)) {
    throw new Error("Expected the donations register to render the shared DataTable.");
  }
  return table;
}

function donorNames(table: HTMLTableElement): string[] {
  return Array.from(table.querySelectorAll("tbody tr")).map((row) => {
    const name = row.querySelector("td:first-child strong");
    if (!name) throw new Error("Expected each donation row to render its donor name.");
    return name.textContent;
  });
}

function rowForDonor(table: HTMLTableElement, donorName: string): HTMLTableRowElement {
  const row = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr")).find(
    (candidate) => candidate.querySelector("td:first-child strong")?.textContent === donorName,
  );
  if (!row) throw new Error(`Expected a donation row for ${donorName}.`);
  return row;
}

function cardForDonor(cards: HTMLElement, donorName: string): HTMLElement {
  const card = within(cards).getByText(donorName).closest<HTMLElement>(".data-table-card");
  if (!card) throw new Error(`Expected a donation card for ${donorName}.`);
  return card;
}

describe("DonationHistoryTab DataTable", () => {
  it("renders standard columns, newest donations first, and mobile cards", async () => {
    const user = userEvent.setup();
    const { props } = renderHistory();

    const table = getDonationTable();
    expect(table).toHaveClass("data-table");
    expect(table).not.toHaveClass("table--actions");
    expect(donorNames(table)).toEqual(["Alma Archer", "Zoe Zodiac"]);
    expect(
      within(table).getByRole("button", { name: "Sort by Date" }).closest("th"),
    ).toHaveAttribute("aria-sort", "descending");

    for (const header of [
      "Donor",
      "Amount",
      "Payment method",
      "Tribute",
      "Status",
      "Thank-you letter",
      "Date",
    ]) {
      expect(within(table).getByRole("button", { name: `Sort by ${header}` })).toBeInTheDocument();
    }
    expect(within(table).getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: "Sort by Actions" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sort by")).not.toBeInTheDocument();

    const exportLink = screen.getByRole("link", { name: "Export CSV" });
    expect(exportLink).toHaveAttribute("download", "donations.csv");
    expect(exportLink.getAttribute("href")).toContain("data:text/csv");
    await user.click(screen.getByRole("checkbox", { name: "Show refunded" }));
    expect(donorNames(table)).toEqual(["Alma Archer", "Zoe Zodiac", "Bea Baker"]);
    await user.click(screen.getByRole("button", { name: "Refresh status" }));
    await user.click(screen.getByRole("button", { name: "Record donation" }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(props.onOpenManualModal).toHaveBeenCalledTimes(1);

    const cards = document.querySelector(".data-table-cards");
    expect(cards).not.toBeNull();
    if (!(cards instanceof HTMLElement)) return;
    for (const label of [
      "Donor",
      "Amount",
      "Payment",
      "Tribute",
      "Status",
      "Thank-you",
      "Date",
      "Actions",
    ]) {
      expect(within(cards).getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(within(cards).getByRole("button", { name: "Refund" })).toBeInTheDocument();
  });

  it("sorts each data column and keeps filtering and the shown count independent of sorting", async () => {
    const user = userEvent.setup();
    renderHistory();
    const table = getDonationTable();
    expect(donorNames(table)).toEqual(["Alma Archer", "Zoe Zodiac"]);
    await user.click(screen.getByRole("checkbox", { name: "Show refunded" }));
    expect(donorNames(table)).toEqual(["Alma Archer", "Zoe Zodiac", "Bea Baker"]);

    const ascendingOrders: Readonly<Record<string, readonly string[]>> = {
      Amount: ["Bea Baker", "Alma Archer", "Zoe Zodiac"],
      Donor: ["Alma Archer", "Bea Baker", "Zoe Zodiac"],
      "Payment method": ["Alma Archer", "Bea Baker", "Zoe Zodiac"],
      Status: ["Alma Archer", "Zoe Zodiac", "Bea Baker"],
      "Thank-you letter": ["Bea Baker", "Alma Archer", "Zoe Zodiac"],
      Tribute: ["Zoe Zodiac", "Bea Baker", "Alma Archer"],
    };

    for (const [header, expectedNames] of Object.entries(ascendingOrders)) {
      await user.click(within(table).getByRole("button", { name: `Sort by ${header}` }));
      expect(donorNames(table)).toEqual(expectedNames);
      expect(
        within(table)
          .getByRole("button", { name: `Sort by ${header}` })
          .closest("th"),
      ).toHaveAttribute("aria-sort", "ascending");
    }

    const dateSort = within(table).getByRole("button", { name: "Sort by Date" });
    await user.click(dateSort);
    expect(dateSort.closest("th")).toHaveAttribute("aria-sort", "ascending");
    expect(donorNames(table)).toEqual(["Bea Baker", "Zoe Zodiac", "Alma Archer"]);
    await user.click(dateSort);
    expect(dateSort.closest("th")).toHaveAttribute("aria-sort", "descending");
    expect(donorNames(table)).toEqual(["Alma Archer", "Zoe Zodiac", "Bea Baker"]);

    const search = screen.getByRole("searchbox", { name: "Search" });
    await user.type(search, "bea.baker");
    expect(screen.getByText("1 shown")).toBeInTheDocument();
    expect(donorNames(table)).toEqual(["Bea Baker"]);
    await user.clear(search);

    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-04-10" } });
    expect(screen.getByText("2 shown")).toBeInTheDocument();
    expect(donorNames(table)).toEqual(["Zoe Zodiac", "Bea Baker"]);

    await user.selectOptions(screen.getByLabelText("Thank you letter"), "sent");
    expect(screen.getByText("1 shown")).toBeInTheDocument();
    expect(donorNames(table)).toEqual(["Zoe Zodiac"]);

    await user.selectOptions(screen.getByLabelText("Thank you letter"), "all");
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "" } });
    await user.selectOptions(screen.getByLabelText("Payment source"), "manual");
    expect(screen.getByText("2 shown")).toBeInTheDocument();
    await user.click(within(table).getByRole("button", { name: "Sort by Amount" }));
    expect(screen.getByText("2 shown")).toBeInTheDocument();
    expect(donorNames(table)).toEqual(["Bea Baker", "Alma Archer"]);
  });

  it("preserves anonymous email privacy in desktop and card presentations", () => {
    const anonymousDonation = makeDonation({
      anonymous: true,
      buyerEmail: "private-donor@example.org",
      buyerName: "Private Donor",
      createdAt: "2026-06-01T12:00:00.000Z",
      id: DONATION_IDS.alma,
      paymentReference: "check 122",
    });
    renderHistory({ donations: [anonymousDonation] });

    const table = getDonationTable();
    const cards = document.querySelector(".data-table-cards");
    expect(within(table).getByText("Anonymous")).toBeInTheDocument();
    expect(within(table).queryByText("private-donor@example.org")).not.toBeInTheDocument();
    expect(within(table).getByText("check 122")).toBeInTheDocument();
    expect(cards).not.toBeNull();
    if (!(cards instanceof HTMLElement)) return;
    expect(within(cards).getByText("Anonymous")).toBeInTheDocument();
    expect(within(cards).queryByText("private-donor@example.org")).not.toBeInTheDocument();
    expect(within(cards).getByText("check 122")).toBeInTheDocument();
  });

  it("keeps thank-you and refund actions reachable, guarded, and tied to their donation IDs", async () => {
    const user = userEvent.setup();
    const thankYouUpdateGate = { finish: (): void => undefined };
    let thankYouUpdateCount = 0;
    const onUpdateThankYou = vi.fn(() => {
      thankYouUpdateCount += 1;
      if (thankYouUpdateCount === 1) {
        return new Promise<void>((resolve) => {
          thankYouUpdateGate.finish = resolve;
        });
      }
      return Promise.resolve();
    });
    const onRefund = vi.fn((): Promise<void> => Promise.resolve());
    const rows = [
      makeDonation({
        buyerName: "Zoe Zodiac",
        createdAt: "2026-05-03T12:00:00.000Z",
        id: DONATION_IDS.zoe,
      }),
      makeDonation({
        buyerName: "Bea Baker",
        createdAt: "2026-04-10T12:00:00.000Z",
        id: DONATION_IDS.bea,
        refundRequested: true,
        status: "paid",
        thankYouSentAt: "2026-04-15T12:00:00.000Z",
      }),
      makeDonation({
        buyerName: "Alma Archer",
        createdAt: "2026-04-01T12:00:00.000Z",
        id: DONATION_IDS.alma,
        status: "refunded",
      }),
    ];
    const view = renderHistory({ donations: rows, onRefund, onUpdateThankYou });
    const table = getDonationTable();
    const zoeRow = within(table)
      .getAllByRole("row")
      .find((row) => within(row).queryByText("Zoe Zodiac"));
    expect(zoeRow).toBeDefined();
    if (!zoeRow) return;

    const markSent = within(zoeRow).getByRole("button", { name: "Mark sent" });
    await user.click(markSent);
    expect(onUpdateThankYou).toHaveBeenCalledWith(DONATION_IDS.zoe, true);
    expect(markSent).toBeDisabled();
    thankYouUpdateGate.finish();
    await waitFor(() => expect(within(zoeRow).getByRole("button", { name: "Undo" })).toBeEnabled());
    await user.click(within(zoeRow).getByRole("button", { name: "Undo" }));
    expect(onUpdateThankYou).toHaveBeenLastCalledWith(DONATION_IDS.zoe, false);

    expect(within(table).getAllByRole("button", { name: "Refund" })).toHaveLength(1);
    await user.click(within(zoeRow).getByRole("button", { name: "Refund" }));
    expect(within(zoeRow).getByText("Refund this donation?")).toBeInTheDocument();
    expect(within(zoeRow).getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    view.rerender(<DonationHistoryHarness {...view.props} busy />);
    const busyTable = getDonationTable();
    const busyZoeRow = within(busyTable)
      .getAllByRole("row")
      .find((row) => within(row).queryByText("Zoe Zodiac"));
    expect(busyZoeRow).toBeDefined();
    if (!busyZoeRow) return;
    expect(within(busyZoeRow).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(busyZoeRow).getByRole("button", { name: "Refunding…" })).toBeDisabled();

    view.rerender(<DonationHistoryHarness {...view.props} />);
    const readyTable = getDonationTable();
    const readyZoeRow = within(readyTable)
      .getAllByRole("row")
      .find((row) => within(row).queryByText("Zoe Zodiac"));
    expect(readyZoeRow).toBeDefined();
    if (!readyZoeRow) return;
    await user.click(within(readyZoeRow).getByRole("button", { name: "Cancel" }));
    expect(within(readyZoeRow).getByRole("button", { name: "Refund" })).toBeInTheDocument();
    await user.click(within(readyZoeRow).getByRole("button", { name: "Refund" }));
    await user.click(within(readyZoeRow).getByRole("button", { name: "Confirm refund" }));
    expect(onRefund).toHaveBeenCalledWith(DONATION_IDS.zoe);
    await waitFor(() => {
      expect(within(getDonationTable()).queryAllByRole("button", { name: "Refund" })).toHaveLength(
        0,
      );
      expect(within(getDonationTable()).queryByText("Zoe Zodiac")).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("checkbox", { name: "Show refunded" }));
    const refundedZoeRow = rowForDonor(getDonationTable(), "Zoe Zodiac");
    expect(within(refundedZoeRow).getByText("Refunded")).toBeInTheDocument();
    expect(
      within(refundedZoeRow).queryByRole("button", { name: "Refund" }),
    ).not.toBeInTheDocument();
  });

  it("keeps refunded thank-you state non-actionable across filters and mobile cards", async () => {
    const user = userEvent.setup();
    const onUpdateThankYou = vi.fn((): Promise<void> => Promise.resolve());
    const donations = [
      makeDonation({
        buyerName: "Paid Pending Donor",
        createdAt: "2026-05-04T12:00:00.000Z",
        id: DONATION_IDS.paidPending,
      }),
      makeDonation({
        buyerName: "Paid Sent Donor",
        createdAt: "2026-05-03T12:00:00.000Z",
        id: DONATION_IDS.paidSent,
        thankYouSentAt: "2026-04-15T12:00:00.000Z",
      }),
      makeDonation({
        buyerName: "Refunded Pending Donor",
        createdAt: "2026-05-02T12:00:00.000Z",
        id: DONATION_IDS.refundedPending,
        status: "refunded",
      }),
      makeDonation({
        buyerName: "Refunded Sent Donor",
        createdAt: "2026-05-01T12:00:00.000Z",
        id: DONATION_IDS.refundedSent,
        status: "refunded",
        thankYouSentAt: "2026-04-16T12:00:00.000Z",
      }),
    ];
    const { props } = renderHistory({ donations, onUpdateThankYou });
    const table = getDonationTable();
    expect(donorNames(table)).toEqual(["Paid Pending Donor", "Paid Sent Donor"]);
    await user.click(screen.getByRole("checkbox", { name: "Show refunded" }));

    expect(
      within(rowForDonor(table, "Paid Pending Donor")).getByText("Pending"),
    ).toBeInTheDocument();
    expect(
      within(rowForDonor(table, "Paid Pending Donor")).getByRole("button", { name: "Mark sent" }),
    ).toBeInTheDocument();
    expect(
      within(rowForDonor(table, "Paid Sent Donor")).getByText(/Sent .*2026/),
    ).toBeInTheDocument();
    expect(
      within(rowForDonor(table, "Paid Sent Donor")).getByRole("button", { name: "Undo" }),
    ).toBeInTheDocument();

    const refundedPendingRow = rowForDonor(table, "Refunded Pending Donor");
    expect(within(refundedPendingRow).getByText("Not applicable")).toBeInTheDocument();
    expect(
      within(refundedPendingRow).queryByRole("button", { name: "Mark sent", hidden: true }),
    ).not.toBeInTheDocument();

    const refundedSentRow = rowForDonor(table, "Refunded Sent Donor");
    expect(within(refundedSentRow).getByText(/Sent .*2026/)).toBeInTheDocument();
    expect(within(refundedSentRow).getByRole("button", { name: "Undo" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Thank you letter"), "sent");
    expect(screen.getByText("2 shown")).toBeInTheDocument();
    expect(donorNames(table)).toEqual(["Paid Sent Donor", "Refunded Sent Donor"]);

    await user.selectOptions(screen.getByLabelText("Thank you letter"), "pending");
    expect(screen.getByText("1 shown")).toBeInTheDocument();
    expect(donorNames(table)).toEqual(["Paid Pending Donor"]);

    await user.selectOptions(screen.getByLabelText("Thank you letter"), "all");
    const cards = document.querySelector(".data-table-cards");
    expect(cards).not.toBeNull();
    if (!(cards instanceof HTMLElement)) return;

    const refundedPendingCard = cardForDonor(cards, "Refunded Pending Donor");
    expect(within(refundedPendingCard).getByText("Not applicable")).toBeInTheDocument();
    expect(
      within(refundedPendingCard).queryByRole("button", { name: "Mark sent", hidden: true }),
    ).not.toBeInTheDocument();
    const refundedSentCard = cardForDonor(cards, "Refunded Sent Donor");
    expect(within(refundedSentCard).getByText(/Sent .*2026/)).toBeInTheDocument();
    expect(
      within(refundedSentCard).getByRole("button", { name: "Undo", hidden: true }),
    ).toBeInTheDocument();

    await user.click(
      within(rowForDonor(getDonationTable(), "Refunded Sent Donor")).getByRole("button", {
        name: "Undo",
      }),
    );
    expect(onUpdateThankYou).toHaveBeenCalledWith(DONATION_IDS.refundedSent, false);
    await waitFor(() => {
      const updatedTable = getDonationTable();
      const updatedRow = rowForDonor(updatedTable, "Refunded Sent Donor");
      expect(within(updatedRow).getByText("Not applicable")).toBeInTheDocument();
      expect(
        within(updatedRow).queryByRole("button", { name: "Mark sent", hidden: true }),
      ).not.toBeInTheDocument();
    });

    const updatedCards = document.querySelector(".data-table-cards");
    expect(updatedCards).not.toBeNull();
    if (!(updatedCards instanceof HTMLElement)) return;
    const updatedRefundedSentCard = cardForDonor(updatedCards, "Refunded Sent Donor");
    expect(within(updatedRefundedSentCard).getByText("Not applicable")).toBeInTheDocument();
    expect(
      within(updatedRefundedSentCard).queryByRole("button", { name: "Mark sent", hidden: true }),
    ).not.toBeInTheDocument();
    expect(props.onUpdateThankYou).toHaveBeenCalledTimes(1);
  });

  it("uses distinct empty messages for a new register and a filtered result", async () => {
    const user = userEvent.setup();
    const emptyView = renderHistory({ donations: [] });
    expect(screen.getByText("No donations recorded yet.")).toBeInTheDocument();
    expect(screen.getByText("0 shown")).toBeInTheDocument();
    expect(document.querySelector("table.data-table")).not.toBeInTheDocument();

    emptyView.unmount();
    renderHistory();
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "no matching donor");
    expect(screen.getByText("No donations match these filters.")).toBeInTheDocument();
    expect(screen.getByText("0 shown")).toBeInTheDocument();
    expect(document.querySelector("table.data-table")).not.toBeInTheDocument();
  });

  it("composes the refunded toggle with other filters while preserving totals and the full export", async () => {
    const user = userEvent.setup();
    renderHistory();

    const table = getDonationTable();
    const toggle = screen.getByRole("checkbox", { name: "Show refunded" });
    expect(toggle).not.toBeChecked();
    expect(donorNames(table)).toEqual(["Alma Archer", "Zoe Zodiac"]);
    const exportLink = screen.getByRole("link", { name: "Export CSV" });
    const exportHref = exportLink.getAttribute("href");
    expect(exportHref).not.toBeNull();
    const summary = Array.from(
      document.querySelectorAll(".donation-dashboard__metrics .summary-card"),
    ).map((card) => card.textContent);

    await user.click(toggle);
    expect(donorNames(table)).toEqual(["Alma Archer", "Zoe Zodiac", "Bea Baker"]);
    expect(exportLink.getAttribute("href")).toBe(exportHref);
    const exportedCsv = decodeURIComponent(exportHref?.split(",", 2)[1] ?? "");
    expect(exportedCsv).toContain("Bea Baker");

    await user.selectOptions(screen.getByLabelText("Payment source"), "manual");
    expect(donorNames(table)).toEqual(["Alma Archer", "Bea Baker"]);
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "Bea");
    expect(donorNames(table)).toEqual(["Bea Baker"]);
    await user.click(toggle);
    expect(
      screen.getByText("All donations matching these filters are refunded."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 shown")).toBeInTheDocument();
    expect(exportLink.getAttribute("href")).toBe(exportHref);
    expect(
      Array.from(document.querySelectorAll(".donation-dashboard__metrics .summary-card")).map(
        (card) => card.textContent,
      ),
    ).toEqual(summary);
  });
});
