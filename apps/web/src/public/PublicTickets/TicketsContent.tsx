import { publicPageHeading } from "../publicPageLabels";
import { ticketSalesPath } from "@choir/domain";
import type { PublishedOrganizationProjection, TransactionFeeSettings } from "@choir/contracts";
import { PublicGraphicImage } from "../PublicGraphicImage";
import { mediaUrl } from "../publicMedia";
import { getEventVenueDetails } from "../venueDetails";
import { TicketBundlePurchaseForm } from "./forms/TicketBundlePurchaseForm";
import { TicketPurchaseForm } from "./forms/TicketPurchaseForm";
import { TicketReceipt } from "./receipt/TicketReceipt";
import { money, publicDate, publicTime } from "./shared";

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
    return <TicketReceipt projection={projection} token={search.get("token") ?? ""} />;
  const bundleId = /^\/tickets\/bundles\/([a-z0-9-]+)$/i.exec(pathname)?.[1];
  if (bundleId) {
    const bundle = projection.payload.ticketBundles.find(
      (candidate) => candidate.id === bundleId || candidate.ticketSlug === bundleId,
    );
    return bundle && new Date(bundle.saleEndAt).getTime() > nowMs ? (
      <TicketBundlePurchaseForm bundle={bundle} feeSettings={feeSettings} projection={projection} />
    ) : (
      <p className="notice notice--error">This ticket bundle is no longer available.</p>
    );
  }
  const eventId = /^\/tickets\/([a-z0-9-]+)$/i.exec(pathname)?.[1];
  if (eventId) {
    const event = projection.payload.performances.find(
      (candidate) => candidate.id === eventId || candidate.ticketSlug === eventId,
    );
    return event?.isTicketingEnabled && new Date(event.startsAt).getTime() > nowMs ? (
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
  if (!["/tickets", "/tickets/"].includes(pathname)) {
    return <p className="notice notice--error">This ticket page is not available.</p>;
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
    <section className="public-section public-section--tickets">
      <h1>{publicPageHeading(projection.payload.settings, "tickets", "Tickets")}</h1>
      {events.length === 0 && bundles.length === 0 ? (
        <p>No tickets are currently available.</p>
      ) : (
        <div className="public-performance-grid">
          {bundles.map((bundle) => (
            <article
              className="public-performance-card public-performance-card--ticket"
              key={bundle.id}
            >
              {bundle.graphicFileId ? (
                <PublicGraphicImage
                  alt={bundle.title}
                  src={mediaUrl(projection, bundle.graphicFileId)}
                />
              ) : null}
              <div className="public-performance-card__body">
                <div className="public-performance-card__content">
                  <p>Multi-performance pass</p>
                  <h2>{bundle.title}</h2>
                </div>
                <div className="public-performance-card__purchase">
                  <p>{money(bundle.priceCents)} per pass</p>
                  <a
                    className="button button--primary ticket-card__link"
                    href={ticketSalesPath(bundle, "bundle")}
                  >
                    Buy pass
                  </a>
                </div>
              </div>
            </article>
          ))}
          {events.map((event) => {
            const venueDetails = getEventVenueDetails(event);
            return (
              <article
                className="public-performance-card public-performance-card--ticket"
                key={event.id}
              >
                {event.graphicFileId ? (
                  <PublicGraphicImage
                    alt={event.title}
                    src={mediaUrl(projection, event.graphicFileId)}
                  />
                ) : null}
                <div className="public-performance-card__body">
                  <div className="public-performance-card__content">
                    <p>{publicDate(event.startsAt, projection.payload.timezone)}</p>
                    <h2>{event.title}</h2>
                    {event.doorsOpenTime ? (
                      <p>Doors open at {publicTime(event.doorsOpenTime)}.</p>
                    ) : null}
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
                  </div>
                  <div className="public-performance-card__purchase">
                    <p>From {money(event.advancePriceCents)}</p>
                    <a
                      className="button button--primary ticket-card__link"
                      href={ticketSalesPath(event)}
                    >
                      Buy tickets
                    </a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
