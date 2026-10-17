import type { PublishedOrganizationProjection } from "@choir/contracts";
import { availableTicketBundlesForEvent, ticketSalesPath } from "@choir/domain";
import { money } from "../shared";

export function TicketBundleSuggestions({
  bundles,
  eventId,
  nowMs,
}: {
  readonly bundles: PublishedOrganizationProjection["payload"]["ticketBundles"];
  readonly eventId: string;
  readonly nowMs: number;
}) {
  const available = availableTicketBundlesForEvent(bundles, eventId, nowMs);
  if (available.length === 0) return null;
  return (
    <aside
      className="ticket-bundle-suggestions"
      aria-labelledby="ticket-bundle-suggestions-heading"
    >
      <h2 id="ticket-bundle-suggestions-heading">Coming to more than one concert?</h2>
      {available.map((bundle) => (
        <div className="ticket-bundle-suggestions__row" key={bundle.id}>
          <p>
            This concert is included in <strong>{bundle.title}</strong>.
            <span className="ticket-bundle-suggestions__price">
              {money(bundle.priceCents)} per pass · {bundle.eventIds.length}{" "}
              {bundle.eventIds.length === 1 ? "performance" : "performances"}
            </span>
          </p>
          <a
            className="button button--secondary"
            href={ticketSalesPath(bundle, "bundle")}
            aria-label={`View season pass: ${bundle.title}`}
          >
            View season pass →
          </a>
        </div>
      ))}
    </aside>
  );
}
