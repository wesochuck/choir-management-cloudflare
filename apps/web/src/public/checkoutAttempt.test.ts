import { describe, expect, it } from "vitest";

import { AuthApiError } from "../api";
import {
  shouldStartNewDonationCheckoutAttempt,
  shouldStartNewTicketCheckoutAttempt,
} from "./checkoutAttempt";

describe("public checkout attempt identities", () => {
  it("rotates ticket request IDs only after typed terminal application failures", () => {
    expect(
      shouldStartNewTicketCheckoutAttempt(
        new AuthApiError("Too small", 422, "ticket_checkout_amount_too_small"),
      ),
    ).toBe(true);
    expect(
      shouldStartNewTicketCheckoutAttempt(
        new AuthApiError("Changed order", 409, "checkout_request_conflict"),
      ),
    ).toBe(true);
    expect(shouldStartNewTicketCheckoutAttempt(new TypeError("Network failed"))).toBe(false);
    expect(shouldStartNewTicketCheckoutAttempt(new DOMException("Aborted", "AbortError"))).toBe(
      false,
    );
    expect(shouldStartNewTicketCheckoutAttempt(new Error("Invalid JSON"))).toBe(false);
  });

  it("keeps donation request IDs on ambiguous failures and rotates terminal failures", () => {
    expect(
      shouldStartNewDonationCheckoutAttempt(
        new AuthApiError("Expired", 409, "donation_checkout_expired"),
      ),
    ).toBe(true);
    expect(shouldStartNewDonationCheckoutAttempt(new TypeError("Network failed"))).toBe(false);
  });
});
