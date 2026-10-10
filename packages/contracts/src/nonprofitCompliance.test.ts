import { describe, expect, it } from "vitest";
import {
  complianceTaskCreateRequestSchema,
  MAX_COMPLIANCE_TASKS,
  nonprofitComplianceSettingsSchema,
  nonprofitComplianceTaskSchema,
} from "./nonprofitCompliance";

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
    expect(nonprofitComplianceTaskSchema.parse(task)).toMatchObject(task);
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

describe("organization compliance catalog", () => {
  it("defaults legacy tasks to builtin, unarchived, and unassigned", () => {
    const parsed = nonprofitComplianceTaskSchema.parse(task);
    expect(parsed).toMatchObject({
      archived: false,
      description: "",
      referenceUrl: null,
      responsibleMembershipId: null,
      responsibleNeedsReassignment: false,
      source: "builtin",
      templateKey: null,
    });
  });

  it("accepts the Ohio unclaimed-funds built-in kind", () => {
    const parsed = nonprofitComplianceTaskSchema.parse({
      ...task,
      kind: "ohio_unclaimed_funds_annual_report",
    });
    expect(parsed.kind).toBe("ohio_unclaimed_funds_annual_report");
  });

  it("accepts custom tasks with null kind and no template key", () => {
    const parsed = nonprofitComplianceTaskSchema.parse({
      ...task,
      kind: null,
      source: "custom",
      templateKey: null,
      title: "Custom deadline",
    });
    expect(parsed.source).toBe("custom");
    expect(parsed.kind).toBeNull();
  });

  it("rejects archived builtins and custom tasks carrying a template key", () => {
    expect(nonprofitComplianceTaskSchema.safeParse({ ...task, archived: true }).success).toBe(
      false,
    );
    expect(
      nonprofitComplianceTaskSchema.safeParse({
        ...task,
        kind: null,
        source: "custom",
        templateKey: "irs_annual_return",
      }).success,
    ).toBe(false);
    expect(
      nonprofitComplianceTaskSchema.safeParse({ ...task, kind: null, source: "builtin" }).success,
    ).toBe(false);
  });

  it("rejects unsafe reference URLs", () => {
    expect(
      nonprofitComplianceTaskSchema.safeParse({ ...task, referenceUrl: "javascript:alert(1)" })
        .success,
    ).toBe(false);
    expect(
      nonprofitComplianceTaskSchema.safeParse({ ...task, referenceUrl: "https://example.test/x" })
        .success,
    ).toBe(true);
  });

  it("enforces the bounded catalog cap", () => {
    expect(MAX_COMPLIANCE_TASKS).toBe(50);
    const one = nonprofitComplianceTaskSchema.parse(task);
    const many = Array.from({ length: MAX_COMPLIANCE_TASKS + 1 }, (_, index) => ({
      ...one,
      id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    }));
    expect(
      nonprofitComplianceSettingsSchema.safeParse({ enabled: true, tasks: many }).success,
    ).toBe(false);
    const capped = Array.from({ length: MAX_COMPLIANCE_TASKS }, (_, index) => ({
      ...one,
      id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    }));
    expect(
      nonprofitComplianceSettingsSchema.safeParse({ enabled: true, tasks: capped }).success,
    ).toBe(true);
  });

  it("validates custom creation payloads", () => {
    expect(complianceTaskCreateRequestSchema.safeParse({ title: "Yearly filing" }).success).toBe(
      true,
    );
    expect(complianceTaskCreateRequestSchema.safeParse({ title: "  " }).success).toBe(false);
    expect(
      complianceTaskCreateRequestSchema.safeParse({
        referenceUrl: "ftp://example.test/file",
        title: "Yearly filing",
      }).success,
    ).toBe(false);
  });
});
