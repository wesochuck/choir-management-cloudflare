import { canSetDonationThankYouStatus, datePartInTimeZone } from "@choir/domain";
import type { DonationRecord } from "@choir/contracts";
import { DataTable, type DataTableColumn } from "@choir/ui";
import { useCallback, useMemo, useState } from "react";

import {
  EMPTY_DONATIONS,
  canRefundDonation,
  donationStatusDisplay,
  donationsCsv,
  money,
  tributeLabel,
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
      return "Other";
    default:
      return "Online (Stripe)";
  }
}

function matchesDonationSearch(donation: (typeof EMPTY_DONATIONS)[number], query: string): boolean {
  if (!query) return true;
  return (
    donation.buyerName.toLocaleLowerCase().includes(query) ||
    donation.buyerEmail.toLocaleLowerCase().includes(query) ||
    donation.paymentReference.toLocaleLowerCase().includes(query) ||
    donation.tributeName.toLocaleLowerCase().includes(query)
  );
}

function canMarkThankYouSent(donation: Pick<DonationRecord, "status">): boolean {
  return canSetDonationThankYouStatus(donation.status, true);
}

function matchesThankYouFilter(
  donation: Pick<DonationRecord, "status" | "thankYouSentAt">,
  filter: "all" | "pending" | "sent",
): boolean {
  if (filter === "all") return true;
  if (filter === "sent") return Boolean(donation.thankYouSentAt);
  return canMarkThankYouSent(donation) && !donation.thankYouSentAt;
}

function thankYouState(
  donation: Pick<DonationRecord, "status" | "thankYouSentAt">,
): "not-applicable" | "pending" | "sent" {
  if (donation.thankYouSentAt) return "sent";
  return canMarkThankYouSent(donation) ? "pending" : "not-applicable";
}

function matchesPaymentSourceFilter(
  paymentMethod: string | undefined,
  filter: "all" | "online" | "manual",
): boolean {
  if (filter === "all") return true;
  const isManual =
    paymentMethod === "check" ||
    paymentMethod === "cash" ||
    paymentMethod === "bank_transfer" ||
    paymentMethod === "card_offline" ||
    paymentMethod === "other";
  return filter === "manual" ? isManual : !isManual;
}

export function DonationHistoryTab({
  busy,
  donationState,
  onOpenManualModal,
  onRefresh,
  patronState,
  refreshing,
  refund,
  refundId,
  setRefundId,
  timezone,
  updateThankYou,
}: {
  readonly busy: boolean;
  readonly donationState: DonationState;
  readonly onOpenManualModal: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly patronState: PatronState;
  readonly refreshing: boolean;
  readonly refund: (id: string) => Promise<void>;
  readonly refundId: string | null;
  readonly setRefundId: (id: string | null) => void;
  readonly timezone: string;
  readonly updateThankYou: (donationId: string, sent: boolean) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showRefunded, setShowRefunded] = useState(false);
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

  const matchingDonations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return donations.filter((donation) => {
      const donationDate = datePartInTimeZone(new Date(donation.createdAt), timezone);
      return (
        matchesDonationSearch(donation, normalizedQuery) &&
        (!fromDate || donationDate >= fromDate) &&
        (!toDate || donationDate <= toDate) &&
        matchesThankYouFilter(donation, thankYouFilter) &&
        matchesPaymentSourceFilter(donation.paymentMethod, paymentSourceFilter)
      );
    });
  }, [donations, fromDate, paymentSourceFilter, query, thankYouFilter, timezone, toDate]);
  const filteredDonations = useMemo(
    () =>
      showRefunded
        ? matchingDonations
        : matchingDonations.filter((donation) => donation.status !== "refunded"),
    [matchingDonations, showRefunded],
  );

  const handleToggleThankYou = useCallback(
    async (donationId: string, sent: boolean) => {
      setTogglingThankYouId(donationId);
      try {
        await updateThankYou(donationId, sent);
      } finally {
        setTogglingThankYouId(null);
      }
    },
    [updateThankYou],
  );

  const donationColumns = useMemo<readonly DataTableColumn<DonationRecord>[]>(
    () => [
      {
        header: "Donor",
        id: "donor",
        render: (donation) => (
          <div className="donation-register__donor">
            <strong>{donation.anonymous ? "Anonymous" : donation.buyerName}</strong>
            {!donation.anonymous && donation.buyerEmail ? (
              <span className="field-help">{donation.buyerEmail}</span>
            ) : null}
            {donation.paymentReference ? (
              <span className="field-help">{donation.paymentReference}</span>
            ) : null}
          </div>
        ),
        sortValue: (donation) => (donation.anonymous ? "Anonymous" : donation.buyerName),
      },
      {
        header: "Amount",
        id: "amount",
        render: (donation) => money(donation.amountCents),
        sortValue: (donation) => donation.amountCents,
      },
      {
        header: "Payment method",
        id: "paymentMethod",
        mobileLabel: "Payment",
        render: (donation) => paymentMethodLabel(donation.paymentMethod),
        sortValue: (donation) => paymentMethodLabel(donation.paymentMethod),
      },
      {
        header: "Tribute",
        id: "tribute",
        render: (donation) =>
          `${tributeLabel(donation.tributeType)}${donation.tributeName ? `: ${donation.tributeName}` : ""}`,
        sortValue: (donation) =>
          `${tributeLabel(donation.tributeType)}${donation.tributeName ? `: ${donation.tributeName}` : ""}`,
      },
      {
        header: "Status",
        id: "status",
        render: (donation) => {
          const statusDisplay = donationStatusDisplay(donation);
          return <span className={statusDisplay.badgeClass}>{statusDisplay.label}</span>;
        },
        sortValue: (donation) => donationStatusDisplay(donation).label,
      },
      {
        header: "Thank-you letter",
        id: "thankYou",
        mobileLabel: "Thank-you",
        render: (donation) => {
          const status = thankYouState(donation);
          return (
            <div className="thank-you-status-cell">
              {status === "sent" && donation.thankYouSentAt ? (
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
              ) : status === "pending" ? (
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
              ) : (
                <span className="badge badge--muted">Not applicable</span>
              )}
            </div>
          );
        },
        sortValue: (donation) => {
          const status = thankYouState(donation);
          return status === "sent" ? `sent:${donation.thankYouSentAt ?? ""}` : status;
        },
      },
      {
        header: "Date",
        id: "date",
        render: (donation) => new Date(donation.createdAt).toLocaleDateString(),
        sortValue: (donation) => donation.createdAt,
      },
      {
        header: "Actions",
        id: "actions",
        render: (donation) =>
          refundId === donation.id ? (
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
          ) : donation.status === "paid" && canRefundDonation(donation) ? (
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
          ) : null,
      },
    ],
    [busy, handleToggleThankYou, refund, refundId, setRefundId, togglingThankYouId],
  );

  if (donationState.status === "loading") return <p>Loading donations…</p>;
  if (donationState.status === "error")
    return <p className="notice notice--error">Donations could not be loaded.</p>;

  const donationExportHref = `data:text/csv;charset=utf-8,${encodeURIComponent(donationsCsv(donationState.donations))}`;

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
            <p>Search donation history, track thank-you letters, and record gifts.</p>
          </div>
          <div className="form-actions">
            <button
              className="button button--secondary"
              disabled={busy || refreshing}
              onClick={() => void onRefresh()}
              type="button"
            >
              {refreshing ? "Refreshing…" : "Refresh status"}
            </button>
            <a
              className="button button--secondary"
              download="donations.csv"
              href={donationExportHref}
            >
              Export CSV
            </a>
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
        </div>
        <label className="checkbox-row">
          <input
            checked={showRefunded}
            onChange={(event) => {
              setShowRefunded(event.target.checked);
            }}
            type="checkbox"
          />
          Show refunded
        </label>
        <DataTable
          columns={donationColumns}
          emptyMessage={
            donations.length === 0
              ? "No donations recorded yet."
              : matchingDonations.length > 0 && filteredDonations.length === 0
                ? "All donations matching these filters are refunded."
                : "No donations match these filters."
          }
          initialSort={{ columnId: "date", direction: "desc" }}
          keySelector={(donation) => donation.id}
          rows={filteredDonations}
        />
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
