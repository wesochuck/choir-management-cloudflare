import { describe, expect, it } from "vitest";

import { formatDonationMoney } from "./donationFormat";

describe("donation money formatting", () => {
  it("formats cents as labeled USD currency with two decimal places", () => {
    expect(formatDonationMoney(100, "en-US")).toBe("$1.00");
    expect(formatDonationMoney(1_234, "en-US")).toBe("$12.34");
  });
});
