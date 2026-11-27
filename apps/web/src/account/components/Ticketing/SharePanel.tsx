import { isTicketEventShareable, ticketSalesPath } from "@choir/domain";
import type { OrganizationEvent, TicketBundle } from "@choir/contracts";
import { QRCodeShareCard } from "../../QRCodeShareCard";
import { money } from "./shared";
import { useTicketingClock } from "./useTicketingClock";

export function SharePanel({
  bundles,
  ticketEvents,
}: {
  readonly bundles: readonly TicketBundle[];
  readonly ticketEvents: readonly OrganizationEvent[];
}) {
  const nowMs = useTicketingClock();

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
        {ticketEvents
          .filter((event) => isTicketEventShareable(event, nowMs))
          .map((event) => (
            <QRCodeShareCard
              asFieldset
              description={`Tickets for ${event.title}.`}
              key={event.id}
              path={ticketSalesPath(event)}
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
              path={ticketSalesPath(bundle, "bundle")}
              title={bundle.title}
            />
          ))}
      </div>
    </div>
  );
}
