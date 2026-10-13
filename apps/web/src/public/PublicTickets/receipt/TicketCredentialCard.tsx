import type { PublicTicketReceipt, TicketConfirmationSettings } from "@choir/contracts";
import { useState } from "react";
import { QRCodeImage } from "../../../shared/QRCodeImage";
import { getEventVenueDetails } from "../../venueDetails";
import { publicDate } from "../shared";

export function SingleTicketCredentialCard({
  purchase,
  settings,
}: {
  readonly purchase: PublicTicketReceipt;
  readonly settings: TicketConfirmationSettings;
}) {
  const [qrFailedToken, setQrFailedToken] = useState<string | null>(null);
  const qrFailedForCurrentToken =
    purchase.scanToken !== null && qrFailedToken === purchase.scanToken;
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
          alt={`Admission QR code for ${purchase.eventTitle}`}
          className="ticket-credential-card__qr-image"
          errorCorrectionLevel="H"
          fallbackMessage="The QR code could not be displayed. Use the ticket link or show this page to event staff."
          margin={2}
          onError={() => {
            setQrFailedToken(purchase.scanToken);
          }}
          payload={purchase.scanToken ?? ""}
          width={280}
        />
      </div>
      <p className="ticket-credential-card__instructions">
        {settings.qrCodeInstructions || "Present this QR code at the door."}
      </p>
      <div className="ticket-credential-card__event-details">
        <h4>{purchase.eventTitle}</h4>
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
      {qrFailedForCurrentToken ? (
        <details className="ticket-credential-card__fallback-disclosure">
          <summary>Manual credential</summary>
          <code className="ticket-credential">{purchase.scanToken}</code>
        </details>
      ) : null}
    </article>
  );
}

interface BundlePassEvent {
  readonly event: PublicTicketReceipt["includedEvents"][number];
  readonly venue: ReturnType<typeof getEventVenueDetails>;
}

interface BundlePassVenueSummary {
  readonly displayName: string | null;
  readonly address: string | null;
  readonly commonMapUrl: string | null;
  readonly eventMapUrl: string | null;
  readonly commonMapLabel: string;
}

function sharedVenueValue(values: readonly string[]): string | null {
  const first = values[0];
  return first && values.every((value) => value === first) ? first : null;
}

function getBundlePassEvents(purchase: PublicTicketReceipt): readonly BundlePassEvent[] {
  return [...purchase.includedEvents]
    .sort((a, b) => {
      const diff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      return diff !== 0 ? diff : a.title.localeCompare(b.title);
    })
    .map((event) => ({
      event,
      venue: getEventVenueDetails({
        location: event.location,
        venueAddress: event.venueAddress,
        venueName: event.venueName,
      }),
    }));
}

function getBundlePassVenueSummary(events: readonly BundlePassEvent[]): BundlePassVenueSummary {
  const displayName = sharedVenueValue(events.map(({ venue }) => venue.displayName));
  const address = sharedVenueValue(events.map(({ venue }) => venue.venueAddress));
  const eventMapUrl = sharedVenueValue(events.map(({ venue }) => venue.googleMapsUrl ?? ""));
  const addressMapUrl = address
    ? getEventVenueDetails({ venueAddress: address }).googleMapsUrl
    : null;
  const commonMapUrl = eventMapUrl ?? (displayName === null ? addressMapUrl : null);

  return {
    address,
    commonMapLabel:
      eventMapUrl !== null ? "View on Google Maps" : "View shared address on Google Maps",
    commonMapUrl,
    displayName,
    eventMapUrl,
  };
}

function BundlePassEventVenue({
  venue,
  sharedVenue,
}: {
  readonly venue: ReturnType<typeof getEventVenueDetails>;
  readonly sharedVenue: BundlePassVenueSummary;
}) {
  const shouldShowName = sharedVenue.displayName === null && venue.displayName !== "";
  const shouldShowAddress = sharedVenue.address === null && venue.venueAddress !== "";
  return (
    <>
      {shouldShowName ? (
        <p>
          <strong>{venue.displayName}</strong>
        </p>
      ) : null}
      {shouldShowAddress ? <p>{venue.venueAddress}</p> : null}
      {venue.googleMapsUrl && venue.googleMapsUrl !== sharedVenue.eventMapUrl ? (
        <p>
          <a href={venue.googleMapsUrl} rel="noreferrer" target="_blank">
            View on Google Maps
          </a>
        </p>
      ) : null}
    </>
  );
}

function BundlePassSharedVenue({ venue }: { readonly venue: BundlePassVenueSummary }) {
  const hasSharedDetails = [venue.displayName, venue.address, venue.commonMapUrl].some(Boolean);
  if (!hasSharedDetails) {
    return null;
  }

  return (
    <section
      aria-label="Venue details shared by all included concerts"
      className="ticket-pass-card__shared-venue"
    >
      <h4>Shared venue</h4>
      {venue.displayName ? (
        <p>
          <strong>{venue.displayName}</strong>
        </p>
      ) : null}
      {venue.address ? <p>{venue.address}</p> : null}
      {venue.commonMapUrl ? (
        <p>
          <a href={venue.commonMapUrl} rel="noreferrer" target="_blank">
            {venue.commonMapLabel}
          </a>
        </p>
      ) : null}
    </section>
  );
}

function BundlePassIncludedEvents({
  events,
  sharedVenue,
  timezone,
}: {
  readonly events: readonly BundlePassEvent[];
  readonly sharedVenue: BundlePassVenueSummary;
  readonly timezone: string;
}) {
  return (
    <section aria-label="Included concerts" className="ticket-pass-card__events">
      <h3>Included concerts</h3>
      {events.length > 0 ? (
        <ul className="ticket-pass-event-list">
          {events.map(({ event, venue }) => (
            <li className="ticket-pass-event" key={event.id}>
              <h4>{event.title}</h4>
              <p>{publicDate(event.startsAt, timezone)}</p>
              <BundlePassEventVenue sharedVenue={sharedVenue} venue={venue} />
            </li>
          ))}
        </ul>
      ) : (
        <p>Concert details are not available yet.</p>
      )}
      <BundlePassSharedVenue venue={sharedVenue} />
    </section>
  );
}

export function BundlePassCredentialCard({
  purchase,
  settings,
}: {
  readonly purchase: PublicTicketReceipt;
  readonly settings: TicketConfirmationSettings;
}) {
  const [qrFailedToken, setQrFailedToken] = useState<string | null>(null);
  const events = getBundlePassEvents(purchase);
  const sharedVenue = getBundlePassVenueSummary(events);
  const hasScanCredential = purchase.status === "paid" && purchase.scanToken !== null;
  const qrFailedForCurrentToken = hasScanCredential && qrFailedToken === purchase.scanToken;
  const qrInstructions = settings.qrCodeInstructions.trim()
    ? settings.qrCodeInstructions
    : "Present this pass QR code at the door for admission.";

  return (
    <article
      aria-label="Bundle pass admission credential"
      className="ticket-credential-card ticket-pass-card panel"
    >
      <header className="ticket-pass-card__header">
        <h2>Your bundle pass</h2>
        <h3>{purchase.bundleTitle}</h3>
        <p>
          Includes <strong>{events.length}</strong> {events.length === 1 ? "concert" : "concerts"}
        </p>
      </header>
      {hasScanCredential ? (
        <div className="ticket-credential-card__qr ticket-pass-card__qr">
          <QRCodeImage
            alt={`Bundle pass QR code for ${purchase.bundleTitle}; valid for all ${String(events.length)} included concerts`}
            className="ticket-credential-card__qr-image"
            errorCorrectionLevel="H"
            fallbackMessage="The QR code could not be displayed. Use the ticket link or show this page to event staff."
            margin={2}
            onError={() => {
              setQrFailedToken(purchase.scanToken);
            }}
            payload={purchase.scanToken ?? ""}
            width={280}
          />
        </div>
      ) : null}
      {hasScanCredential ? (
        <p className="ticket-credential-card__instructions ticket-pass-card__instructions">
          {qrInstructions} This same pass QR code is valid for every included concert.
        </p>
      ) : null}
      <BundlePassIncludedEvents
        events={events}
        sharedVenue={sharedVenue}
        timezone={purchase.timezone}
      />
      {qrFailedForCurrentToken ? (
        <details className="ticket-credential-card__fallback-disclosure">
          <summary>Manual credential</summary>
          <code className="ticket-credential">{purchase.scanToken}</code>
        </details>
      ) : null}
    </article>
  );
}
