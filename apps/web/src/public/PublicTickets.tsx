import type {
  PublishedOrganizationProjection,
  PublicTicketReceipt,
  TicketCheckoutQuote,
  TicketConfirmationSettings,
  TicketCheckoutQuoteRequest,
  TransactionFeeSettings,
} from "@choir/contracts";
import { ticketProcessingFeeCents, ticketUnitPriceCents } from "@choir/domain";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import {
  AuthApiError,
  createPublicTicketCheckout,
  getPublicTicketDiscountAvailability,
  getPublicCommerceProjection,
  getPublicTicketConfirmationSettings,
  getPublicTransactionFeeSettings,
  getPublicTicketPurchase,
  getPublishedOrganizationProjection,
  quotePublicTicketCheckout,
} from "../auth/api";
import { OrganizationLayout, PublicTransactionLayout } from "./PublicOrganizationSite";
import { getEventVenueDetails } from "./venueDetails";
import { QRCodeImage } from "../shared/QRCodeImage";

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
  admissionInstructions:
    "Keep this confirmation available on your phone. Present the QR code at the door if requested.",
  pendingMessage:
    "We could not load the full ticket details yet. Your purchase may still be processing. Please refresh this page in a moment, or contact the box office if this continues.",
  qrCodeInstructions:
    "Present this QR code at the door for entry. You can also use the link in your confirmation email to open this ticket anytime.",
  successMessage: "Your purchase has been successfully processed.",
  willCallInstructions:
    "Keep this confirmation available on your phone. Present the QR code at the door if requested.",
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

export interface TicketDiscountState {
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

export function TicketDiscountControls({ state }: { readonly state: TicketDiscountState }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (!state.hasRedeemableCode) return null;

  if (state.appliedCode && !state.quoteError) {
    const codeName = state.displayQuote.discountCode ?? state.appliedCode;
    return (
      <div className="ticket-discount-controls ticket-discount-applied" role="status">
        <span>
          <strong>{codeName} applied</strong>
          {state.quoteBusy ? " (checking…)" : null}
        </span>
        <span aria-hidden="true"> · </span>
        <button
          className="text-button ticket-discount-remove"
          onClick={() => {
            state.clearCode();
            setIsExpanded(false);
            requestAnimationFrame(() => {
              toggleRef.current?.focus();
            });
          }}
          type="button"
        >
          Remove
        </button>
      </div>
    );
  }

  const showEntry = isExpanded || Boolean(state.quoteError);

  return (
    <div className="ticket-discount-controls">
      <button
        aria-controls="ticket-discount-region"
        aria-expanded={showEntry}
        className="text-button ticket-discount-toggle"
        onClick={() => {
          const next = !showEntry;
          setIsExpanded(next);
          if (next) {
            requestAnimationFrame(() => {
              inputRef.current?.focus();
            });
          }
        }}
        ref={toggleRef}
        type="button"
      >
        Have a discount code?
      </button>

      {showEntry ? (
        <div className="field ticket-discount-region" id="ticket-discount-region">
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
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (state.codeInput.trim() && !state.quoteBusy) {
                    state.applyCode();
                  }
                }
              }}
              ref={inputRef}
              value={state.codeInput}
            />
            <button
              className="button button--secondary"
              disabled={!state.codeInput.trim() || state.quoteBusy}
              onClick={state.applyCode}
              type="button"
            >
              {state.quoteBusy ? "Checking…" : "Apply code"}
            </button>
          </div>
          <p className="field-help" id="ticket-discount-code-help">
            {state.quoteBusy
              ? "Checking this code against the current price…"
              : "One code may be applied to this purchase."}
          </p>
          {state.quoteError ? (
            <p
              className="field-help field-help--error"
              id="ticket-discount-code-error"
              role="alert"
            >
              {state.quoteError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 45000;

function getReceiptHeading(status: PublicTicketReceipt["status"]): string {
  switch (status) {
    case "pending":
      return "Ticket order processing";
    case "paid":
      return "Your tickets are confirmed";
    case "refunded":
      return "Ticket order refunded";
    case "expired":
      return "Ticket order expired";
  }
}

function getReceiptMessage(
  status: PublicTicketReceipt["status"],
  settings: TicketConfirmationSettings,
): string {
  switch (status) {
    case "pending":
      return settings.pendingMessage;
    case "paid":
      return settings.successMessage;
    case "refunded":
      return "This ticket order has been refunded.";
    case "expired":
      return "This ticket order has expired because payment was not completed.";
  }
}

function TicketReceiptPricing({ purchase }: { readonly purchase: PublicTicketReceipt }) {
  if (!purchase.discountCode) {
    return (
      <p>
        Total: <strong>{money(purchase.amountPaidCents)}</strong>
      </p>
    );
  }

  return (
    <div className="ticket-price-summary">
      <p>
        Original subtotal: <strong>{money(purchase.originalSubtotalCents)}</strong>
      </p>
      <p>
        Discount ({purchase.discountCode}): <strong>-{money(purchase.discountAmountCents)}</strong>
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
  );
}

function TicketCredentialCard({
  purchase,
  settings,
}: {
  readonly purchase: PublicTicketReceipt;
  readonly settings: TicketConfirmationSettings;
}) {
  const [qrFailed, setQrFailed] = useState(false);
  const venue = getEventVenueDetails({
    location: purchase.location,
    venueAddress: purchase.venueAddress,
    venueName: purchase.venueName,
  });

  return (
    <article aria-label="Ticket admission credential" className="ticket-credential-card panel">
      <h3>Your ticket</h3>
      <div className="ticket-credential-card__qr">
        <QRCodeImage
          alt={`Admission QR code for ${purchase.bundleId ? purchase.bundleTitle : purchase.eventTitle}`}
          className="ticket-credential-card__qr-image"
          errorCorrectionLevel="H"
          fallbackMessage="The QR code could not be displayed. Use the ticket link or show this page to event staff."
          margin={2}
          onError={() => {
            setQrFailed(true);
          }}
          payload={purchase.scanToken ?? ""}
          width={280}
        />
      </div>
      <p className="ticket-credential-card__instructions">
        {settings.qrCodeInstructions || "Present this QR code at the door."}
      </p>
      <div className="ticket-credential-card__event-details">
        <h4>{purchase.bundleId ? purchase.bundleTitle : purchase.eventTitle}</h4>
        <p>{publicDate(purchase.eventStartsAt, purchase.timezone)}</p>
        {venue.displayName ? (
          <p>
            <strong>{venue.displayName}</strong>
          </p>
        ) : null}
        {venue.venueAddress ? <p>{venue.venueAddress}</p> : null}
        {venue.googleMapsUrl ? (
          <p>
            <a href={venue.googleMapsUrl} rel="noreferrer" target="_blank">
              View on Google Maps
            </a>
          </p>
        ) : null}
      </div>
      {qrFailed && purchase.scanToken ? (
        <details className="ticket-credential-card__fallback-disclosure">
          <summary>Manual credential</summary>
          <code className="ticket-credential">{purchase.scanToken}</code>
        </details>
      ) : null}
    </article>
  );
}

function TicketReceiptPanel({
  purchase,
  settings,
}: {
  readonly purchase: PublicTicketReceipt;
  readonly settings: TicketConfirmationSettings;
}) {
  const sortedEvents = purchase.bundleId
    ? [...purchase.includedEvents].sort((a, b) => {
        const diff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
        return diff !== 0 ? diff : a.title.localeCompare(b.title);
      })
    : null;

  const venue = getEventVenueDetails({
    location: purchase.location,
    venueAddress: purchase.venueAddress,
    venueName: purchase.venueName,
  });

  return (
    <div className="ticket-receipt-container">
      {purchase.status === "paid" && purchase.scanToken ? (
        <TicketCredentialCard purchase={purchase} settings={settings} />
      ) : null}
      <div className="panel">
        <h2>{purchase.bundleId ? purchase.bundleTitle : purchase.eventTitle}</h2>
        {sortedEvents ? (
          <ul className="public-bundle-event-list">
            {sortedEvents.map((event) => {
              const eventVenue = getEventVenueDetails({
                location: event.location,
                venueAddress: event.venueAddress,
                venueName: event.venueName,
              });
              return (
                <li className="public-bundle-event-item" key={event.id}>
                  <div>
                    <strong>{event.title}</strong> · {publicDate(event.startsAt, purchase.timezone)}
                  </div>
                  {eventVenue.displayName ? <div>{eventVenue.displayName}</div> : null}
                  {eventVenue.venueAddress ? <div>{eventVenue.venueAddress}</div> : null}
                  {eventVenue.googleMapsUrl ? (
                    <div>
                      <a href={eventVenue.googleMapsUrl} rel="noreferrer" target="_blank">
                        View on Google Maps
                      </a>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <>
            <p>{publicDate(purchase.eventStartsAt, purchase.timezone)}</p>
            {venue.displayName ? (
              <p>
                <strong>{venue.displayName}</strong>
              </p>
            ) : null}
            {venue.venueAddress ? <p>{venue.venueAddress}</p> : null}
            {venue.googleMapsUrl ? (
              <p>
                <a href={venue.googleMapsUrl} rel="noreferrer" target="_blank">
                  View on Google Maps
                </a>
              </p>
            ) : null}
          </>
        )}
        <p>
          Name on order: <strong>{purchase.buyerName}</strong>
        </p>
        <p>
          Quantity: <strong>{purchase.quantity}</strong>
        </p>
        <TicketReceiptPricing purchase={purchase} />
        {purchase.status === "paid" || purchase.status === "pending" ? (
          <p>{settings.admissionInstructions || settings.willCallInstructions}</p>
        ) : null}
      </div>
    </div>
  );
}

function TicketReceiptContent({
  onRefresh,
  settings,
  token,
}: {
  readonly onRefresh: () => void;
  readonly settings: TicketConfirmationSettings;
  readonly token: string;
}) {
  const [purchase, setPurchase] = useState<PublicTicketReceipt | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let latestPurchase: PublicTicketReceipt | null = null;
    const startTime = Date.now();

    function schedulePoll() {
      if (controller.signal.aborted) {
        return;
      }

      getPublicTicketPurchase(token, controller.signal)
        .then((nextPurchase) => {
          if (controller.signal.aborted) {
            return;
          }
          latestPurchase = nextPurchase;
          setPurchase(nextPurchase);
          setLoadError(null);

          if (nextPurchase.status === "pending") {
            const elapsed = Date.now() - startTime;
            if (elapsed >= POLL_TIMEOUT_MS) {
              setIsTimedOut(true);
            } else {
              timerId = setTimeout(schedulePoll, POLL_INTERVAL_MS);
            }
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }

          if (error instanceof AuthApiError && error.status === 404) {
            setIsUnavailable(true);
            return;
          }

          const elapsed = Date.now() - startTime;
          if (elapsed < POLL_TIMEOUT_MS) {
            timerId = setTimeout(schedulePoll, POLL_INTERVAL_MS);
          } else if (!latestPurchase) {
            setLoadError(
              "Unable to load ticket receipt. Please check your connection and try again.",
            );
          } else {
            setIsTimedOut(true);
          }
        });
    }

    schedulePoll();

    return () => {
      controller.abort();
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [token]);

  if (isUnavailable) {
    return <p className="notice notice--error">This ticket receipt is unavailable.</p>;
  }

  if (loadError && !purchase) {
    return (
      <section className="public-section public-section--narrow">
        <p className="notice notice--error">{loadError}</p>
        <button
          className="button button--secondary"
          onClick={() => {
            onRefresh();
          }}
          type="button"
        >
          Check status again
        </button>
      </section>
    );
  }

  if (!purchase) {
    return <p className="notice notice--info">Loading ticket receipt…</p>;
  }

  return (
    <section className="public-section public-section--narrow">
      <h1>{getReceiptHeading(purchase.status)}</h1>
      <p>{getReceiptMessage(purchase.status, settings)}</p>
      {purchase.status === "pending" && isTimedOut ? (
        <div className="notice notice--info">
          <p>
            We are still waiting for confirmation from the payment provider. Your order details are
            below.
          </p>
          <button
            className="button button--secondary"
            onClick={() => {
              onRefresh();
            }}
            type="button"
          >
            Check status again
          </button>
        </div>
      ) : null}
      {purchase.checkoutMode === "free" ? (
        <p className="notice notice--info">Complimentary order — no payment was collected.</p>
      ) : purchase.checkoutMode === "fake" ? (
        <p className="notice notice--warning">Staging simulation: no payment card was charged.</p>
      ) : null}
      <TicketReceiptPanel purchase={purchase} settings={settings} />
      <a className="button button--secondary" href="/tickets">
        Return to tickets
      </a>
    </section>
  );
}

export function TicketReceipt({ token }: { readonly token: string }) {
  const [confirmationSettings, setConfirmationSettings] = useState(
    DEFAULT_TICKET_CONFIRMATION_SETTINGS,
  );
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void getPublicTicketConfirmationSettings(controller.signal)
      .then((nextSettings) => {
        setConfirmationSettings(nextSettings);
      })
      .catch(() => {
        // Keeps default settings
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (!token) {
    return <p className="notice notice--error">This ticket receipt is unavailable.</p>;
  }

  return (
    <TicketReceiptContent
      key={`${token}:${String(refreshKey)}`}
      onRefresh={() => {
        setRefreshKey((key) => key + 1);
      }}
      settings={confirmationSettings}
      token={token}
    />
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
          Name on order
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
          I would like to receive updates about future events and programs
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
          Name on order
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
          I would like to receive updates about future events and programs
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
  const settings = state.projection.payload.settings;
  const content = (
    <TicketsContent
      feeSettings={state.feeSettings}
      nowMs={nowMs}
      pathname={pathname}
      projection={state.projection}
    />
  );

  return settings.showBrandingHeaderFooter ? (
    <OrganizationLayout pathname={pathname} projection={state.projection}>
      {content}
    </OrganizationLayout>
  ) : (
    <PublicTransactionLayout projection={state.projection}>{content}</PublicTransactionLayout>
  );
}
