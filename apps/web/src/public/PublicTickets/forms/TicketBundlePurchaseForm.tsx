import { NumberInput } from "@choir/ui";
import type { PublishedOrganizationProjection, TransactionFeeSettings } from "@choir/contracts";
import { isSupportedPaidCheckoutAmount } from "@choir/domain";
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
  const [checkoutRequestId, setCheckoutRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discount = useTicketDiscountQuote({
    feeSettings,
    quantity,
    target: { bundleId: bundle.id },
    unitPriceCents: bundle.priceCents,
  });
  const displayedQuote = discount.displayQuote;
  const checkoutAmountSupported = isSupportedPaidCheckoutAmount(displayedQuote.totalCents);
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
      if (shouldStartNewTicketCheckoutAttempt(failure)) {
        setCheckoutRequestId(crypto.randomUUID());
      }
      setError(
        failure instanceof Error ? failure.message : "The bundle order could not be completed.",
      );
      setBusy(false);
    }
  }

  return (
    <section className="public-section public-section--narrow public-section--ticket-checkout">
      <a href="/tickets">← All tickets</a>
      {bundle.graphicFileId ? (
        <PublicGraphicImage
          alt={bundle.title}
          className="ticket-purchase-hero__image"
          src={mediaUrl(projection, bundle.graphicFileId)}
          wrapperClassName="ticket-purchase-hero"
        />
      ) : null}
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
                {event.doorsOpenTime ? <p>Doors open at {event.doorsOpenTime}.</p> : null}
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
            maxLength={200}
            onChange={(event) => {
              setBuyerName(event.target.value);
            }}
            required
            value={buyerName}
          />
        </label>
        <label className="field">
          Email
          <input
            aria-describedby={error ? "multi-ticket-order-error" : undefined}
            onChange={(event) => {
              setBuyerEmail(event.target.value);
            }}
            required
            type="email"
            value={buyerEmail}
          />
        </label>
        <label className="field">
          Confirm email
          <input
            aria-describedby={error ? "multi-ticket-order-error" : undefined}
            aria-invalid={Boolean(error?.toLowerCase().includes("email"))}
            onChange={(event) => {
              setConfirmEmail(event.target.value);
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
            onChange={(event) => {
              const raw = Number(event.target.value);
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
            onChange={(event) => {
              setMarketingOptIn(event.target.checked);
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
            <p className="notice notice--error" id="multi-ticket-minimum-payment" role="alert">
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
