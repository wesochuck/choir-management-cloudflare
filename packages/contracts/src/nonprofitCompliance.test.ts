import { describe, expect, it } from "vitest";
import { nonprofitComplianceTaskSchema } from "./nonprofitCompliance";

const task = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "irs_annual_return",
  title: "IRS annual return",
  applicable: true,
  lastCompletedDate: null,
  nextDueDate: null,
  nextReminderAt: null,
  recurrenceMonths: 12,
  reminderIntervalDays: 7,
};

describe("compliance completion attribution", () => {
  it("accepts older responses without attribution fields", () => {
    expect(nonprofitComplianceTaskSchema.parse(task)).toEqual(task);
  });
  it.each([
    { lastCompletedByUserId: "admin-id", lastCompletedByName: "Jordan Smith" },
    { lastCompletedByUserId: "admin-id", lastCompletedByName: null },
    { lastCompletedByUserId: null, lastCompletedByName: null },
    { lastCompletedByUserId: undefined, lastCompletedByName: undefined },
  ])("accepts nullable or optional attribution: %j", (attribution) => {
    expect(nonprofitComplianceTaskSchema.parse({ ...task, ...attribution })).toMatchObject(
      attribution,
    );
  });
  it.each([
    { lastCompletedByUserId: 42 },
    { lastCompletedByName: 42 },
    { lastCompletedByName: "" },
  ])("rejects invalid attribution: %j", (attribution) => {
    expect(nonprofitComplianceTaskSchema.safeParse({ ...task, ...attribution }).success).toBe(
      false,
    );
  });
});
