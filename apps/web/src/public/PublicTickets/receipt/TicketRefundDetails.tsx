import type { PublicTicketReceipt } from "@choir/contracts";
import { PublicGraphicImage } from "../../PublicGraphicImage";
import { getRefundedAmountCents, getRefundedAt, money, publicDate } from "../shared";
import { TicketOrderSchedule } from "./TicketOrderSummary";

export function TicketRefundSummary({ purchase }: { readonly purchase: PublicTicketReceipt }) {
  const hasDiscount = Boolean(purchase.discountCode) || purchase.discountAmountCents > 0;
  const refundedAt = getRefundedAt(purchase);

  return (
    <section
      aria-labelledby="ticket-refund-summary-heading"
      className="ticket-refund-summary panel"
    >
      <h2 id="ticket-refund-summary-heading">Refund summary</h2>
      <dl>
        <div className="ticket-refund-summary__highlight">
          <dt>Refunded amount</dt>
          <dd>{money(getRefundedAmountCents(purchase))}</dd>
        </div>
        {refundedAt ? (
          <div>
            <dt>Refund processed</dt>
            <dd>
              <time dateTime={refundedAt}>{publicDate(refundedAt, purchase.timezone)}</time>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Original subtotal</dt>
          <dd>{money(purchase.originalSubtotalCents)}</dd>
        </div>
        {hasDiscount ? (
          <>
            <div>
              <dt>{purchase.discountCode ? `Discount (${purchase.discountCode})` : "Discount"}</dt>
              <dd>−{money(purchase.discountAmountCents)}</dd>
            </div>
            <div>
              <dt>Discounted subtotal</dt>
              <dd>{money(purchase.discountedSubtotalCents)}</dd>
            </div>
          </>
        ) : null}
        <div>
          <dt>Processing fee</dt>
          <dd>{money(purchase.feeCents)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function TicketRefundOrderDetails({
  graphicUrl,
  purchase,
}: {
  readonly graphicUrl?: string | null | undefined;
  readonly purchase: PublicTicketReceipt;
}) {
  return (
    <section
      aria-labelledby="ticket-refund-order-heading"
      className="ticket-refund-order-details panel"
    >
      <PublicGraphicImage
        alt={purchase.bundleId ? purchase.bundleTitle : purchase.eventTitle}
        className="ticket-receipt-graphic__image"
        src={graphicUrl}
        wrapperClassName="ticket-receipt-graphic"
      />
      <h2 id="ticket-refund-order-heading">Refunded order details</h2>
      <h3>{purchase.bundleId ? purchase.bundleTitle : purchase.eventTitle}</h3>
      <TicketOrderSchedule purchase={purchase} />
      <dl className="ticket-refund-order-details__facts">
        <div>
          <dt>Name on order</dt>
          <dd>{purchase.buyerName}</dd>
        </div>
        <div>
          <dt>Quantity</dt>
          <dd>{purchase.quantity}</dd>
        </div>
      </dl>
    </section>
  );
}
