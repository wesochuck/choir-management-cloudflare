import { describe, expect, it } from "vitest";

import { canSetDonationThankYouStatus, canTransitionDonation } from "./donations";

describe("donation thank-you status", () => {
  it("allows paid status changes, blocks refunded mark-sent, and permits undo", () => {
    expect(canSetDonationThankYouStatus("paid", true)).toBe(true);
    expect(canSetDonationThankYouStatus("paid", false)).toBe(true);
    expect(canSetDonationThankYouStatus("refunded", true)).toBe(false);
    expect(canSetDonationThankYouStatus("refunded", false)).toBe(true);
  });
});

describe("donation status transitions", () => {
  it("allows an expired checkout to complete later", () => {
    expect(canTransitionDonation("pending", "expired")).toBe(true);
    expect(canTransitionDonation("expired", "paid")).toBe(true);
  });

  it("does not reopen refunded or paid donations", () => {
    expect(canTransitionDonation("refunded", "paid")).toBe(false);
    expect(canTransitionDonation("paid", "pending")).toBe(false);
  });
});
