import { describe, expect, it } from "vitest";

import {
  memberProfileSchema,
  memberProfileUpdateRequestSchema,
  organizationProfileDeleteResponseSchema,
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

describe("organizationProfileDeleteResponseSchema", () => {
  it("validates successful profile deletion response", () => {
    const parsed = organizationProfileDeleteResponseSchema.parse({
      deleted: true,
      profileId: "11111111-1111-4111-8111-111111111111",
      requestId: "22222222-2222-4222-8222-222222222222",
    });
    expect(parsed.deleted).toBe(true);
    expect(parsed.profileId).toBe("11111111-1111-4111-8111-111111111111");
  });
});

describe("directory contact visibility preferences", () => {
  it("keeps omitted update fields absent for backward-compatible writes", () => {
    const parsed = memberProfileUpdateRequestSchema.parse({ displayName: "Singer" });
    expect(parsed.showEmailInDirectory).toBeUndefined();
    expect(parsed.showPhoneInDirectory).toBeUndefined();
  });
  it.each([true, false, undefined])("accepts boolean or omitted preferences (%s)", (value) => {
    expect(
      memberProfileUpdateRequestSchema.parse({
        displayName: "Singer",
        showEmailInDirectory: value,
        showPhoneInDirectory: value,
      }),
    ).toMatchObject({ displayName: "Singer" });
  });
  it.each([null, "false", 0])("rejects invalid preference values (%s)", (value) => {
    expect(
      memberProfileUpdateRequestSchema.safeParse({
        displayName: "Singer",
        showEmailInDirectory: value,
      }).success,
    ).toBe(false);
    expect(
      memberProfileUpdateRequestSchema.safeParse({
        displayName: "Singer",
        showPhoneInDirectory: value,
      }).success,
    ).toBe(false);
  });
  it("defaults missing read fields to visible for older responses", () => {
    const parsed = memberProfileSchema.parse({
      displayName: "Singer",
      email: "singer@example.test",
      globalStatus: "Active",
      id: "11111111-1111-4111-8111-111111111111",
      voicePart: "",
    });
    expect(parsed).toMatchObject({ showEmailInDirectory: true, showPhoneInDirectory: true });
  });
});
