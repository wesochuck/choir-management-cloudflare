import type {
  PublishedOrganizationProjection,
  PublicTicketReceipt,
  TransactionFeeSettings,
} from "@choir/contracts";
import { ticketProcessingFeeCents, ticketUnitPriceCents } from "@choir/domain";
import { useEffect, useState, type SyntheticEvent } from "react";

import {
  createPublicTicketCheckout,
  getPublicTransactionFeeSettings,
  getPublicTicketPurchase,
  getPublishedOrganizationProjection,
} from "../auth/api";
import { OrganizationLayout } from "./PublicOrganizationSite";

type LoadState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly feeSettings: TransactionFeeSettings;
      readonly projection: PublishedOrganizationProjection;
      readonly status: "ready";
    };

const DEFAULT_TRANSACTION_FEE_SETTINGS: TransactionFeeSettings = {
  fixedCents: 30,
  passFeeToDonor: false,
  percentage: 2.9,
};

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

function publicDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function TicketReceipt({ token }: { readonly token: string }) {
  const [purchase, setPurchase] = useState<PublicTicketReceipt | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    getPublicTicketPurchase(token, controller.signal)
      .then(setPurchase)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, [token]);
  if (failed || !token)
    return <p className="notice notice--error">This ticket receipt is unavailable.</p>;
  if (!purchase) return <p className="notice notice--info">Loading ticket receipt…</p>;
  return (
    <section className="public-section public-section--narrow">
      <p className="eyebrow">Order complete</p>
      <h1>Your tickets are confirmed</h1>
      {purchase.checkoutMode === "fake" ? (
        <p className="notice notice--warning">Staging simulation: no payment card was charged.</p>
      ) : null}
      <div className="panel">
        <h2>{purchase.bundleId ? purchase.bundleTitle : purchase.eventTitle}</h2>
        {purchase.bundleId ? (
          <ul>
            {purchase.includedEvents.map((event) => (
              <li key={event.id}>
                {event.title} · {publicDate(event.startsAt, purchase.timezone)}
              </li>
            ))}
          </ul>
        ) : (
          <p>{publicDate(purchase.eventStartsAt, purchase.timezone)}</p>
        )}
        <p>
          Will call name: <strong>{purchase.buyerName}</strong>
        </p>
        <p>
          Quantity: <strong>{purchase.quantity}</strong>
        </p>
        <p>
          Total: <strong>{money(purchase.amountPaidCents)}</strong>
        </p>
        <details>
          <summary>Door credential</summary>
          <p>Keep this credential private and present it to the ticket desk.</p>
          <code className="ticket-credential">{purchase.scanToken}</code>
        </details>
      </div>
      <a className="button button--secondary" href="/tickets">
        Return to tickets
      </a>
    </section>
  );
}

function TicketPurchaseForm({
  event,
  feeSettings,
  nowMs,
  projection,
}: {
  readonly event: PublishedOrganizationProjection["payload"]["performances"][number];
  readonly feeSettings: TransactionFeeSettings;
  readonly nowMs: number;
  readonly projection: PublishedOrganizationProjection;
}) {
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [checkoutRequestId] = useState(() => crypto.randomUUID());
  const [confirmEmail, setConfirmEmail] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unitPriceCents = ticketUnitPriceCents({
    advancePriceCents: event.advancePriceCents,
    dayOfPriceCents: event.dayOfPriceCents,
    now: new Date(nowMs),
    startsAt: event.startsAt,
    timezone: projection.payload.timezone,
  });
  const feeCents = ticketProcessingFeeCents(unitPriceCents, quantity, feeSettings);
  const totalCents = unitPriceCents * quantity + feeCents;

  async function submit(formEvent: SyntheticEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (buyerEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      setError("Email addresses must match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createPublicTicketCheckout({
        buyerEmail: buyerEmail.trim(),
        buyerName: buyerName.trim(),
        checkoutRequestId,
        eventId: event.id,
        marketingOptIn,
        quantity,
      });
      window.location.assign(result.url);
    } catch (failure: unknown) {
      setError(
        failure instanceof Error ? failure.message : "The ticket order could not be completed.",
      );
      setBusy(false);
    }
  }

  return (
    <section className="public-section public-section--narrow">
      <a href="/tickets">← All tickets</a>
      <h1>{event.title}</h1>
      <p>{publicDate(event.startsAt, projection.payload.timezone)}</p>
      {event.venueName || event.location ? <p>{event.venueName || event.location}</p> : null}
      {event.doorsOpenTime ? <p>Doors open at {event.doorsOpenTime}.</p> : null}
      <form className="panel form-stack" onSubmit={(formEvent) => void submit(formEvent)}>
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="field">
          Name for will call
          <input
            required
            maxLength={200}
            value={buyerName}
            onChange={(e) => {
              setBuyerName(e.target.value);
            }}
          />
        </label>
        <label className="field">
          Email
          <input
            required
            type="email"
            value={buyerEmail}
            onChange={(e) => {
              setBuyerEmail(e.target.value);
            }}
          />
        </label>
        <label className="field">
          Confirm email
          <input
            required
            type="email"
            value={confirmEmail}
            onChange={(e) => {
              setConfirmEmail(e.target.value);
            }}
          />
        </label>
        <label className="field">
          Quantity
          <input
            min="1"
            max="10"
            step="1"
            type="number"
            value={quantity}
            onChange={(e) => {
              setQuantity(Number(e.target.value));
            }}
          />
        </label>
        <label>
          <input
            checked={marketingOptIn}
            type="checkbox"
            onChange={(e) => {
              setMarketingOptIn(e.target.checked);
            }}
          />{" "}
          Keep me informed about future Organization events
        </label>
        <div>
          <p>Tickets: {money(unitPriceCents * quantity)}</p>
          <p>Processing fee: {money(feeCents)}</p>
          <p>
            <strong>Total: {money(totalCents)}</strong>
          </p>
        </div>
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Completing order…" : "Complete ticket order"}
        </button>
      </form>
    </section>
  );
}

function TicketBundlePurchaseForm({
  bundle,
  feeSettings,
  projection,
}: {
  readonly bundle: PublishedOrganizationProjection["payload"]["ticketBundles"][number];
  readonly feeSettings: TransactionFeeSettings;
  readonly projection: PublishedOrganizationProjection;
}) {
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [checkoutRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feeCents = ticketProcessingFeeCents(bundle.priceCents, quantity, feeSettings);
  const includedEvents = bundle.eventIds
    .map((eventId) => projection.payload.performances.find(({ id }) => id === eventId))
    .filter((event) => event !== undefined);

  async function submit(formEvent: SyntheticEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (buyerEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      setError("Email addresses must match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createPublicTicketCheckout({
        bundleId: bundle.id,
        buyerEmail: buyerEmail.trim(),
        buyerName: buyerName.trim(),
        checkoutRequestId,
        marketingOptIn,
        quantity,
      });
      window.location.assign(result.url);
    } catch (failure: unknown) {
      setError(
        failure instanceof Error ? failure.message : "The bundle order could not be completed.",
      );
      setBusy(false);
    }
  }

  return (
    <section className="public-section public-section--narrow">
      <a href="/tickets">← All tickets</a>
      <h1>{bundle.title}</h1>
      <p>One pass includes admission to:</p>
      <ul>
        {includedEvents.map((event) => (
          <li key={event.id}>
            {event.title} · {publicDate(event.startsAt, projection.payload.timezone)}
          </li>
        ))}
      </ul>
      <form className="panel form-stack" onSubmit={(event) => void submit(event)}>
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="field">
          Name for will call
          <input
            required
            maxLength={200}
            value={buyerName}
            onChange={(event) => {
              setBuyerName(event.target.value);
            }}
          />
        </label>
        <label className="field">
          Email
          <input
            required
            type="email"
            value={buyerEmail}
            onChange={(event) => {
              setBuyerEmail(event.target.value);
            }}
          />
        </label>
        <label className="field">
          Confirm email
          <input
            required
            type="email"
            value={confirmEmail}
            onChange={(event) => {
              setConfirmEmail(event.target.value);
            }}
          />
        </label>
        <label className="field">
          Quantity
          <input
            min="1"
            max="10"
            step="1"
            type="number"
            value={quantity}
            onChange={(event) => {
              setQuantity(Number(event.target.value));
            }}
          />
        </label>
        <label>
          <input
            checked={marketingOptIn}
            type="checkbox"
            onChange={(event) => {
              setMarketingOptIn(event.target.checked);
            }}
          />{" "}
          Keep me informed about future Organization events
        </label>
        <div>
          <p>Passes: {money(bundle.priceCents * quantity)}</p>
          <p>Processing fee: {money(feeCents)}</p>
          <p>
            <strong>Total: {money(bundle.priceCents * quantity + feeCents)}</strong>
          </p>
        </div>
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Completing order…" : "Complete bundle order"}
        </button>
      </form>
    </section>
  );
}

function TicketsContent({
  feeSettings,
  pathname,
  projection,
  nowMs,
}: {
  readonly feeSettings: TransactionFeeSettings;
  readonly pathname: string;
  readonly projection: PublishedOrganizationProjection;
  readonly nowMs: number;
}) {
  const search = new URLSearchParams(window.location.search);
  if (pathname === "/tickets/order/success")
    return <TicketReceipt token={search.get("token") ?? ""} />;
  const bundleId = /^\/tickets\/bundles\/([0-9a-f-]+)$/i.exec(pathname)?.[1];
  if (bundleId) {
    const bundle = projection.payload.ticketBundles.find((candidate) => candidate.id === bundleId);
    return bundle && new Date(bundle.saleEndAt).getTime() > nowMs ? (
      <TicketBundlePurchaseForm bundle={bundle} feeSettings={feeSettings} projection={projection} />
    ) : (
      <p className="notice notice--error">This ticket bundle is no longer available.</p>
    );
  }
  const eventId = /^\/tickets\/([0-9a-f-]+)$/i.exec(pathname)?.[1];
  if (eventId) {
    const event = projection.payload.performances.find((candidate) => candidate.id === eventId);
    return event?.isTicketingEnabled ? (
      <TicketPurchaseForm
        event={event}
        feeSettings={feeSettings}
        nowMs={nowMs}
        projection={projection}
      />
    ) : (
      <p className="notice notice--error">Ticket sales are closed for this performance.</p>
    );
  }
  const events = projection.payload.performances.filter(
    (event) => event.isTicketingEnabled && new Date(event.startsAt).getTime() > nowMs,
  );
  const bundles = projection.payload.ticketBundles.filter(
    (bundle) => new Date(bundle.saleEndAt).getTime() > nowMs,
  );
  return (
    <section className="public-section">
      <h1>Tickets</h1>
      {events.length === 0 && bundles.length === 0 ? (
        <p>No tickets are currently available.</p>
      ) : (
        <div className="public-performance-grid">
          {bundles.map((bundle) => (
            <article className="public-performance-card" key={bundle.id}>
              <div>
                <p className="eyebrow">Multi-performance pass</p>
                <h2>{bundle.title}</h2>
                <p>{money(bundle.priceCents)} per pass</p>
                <a className="button button--primary" href={`/tickets/bundles/${bundle.id}`}>
                  Buy pass
                </a>
              </div>
            </article>
          ))}
          {events.map((event) => (
            <article className="public-performance-card" key={event.id}>
              <div>
                <p className="eyebrow">{publicDate(event.startsAt, projection.payload.timezone)}</p>
                <h2>{event.title}</h2>
                <p>From {money(event.advancePriceCents)}</p>
                <a className="button button--primary" href={`/tickets/${event.id}`}>
                  Buy tickets
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function PublicTickets({ pathname }: { readonly pathname: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [nowMs] = useState(() => Date.now());
  useEffect(() => {
    const controller = new AbortController();
    void getPublishedOrganizationProjection(controller.signal)
      .then(async (projection) => {
        if (!projection) {
          setState({ status: "error" });
          return;
        }
        const feeSettings = await getPublicTransactionFeeSettings(controller.signal).catch(
          () => DEFAULT_TRANSACTION_FEE_SETTINGS,
        );
        setState({ feeSettings, projection, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => {
      controller.abort();
    };
  }, []);
  if (state.status === "loading")
    return (
      <main className="auth-layout">
        <p className="notice notice--info">Loading tickets…</p>
      </main>
    );
  if (state.status === "error")
    return (
      <main className="auth-layout">
        <p className="notice notice--error">Tickets are unavailable.</p>
      </main>
    );
  return (
    <OrganizationLayout projection={state.projection}>
      <TicketsContent
        feeSettings={state.feeSettings}
        nowMs={nowMs}
        pathname={pathname}
        projection={state.projection}
      />
    </OrganizationLayout>
  );
}
