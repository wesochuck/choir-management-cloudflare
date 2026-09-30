import { describe, expect, it } from "vitest";

import {
  addDaysToDateOnly,
  addDaysToIsoDateTime,
  addMonthsToDateOnly,
  compareDateOnly,
  complianceTaskStatus,
  isValidDateOnlyString,
  nextDueDateFromCompletion,
} from "./complianceRecurrence";

describe("complianceTaskStatus", () => {
  // Fixed historical snapshot includes the leap-day reminder boundary.
  const today = "2024-02-01";
  it.each([
    { days: 29, completed: false, status: "scheduled" },
    { days: 29, completed: true, status: "completed" },
    { days: 28, completed: false, status: "upcoming" },
    { days: 28, completed: true, status: "upcoming" },
    { days: 1, completed: true, status: "upcoming" },
    { days: 0, completed: false, status: "due" },
    { days: 0, completed: true, status: "due" },
    { days: -1, completed: false, status: "overdue" },
    { days: -1, completed: true, status: "overdue" },
    { days: null, completed: false, status: "not_scheduled" },
    { days: null, completed: true, status: "completed" },
  ])("returns $status at $days days with completion=$completed", ({ days, completed, status }) => {
    expect(
      complianceTaskStatus(
        {
          applicable: true,
          lastCompletedDate: completed ? "2023-02-01" : null,
          nextDueDate: days === null ? null : addDaysToDateOnly(today, days),
        },
        today,
      ),
    ).toBe(status);
  });

  it("keeps inapplicable tasks neutral even when their deadline has passed", () => {
    expect(
      complianceTaskStatus(
        { applicable: false, lastCompletedDate: null, nextDueDate: "2024-01-01" },
        today,
      ),
    ).toBe("not_applicable");
  });
});

describe("isValidDateOnlyString", () => {
  it("accepts well-formed calendar dates", () => {
    expect(isValidDateOnlyString("2026-05-15")).toBe(true);
    expect(isValidDateOnlyString("2024-02-29")).toBe(true);
  });

  it("rejects malformed or impossible dates", () => {
    expect(isValidDateOnlyString("2026-5-15")).toBe(false);
    expect(isValidDateOnlyString("2026-02-30")).toBe(false);
    expect(isValidDateOnlyString("2023-02-29")).toBe(false);
    expect(isValidDateOnlyString("2026-13-01")).toBe(false);
    expect(isValidDateOnlyString("2026-00-10")).toBe(false);
    expect(isValidDateOnlyString("not-a-date")).toBe(false);
    expect(isValidDateOnlyString("2026-05-15T00:00:00.000Z")).toBe(false);
  });
});

describe("addMonthsToDateOnly", () => {
  it("advances annual and multi-year recurrences", () => {
    expect(addMonthsToDateOnly("2026-05-15", 12)).toBe("2027-05-15");
    expect(addMonthsToDateOnly("2026-05-15", 60)).toBe("2031-05-15");
  });

  it("clamps month-end days instead of overflowing", () => {
    expect(addMonthsToDateOnly("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDateOnly("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsToDateOnly("2026-08-31", 6)).toBe("2027-02-28");
  });

  it("throws on invalid anchors", () => {
    expect(() => addMonthsToDateOnly("2026-13-40", 12)).toThrow();
  });
});

describe("addDaysToDateOnly", () => {
  it("advances weekly reminder cadences across month boundaries", () => {
    expect(addDaysToDateOnly("2026-05-15", 7)).toBe("2026-05-22");
    expect(addDaysToDateOnly("2026-05-29", 7)).toBe("2026-06-05");
  });
});

describe("compareDateOnly", () => {
  it("orders ISO date strings chronologically", () => {
    expect(compareDateOnly("2026-05-14", "2026-05-15")).toBe(-1);
    expect(compareDateOnly("2026-05-15", "2026-05-15")).toBe(0);
    expect(compareDateOnly("2026-05-16", "2026-05-15")).toBe(1);
  });
});

describe("nextDueDateFromCompletion", () => {
  it("anchors the next cycle to the prior due date, not the completion day", () => {
    expect(nextDueDateFromCompletion("2026-05-15", 12)).toBe("2027-05-15");
    expect(nextDueDateFromCompletion("2021-05-15", 60)).toBe("2026-05-15");
  });
});

describe("addDaysToIsoDateTime", () => {
  it("advances reminder timestamps by whole days", () => {
    expect(addDaysToIsoDateTime("2026-05-15T12:00:00.000Z", 7)).toBe("2026-05-22T12:00:00.000Z");
  });

  it("throws on invalid timestamps", () => {
    expect(() => addDaysToIsoDateTime("not-a-date", 7)).toThrow();
  });
});
