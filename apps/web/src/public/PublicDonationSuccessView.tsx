import type { DonationRecord } from "@choir/contracts";
import { useEffect, useState } from "react";

import { getPublicDonationReceipt } from "../auth/api";

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD" }).format(cents / 100);
}

function statusText(status: DonationRecord["status"]): string {
  if (status === "pending") return "Payment processing";
  if (status === "paid") return "Paid";
  if (status === "expired") return "Checkout expired — no payment was taken";
  return "Refunded";
}

export function PublicDonationSuccessView() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [donation, setDonation] = useState<DonationRecord | null>(null);
  const [error, setError] = useState(() => !token);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    getPublicDonationReceipt(token, controller.signal)
      .then((receipt) => {
        setDonation(receipt);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
        }
      });
    return () => {
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

  return (
    <section className="public-section public-section--narrow">
      <h1>{donation?.status === "paid" ? "Thank you for your gift!" : "Donation status"}</h1>
      {!donation ? <p role="status">Loading your receipt…</p> : null}
      {donation ? (
        <>
          <p className="notice notice--success">{statusText(donation.status)}</p>
          <div className="panel">
            <h2>{money(donation.amountCents)}</h2>
            <p>
              Donor: <strong>{donation.anonymous ? "Anonymous" : donation.buyerName}</strong>
            </p>
            <p>
              Email: <strong>{donation.buyerEmail}</strong>
            </p>
            {donation.tributeType !== "none" ? (
              <p>
                Tribute: <strong>{donation.tributeType}</strong>
                {donation.tributeName ? ` · ${donation.tributeName}` : ""}
              </p>
            ) : null}
            <p>A receipt will be sent to this email after payment confirmation.</p>
          </div>
        </>
      ) : null}
      <a className="button button--secondary" href="/">
        Return home
      </a>
    </section>
  );
}
