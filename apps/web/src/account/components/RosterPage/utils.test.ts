import { describe, expect, it } from "vitest";

import { emptyProfile } from "./utils";

describe("RosterPage emptyProfile", () => {
  it("defaults receiveAdminNotifications to false when adding someone to the roster", () => {
    expect(emptyProfile.receiveAdminNotifications).toBe(false);
    expect(emptyProfile.receiveAttendanceReports).toBe(true);
    expect(emptyProfile.showInDirectory).toBe(true);
    expect(emptyProfile.doNotEmail).toBe(false);
    expect(emptyProfile.isSectionLeader).toBe(false);
  });
});
