import type { DonationRecord } from "@choir/contracts";
import { describe, expect, it } from "vitest";
import { canRefundDonation, donationStatusDisplay } from "./types";

describe("donationStatusDisplay and canRefundDonation", () => {
  const baseDonation: Pick<DonationRecord, "refundRequested" | "status"> = {
    refundRequested: false,
    status: "paid",
  };

  it("displays Paid with success badge and permits refund for standard paid donation", () => {
    const display = donationStatusDisplay(baseDonation);
    expect(display.label).toBe("Paid");
    expect(display.badgeClass).toBe("status-pill status-pill--success");
    expect(canRefundDonation(baseDonation)).toBe(true);
  });

  it("displays Refund requested with warning badge and suppresses refund when refundRequested is true", () => {
    const requestedDonation = {
      ...baseDonation,
      refundRequested: true,
    };
    const display = donationStatusDisplay(requestedDonation);
    expect(display.label).toBe("Refund requested");
    expect(display.badgeClass).toBe("status-pill status-pill--warning");
    expect(canRefundDonation(requestedDonation)).toBe(false);
  });

  it("displays Refunded with neutral badge and suppresses refund when status is refunded", () => {
    const refundedDonation = {
      ...baseDonation,
      refundRequested: true,
      status: "refunded" as const,
    };
    const display = donationStatusDisplay(refundedDonation);
    expect(display.label).toBe("Refunded");
    expect(display.badgeClass).toBe("status-pill status-pill--neutral");
    expect(canRefundDonation(refundedDonation)).toBe(false);
  });
});
