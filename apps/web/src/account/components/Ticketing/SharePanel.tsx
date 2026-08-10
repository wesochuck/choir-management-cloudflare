import type { OrganizationEvent, TicketBundle } from "@choir/contracts";
import { QRCodeShareCard } from "../../QRCodeShareCard";
import { money } from "./shared";

export function SharePanel({
  bundles,
  ticketEvents,
}: {
  readonly bundles: readonly TicketBundle[];
  readonly ticketEvents: readonly OrganizationEvent[];
}) {
  return (
    <div
      aria-labelledby="ticketing-share-tab"
      className="ticketing-tab-panel"
      id="ticketing-share-panel"
      role="tabpanel"
    >
      <div>
        <p className="eyebrow">Share & QR codes</p>
        <h3>Public ticketing links</h3>
        <p>Share these links with your audience. Each page includes a ready-to-scan QR code.</p>
      </div>
      <div className="ticketing-share-grid">
        <QRCodeShareCard
          description="Share this page so your audience can see available performances and buy tickets."
          path="/tickets"
          title="All ticketing"
        />
        {ticketEvents.map((event) => (
          <QRCodeShareCard
            description={`Tickets for ${event.title}.`}
            key={event.id}
            path={`/tickets/${event.id}`}
            title={event.title}
          />
        ))}
        {bundles
          .filter((bundle) => bundle.isActive)
          .map((bundle) => (
            <QRCodeShareCard
              description={`${money(bundle.priceCents)} bundle covering ${String(bundle.eventIds.length)} performance${bundle.eventIds.length === 1 ? "" : "s"}.`}
              key={bundle.id}
              path={`/tickets/bundles/${bundle.id}`}
              title={bundle.title}
            />
          ))}
      </div>
    </div>
  );
}
