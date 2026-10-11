import { describe, expect, it } from "vitest";

import {
  memberProfileSchema,
  memberProfileUpdateRequestSchema,
  organizationProfileRequestSchema,
} from "./profiles";

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

describe("reminder preferences", () => {
  it("leaves reminder flags undefined when omitted from update payloads", () => {
    const update = memberProfileUpdateRequestSchema.parse({ displayName: "Jane Doe" });
    expect(update.receiveRehearsalReminders).toBeUndefined();
    expect(update.receivePerformanceReminders).toBeUndefined();
    expect(update.receiveOtherEventReminders).toBeUndefined();
    const adminUpdate = organizationProfileRequestSchema.parse({ displayName: "Jane Doe" });
    expect(adminUpdate.receiveRehearsalReminders).toBeUndefined();
    expect(
      memberProfileSchema.parse({
        displayName: "Jane Doe",
        email: "",
        globalStatus: "Active",
        id: "11111111-1111-4111-8111-111111111111",
        voicePart: "S1",
      }),
    ).toMatchObject({
      receiveOtherEventReminders: true,
      receivePerformanceReminders: true,
      receiveRehearsalReminders: true,
    });
  });
});
