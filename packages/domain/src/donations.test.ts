import { describe, expect, it } from "vitest";

import { canTransitionDonation } from "./donations";

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
