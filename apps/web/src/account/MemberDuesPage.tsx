import { transactionProcessingFeeCents } from "@choir/domain";
import { useEffect, useMemo, useState } from "react";

import { AuthApiError, createMyDuesCheckout, getMyDues } from "../auth/api";
import type { DuesRecord, Season, TransactionFeeSettings } from "@choir/contracts";

type DuesState =
  | { readonly status: "error" | "loading" }
  | {
      readonly dues: readonly DuesRecord[];
      readonly seasons: readonly Season[];
      readonly status: "ready";
      readonly transactionFeeSettings: TransactionFeeSettings;
    };
type DuesReadyState = Extract<DuesState, { readonly status: "ready" }>;

function isReadyDuesState(state: DuesState): state is DuesReadyState {
  return state.status === "ready";
}

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

function seasonDate(season: Season): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(season.startsAt),
  );
}

function statusLabel(record: DuesRecord | undefined): string {
  if (!record) return "Not paid";
  if (record.status === "paid") return "Paid";
  if (record.status === "refunded") return "Refunded";
  return "Payment processing";
}

export function MemberDuesPage({ enabled }: { readonly enabled: boolean }) {
  const [state, setState] = useState<DuesState>({ status: "loading" });
  const [busySeasonId, setBusySeasonId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(() => {
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (checkout === "success") return "Payment submitted. Your dues status will update shortly.";
    if (checkout === "cancelled") return "Checkout was cancelled. No payment was taken.";
    return null;
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getMyDues(controller.signal)
      .then((result) => {
        setState({ ...result, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  const activeSeasons = useMemo(
    () =>
      state.status === "ready"
        ? [...state.seasons].sort(
            (left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime(),
          )
        : [],
    [state],
  );

  async function pay(season: Season): Promise<void> {
    if (busySeasonId) return;
    setBusySeasonId(season.id);
    setMessage(null);
    try {
      const checkout = await createMyDuesCheckout(season.id);
      window.location.assign(checkout.url);
    } catch (error: unknown) {
      setMessage(
        error instanceof AuthApiError
          ? error.message
          : "Online dues checkout could not be started. Please try again.",
      );
      setBusySeasonId(null);
    }
  }

  if (!enabled) {
    return <p className="notice notice--warning">Your member workspace is not available yet.</p>;
  }
  if (state.status === "loading") return <p className="notice">Loading season dues…</p>;
  if (state.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Season dues could not be loaded. Please try again later.
      </p>
    );
  }
  if (!isReadyDuesState(state)) return null;
  const readyState = state;

  return (
    <section className="account-section member-dues-page" aria-labelledby="member-dues-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Your choir</p>
        <h2 id="member-dues-title">Season dues</h2>
        <p>Review what you owe and pay securely with Stripe.</p>
      </div>
      {message ? (
        <p
          className={`notice ${message.startsWith("Payment submitted") ? "notice--success" : "notice--error"}`}
          role="status"
        >
          {message}
        </p>
      ) : null}
      {activeSeasons.length === 0 ? (
        <p className="empty-state">Your Organization has not configured any seasons yet.</p>
      ) : (
        <div className="member-dues-list" role="list">
          {activeSeasons.map((season) => {
            const record = readyState.dues.find(({ seasonId }) => seasonId === season.id);
            const amountCents = record?.amountCents ?? season.duesAmountCents;
            const feeCents =
              record?.feeCents ??
              transactionProcessingFeeCents(amountCents, readyState.transactionFeeSettings);
            const totalCents = amountCents + feeCents;
            const canPay = !record;
            return (
              <article className="member-dues-row" key={season.id} role="listitem">
                <div>
                  <h3>{season.name}</h3>
                  <p>Season starts {seasonDate(season)}</p>
                </div>
                <dl className="member-dues-row__amounts">
                  <div>
                    <dt>Dues</dt>
                    <dd>{money(amountCents)}</dd>
                  </div>
                  <div>
                    <dt>Processing fee</dt>
                    <dd>{money(feeCents)}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>{money(totalCents)}</dd>
                  </div>
                </dl>
                <div className="member-dues-row__action">
                  <span className={`status-pill status-pill--${record?.status ?? "pending"}`}>
                    {statusLabel(record)}
                  </span>
                  {canPay ? (
                    <button
                      className="button button--primary"
                      disabled={busySeasonId !== null}
                      onClick={() => void pay(season)}
                      type="button"
                    >
                      {busySeasonId === season.id ? "Opening Stripe…" : "Pay dues"}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="member-dues-page__note">
        The processing fee is shown separately and is added to the dues total so your Organization
        receives the full dues amount.
      </p>
    </section>
  );
}
