import type { PublicTicketReceipt, TicketConfirmationSettings } from "@choir/contracts";
import { useState } from "react";
import { QRCodeImage } from "../../../shared/QRCodeImage";
import { getEventVenueDetails } from "../../venueDetails";
import {
  DEFAULT_TICKET_CONFIRMATION_SETTINGS,
  publicDate,
  publicDateWithWeekday,
  publicTime,
  publicTimeFromIso,
} from "../shared";

function TicketTimesBox({
  doorsOpenFormatted,
  startTimeFormatted,
}: {
  readonly doorsOpenFormatted: string | null;
  readonly startTimeFormatted: string;
}) {
  return (
    <div
      className={
        doorsOpenFormatted
          ? "admission-ticket__times"
          : "admission-ticket__times admission-ticket__times--single"
      }
    >
      {doorsOpenFormatted ? (
        <div className="admission-ticket__time-block">
          <span className="admission-ticket__time-label">Doors open</span>
          <span className="admission-ticket__time-value">{doorsOpenFormatted}</span>
        </div>
      ) : null}
      <div className="admission-ticket__time-block">
        <span className="admission-ticket__time-label">Concert starts</span>
        <span className="admission-ticket__time-value">{startTimeFormatted}</span>
      </div>
    </div>
  );
}

function TicketVenueRow({ venue }: { readonly venue: ReturnType<typeof getEventVenueDetails> }) {
  return (
    <div className="admission-ticket__venue">
      <span aria-hidden="true" className="admission-ticket__venue-dot">
        ●
      </span>
      <div className="admission-ticket__venue-text">
        {venue.displayName ? (
          <strong className="admission-ticket__venue-name">{venue.displayName}</strong>
        ) : null}
        {venue.venueAddress ? (
          <span className="admission-ticket__venue-address">{venue.venueAddress}</span>
        ) : null}
        {venue.googleMapsUrl ? (
          <p className="admission-ticket__map-paragraph no-print">
            <a
              className="admission-ticket__map-link"
              href={venue.googleMapsUrl}
              rel="noreferrer"
              target="_blank"
            >
              View on Google Maps
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function SingleTicketCredentialCard({
  doorsOpenTime,
  purchase,
  settings,
}: {
  readonly doorsOpenTime?: string | null | undefined;
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

  const rawDoorsOpen =
    doorsOpenTime && doorsOpenTime.trim().length > 0 ? doorsOpenTime : purchase.doorsOpenTime;
  const doorsOpenFormatted = rawDoorsOpen ? publicTime(rawDoorsOpen) : null;
  const startTimeFormatted = publicTimeFromIso(purchase.eventStartsAt, purchase.timezone);
  const hasScanCredential = purchase.status === "paid" && purchase.scanToken !== null;

  const venueInstructions =
    settings.admissionInstructions &&
    settings.admissionInstructions !== DEFAULT_TICKET_CONFIRMATION_SETTINGS.admissionInstructions
      ? settings.admissionInstructions
      : "Show this ticket to staff. They can check the event, name and ticket number. Bring photo ID for Will Call.";

  return (
    <article
      aria-label="Ticket admission credential"
      className="admission-ticket panel ticket-credential-card"
    >
      <div className="admission-ticket__header">
        <div className="admission-ticket__badge-row">
          <h3 aria-label="Your ticket" className="admission-ticket__type">
            Admission ticket
          </h3>
          <span className="admission-ticket__badge">Admits {purchase.quantity}</span>
        </div>
        <h2 className="admission-ticket__event-title">{purchase.eventTitle}</h2>
        <p className="admission-ticket__date">
          {publicDateWithWeekday(purchase.eventStartsAt, purchase.timezone)}
        </p>
      </div>

      <TicketTimesBox
        doorsOpenFormatted={doorsOpenFormatted}
        startTimeFormatted={startTimeFormatted}
      />

      <TicketVenueRow venue={venue} />

      <hr className="admission-ticket__divider" />

      <div className="admission-ticket__id-row">
        <div className="admission-ticket__id-block">
          <span className="admission-ticket__label">Ticket number</span>
          <span className="admission-ticket__id-value">{purchase.id}</span>
          <p className="admission-ticket__purchaser">
            Purchased by <strong>{purchase.buyerName}</strong>
          </p>
        </div>
        <div className="admission-ticket__total-block">
          <span className="admission-ticket__label">Total admission</span>
          <span className="admission-ticket__total-value">{purchase.quantity}</span>
          <span className="admission-ticket__total-unit">
            {purchase.quantity === 1 ? "guest" : "guests"}
          </span>
        </div>
      </div>

      <hr className="admission-ticket__divider admission-ticket__divider--dotted" />

      <div className="admission-ticket__entry-row">
        {hasScanCredential ? (
          <div className="admission-ticket__qr-box">
            <QRCodeImage
              alt={`Admission QR code for ${purchase.eventTitle}`}
              className="admission-ticket__qr-image"
              errorCorrectionLevel="H"
              fallbackMessage="The QR code could not be displayed. Use the ticket link or show this page to event staff."
              margin={2}
              onError={() => {
                setQrFailedToken(purchase.scanToken);
              }}
              payload={purchase.scanToken ?? ""}
              width={130}
            />
          </div>
        ) : null}
        <div className="admission-ticket__instructions-block">
          <h3 className="admission-ticket__instructions-heading">At the venue</h3>
          <p className="admission-ticket__instructions-text">{venueInstructions}</p>
          <p className="admission-ticket__qr-note">QR code retained for future use.</p>
        </div>
      </div>

      <div className="admission-ticket__print-footer">
        <p>Present this ticket at admission. QR code retained for future use.</p>
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
      className="admission-ticket panel ticket-credential-card ticket-pass-card"
    >
      <header className="ticket-pass-card__header admission-ticket__header">
        <div className="admission-ticket__badge-row">
          <h2 aria-label="Your bundle pass" className="admission-ticket__type">
            Your bundle pass
          </h2>
          <span className="admission-ticket__badge">Admits {purchase.quantity}</span>
        </div>
        <h3 className="admission-ticket__event-title">{purchase.bundleTitle}</h3>
        <p className="admission-ticket__date">
          Includes <strong>{events.length}</strong> {events.length === 1 ? "concert" : "concerts"}
        </p>
      </header>

      <div className="admission-ticket__id-row">
        <div className="admission-ticket__id-block">
          <span className="admission-ticket__label">Pass number</span>
          <span className="admission-ticket__id-value">{purchase.id}</span>
          <p className="admission-ticket__purchaser">
            Purchased by <strong>{purchase.buyerName}</strong>
          </p>
        </div>
        <div className="admission-ticket__total-block">
          <span className="admission-ticket__label">Total admission</span>
          <span className="admission-ticket__total-value">{purchase.quantity}</span>
          <span className="admission-ticket__total-unit">
            {purchase.quantity === 1 ? "guest" : "guests"}
          </span>
        </div>
      </div>

      <BundlePassIncludedEvents
        events={events}
        sharedVenue={sharedVenue}
        timezone={purchase.timezone}
      />

      <hr className="admission-ticket__divider admission-ticket__divider--dotted" />

      {hasScanCredential ? (
        <div className="admission-ticket__entry-row">
          <div className="admission-ticket__qr-box">
            <QRCodeImage
              alt={`Bundle pass QR code for ${purchase.bundleTitle}; valid for all ${String(events.length)} included concerts`}
              className="ticket-credential-card__qr-image admission-ticket__qr-image"
              errorCorrectionLevel="H"
              fallbackMessage="The QR code could not be displayed. Use the ticket link or show this page to event staff."
              margin={2}
              onError={() => {
                setQrFailedToken(purchase.scanToken);
              }}
              payload={purchase.scanToken ?? ""}
              width={130}
            />
          </div>
          <div className="admission-ticket__instructions-block">
            <h3 className="admission-ticket__instructions-heading">At the venue</h3>
            <p className="admission-ticket__instructions-text">
              {qrInstructions} This same pass QR code is valid for every included concert.
            </p>
            <p className="admission-ticket__qr-note">QR code retained for future use.</p>
          </div>
        </div>
      ) : null}

      <div className="admission-ticket__print-footer">
        <p>Present this ticket at admission. QR code retained for future use.</p>
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
