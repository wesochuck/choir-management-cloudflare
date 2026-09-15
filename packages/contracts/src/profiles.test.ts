import { describe, expect, it } from "vitest";

import { organizationProfileRequestSchema } from "./profiles";

describe("organizationProfileRequestSchema", () => {
  it("defaults receiveAdminNotifications to false for member profiles", () => {
    const parsed = organizationProfileRequestSchema.parse({
      displayName: "Jane Doe",
    });
    expect(parsed.receiveAdminNotifications).toBe(false);
    expect(parsed.receiveAttendanceReports).toBe(true);
    expect(parsed.showInDirectory).toBe(true);
    expect(parsed.doNotEmail).toBe(false);
    expect(parsed.hidden).toBe(false);
    expect(parsed.isSectionLeader).toBe(false);
  });
});
