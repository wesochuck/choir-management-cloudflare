import type { PublishedOrganizationProjection, PublicTicketPurchase } from "@choir/contracts";
import { ticketProcessingFeeCents, ticketUnitPriceCents } from "@choir/domain";
import { useEffect, useState, type SyntheticEvent } from "react";

import {
  createPublicTicketCheckout,
  getPublicTicketPurchase,
  getPublishedOrganizationProjection,
} from "../auth/api";
import { OrganizationLayout } from "./PublicOrganizationSite";

type LoadState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly projection: PublishedOrganizationProjection; readonly status: "ready" };

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
  const [purchase, setPurchase] = useState<PublicTicketPurchase | null>(null);
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
        <h2>{purchase.eventTitle}</h2>
        <p>{publicDate(purchase.eventStartsAt, purchase.timezone)}</p>
        <p>
          Will call name: <strong>{purchase.buyerName}</strong>
        </p>
        <p>
          Quantity: <strong>{purchase.quantity}</strong>
        </p>
        <p>
          Total: <strong>{money(purchase.amountPaidCents)}</strong>
        </p>
      </div>
      <a className="button button--secondary" href="/tickets">
        Return to tickets
      </a>
    </section>
  );
}

function TicketPurchaseForm({
  event,
  nowMs,
  projection,
}: {
  readonly event: PublishedOrganizationProjection["payload"]["performances"][number];
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
  const feeCents = ticketProcessingFeeCents(unitPriceCents, quantity);
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

function TicketsContent({
  pathname,
  projection,
  nowMs,
}: {
  readonly pathname: string;
  readonly projection: PublishedOrganizationProjection;
  readonly nowMs: number;
}) {
  const search = new URLSearchParams(window.location.search);
  if (pathname === "/tickets/order/success")
    return <TicketReceipt token={search.get("token") ?? ""} />;
  const eventId = /^\/tickets\/([0-9a-f-]+)$/i.exec(pathname)?.[1];
  if (eventId) {
    const event = projection.payload.performances.find((candidate) => candidate.id === eventId);
    return event?.isTicketingEnabled ? (
      <TicketPurchaseForm event={event} nowMs={nowMs} projection={projection} />
    ) : (
      <p className="notice notice--error">Ticket sales are closed for this performance.</p>
    );
  }
  const events = projection.payload.performances.filter(
    (event) => event.isTicketingEnabled && new Date(event.startsAt).getTime() > nowMs,
  );
  return (
    <section className="public-section">
      <h1>Tickets</h1>
      {events.length === 0 ? (
        <p>No tickets are currently available.</p>
      ) : (
        <div className="public-performance-grid">
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
    getPublishedOrganizationProjection(controller.signal)
      .then((projection) => {
        setState(projection ? { projection, status: "ready" } : { status: "error" });
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
      <TicketsContent nowMs={nowMs} pathname={pathname} projection={state.projection} />
    </OrganizationLayout>
  );
}
