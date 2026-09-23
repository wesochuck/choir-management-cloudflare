import type { DonationRecord } from "@choir/contracts";
import { useEffect, useState } from "react";

import { getPublicDonationReceipt, getPublicDonationSettings } from "../api";
import { formatDonationMoney } from "./donationFormat";

const DEFAULT_THANK_YOU_MESSAGE =
  "Your support helps us continue our programs and share our music with the community.";
const DONATION_RECEIPT_POLL_INTERVAL_MS = 2_000;
const DONATION_RECEIPT_POLL_TIMEOUT_MS = 45_000;

function statusHeading(status: DonationRecord["status"]): string {
  if (status === "paid") return "Thank you for your gift!";
  if (status === "pending") return "We're confirming your donation";
  if (status === "refunded") return "Donation refunded";
  return "Donation not completed";
}

function statusLabel(status: DonationRecord["status"]): string {
  if (status === "paid") return "Donation complete";
  if (status === "pending") return "Payment processing";
  if (status === "refunded") return "Refunded";
  return "Checkout expired";
}

function totalLabel(status: DonationRecord["status"]): string {
  if (status === "pending") return "Expected total";
  if (status === "refunded") return "Original total charged";
  return "Total charged";
}

function donationDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function DonationReceiptHero({
  donation,
  pollingTimedOut,
  thankYouMessage,
}: {
  readonly donation: DonationRecord;
  readonly pollingTimedOut: boolean;
  readonly thankYouMessage: string;
}) {
  return (
    <div className="public-donation-receipt__hero" aria-live="polite">
      {donation.status === "paid" ? (
        <span className="public-donation-receipt__mark" aria-hidden="true">
          <svg viewBox="0 0 48 48" focusable="false">
            <circle cx="24" cy="24" r="22" />
            <path d="m14 24 7 7 14-15" />
          </svg>
        </span>
      ) : null}
      <h1>{statusHeading(donation.status)}</h1>
      <p
        className={`public-donation-receipt__status public-donation-receipt__status--${donation.status}`}
      >
        {statusLabel(donation.status)}
      </p>
      {donation.status === "paid" ? (
        <>
          <p className="public-donation-receipt__amount-label">Your gift</p>
          <p className="public-donation-receipt__amount">
            {formatDonationMoney(donation.amountCents)}
          </p>
          <p className="public-donation-receipt__thank-you">{thankYouMessage}</p>
        </>
      ) : donation.status === "pending" ? (
        <p className="public-donation-receipt__message">
          {pollingTimedOut ? (
            <>
              Payment is taking longer than usual. You can leave this page; we’ll email a receipt to{" "}
              <strong>{donation.buyerEmail}</strong> when processing completes.
            </>
          ) : (
            "Your payment is still processing. Keep this page open while we confirm it."
          )}
        </p>
      ) : donation.status === "refunded" ? (
        <p className="public-donation-receipt__message">This donation has been refunded.</p>
      ) : (
        <p className="public-donation-receipt__message">
          The checkout expired and no payment was taken.
        </p>
      )}
    </div>
  );
}

function DonationSummary({ donation }: { readonly donation: DonationRecord }) {
  const totalCents = donation.amountCents + donation.feeCents;
  return (
    <section
      className="panel public-donation-receipt__card"
      aria-labelledby="donation-gift-summary"
    >
      <h2 id="donation-gift-summary">Gift summary</h2>
      <dl className="public-donation-receipt__rows">
        <div>
          <dt>Donation amount</dt>
          <dd>{formatDonationMoney(donation.amountCents)}</dd>
        </div>
        {donation.feeCents > 0 ? (
          <div>
            <dt>Processing fee</dt>
            <dd>{formatDonationMoney(donation.feeCents)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Gift date</dt>
          <dd>{donationDate(donation.createdAt)}</dd>
        </div>
        {donation.status !== "expired" ? (
          <div className="public-donation-receipt__total">
            <dt>{totalLabel(donation.status)}</dt>
            <dd>{formatDonationMoney(totalCents)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function DonationDetails({ donation }: { readonly donation: DonationRecord }) {
  const hasTribute = donation.tributeType === "honor" || donation.tributeType === "memory";
  return (
    <section
      className="panel public-donation-receipt__card"
      aria-labelledby="donation-gift-details"
    >
      <h2 id="donation-gift-details">Gift details</h2>
      <dl className="public-donation-receipt__rows">
        <div>
          <dt>Donor</dt>
          <dd>{donation.buyerName}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{donation.buyerEmail}</dd>
        </div>
        {hasTribute ? (
          <div>
            <dt>Tribute</dt>
            <dd>
              {donation.tributeType === "honor" ? "In honor of" : "In memory of"}
              {donation.tributeName ? ` ${donation.tributeName}` : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      {donation.anonymous ? (
        <p className="public-donation-receipt__anonymous">
          Your name will be hidden from public donor recognition.
        </p>
      ) : null}
    </section>
  );
}

export function PublicDonationSuccessView() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [donation, setDonation] = useState<DonationRecord | null>(null);
  const [error, setError] = useState(() => !token);
  const [pollingTimedOut, setPollingTimedOut] = useState(false);
  const [thankYouMessage, setThankYouMessage] = useState(DEFAULT_THANK_YOU_MESSAGE);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const deadline = Date.now() + DONATION_RECEIPT_POLL_TIMEOUT_MS;
    const polling: {
      deadlineTimeout: number | null;
      receiptLoaded: boolean;
      stopped: boolean;
      timeout: number | null;
    } = {
      deadlineTimeout: null,
      receiptLoaded: false,
      stopped: false,
      timeout: null,
    };

    function stopPolling(): void {
      polling.stopped = true;
      if (polling.timeout !== null) window.clearTimeout(polling.timeout);
      if (polling.deadlineTimeout !== null) window.clearTimeout(polling.deadlineTimeout);
    }

    function pollingIsActive(): boolean {
      return !polling.stopped && !controller.signal.aborted;
    }

    polling.deadlineTimeout = window.setTimeout(() => {
      if (polling.stopped) return;
      polling.stopped = true;
      if (polling.receiptLoaded) {
        setPollingTimedOut(true);
      } else {
        setError(true);
      }
      controller.abort();
    }, DONATION_RECEIPT_POLL_TIMEOUT_MS);

    function scheduleNextPoll(): void {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        setPollingTimedOut(true);
        stopPolling();
        return;
      }
      polling.timeout = window.setTimeout(
        () => void loadReceipt(),
        Math.min(DONATION_RECEIPT_POLL_INTERVAL_MS, remaining),
      );
    }

    async function loadReceipt(): Promise<void> {
      if (!pollingIsActive()) return;
      try {
        const receipt = await getPublicDonationReceipt(token, controller.signal);
        if (!pollingIsActive()) return;
        polling.receiptLoaded = true;
        setError(false);
        setDonation(receipt);
        if (receipt.status !== "pending") {
          stopPolling();
          return;
        }
        scheduleNextPoll();
      } catch {
        if (!pollingIsActive()) return;
        if (!polling.receiptLoaded) {
          setError(true);
          stopPolling();
          return;
        }
        scheduleNextPoll();
      }
    }

    void loadReceipt();
    void getPublicDonationSettings(controller.signal)
      .then((settings) => {
        if (!controller.signal.aborted && settings.thankYouMessage?.trim()) {
          setThankYouMessage(settings.thankYouMessage.trim());
        }
      })
      .catch(() => {
        // The receipt remains usable if Organization settings are temporarily unavailable.
      });

    return () => {
      stopPolling();
      controller.abort();
    };
  }, [token]);

  if (error) {
    return (
      <section className="public-section public-section--narrow">
        <h1>Receipt unavailable</h1>
        <p className="notice notice--error">This donation receipt link is no longer available.</p>
        <a className="button button--secondary" href="/">
          Return home
        </a>
      </section>
    );
  }

  if (!donation) {
    return (
      <section className="public-section public-section--narrow">
        <h1>Your donation</h1>
        <p role="status">Loading your receipt…</p>
      </section>
    );
  }

  return (
    <section
      className={`public-section public-section--narrow public-donation-receipt public-donation-receipt--${donation.status}`}
    >
      <DonationReceiptHero
        donation={donation}
        pollingTimedOut={pollingTimedOut}
        thankYouMessage={thankYouMessage}
      />

      <div className="public-donation-receipt__details-grid">
        <DonationSummary donation={donation} />
        <DonationDetails donation={donation} />
      </div>

      {donation.status === "paid" ? (
        <p className="public-donation-receipt__receipt-note" role="status">
          We’ll email a donation receipt to <strong>{donation.buyerEmail}</strong>.
        </p>
      ) : null}
      <a className="button button--secondary" href="/">
        Return home
      </a>
    </section>
  );
}
