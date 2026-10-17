import type { OrganizationEvent, TicketBundle } from "@choir/contracts";
import { ticketSalesPath } from "@choir/domain";
import { money } from "./shared";

export function BundleCard({
  bundle,
  busy,
  eventsById,
  onEdit,
  onDelete,
}: {
  readonly bundle: TicketBundle;
  readonly busy: boolean;
  readonly eventsById: ReadonlyMap<string, OrganizationEvent>;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <article aria-labelledby={`bundle-heading-${bundle.id}`} className="ticket-bundle-card">
      <header className="ticket-bundle-card__header">
        <h4 id={`bundle-heading-${bundle.id}`}>{bundle.title}</h4>
        <span
          className={`ticket-bundle-card__status${bundle.isActive ? " ticket-bundle-card__status--active" : ""}`}
        >
          {bundle.isActive ? "Active" : "Inactive"}
        </span>
      </header>
      <p className="ticket-bundle-card__price">
        <strong>{money(bundle.priceCents)}</strong>
        <span>per pass</span>
      </p>
      <p className="ticket-bundle-card__capacity">
        {bundle.capacity === null ? "Unlimited passes" : `Up to ${String(bundle.capacity)} passes`}
      </p>
      <div className="ticket-bundle-card__performances">
        <h5>
          {bundle.eventIds.length} performance{bundle.eventIds.length === 1 ? "" : "s"} included
        </h5>
        <ul>
          {bundle.eventIds.map((id) => (
            <li key={id}>{eventsById.get(id)?.title ?? "Performance no longer available"}</li>
          ))}
        </ul>
      </div>
      <footer className="ticket-bundle-card__actions">
        <button
          className="button button--secondary button--control-height"
          disabled={busy}
          onClick={onEdit}
          type="button"
        >
          Edit bundle
        </button>
        <a
          className="ticket-bundle-card__link"
          href={ticketSalesPath(bundle, "bundle")}
          rel="noreferrer"
          target="_blank"
        >
          View ticket page <span aria-hidden="true">↗</span>
        </a>
        <button
          aria-label={`Delete ${bundle.title}`}
          className="text-button text-button--danger"
          disabled={busy}
          onClick={onDelete}
          type="button"
        >
          Delete
        </button>
      </footer>
    </article>
  );
}
