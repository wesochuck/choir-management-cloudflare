import type { JSX } from "react";

/**
 * Shared final-step footer for the public ticket and bundle checkout forms.
 * Copy always derives from the same displayed quote total shown above it, so
 * it updates reactively with quantity and discounts (including while a fresh
 * authoritative quote is loading) and never promises a Stripe page for $0
 * orders. Paid orders continue to a Stripe-hosted page; free orders confirm
 * inside Choir Manager.
 */
export function TicketCheckoutFooter({
  busy,
  disabled,
  totalCents,
}: {
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly totalCents: number;
}): JSX.Element {
  const isFree = totalCents === 0;
  return (
    <div className="ticket-checkout-footer">
      <p className="ticket-checkout-footer__note">
        <svg
          aria-hidden="true"
          className="ticket-checkout-footer__icon"
          focusable="false"
          height="16"
          viewBox="0 0 16 16"
          width="16"
        >
          <rect
            fill="none"
            height="6"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.5"
            width="9"
            x="3.5"
            y="7"
          />
          <path
            d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        <span>
          {isFree ? (
            <>
              <strong>No payment required.</strong>
              <br />
              Your free order will be confirmed when you continue.
            </>
          ) : (
            <>
              <strong>You won&apos;t be charged yet.</strong>
              <br />
              You&apos;ll review and confirm your payment securely with Stripe on the next page.
            </>
          )}
        </span>
      </p>
      <button className="button button--primary" disabled={disabled} type="submit">
        {busy
          ? isFree
            ? "Confirming free order…"
            : "Continuing to payment…"
          : isFree
            ? "Confirm free order"
            : "Continue to secure payment"}
      </button>
    </div>
  );
}
