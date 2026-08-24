import { datePartInTimeZone } from "@choir/domain";
import { useMemo, useState } from "react";

import {
  EMPTY_DONATIONS,
  money,
  tributeLabel,
  type DonationSort,
  type DonationState,
  type PatronState,
} from "./types";
import { PatronsTab } from "./PatronsTab";

export function DonationHistoryTab({
  busy,
  donationState,
  patronState,
  refund,
  refundId,
  setRefundId,
  timezone,
}: {
  readonly busy: boolean;
  readonly donationState: DonationState;
  readonly patronState: PatronState;
  readonly refund: (id: string) => Promise<void>;
  readonly refundId: string | null;
  readonly setRefundId: (id: string | null) => void;
  readonly timezone: string;
}) {
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState<DonationSort>("dateDesc");
  const donations = donationState.status === "ready" ? donationState.donations : EMPTY_DONATIONS;
  const paidDonations = donations.filter((donation) => donation.status === "paid");
  const totalRaisedCents = paidDonations.reduce(
    (total, donation) => total + donation.amountCents,
    0,
  );
  const averageGiftCents = paidDonations.length
    ? Math.round(totalRaisedCents / paidDonations.length)
    : 0;
  const filteredDonations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return donations
      .filter((donation) => {
        const donorText = [
          donation.anonymous ? "Anonymous" : donation.buyerName,
          donation.anonymous ? "" : donation.buyerEmail,
          donation.tributeName,
        ]
          .join(" ")
          .toLocaleLowerCase();
        const donationDate = datePartInTimeZone(new Date(donation.createdAt), timezone);
        return (
          (!normalizedQuery || donorText.includes(normalizedQuery)) &&
          (!fromDate || donationDate >= fromDate) &&
          (!toDate || donationDate <= toDate)
        );
      })
      .toSorted((left, right) => {
        if (sort === "donor") {
          const leftName = left.anonymous ? "Anonymous" : left.buyerName;
          const rightName = right.anonymous ? "Anonymous" : right.buyerName;
          return leftName.localeCompare(rightName);
        }
        const direction = sort === "dateDesc" ? -1 : 1;
        return direction * left.createdAt.localeCompare(right.createdAt);
      });
  }, [donations, fromDate, query, sort, timezone, toDate]);

  if (donationState.status === "loading") return <p>Loading donations…</p>;
  if (donationState.status === "error")
    return <p className="notice notice--error">Donations could not be loaded.</p>;

  return (
    <div className="donation-history">
      <fieldset className="ticket-dashboard donation-dashboard">
        <legend>Donation summary</legend>
        <div className="ticket-dashboard__section-heading">
          <div>
            <p>Review incoming gifts and donor activity.</p>
          </div>
        </div>
        <div className="ticket-dashboard__metrics donation-dashboard__metrics">
          <article className="summary-card ticket-dashboard__metric">
            <span className="summary-card__label">Donations count</span>
            <strong>{paidDonations.length}</strong>
          </article>
          <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--sales">
            <span className="summary-card__label">Total raised</span>
            <strong>{money(totalRaisedCents)}</strong>
          </article>
          <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--revenue">
            <span className="summary-card__label">Average gift</span>
            <strong>{money(averageGiftCents)}</strong>
          </article>
        </div>
      </fieldset>
      <fieldset className="ticket-dashboard__will-call donation-register">
        <legend>Donations register</legend>
        <div className="ticket-dashboard__section-heading">
          <div>
            <p>Search donation history, review payment status, and process refunds.</p>
          </div>
          <span className="field-help">{filteredDonations.length} shown</span>
        </div>
        <div className="ticket-dashboard__filters donation-dashboard__filters">
          <label className="field">
            Search
            <input
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Donor name or email…"
              type="search"
              value={query}
            />
          </label>
          <label className="field">
            From date
            <input
              onChange={(event) => {
                setFromDate(event.target.value);
              }}
              type="date"
              value={fromDate}
            />
          </label>
          <label className="field">
            To date
            <input
              onChange={(event) => {
                setToDate(event.target.value);
              }}
              type="date"
              value={toDate}
            />
          </label>
          <label className="field">
            Sort by
            <select
              onChange={(event) => {
                const value = event.target.value;
                if (value === "dateDesc" || value === "dateAsc" || value === "donor") {
                  setSort(value);
                }
              }}
              value={sort}
            >
              <option value="dateDesc">Date (Newest First)</option>
              <option value="dateAsc">Date (Oldest First)</option>
              <option value="donor">Donor name</option>
            </select>
          </label>
        </div>
        {donations.length === 0 ? <p>No donations yet.</p> : null}
        {donations.length > 0 && filteredDonations.length === 0 ? (
          <p className="empty-state">No donations match these filters.</p>
        ) : null}
        {filteredDonations.length > 0 ? (
          <div className="table-scroll">
            <table className="table--actions">
              <thead>
                <tr>
                  <th>Donor</th>
                  <th>Amount</th>
                  <th>Processing fee</th>
                  <th>Tribute</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredDonations.map((donation) => (
                  <tr key={donation.id}>
                    <td>
                      {donation.anonymous ? "Anonymous" : donation.buyerName}
                      <br />
                      <small>{donation.anonymous ? "" : donation.buyerEmail}</small>
                    </td>
                    <td>{money(donation.amountCents)}</td>
                    <td>{donation.feeCents > 0 ? money(donation.feeCents) : "Covered"}</td>
                    <td>
                      {tributeLabel(donation.tributeType)}
                      {donation.tributeName ? `: ${donation.tributeName}` : ""}
                    </td>
                    <td>{donation.status}</td>
                    <td>{new Date(donation.createdAt).toLocaleDateString()}</td>
                    <td>
                      {refundId === donation.id ? (
                        <div className="danger-confirmation">
                          <p>Refund this donation?</p>
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
                              onClick={() => void refund(donation.id)}
                              type="button"
                            >
                              {busy ? "Refunding…" : "Confirm refund"}
                            </button>
                          </div>
                        </div>
                      ) : donation.status === "paid" ? (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setRefundId(donation.id);
                          }}
                          type="button"
                        >
                          Refund
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </fieldset>
      <details className="donation-patrons">
        <summary>
          Patron summaries ({patronState.status === "ready" ? patronState.patrons.length : "…"})
        </summary>
        <PatronsTab patronState={patronState} />
      </details>
    </div>
  );
}
