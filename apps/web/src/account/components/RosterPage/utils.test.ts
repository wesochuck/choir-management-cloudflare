import { describe, expect, it } from "vitest";

import { emptyProfile } from "./utils";

describe("RosterPage emptyProfile", () => {
  it("defaults receiveAdminNotifications to false when adding someone to the roster", () => {
    expect(emptyProfile.receiveAdminNotifications).toBe(false);
    expect(emptyProfile.receiveFinancialAlerts).toBe(false);
    expect(emptyProfile.receiveAttendanceReports).toBe(true);
    expect(emptyProfile.receiveOtherEventReminders).toBe(true);
    expect(emptyProfile.receivePerformanceReminders).toBe(true);
    expect(emptyProfile.receiveRehearsalReminders).toBe(true);
    expect(emptyProfile.showInDirectory).toBe(true);
    expect(emptyProfile.doNotEmail).toBe(false);
    expect(emptyProfile.isSectionLeader).toBe(false);
  });
});

describe("duesStatusLabel", () => {
  it("formats dues status accurately for cash, online, and pending checkouts", async () => {
    const { duesStatusLabel } = await import("./utils");
    const now = new Date().toISOString();
    const base = {
      amountCents: 5000,
      createdAt: now,
      feeCents: 0,
      id: "1",
      paidAt: null,
      profileId: "p1",
      refundRequested: false,
      seasonId: "s1",
      sharedCheckout: false,
      updatedAt: now,
    };

    expect(duesStatusLabel(undefined)).toBe("Not paid");
    expect(
      duesStatusLabel({
        ...base,
        paymentMethod: "cash",
        status: "paid",
      }),
    ).toBe("Paid · Cash");
    expect(
      duesStatusLabel({
        ...base,
        feeCents: 150,
        paymentMethod: "online",
        status: "paid",
      }),
    ).toBe("Paid");
    expect(
      duesStatusLabel({
        ...base,
        feeCents: 150,
        paymentMethod: "online",
        status: "pending",
      }),
    ).toBe("Online checkout pending");
    expect(
      duesStatusLabel({
        ...base,
        feeCents: 150,
        paymentMethod: "online",
        sharedCheckout: true,
        status: "pending",
      }),
    ).toBe("Online checkout pending (shared)");
    expect(
      duesStatusLabel({
        ...base,
        paymentMethod: "online",
        status: "refunded",
      }),
    ).toBe("Refunded");
  });
});
