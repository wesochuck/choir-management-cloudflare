import type { PublicTicketReceipt, TicketConfirmationSettings } from "@choir/contracts";
import { PublicGraphicImage } from "../../PublicGraphicImage";
import { getEventVenueDetails } from "../../venueDetails";
import { money, publicDate } from "../shared";

export function TicketReceiptPricing({ purchase }: { readonly purchase: PublicTicketReceipt }) {
  if (!purchase.discountCode) {
    return (
      <p className="ticket-order-pricing-line">
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
      <p className="ticket-order-pricing-line">
        Total: <strong>{money(purchase.amountPaidCents)}</strong>
      </p>
    </div>
  );
}

export function TicketOrderSchedule({ purchase }: { readonly purchase: PublicTicketReceipt }) {
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

  if (sortedEvents) {
    return (
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
    );
  }

  return (
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
  );
}

export function SingleTicketOrderSummary({
  graphicUrl,
  purchase,
}: {
  readonly graphicUrl?: string | null | undefined;
  readonly purchase: PublicTicketReceipt;
  readonly settings?: TicketConfirmationSettings | undefined;
}) {
  return (
    <section aria-label="Purchase summary" className="ticket-order-summary">
      {graphicUrl ? (
        <div className="ticket-order-summary__artwork no-print">
          <PublicGraphicImage
            alt={purchase.eventTitle}
            className="ticket-receipt-graphic__image"
            src={graphicUrl}
            wrapperClassName="ticket-receipt-graphic"
          />
        </div>
      ) : null}
      <h2 className="ticket-order-summary__heading">Purchase summary</h2>
      <p>
        Name on order: <strong>{purchase.buyerName}</strong>
      </p>
      <p>
        Quantity: <strong>{purchase.quantity}</strong>
      </p>
      <TicketReceiptPricing purchase={purchase} />
    </section>
  );
}

export function BundlePurchaseSummary({
  graphicUrl,
  purchase,
}: {
  readonly graphicUrl?: string | null | undefined;
  readonly purchase: PublicTicketReceipt;
  readonly settings?: TicketConfirmationSettings | undefined;
}) {
  return (
    <section aria-label="Purchase summary" className="ticket-order-summary ticket-purchase-summary">
      {graphicUrl ? (
        <div className="ticket-order-summary__artwork no-print">
          <PublicGraphicImage
            alt={purchase.bundleTitle}
            className="ticket-receipt-graphic__image"
            src={graphicUrl}
            wrapperClassName="ticket-receipt-graphic"
          />
        </div>
      ) : null}
      <h2 className="ticket-order-summary__heading">Purchase summary</h2>
      <p>
        Name on order: <strong>{purchase.buyerName}</strong>
      </p>
      <p>
        Quantity: <strong>{purchase.quantity}</strong>
      </p>
      <TicketReceiptPricing purchase={purchase} />
    </section>
  );
}
