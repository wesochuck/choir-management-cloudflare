import { type DonationRecord, type OrganizationTicketOrder } from "@choir/contracts";
import { useMemo, useState } from "react";
import { DataTable } from "@choir/ui";
import { Status, type CommerceFilter, type LoadState } from "./shared";
import {
  commerceRowAmount,
  commerceRowDate,
  commerceRowDetails,
  commerceRowEmail,
  commerceRowFee,
  commerceRowName,
  commerceRowQuantity,
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
  const total = rows.reduce((sum, row) => sum + commerceRowAmount(row), 0);
  const fees = rows.reduce((sum, row) => sum + commerceRowFee(row), 0);
  const ticketsSold = visibleTicketOrders.reduce((sum, order) => sum + order.quantity, 0);
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
                "Amount",
                "Processing fee",
                "Status",
                "Date",
              ],
              ...rows.map((row) => [
                commerceRowType(row),
                commerceRowName(row),
                commerceRowEmail(row),
                commerceRowDetails(row),
                commerceRowQuantity(row) ?? "",
                money(commerceRowAmount(row)),
                money(commerceRowFee(row)),
                row.record.status,
                commerceRowDate(row),
              ]),
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
                <strong>{money(total)}</strong>
                <span>Total received</span>
              </div>
              <div className="reports-kpi">
                <strong>{money(fees)}</strong>
                <span>Processing fees</span>
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
