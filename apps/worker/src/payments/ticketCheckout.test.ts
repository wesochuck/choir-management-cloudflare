import { describe, expect, it } from "vitest";

import {
  TicketCheckoutUnavailableError,
  ticketCheckoutLineItems,
  ticketCheckoutMode,
} from "./ticketCheckout";

describe("ticket checkout provider boundary", () => {
  it("permits deterministic fake checkout outside production", () => {
    expect(ticketCheckoutMode({ APP_ENV: "local", EXTERNAL_EFFECTS_MODE: "fake" })).toBe("fake");
    expect(ticketCheckoutMode({ APP_ENV: "staging", EXTERNAL_EFFECTS_MODE: "fake" })).toBe("fake");
  });

  it("refuses disabled, unqualified sandbox, and production effects", () => {
    expect(() =>
      ticketCheckoutMode({ APP_ENV: "production", EXTERNAL_EFFECTS_MODE: "fake" }),
    ).toThrow(TicketCheckoutUnavailableError);
    expect(() =>
      ticketCheckoutMode({ APP_ENV: "staging", EXTERNAL_EFFECTS_MODE: "sandbox" }),
    ).toThrow(TicketCheckoutUnavailableError);
    expect(() =>
      ticketCheckoutMode({ APP_ENV: "local", EXTERNAL_EFFECTS_MODE: "disabled" }),
    ).toThrow(TicketCheckoutUnavailableError);
  });

  it("permits explicitly enabled Stripe test/live checkout only outside local and preview", () => {
    expect(
      ticketCheckoutMode({
        APP_ENV: "staging",
        EXTERNAL_EFFECTS_MODE: "sandbox",
        STRIPE_PAYMENTS_ENABLED: "true",
      }),
    ).toBe("stripe");
    expect(
      ticketCheckoutMode({
        APP_ENV: "production",
        EXTERNAL_EFFECTS_MODE: "sandbox",
        STRIPE_PAYMENTS_ENABLED: "true",
      }),
    ).toBe("stripe");
  });

  it("passes the authoritative discounted subtotal and fee to Stripe", () => {
    expect(
      ticketCheckoutLineItems({
        discountedSubtotalCents: 1_600,
        feeCents: 77,
        productName: "Concert ticket",
      }),
    ).toEqual([
      { productName: "Concert ticket", quantity: 1, unitAmountCents: 1_600 },
      { productName: "Processing fee", quantity: 1, unitAmountCents: 77 },
    ]);
  });

  it("omits provider line items for a fully complimentary order", () => {
    expect(
      ticketCheckoutLineItems({
        discountedSubtotalCents: 0,
        feeCents: 0,
        productName: "Concert ticket",
      }),
    ).toEqual([]);
  });
});
