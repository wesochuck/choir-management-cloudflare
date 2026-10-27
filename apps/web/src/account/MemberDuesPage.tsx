import { transactionProcessingFeeCents } from "@choir/domain";
import { useEffect, useMemo, useRef, useState } from "react";

import { AuthApiError, createMyDuesCheckout, getMyDues } from "../auth/api";
import type { DuesRecord, Season, TransactionFeeSettings } from "@choir/contracts";

import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";

type DuesState =
  | { readonly status: "error" | "loading" }
  | {
      readonly dues: readonly DuesRecord[];
      readonly onlineDuesPaymentsAvailable: boolean;
      readonly seasons: readonly Season[];
      readonly status: "ready";
      readonly transactionFeeSettings: TransactionFeeSettings;
    };
type DuesReadyState = Extract<DuesState, { readonly status: "ready" }>;

function isReadyDuesState(state: DuesState): state is DuesReadyState {
  return state.status === "ready";
}

const currencyFormatter = new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" });
const seasonDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function money(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

function seasonDate(season: Season): string {
  return seasonDateFormatter.format(new Date(season.startsAt));
}

function statusLabel(record: DuesRecord | undefined): string {
  if (!record) return "Not paid";
  if (record.status === "paid") {
    return record.paymentMethod === "cash" ? "Paid in full · Cash" : "Paid in full";
  }
  if (record.status === "refunded") return "Refunded";
  if (record.status === "expired") return "Checkout expired";
  return "Payment processing";
}

interface MemberDuesRowProps {
  readonly season: Season;
  readonly record: DuesRecord | undefined;
  readonly transactionFeeSettings: TransactionFeeSettings;
  readonly onlineDuesPaymentsAvailable: boolean;
  readonly isBusy: boolean;
  readonly anyBusy: boolean;
  readonly onPay: (season: Season) => void;
}

function MemberDuesRow({
  season,
  record,
  transactionFeeSettings,
  onlineDuesPaymentsAvailable,
  isBusy,
  anyBusy,
  onPay,
}: MemberDuesRowProps) {
  const amountCents = record?.amountCents ?? season.duesAmountCents;
  const feeCents =
    record?.feeCents ?? transactionProcessingFeeCents(amountCents, transactionFeeSettings);
  const totalCents = amountCents + feeCents;
  const status = record?.status ?? "pending";
  const isPaid = status === "paid";
  const canPay = (!record || status === "expired") && onlineDuesPaymentsAvailable;

  return (
    <article
      className={`member-dues-row${isPaid ? " member-dues-row--paid" : ""}`}
      key={season.id}
      role="listitem"
    >
      <div>
        <h3>{season.name}</h3>
        <p>Season starts {seasonDate(season)}</p>
      </div>
      <dl className="member-dues-row__amounts">
        {isPaid ? (
          <div>
            <dt>Amount due</dt>
            <dd className="member-dues-row__balance">{money(0)}</dd>
          </div>
        ) : (
          <>
            <div>
              <dt>Dues</dt>
              <dd>{money(amountCents)}</dd>
            </div>
            <div>
              <dt>Processing fee</dt>
              <dd>{money(feeCents)}</dd>
            </div>
            <div>
              <dt>Total due</dt>
              <dd>{money(totalCents)}</dd>
            </div>
          </>
        )}
      </dl>
      <div className="member-dues-row__action">
        <span
          className={isPaid ? "member-dues-row__paid-status" : `status-pill status-pill--${status}`}
        >
          {statusLabel(record)}
        </span>
        {canPay ? (
          <button
            className="button button--primary"
            disabled={anyBusy}
            onClick={() => {
              onPay(season);
            }}
            type="button"
          >
            {isBusy ? "Opening Stripe…" : "Pay dues"}
          </button>
        ) : null}
      </div>
      {isPaid ? (
        <p className="member-dues-row__receipt">
          Payment received: {money(totalCents)}. You’re all paid up for this season.
        </p>
      ) : null}
    </article>
  );
}

function initialCheckoutNotice(): string | null {
  const checkout = new URLSearchParams(window.location.search).get("checkout");
  if (checkout === "success") return "Payment submitted. Your dues status will update shortly.";
  if (checkout === "cancelled") return "Checkout was cancelled. No payment was taken.";
  return null;
}

function checkoutErrorMessage(error: unknown): string {
  if (error instanceof AuthApiError) return error.message;
  return "Online dues checkout could not be started. Please try again.";
}

function MemberDuesAccessGate({
  accessStatus,
  enabled,
  mfaRequired,
  stateStatus,
}: {
  readonly accessStatus: "error" | "loading" | "none" | "platform-scoped" | "ready" | undefined;
  readonly enabled: boolean;
  readonly mfaRequired: boolean;
  readonly stateStatus: DuesState["status"];
}) {
  if (mfaRequired) {
    return <OrganizationMfaPrompt message="Verify Organization MFA to view your dues." />;
  }
  if (accessStatus === "loading") {
    return (
      <p className="notice" role="status">
        Loading your member workspace…
      </p>
    );
  }
  if (accessStatus === "none" || !enabled) {
    return (
      <p className="notice notice--warning" role="status">
        Your member workspace is not available yet.
      </p>
    );
  }
  if (accessStatus === "error" || stateStatus === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Season dues could not be loaded. Please try again later.
      </p>
    );
  }
  return (
    <p className="notice" role="status">
      Loading your member workspace…
    </p>
  );
}

function DuesNoticeBanner({
  message,
  onlineDuesPaymentsAvailable,
  hasSeasons,
}: {
  readonly message: string | null;
  readonly onlineDuesPaymentsAvailable: boolean;
  readonly hasSeasons: boolean;
}) {
  return (
    <>
      {message ? (
        <p
          className={`notice ${message.startsWith("Payment submitted") ? "notice--success" : "notice--error"}`}
          role={message.startsWith("Payment submitted") ? "status" : "alert"}
        >
          {message}
        </p>
      ) : null}
      {!onlineDuesPaymentsAvailable && hasSeasons ? (
        <p className="notice notice--info" role="status">
          Online dues payments are currently unavailable. Contact your Organization about another
          way to pay.
        </p>
      ) : null}
    </>
  );
}

export function MemberDuesPage({
  accessStatus = "ready",
  enabled,
  mfaRequired = false,
}: {
  readonly accessStatus?: "error" | "loading" | "none" | "platform-scoped" | "ready" | undefined;
  readonly enabled: boolean;
  readonly mfaRequired?: boolean | undefined;
}) {
  const [state, setState] = useState<DuesState>({ status: "loading" });
  const [busySeasonId, setBusySeasonId] = useState<string | null>(null);
  const checkoutRequestIds = useRef(new Map<string, string>());
  const [message, setMessage] = useState<string | null>(initialCheckoutNotice);

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

  const duesBySeason = useMemo(() => {
    const records = new Map<string, DuesRecord>();
    if (state.status === "ready") {
      for (const record of state.dues) {
        // Preserve the first matching record, as the previous Array.find did.
        if (!records.has(record.seasonId)) records.set(record.seasonId, record);
      }
    }
    return records;
  }, [state]);

  async function pay(season: Season): Promise<void> {
    if (busySeasonId) return;
    setBusySeasonId(season.id);
    setMessage(null);
    try {
      const checkoutRequestId = checkoutRequestIds.current.get(season.id) ?? crypto.randomUUID();
      checkoutRequestIds.current.set(season.id, checkoutRequestId);
      const checkout = await createMyDuesCheckout(season.id, checkoutRequestId);
      window.location.assign(checkout.url);
    } catch (error: unknown) {
      setMessage(checkoutErrorMessage(error));
      setBusySeasonId(null);
    }
  }

  if (mfaRequired || accessStatus !== "ready" || !enabled || !isReadyDuesState(state)) {
    return (
      <MemberDuesAccessGate
        accessStatus={accessStatus}
        enabled={enabled}
        mfaRequired={mfaRequired}
        stateStatus={state.status}
      />
    );
  }

  const readyState = state;

  return (
    <section className="account-section member-dues-page" aria-label="Season dues">
      <DuesNoticeBanner
        hasSeasons={activeSeasons.length > 0}
        message={message}
        onlineDuesPaymentsAvailable={readyState.onlineDuesPaymentsAvailable}
      />
      {activeSeasons.length === 0 ? (
        <p className="empty-state">Your Organization has not configured any seasons yet.</p>
      ) : (
        <div className="member-dues-list" role="list">
          {activeSeasons.map((season) => (
            <MemberDuesRow
              anyBusy={busySeasonId !== null}
              isBusy={busySeasonId === season.id}
              key={season.id}
              onlineDuesPaymentsAvailable={readyState.onlineDuesPaymentsAvailable}
              onPay={(s) => {
                void pay(s);
              }}
              record={duesBySeason.get(season.id)}
              season={season}
              transactionFeeSettings={readyState.transactionFeeSettings}
            />
          ))}
        </div>
      )}
      <p className="member-dues-page__note">
        The processing fee is shown separately and is added to the dues total so your Organization
        receives the full dues amount.
      </p>
    </section>
  );
}
