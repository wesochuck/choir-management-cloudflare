import { type DonationRecord, type OrganizationTicketOrder } from "@choir/contracts";
import { calculatePaymentFinancialSummary } from "@choir/domain";
import { useMemo, useState } from "react";
import { DataTable } from "@choir/ui";
import { Status, type CommerceFilter, type LoadState } from "./shared";
import {
  commerceRowAmount,
  commerceRowDate,
  commerceRowDetails,
  commerceRowEmail,
  commerceRowFee,
  commerceRowGrossAmount,
  commerceRowName,
  commerceRowNetProceeds,
  commerceRowProcessorFee,
  commerceRowQuantity,
  commerceRowRefundAmount,
  commerceRows,
  commerceRowType,
  downloadCsv,
  formatDate,
  money,
} from "./reportHelpers";
export function CommerceReport({
  donations,
  state,
  ticketOrders,
}: {
  readonly donations: readonly DonationRecord[];
  readonly state: LoadState;
  readonly ticketOrders: readonly OrganizationTicketOrder[];
}) {
  const [filter, setFilter] = useState<CommerceFilter>("all");
  const rows = useMemo(
    () => commerceRows(donations, ticketOrders, filter),
    [donations, filter, ticketOrders],
  );
  const visibleDonations = filter === "tickets" ? [] : donations;
  const visibleTicketOrders = filter === "donations" ? [] : ticketOrders;
  const ticketsSold = visibleTicketOrders
    .filter((order) => order.status === "paid")
    .reduce((sum, order) => sum + order.quantity, 0);
  const financialSummary = useMemo(() => {
    const inputs = rows.map((row) => {
      if (row.kind === "ticket") {
        return {
          amountPaidCents: row.record.amountPaidCents,
          checkoutMode: row.record.checkoutMode,
          feeCents: row.record.feeCents,
          processorFeeCents: row.record.processorFeeCents,
          status: row.record.status,
        };
      }
      return {
        amountPaidCents: row.record.amountCents + row.record.feeCents,
        checkoutMode: "fake" as const,
        feeCents: row.record.feeCents,
        processorFeeCents: null,
        status: row.record.status,
      };
    });
    return calculatePaymentFinancialSummary(inputs);
  }, [rows]);
  const emptyMessage =
    filter === "donations"
      ? "No donations have been recorded."
      : filter === "tickets"
        ? "No ticket sales have been recorded."
        : "No donations or ticket sales have been recorded.";
  return (
    <>
      <div className="reports-toolbar">
        <div aria-label="Commerce report source" className="reports-source-filter" role="group">
          <span className="field-label">Show</span>
          <div className="reports-source-filter__buttons">
            {(
              [
                ["all", "Both"],
                ["donations", "Donations"],
                ["tickets", "Ticket sales"],
              ] as const
            ).map(([value, label]) => (
              <button
                aria-pressed={filter === value}
                className={filter === value ? "is-active" : undefined}
                key={value}
                onClick={() => {
                  setFilter(value);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          className="button button--secondary"
          disabled={!rows.length || state !== "ready"}
          onClick={() => {
            downloadCsv("donations-and-ticket-sales-report.csv", [
              [
                "Type",
                "Donor / buyer",
                "Email",
                "Event / tribute",
                "Quantity",
                "Gross amount",
                "Refund amount",
                "Customer fee collected",
                "Stripe processing fee",
                "Net proceeds",
                "Status",
                "Date",
              ],
              ...rows.map((row) => {
                const processorFee = commerceRowProcessorFee(row);
                const netProceeds = commerceRowNetProceeds(row);
                const refundAmount = commerceRowRefundAmount(row);
                return [
                  commerceRowType(row),
                  commerceRowName(row),
                  commerceRowEmail(row),
                  commerceRowDetails(row),
                  commerceRowQuantity(row) ?? "",
                  money(commerceRowGrossAmount(row)),
                  refundAmount > 0 ? `-${money(refundAmount)}` : "$0.00",
                  money(commerceRowFee(row)),
                  processorFee !== null ? money(processorFee) : "Pending",
                  netProceeds !== null
                    ? netProceeds < 0
                      ? `-${money(Math.abs(netProceeds))}`
                      : money(netProceeds)
                    : "Pending",
                  row.record.status,
                  commerceRowDate(row),
                ];
              }),
            ]);
          }}
          type="button"
        >
          Export CSV
        </button>
      </div>
      {state !== "ready" ? (
        <Status state={state} />
      ) : rows.length === 0 ? (
        <Status state="ready" empty={emptyMessage} />
      ) : (
        <>
          <fieldset className="reports-summary-fieldset">
            <legend>Transaction summary</legend>
            <div className="reports-kpi-grid reports-kpi-grid--commerce">
              <div className="reports-kpi">
                <strong>{rows.length}</strong>
                <span>Transactions</span>
              </div>
              <div className="reports-kpi">
                <strong>{visibleDonations.length}</strong>
                <span>Donations</span>
              </div>
              <div className="reports-kpi">
                <strong>{visibleTicketOrders.length}</strong>
                <span>Ticket orders</span>
              </div>
              <div className="reports-kpi">
                <strong>{ticketsSold}</strong>
                <span>Tickets sold</span>
              </div>
              <div className="reports-kpi">
                <strong>{money(financialSummary.grossChargedCents)}</strong>
                <span>Gross charged</span>
              </div>
              <div className="reports-kpi">
                <strong>
                  {financialSummary.refundCents > 0
                    ? `-${money(financialSummary.refundCents)}`
                    : "$0.00"}
                </strong>
                <span>Refunds</span>
              </div>
              <div className="reports-kpi">
                <strong>{money(financialSummary.customerFeeCents)}</strong>
                <span>Customer fees</span>
              </div>
              <div className="reports-kpi">
                <strong>
                  {financialSummary.processorFeeCents > 0
                    ? `-${money(financialSummary.processorFeeCents)}`
                    : financialSummary.unreconciledProcessorFeeCount > 0
                      ? "Pending"
                      : "$0.00"}
                </strong>
                <span>Stripe fees</span>
              </div>
              <div className="reports-kpi">
                <strong>
                  {financialSummary.netProceedsCents !== null
                    ? financialSummary.netProceedsCents < 0
                      ? `-${money(Math.abs(financialSummary.netProceedsCents))}`
                      : money(financialSummary.netProceedsCents)
                    : "Pending"}
                </strong>
                <span>Net proceeds</span>
              </div>
            </div>
          </fieldset>
          <DataTable
            columns={[
              {
                header: "Type",
                id: "type",
                render: (row) => commerceRowType(row),
                sortValue: (row) => commerceRowType(row),
              },
              {
                header: "Donor / buyer",
                id: "person",
                render: (row) => (
                  <>
                    <strong>{commerceRowName(row)}</strong>
                    <br />
                    <small>{commerceRowEmail(row)}</small>
                  </>
                ),
                sortValue: (row) => commerceRowName(row),
              },
              {
                header: "Event / tribute",
                id: "details",
                render: (row) => commerceRowDetails(row),
                sortValue: (row) => commerceRowDetails(row),
              },
              {
                header: "Quantity",
                id: "quantity",
                render: (row) => commerceRowQuantity(row) ?? "—",
                sortValue: (row) => commerceRowQuantity(row) ?? 0,
              },
              {
                header: "Amount",
                id: "amount",
                render: (row) => money(commerceRowAmount(row)),
                sortValue: (row) => commerceRowAmount(row),
              },
              {
                header: "Fee",
                id: "fee",
                render: (row) => (commerceRowFee(row) ? money(commerceRowFee(row)) : "Covered"),
                sortValue: (row) => commerceRowFee(row),
              },
              {
                header: "Status",
                id: "status",
                render: (row) => row.record.status,
                sortValue: (row) => row.record.status,
              },
              {
                header: "Date",
                id: "date",
                render: (row) => formatDate(commerceRowDate(row), true),
                sortValue: (row) => commerceRowDate(row),
              },
            ]}
            initialSort={{ columnId: "date", direction: "desc" }}
            keySelector={(row) => `${row.kind}-${row.record.id}`}
            rows={rows}
          />
        </>
      )}
    </>
  );
}
