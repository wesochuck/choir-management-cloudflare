import type { OrganizationEvent, TicketBundle } from "@choir/contracts";
import { ticketBundleSaleEnd, ticketEventSaleEnd, ticketSalesPath } from "@choir/domain";
import { money } from "./shared";

const saleStatusLabels = {
  open: "On sale",
  closed: "Sales closed",
  inactive: "Inactive",
};

export function BundleCard({
  bundle,
  busy,
  eventsById,
  nowMs,
  onEdit,
  onDelete,
}: {
  readonly bundle: TicketBundle;
  readonly busy: boolean;
  readonly eventsById: ReadonlyMap<string, OrganizationEvent>;
  readonly nowMs: number;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const saleEnd =
    bundle.effectiveSaleEndAt === undefined
      ? ticketBundleSaleEnd(
          bundle.saleEndAt,
          bundle.eventIds.map((id) => {
            const event = eventsById.get(id);
            // The Organization event list excludes archived performances.
            return event ? ticketEventSaleEnd({ ...event, isArchived: false }) : null;
          }),
        )
      : bundle.effectiveSaleEndAt === null
        ? null
        : Date.parse(bundle.effectiveSaleEndAt);
  const onSale = bundle.isActive && saleEnd !== null && nowMs < saleEnd;
  const saleStatus = onSale ? "open" : bundle.isActive ? "closed" : "inactive";

  return (
    <article aria-labelledby={`bundle-heading-${bundle.id}`} className="ticket-bundle-card">
      <header className="ticket-bundle-card__header">
        <h4 id={`bundle-heading-${bundle.id}`}>{bundle.title}</h4>
        <span
          className={`ticket-bundle-card__status${onSale ? " ticket-bundle-card__status--active" : ""}`}
        >
          {saleStatusLabels[saleStatus]}
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
