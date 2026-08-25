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
      <div className="ticketing-share-grid">
        <QRCodeShareCard
          asFieldset
          description="Share this page so your audience can see available performances and buy tickets."
          path="/tickets"
          title="All ticketing"
        />
        {ticketEvents.map((event) => (
          <QRCodeShareCard
            asFieldset
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
              asFieldset
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
