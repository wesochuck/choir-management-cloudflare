import { describe, expect, it } from "vitest";

import { isSupportedPaidCheckoutAmount, MINIMUM_PAID_CHECKOUT_CENTS } from "./checkoutAmount";

describe("online paid checkout amount policy", () => {
  it("allows complimentary orders and paid totals at or above the Stripe minimum", () => {
    expect(MINIMUM_PAID_CHECKOUT_CENTS).toBe(50);
    expect(isSupportedPaidCheckoutAmount(0)).toBe(true);
    expect(isSupportedPaidCheckoutAmount(50)).toBe(true);
    expect(isSupportedPaidCheckoutAmount(51)).toBe(true);
  });

  it("rejects paid totals below the Stripe minimum", () => {
    expect(isSupportedPaidCheckoutAmount(1)).toBe(false);
    expect(isSupportedPaidCheckoutAmount(43)).toBe(false);
    expect(isSupportedPaidCheckoutAmount(49)).toBe(false);
  });
});
