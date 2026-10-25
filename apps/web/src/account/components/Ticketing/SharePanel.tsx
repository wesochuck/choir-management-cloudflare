import { isTicketEventShareable, ticketSalesPath } from "@choir/domain";
import type { OrganizationEvent, TicketBundle } from "@choir/contracts";
import { useEffect, useState } from "react";
import { QRCodeShareCard } from "../../QRCodeShareCard";
import { money } from "./shared";

export function SharePanel({
  bundles,
  ticketEvents,
}: {
  readonly bundles: readonly TicketBundle[];
  readonly ticketEvents: readonly OrganizationEvent[];
}) {
  const [nowMs, setNowMs] = useState(Date.now);

  useEffect(() => {
    const refresh = () => {
      setNowMs(Date.now());
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

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
