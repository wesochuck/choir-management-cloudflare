/**
 * Stripe Checkout supports complimentary orders locally, but paid card charges
 * must meet Stripe's USD minimum. Keep this rule provider-independent so every
 * online checkout path has the same behavior before it creates local state.
 */
export const MINIMUM_PAID_CHECKOUT_CENTS = 50;

export function isSupportedPaidCheckoutAmount(totalCents: number): boolean {
  return totalCents === 0 || totalCents >= MINIMUM_PAID_CHECKOUT_CENTS;
}
