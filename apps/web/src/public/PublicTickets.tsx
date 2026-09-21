import type {
  PublishedOrganizationProjection,
  PublicTicketReceipt,
  TicketCheckoutQuote,
  TicketConfirmationSettings,
  TicketCheckoutQuoteRequest,
  TransactionFeeSettings,
} from "@choir/contracts";
import { ticketProcessingFeeCents, ticketUnitPriceCents } from "@choir/domain";
import { useEffect, useState, type SyntheticEvent } from "react";

import {
  createPublicTicketCheckout,
  getPublicTicketDiscountAvailability,
  getPublicCommerceProjection,
  getPublicTicketConfirmationSettings,
  getPublicTransactionFeeSettings,
  getPublicTicketPurchase,
  getPublishedOrganizationProjection,
  quotePublicTicketCheckout,
} from "../auth/api";
import { OrganizationLayout } from "./PublicOrganizationSite";
import { getEventVenueDetails } from "./venueDetails";

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

const DEFAULT_TICKET_CONFIRMATION_SETTINGS: TicketConfirmationSettings = {
  pendingMessage:
    "We could not load the full ticket details yet. Your purchase may still be processing. Please refresh this page in a moment, or contact the box office if this continues.",
  qrCodeInstructions:
    "Print or screenshot this entire page and bring it with you. We also sent a confirmation email with a link back to this page.",
  successMessage: "Your purchase has been successfully processed.",
  willCallInstructions:
    "A confirmation email has been sent with a link back to this page. Your tickets will be held at Will Call on show day. Please bring a photo ID matching the buyer’s name.",
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

interface TicketDiscountTarget {
  readonly bundleId?: string;
  readonly eventId?: string;
}

interface TicketDiscountState {
  readonly appliedCode: string | null;
  readonly applyCode: () => void;
  readonly clearCode: () => void;
  readonly codeInput: string;
  readonly displayQuote: TicketCheckoutQuote;
  readonly hasRedeemableCode: boolean;
  readonly quoteBusy: boolean;
  readonly quoteError: string | null;
  readonly setCodeInput: (value: string) => void;
}

function useTicketDiscountQuote({
  feeSettings,
  quantity,
  target,
  unitPriceCents,
}: {
  readonly feeSettings: TransactionFeeSettings;
  readonly quantity: number;
  readonly target: TicketDiscountTarget;
  readonly unitPriceCents: number;
}): TicketDiscountState {
  const [hasRedeemableCode, setHasRedeemableCode] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [quote, setQuote] = useState<TicketCheckoutQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const bundleId = target.bundleId;
  const eventId = target.eventId;

  useEffect(() => {
    const controller = new AbortController();
    void getPublicTicketDiscountAvailability(
      {
        ...(bundleId ? { bundleId } : {}),
        ...(eventId ? { eventId } : {}),
      },
      controller.signal,
    )
      .then((available) => {
        if (!controller.signal.aborted) setHasRedeemableCode(available);
      })
      .catch(() => {
        if (!controller.signal.aborted) setHasRedeemableCode(false);
      });
    return () => {
      controller.abort();
    };
  }, [bundleId, eventId]);

  useEffect(() => {
    if (!appliedCode) return;
    const controller = new AbortController();
    void quotePublicTicketCheckout(
      {
        bundleId: bundleId ?? null,
        discountCode: appliedCode,
        eventId: eventId ?? null,
        quantity,
      } satisfies TicketCheckoutQuoteRequest,
      controller.signal,
    )
      .then((nextQuote) => {
        if (controller.signal.aborted) return;
        setQuote(nextQuote);
        setQuoteError(null);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setQuote(null);
        setAppliedCode(null);
        setQuoteError(
          failure instanceof Error ? failure.message : "This code is not valid for this purchase.",
        );
      });
    return () => {
      controller.abort();
    };
  }, [appliedCode, bundleId, eventId, quantity]);

  const localQuote: TicketCheckoutQuote = {
    discountAmountCents: 0,
    discountCode: null,
    discountType: null,
    discountValue: null,
    discountedSubtotalCents: unitPriceCents * quantity,
    feeCents: ticketProcessingFeeCents(unitPriceCents, quantity, feeSettings),
    originalSubtotalCents: unitPriceCents * quantity,
    originalUnitPriceCents: unitPriceCents,
    quantity,
    totalCents:
      unitPriceCents * quantity + ticketProcessingFeeCents(unitPriceCents, quantity, feeSettings),
  };

  return {
    appliedCode,
    applyCode: () => {
      const nextCode = codeInput.trim();
      setQuoteError(null);
      if (!nextCode) {
        setAppliedCode(null);
        setQuote(null);
        return;
      }
      setAppliedCode(nextCode);
    },
    clearCode: () => {
      setCodeInput("");
      setAppliedCode(null);
      setQuote(null);
      setQuoteError(null);
    },
    codeInput,
    displayQuote: quote ?? localQuote,
    hasRedeemableCode,
    quoteBusy: Boolean(appliedCode && quote?.quantity !== quantity),
    quoteError,
    setCodeInput,
  };
}

function TicketDiscountControls({ state }: { readonly state: TicketDiscountState }) {
  if (!state.hasRedeemableCode) return null;
  return (
    <div className="field">
      <label htmlFor="ticket-discount-code">Discount code (optional)</label>
      <div className="form-actions">
        <input
          aria-describedby={
            state.quoteError
              ? "ticket-discount-code-error ticket-discount-code-help"
              : "ticket-discount-code-help"
          }
          aria-invalid={Boolean(state.quoteError)}
          id="ticket-discount-code"
          maxLength={64}
          onChange={(event) => {
            state.setCodeInput(event.target.value);
          }}
          value={state.codeInput}
        />
        {state.appliedCode ? (
          <button className="button button--secondary" onClick={state.clearCode} type="button">
            Remove
          </button>
        ) : (
          <button
            className="button button--secondary"
            disabled={!state.codeInput.trim() || state.quoteBusy}
            onClick={state.applyCode}
            type="button"
          >
            {state.quoteBusy ? "Checking…" : "Apply code"}
          </button>
        )}
      </div>
      <p className="field-help" id="ticket-discount-code-help">
        {state.quoteBusy
          ? "Checking this code against the current price…"
          : state.appliedCode
            ? `Code ${state.displayQuote.discountCode ?? state.appliedCode} applied.`
            : "One code may be applied to this purchase."}
      </p>
      {state.quoteError ? (
        <p className="field-help field-help--error" id="ticket-discount-code-error" role="alert">
          {state.quoteError}
        </p>
      ) : null}
    </div>
  );
}

function TicketReceipt({ token }: { readonly token: string }) {
  const [purchase, setPurchase] = useState<PublicTicketReceipt | null>(null);
  const [confirmationSettings, setConfirmationSettings] = useState(
    DEFAULT_TICKET_CONFIRMATION_SETTINGS,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getPublicTicketPurchase(token, controller.signal),
      getPublicTicketConfirmationSettings(controller.signal).catch(
        () => DEFAULT_TICKET_CONFIRMATION_SETTINGS,
      ),
    ])
      .then(([nextPurchase, nextSettings]) => {
        setPurchase(nextPurchase);
        setConfirmationSettings(nextSettings);
      })
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
      <h1>
        {purchase.status === "pending" ? "Ticket order processing" : "Your tickets are confirmed"}
      </h1>
      <p>
        {purchase.status === "pending"
          ? confirmationSettings.pendingMessage
          : confirmationSettings.successMessage}
      </p>
      {purchase.checkoutMode === "free" ? (
        <p className="notice notice--info">Complimentary order — no payment was collected.</p>
      ) : purchase.checkoutMode === "fake" ? (
        <p className="notice notice--warning">Staging simulation: no payment card was charged.</p>
      ) : null}
      <div className="panel">
        <h2>{purchase.bundleId ? purchase.bundleTitle : purchase.eventTitle}</h2>
        {purchase.bundleId ? (
          <ul className="public-bundle-event-list">
            {[...purchase.includedEvents]
              .sort((a, b) => {
                const diff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
                return diff !== 0 ? diff : a.title.localeCompare(b.title);
              })
              .map((event) => (
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
        {purchase.discountCode ? (
          <div className="ticket-price-summary">
            <p>
              Original subtotal: <strong>{money(purchase.originalSubtotalCents)}</strong>
            </p>
            <p>
              Discount ({purchase.discountCode}):{" "}
              <strong>-{money(purchase.discountAmountCents)}</strong>
            </p>
            <p>
              Discounted subtotal: <strong>{money(purchase.discountedSubtotalCents)}</strong>
            </p>
            <p>
              Processing fee: <strong>{money(purchase.feeCents)}</strong>
            </p>
            <p>
              Total: <strong>{money(purchase.amountPaidCents)}</strong>
            </p>
          </div>
        ) : (
          <p>
            Total: <strong>{money(purchase.amountPaidCents)}</strong>
          </p>
        )}
        <p>{confirmationSettings.willCallInstructions}</p>
        <details>
          <summary>Door credential</summary>
          <p>{confirmationSettings.qrCodeInstructions}</p>
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
  const discount = useTicketDiscountQuote({
    feeSettings,
    quantity,
    target: { eventId: event.id },
    unitPriceCents,
  });
  const displayedQuote = discount.displayQuote;

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
        ...(discount.appliedCode ? { discountCode: discount.appliedCode } : {}),
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
      {(() => {
        const venueDetails = getEventVenueDetails(event);
        if (!venueDetails.displayName && !venueDetails.venueAddress) return null;
        return (
          <div className="public-performance-venue">
            {venueDetails.displayName ? (
              <p className="public-performance-venue__name">{venueDetails.displayName}</p>
            ) : null}
            {venueDetails.venueAddress ? (
              <p className="public-performance-venue__address">{venueDetails.venueAddress}</p>
            ) : null}
            {venueDetails.googleMapsUrl ? (
              <p>
                <a
                  className="public-performance-venue__map-link"
                  href={venueDetails.googleMapsUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  View on Google Maps
                </a>
              </p>
            ) : null}
          </div>
        );
      })()}
      {event.doorsOpenTime ? <p>Doors open at {event.doorsOpenTime}.</p> : null}
      <form className="panel form-stack" onSubmit={(formEvent) => void submit(formEvent)}>
        {error ? (
          <p className="notice notice--error" id="single-ticket-order-error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="field">
          Name for will call
          <input
            aria-describedby={error ? "single-ticket-order-error" : undefined}
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
            aria-describedby={error ? "single-ticket-order-error" : undefined}
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
            aria-describedby={error ? "single-ticket-order-error" : undefined}
            aria-invalid={Boolean(error?.toLowerCase().includes("email"))}
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
              const raw = Number(e.target.value);
              const clamped = Number.isFinite(raw) ? Math.min(Math.max(1, Math.trunc(raw)), 10) : 1;
              setQuantity(clamped);
            }}
          />
        </label>
        <TicketDiscountControls state={discount} />
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
          <p>Original subtotal: {money(displayedQuote.originalSubtotalCents)}</p>
          {displayedQuote.discountCode ? (
            <p>
              Discount ({displayedQuote.discountCode}): -{money(displayedQuote.discountAmountCents)}
            </p>
          ) : null}
          <p>Processing fee: {money(displayedQuote.feeCents)}</p>
          <p>
            <strong>Total: {money(displayedQuote.totalCents)}</strong>
          </p>
        </div>
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Completing order…" : "Complete ticket order"}
        </button>
      </form>
    </section>
  );
}

export function TicketBundlePurchaseForm({
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
  const discount = useTicketDiscountQuote({
    feeSettings,
    quantity,
    target: { bundleId: bundle.id },
    unitPriceCents: bundle.priceCents,
  });
  const displayedQuote = discount.displayQuote;
  const performanceMap = new Map(projection.payload.performances.map((event) => [event.id, event]));
  const includedEvents = bundle.eventIds
    .map((eventId) => performanceMap.get(eventId))
    .filter((event) => event !== undefined)
    .sort((a, b) => {
      const diff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      return diff !== 0 ? diff : a.title.localeCompare(b.title);
    });

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
        ...(discount.appliedCode ? { discountCode: discount.appliedCode } : {}),
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
      <ul className="public-bundle-event-list">
        {includedEvents.map((event) => {
          const venueDetails = getEventVenueDetails(event);
          return (
            <li key={event.id}>
              <div>
                <strong>{event.title}</strong> ·{" "}
                {publicDate(event.startsAt, projection.payload.timezone)}
                {venueDetails.displayName || venueDetails.venueAddress ? (
                  <div className="public-bundle-event-venue">
                    {venueDetails.displayName ? <span>{venueDetails.displayName}</span> : null}
                    {venueDetails.displayName && venueDetails.venueAddress ? (
                      <span> · </span>
                    ) : null}
                    {venueDetails.venueAddress ? <span>{venueDetails.venueAddress}</span> : null}
                    {venueDetails.googleMapsUrl ? (
                      <>
                        <span> · </span>
                        <a
                          className="public-performance-map-link"
                          href={venueDetails.googleMapsUrl}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          View on Google Maps
                        </a>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <form className="panel form-stack" onSubmit={(event) => void submit(event)}>
        {error ? (
          <p className="notice notice--error" id="multi-ticket-order-error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="field">
          Name for will call
          <input
            aria-describedby={error ? "multi-ticket-order-error" : undefined}
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
            aria-describedby={error ? "multi-ticket-order-error" : undefined}
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
            aria-describedby={error ? "multi-ticket-order-error" : undefined}
            aria-invalid={Boolean(error?.toLowerCase().includes("email"))}
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
              const raw = Number(event.target.value);
              const clamped = Number.isFinite(raw) ? Math.min(Math.max(1, Math.trunc(raw)), 10) : 1;
              setQuantity(clamped);
            }}
          />
        </label>
        <TicketDiscountControls state={discount} />
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
          <p>Original subtotal: {money(displayedQuote.originalSubtotalCents)}</p>
          {displayedQuote.discountCode ? (
            <p>
              Discount ({displayedQuote.discountCode}): -{money(displayedQuote.discountAmountCents)}
            </p>
          ) : null}
          <p>Processing fee: {money(displayedQuote.feeCents)}</p>
          <p>
            <strong>Total: {money(displayedQuote.totalCents)}</strong>
          </p>
        </div>
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Completing order…" : "Complete bundle order"}
        </button>
      </form>
    </section>
  );
}

export function TicketsContent({
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
  const events = projection.payload.performances
    .filter((event) => event.isTicketingEnabled && new Date(event.startsAt).getTime() > nowMs)
    .sort((a, b) => {
      const diff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      return diff !== 0 ? diff : a.title.localeCompare(b.title);
    });
  const bundles = projection.payload.ticketBundles
    .filter((bundle) => new Date(bundle.saleEndAt).getTime() > nowMs)
    .sort((a, b) => {
      const diff = new Date(a.saleEndAt).getTime() - new Date(b.saleEndAt).getTime();
      return diff !== 0 ? diff : a.title.localeCompare(b.title);
    });
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
                <p>Multi-performance pass</p>
                <h2>{bundle.title}</h2>
                <p>{money(bundle.priceCents)} per pass</p>
                <a className="button button--primary" href={`/tickets/bundles/${bundle.id}`}>
                  Buy pass
                </a>
              </div>
            </article>
          ))}
          {events.map((event) => {
            const venueDetails = getEventVenueDetails(event);
            return (
              <article className="public-performance-card" key={event.id}>
                <div>
                  <p>{publicDate(event.startsAt, projection.payload.timezone)}</p>
                  <h2>{event.title}</h2>
                  {venueDetails.displayName || venueDetails.venueAddress ? (
                    <div className="public-performance-venue">
                      {venueDetails.displayName ? (
                        <p className="public-performance-location">{venueDetails.displayName}</p>
                      ) : null}
                      {venueDetails.venueAddress ? (
                        <p className="public-performance-address">{venueDetails.venueAddress}</p>
                      ) : null}
                      {venueDetails.googleMapsUrl ? (
                        <p>
                          <a
                            className="public-performance-map-link"
                            href={venueDetails.googleMapsUrl}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            View on Google Maps
                          </a>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <p>From {money(event.advancePriceCents)}</p>
                  <a className="button button--primary" href={`/tickets/${event.id}`}>
                    Buy tickets
                  </a>
                </div>
              </article>
            );
          })}
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
      .then((projection) => projection ?? getPublicCommerceProjection(controller.signal))
      .then(async (projection) => {
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
