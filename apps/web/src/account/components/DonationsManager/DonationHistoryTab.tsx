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

function paymentMethodLabel(method?: string): string {
  switch (method) {
    case "check":
      return "Check";
    case "cash":
      return "Cash";
    case "bank_transfer":
      return "Bank transfer";
    case "card_offline":
      return "Card (Offline)";
    case "other":
      return "Other (Offline)";
    case "stripe":
    default:
      return "Online (Stripe)";
  }
}

function matchesThankYouFilter(
  thankYouSentAt: string | null | undefined,
  filter: "all" | "pending" | "sent",
): boolean {
  if (filter === "pending") return !thankYouSentAt;
  if (filter === "sent") return Boolean(thankYouSentAt);
  return true;
}

function matchesPaymentSourceFilter(
  paymentMethod: string | undefined,
  filter: "all" | "online" | "manual",
): boolean {
  const isOnline = paymentMethod === "stripe" || !paymentMethod;
  if (filter === "online") return isOnline;
  if (filter === "manual") return !isOnline;
  return true;
}

function matchesDonationSearch(
  donation: {
    readonly anonymous: boolean;
    readonly buyerEmail: string;
    readonly buyerName: string;
    readonly paymentReference?: string;
    readonly tributeName: string;
  },
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  const donorText = [
    donation.anonymous ? "Anonymous" : donation.buyerName,
    donation.anonymous ? "" : donation.buyerEmail,
    donation.paymentReference ?? "",
    donation.tributeName,
  ]
    .join(" ")
    .toLocaleLowerCase();
  return donorText.includes(normalizedQuery);
}

export function DonationHistoryTab({
  busy,
  donationState,
  onOpenManualModal,
  patronState,
  refund,
  refundId,
  setRefundId,
  timezone,
  updateThankYou,
}: {
  readonly busy: boolean;
  readonly donationState: DonationState;
  readonly onOpenManualModal: () => void;
  readonly patronState: PatronState;
  readonly refund: (id: string) => Promise<void>;
  readonly refundId: string | null;
  readonly setRefundId: (id: string | null) => void;
  readonly timezone: string;
  readonly updateThankYou: (donationId: string, sent: boolean) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState<DonationSort>("dateDesc");
  const [thankYouFilter, setThankYouFilter] = useState<"all" | "pending" | "sent">("all");
  const [paymentSourceFilter, setPaymentSourceFilter] = useState<"all" | "online" | "manual">(
    "all",
  );
  const [togglingThankYouId, setTogglingThankYouId] = useState<string | null>(null);

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
        const donationDate = datePartInTimeZone(new Date(donation.createdAt), timezone);
        return (
          matchesDonationSearch(donation, normalizedQuery) &&
          (!fromDate || donationDate >= fromDate) &&
          (!toDate || donationDate <= toDate) &&
          matchesThankYouFilter(donation.thankYouSentAt, thankYouFilter) &&
          matchesPaymentSourceFilter(donation.paymentMethod, paymentSourceFilter)
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
  }, [donations, fromDate, paymentSourceFilter, query, sort, thankYouFilter, timezone, toDate]);

  async function handleToggleThankYou(donationId: string, sent: boolean): Promise<void> {
    setTogglingThankYouId(donationId);
    try {
      await updateThankYou(donationId, sent);
    } finally {
      setTogglingThankYouId(null);
    }
  }

  if (donationState.status === "loading") return <p>Loading donations…</p>;
  if (donationState.status === "error")
    return <p className="notice notice--error">Donations could not be loaded.</p>;

  return (
    <div className="donation-history">
      <section
        className="ticket-dashboard donation-dashboard"
        aria-labelledby="donation-summary-heading"
      >
        <div className="ticket-dashboard__section-heading">
          <div>
            <h3 id="donation-summary-heading">Donation summary</h3>
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
      </section>
      <section
        className="ticket-dashboard__will-call donation-register"
        aria-labelledby="donation-register-heading"
      >
        <div className="ticket-dashboard__section-heading">
          <div>
            <h3 id="donation-register-heading">Donations register</h3>
            <p>Search donation history, track thank-you letters, and record gifts.</p>
          </div>
          <div className="form-actions">
            <button
              className="button button--primary"
              disabled={busy}
              onClick={onOpenManualModal}
              type="button"
            >
              Record donation
            </button>
            <span className="field-help">{filteredDonations.length} shown</span>
          </div>
        </div>
        <div className="ticket-dashboard__filters donation-dashboard__filters">
          <label className="field">
            Search
            <input
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Donor, email, memo…"
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
            Thank you letter
            <select
              onChange={(event) => {
                const val = event.target.value;
                if (val === "all" || val === "pending" || val === "sent") {
                  setThankYouFilter(val);
                }
              }}
              value={thankYouFilter}
            >
              <option value="all">All</option>
              <option value="pending">Thank you pending</option>
              <option value="sent">Thank you sent</option>
            </select>
          </label>
          <label className="field">
            Payment source
            <select
              onChange={(event) => {
                const val = event.target.value;
                if (val === "all" || val === "online" || val === "manual") {
                  setPaymentSourceFilter(val);
                }
              }}
              value={paymentSourceFilter}
            >
              <option value="all">All payment sources</option>
              <option value="online">Online (Stripe)</option>
              <option value="manual">Manual / Offline</option>
            </select>
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
                  <th>Payment method</th>
                  <th>Tribute</th>
                  <th>Status</th>
                  <th>Thank-you letter</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredDonations.map((donation) => (
                  <tr key={donation.id}>
                    <td>
                      {donation.anonymous ? "Anonymous" : donation.buyerName}
                      {donation.buyerEmail ? (
                        <>
                          <br />
                          <small>{donation.anonymous ? "" : donation.buyerEmail}</small>
                        </>
                      ) : null}
                      {donation.paymentReference ? (
                        <>
                          <br />
                          <small className="field-help">{donation.paymentReference}</small>
                        </>
                      ) : null}
                    </td>
                    <td>{money(donation.amountCents)}</td>
                    <td>{paymentMethodLabel(donation.paymentMethod)}</td>
                    <td>
                      {tributeLabel(donation.tributeType)}
                      {donation.tributeName ? `: ${donation.tributeName}` : ""}
                    </td>
                    <td>{donation.status}</td>
                    <td>
                      <div className="thank-you-status-cell">
                        {donation.thankYouSentAt ? (
                          <>
                            <span className="badge badge--success">
                              Sent {new Date(donation.thankYouSentAt).toLocaleDateString()}
                            </span>
                            <button
                              className="text-button"
                              disabled={busy || togglingThankYouId === donation.id}
                              onClick={() => void handleToggleThankYou(donation.id, false)}
                              type="button"
                            >
                              Undo
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="badge badge--muted">Pending</span>
                            <button
                              className="text-button"
                              disabled={busy || togglingThankYouId === donation.id}
                              onClick={() => void handleToggleThankYou(donation.id, true)}
                              type="button"
                            >
                              Mark sent
                            </button>
                          </>
                        )}
                      </div>
                    </td>
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
      </section>
      <details className="donation-patrons">
        <summary>
          Patron summaries ({patronState.status === "ready" ? patronState.patrons.length : "…"})
        </summary>
        <PatronsTab patronState={patronState} />
      </details>
    </div>
  );
}
