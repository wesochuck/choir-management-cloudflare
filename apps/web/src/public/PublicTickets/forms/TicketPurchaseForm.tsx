import { NumberInput } from "@choir/ui";
import type { PublishedOrganizationProjection, TransactionFeeSettings } from "@choir/contracts";
import { isSupportedPaidCheckoutAmount, ticketUnitPriceCents } from "@choir/domain";
import { useState, type SyntheticEvent } from "react";

import { createPublicTicketCheckout } from "../../../auth/api";
import { shouldStartNewTicketCheckoutAttempt } from "../../checkoutAttempt";
import { PublicGraphicImage } from "../../PublicGraphicImage";
import { mediaUrl } from "../../publicMedia";
import { getEventVenueDetails } from "../../venueDetails";
import { TicketDiscountControls } from "../discounts/TicketDiscountControls";
import { useTicketDiscountQuote } from "../discounts/useTicketDiscountQuote";
import { money, publicDate } from "../shared";
import { TicketCheckoutFooter } from "./TicketCheckoutFooter";

export function TicketPurchaseForm({
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
  const [checkoutRequestId, setCheckoutRequestId] = useState(() => crypto.randomUUID());
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
  const checkoutAmountSupported = isSupportedPaidCheckoutAmount(displayedQuote.totalCents);

  async function submit(formEvent: SyntheticEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!checkoutAmountSupported) {
      setError(
        "Card payments must total at least $0.50. Increase the quantity or remove the discount code.",
      );
      return;
    }
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
      if (shouldStartNewTicketCheckoutAttempt(failure)) {
        setCheckoutRequestId(crypto.randomUUID());
      }
      setError(
        failure instanceof Error ? failure.message : "The ticket order could not be completed.",
      );
      setBusy(false);
    }
  }

  return (
    <section className="public-section public-section--narrow public-section--ticket-checkout">
      <a href="/tickets">← All tickets</a>
      {event.graphicFileId ? (
        <PublicGraphicImage
          alt={event.title}
          className="ticket-purchase-hero__image"
          src={mediaUrl(projection, event.graphicFileId)}
          wrapperClassName="ticket-purchase-hero"
        />
      ) : null}
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
            maxLength={200}
            onChange={(e) => {
              setBuyerName(e.target.value);
            }}
            required
            value={buyerName}
          />
        </label>
        <label className="field">
          Email
          <input
            aria-describedby={error ? "single-ticket-order-error" : undefined}
            onChange={(e) => {
              setBuyerEmail(e.target.value);
            }}
            required
            type="email"
            value={buyerEmail}
          />
        </label>
        <label className="field">
          Confirm email
          <input
            aria-describedby={error ? "single-ticket-order-error" : undefined}
            aria-invalid={Boolean(error?.toLowerCase().includes("email"))}
            onChange={(e) => {
              setConfirmEmail(e.target.value);
            }}
            required
            type="email"
            value={confirmEmail}
          />
        </label>
        <label className="field">
          Quantity
          <NumberInput
            max="10"
            min="1"
            onChange={(e) => {
              const raw = Number(e.target.value);
              const clamped = Number.isFinite(raw) ? Math.min(Math.max(1, Math.trunc(raw)), 10) : 1;
              setQuantity(clamped);
            }}
            step="1"
            value={quantity}
          />
        </label>
        <TicketDiscountControls state={discount} />
        <label>
          <input
            checked={marketingOptIn}
            onChange={(e) => {
              setMarketingOptIn(e.target.checked);
            }}
            type="checkbox"
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
          {!checkoutAmountSupported ? (
            <p className="notice notice--error" id="single-ticket-minimum-payment" role="alert">
              Card payments must total at least $0.50. Increase the quantity or remove the discount
              code.
            </p>
          ) : null}
        </div>
        <TicketCheckoutFooter
          busy={busy}
          disabled={busy || !checkoutAmountSupported}
          totalCents={displayedQuote.totalCents}
        />
      </form>
    </section>
  );
}
