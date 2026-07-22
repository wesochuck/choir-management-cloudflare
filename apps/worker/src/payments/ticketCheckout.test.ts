import { describe, expect, it } from "vitest";

import { TicketCheckoutUnavailableError, ticketCheckoutMode } from "./ticketCheckout";

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
});
