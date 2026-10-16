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

describe("folder numbers dirty tracking", () => {
  it("detects changes in folder number and folder returned status", async () => {
    const { areFolderNumbersDirty, getModifiedFolderNumbers } = await import("./utils");
    const firstFolder = {
      eventId: "e1",
      eventTitle: "Concert A",
      eventType: "Performance" as const,
      folderNumber: "12",
      folderReturned: false,
      profileId: "p1",
      returnedAt: null,
      startsAt: "2026-12-01T19:00:00Z",
      updatedAt: null,
    };
    const secondFolder = {
      eventId: "e2",
      eventTitle: "Concert B",
      eventType: "Performance" as const,
      folderNumber: "",
      folderReturned: false,
      profileId: "p1",
      returnedAt: null,
      startsAt: "2026-12-15T19:00:00Z",
      updatedAt: null,
    };
    const baseline = [firstFolder, secondFolder];

    // Pristine
    expect(areFolderNumbersDirty(baseline, baseline)).toBe(false);
    expect(getModifiedFolderNumbers(baseline, baseline)).toEqual([]);

    // When empty baseline
    expect(areFolderNumbersDirty(baseline, [])).toBe(false);
    expect(getModifiedFolderNumbers(baseline, [])).toEqual([]);

    // Checkbox toggled
    const returnedChanged = [{ ...firstFolder, folderReturned: true }, secondFolder];
    expect(areFolderNumbersDirty(returnedChanged, baseline)).toBe(true);
    expect(getModifiedFolderNumbers(returnedChanged, baseline)).toEqual([returnedChanged[0]]);

    // Folder number changed
    const numberChanged = [firstFolder, { ...secondFolder, folderNumber: "45" }];
    expect(areFolderNumbersDirty(numberChanged, baseline)).toBe(true);
    expect(getModifiedFolderNumbers(numberChanged, baseline)).toEqual([numberChanged[1]]);

    // Whitespace only matching trimmed
    const whitespaceOnly = [{ ...firstFolder, folderNumber: "  12  " }, secondFolder];
    expect(areFolderNumbersDirty(whitespaceOnly, baseline)).toBe(false);
    expect(getModifiedFolderNumbers(whitespaceOnly, baseline)).toEqual([]);
  });
});
