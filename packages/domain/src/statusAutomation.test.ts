import { describe, expect, it } from "vitest";

import {
  calculateOnBreakInactiveAt,
  calculateRsvpDeadline,
  evaluateProfileStatus,
  isMissedPerformance,
  performanceHasEnded,
} from "./statusAutomation";

const configuration = {
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  rsvpExpiryEnabled: true,
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
} as const;

describe("status automation rules", () => {
  it("keeps RSVP deadline open through the end of the local deadline date", () => {
    const deadline = calculateRsvpDeadline(
      { startsAt: "2026-04-08T23:00:00.000Z", type: "Performance" },
      7,
      "America/New_York",
    );

    expect(deadline?.deadlineDate).toBe("2026-04-01");
    expect(deadline?.deadlineAt).toBe("2026-04-02T03:59:59.999Z");
  });

  it("uses the scheduled duration or local calendar-day end for event completion", () => {
    const now = new Date("2026-04-02T04:00:00.000Z");
    expect(
      performanceHasEnded(
        { durationMinutes: null, startsAt: "2026-04-01T14:00:00.000Z" },
        now,
        "America/New_York",
      ),
    ).toBe(true);
    expect(
      performanceHasEnded(
        { durationMinutes: 120, startsAt: "2026-04-02T01:00:00.000Z" },
        new Date("2026-04-02T02:00:00.000Z"),
        "America/New_York",
      ),
    ).toBe(false);
  });

  it("treats Present as a non-miss and Absent or No as misses", () => {
    expect(isMissedPerformance({ attendance: "Present", rsvp: "No" })).toBe(false);
    expect(isMissedPerformance({ attendance: "Absent", rsvp: "Pending" })).toBe(true);
    expect(isMissedPerformance({ attendance: "Pending", rsvp: "No" })).toBe(true);
    expect(isMissedPerformance({ attendance: "Pending", rsvp: "Pending" })).toBe(false);
  });

  it("moves an active performer inactive after the configured consecutive misses", () => {
    const now = new Date("2026-04-20T12:00:00.000Z");
    const performances = [1, 2, 3].map((day) => ({
      attendance: "Pending" as const,
      durationMinutes: 120,
      id: `performance-${String(day)}`,
      isArchived: false,
      isCanceled: false,
      rsvp: "No" as const,
      startsAt: `2026-04-${String(day).padStart(2, "0")}T14:00:00.000Z`,
    }));

    expect(
      evaluateProfileStatus({
        configuration,
        now,
        performances,
        profile: { currentStatus: "Active", isManual: false, isPerformer: true },
        timezone: "America/New_York",
      }),
    ).toMatchObject({ nextStatus: "Inactive", triggerType: "performance_miss" });
  });

  it("restores an automatically managed non-active performer from a future Yes RSVP", () => {
    const evaluation = evaluateProfileStatus({
      configuration,
      now: new Date("2026-04-01T12:00:00.000Z"),
      performances: [
        {
          attendance: "Pending",
          durationMinutes: null,
          id: "future-performance",
          isArchived: false,
          isCanceled: false,
          rsvp: "Yes",
          startsAt: "2026-04-08T12:00:00.000Z",
        },
      ],
      profile: { currentStatus: "Inactive", isManual: false, isPerformer: true },
      timezone: "America/New_York",
    });

    expect(evaluation).toMatchObject({
      nextStatus: "Active",
      triggerType: "future_performance_rsvp",
    });
  });

  it("calculates the On Break transition as a local calendar date", () => {
    expect(
      calculateOnBreakInactiveAt({
        ...configuration,
        enabled: true,
        isManual: false,
        now: new Date("2026-04-01T12:00:00.000Z"),
        status: "Idle",
        statusChangedAt: "2026-04-01T14:30:00.000Z",
        timezone: "America/New_York",
        timeoutDays: 365,
      }),
    ).toBe("2027-04-01T04:00:00.000Z");
  });
});

describe("status automation guard rails", () => {
  it("does not change a status when automation is disabled", () => {
    const evaluation = evaluateProfileStatus({
      configuration: { ...configuration, statusAutomationEnabled: false },
      now: new Date("2026-04-20T12:00:00.000Z"),
      performances: [1, 2, 3].map((day) => ({
        attendance: "Pending" as const,
        durationMinutes: 120,
        id: `performance-${String(day)}`,
        isArchived: false,
        isCanceled: false,
        rsvp: "No" as const,
        startsAt: `2026-04-${String(day).padStart(2, "0")}T14:00:00.000Z`,
      })),
      profile: { currentStatus: "Active", isManual: false, isPerformer: true },
      timezone: "America/New_York",
    });

    expect(evaluation).toMatchObject({ nextStatus: "Active", triggerType: "none" });
  });

  it("does not recover a non-active performer when recovery is disabled", () => {
    const evaluation = evaluateProfileStatus({
      configuration: { ...configuration, statusAutomationRecoveryEnabled: false },
      now: new Date("2026-04-01T12:00:00.000Z"),
      performances: [
        {
          attendance: "Pending",
          durationMinutes: null,
          id: "future-performance",
          isArchived: false,
          isCanceled: false,
          rsvp: "Yes",
          startsAt: "2026-04-08T12:00:00.000Z",
        },
      ],
      profile: { currentStatus: "Inactive", isManual: false, isPerformer: true },
      timezone: "America/New_York",
    });

    expect(evaluation).toMatchObject({ nextStatus: "Inactive", triggerType: "none" });
  });

  it("ignores manually managed profiles", () => {
    const evaluation = evaluateProfileStatus({
      configuration,
      now: new Date("2026-04-20T12:00:00.000Z"),
      performances: [1, 2, 3].map((day) => ({
        attendance: "Pending" as const,
        durationMinutes: 120,
        id: `performance-${String(day)}`,
        isArchived: false,
        isCanceled: false,
        rsvp: "No" as const,
        startsAt: `2026-04-${String(day).padStart(2, "0")}T14:00:00.000Z`,
      })),
      profile: { currentStatus: "Active", isManual: true, isPerformer: true },
      timezone: "America/New_York",
    });

    expect(evaluation).toMatchObject({ nextStatus: "Active", triggerType: "none" });
  });

  it("ignores profiles without a voice part", () => {
    const evaluation = evaluateProfileStatus({
      configuration,
      now: new Date("2026-04-20T12:00:00.000Z"),
      performances: [1, 2, 3].map((day) => ({
        attendance: "Pending" as const,
        durationMinutes: 120,
        id: `performance-${String(day)}`,
        isArchived: false,
        isCanceled: false,
        rsvp: "No" as const,
        startsAt: `2026-04-${String(day).padStart(2, "0")}T14:00:00.000Z`,
      })),
      profile: { currentStatus: "Active", isManual: false, isPerformer: false },
      timezone: "America/New_York",
    });

    expect(evaluation).toMatchObject({ nextStatus: "Active", triggerType: "none" });
  });

  it("keeps an Active performer active below the miss threshold", () => {
    const performances = [1, 2].map((day) => ({
      attendance: "Pending" as const,
      durationMinutes: 120,
      id: `performance-${String(day)}`,
      isArchived: false,
      isCanceled: false,
      rsvp: "No" as const,
      startsAt: `2026-04-${String(day).padStart(2, "0")}T14:00:00.000Z`,
    }));

    const evaluation = evaluateProfileStatus({
      configuration,
      now: new Date("2026-04-20T12:00:00.000Z"),
      performances,
      profile: { currentStatus: "Active", isManual: false, isPerformer: true },
      timezone: "America/New_York",
    });

    expect(evaluation).toMatchObject({ nextStatus: "Active", triggerType: "none" });
  });

  it("does not count a Present attendance as a miss", () => {
    const performances = [
      {
        attendance: "Present" as const,
        durationMinutes: 120,
        id: "performance-1",
        isArchived: false,
        isCanceled: false,
        rsvp: "No" as const,
        startsAt: "2026-04-01T14:00:00.000Z",
      },
      {
        attendance: "Pending" as const,
        durationMinutes: 120,
        id: "performance-2",
        isArchived: false,
        isCanceled: false,
        rsvp: "No" as const,
        startsAt: "2026-04-02T14:00:00.000Z",
      },
      {
        attendance: "Pending" as const,
        durationMinutes: 120,
        id: "performance-3",
        isArchived: false,
        isCanceled: false,
        rsvp: "No" as const,
        startsAt: "2026-04-03T14:00:00.000Z",
      },
    ];

    const evaluation = evaluateProfileStatus({
      configuration,
      now: new Date("2026-04-20T12:00:00.000Z"),
      performances,
      profile: { currentStatus: "Active", isManual: false, isPerformer: true },
      timezone: "America/New_York",
    });

    expect(evaluation).toMatchObject({ nextStatus: "Active", triggerType: "none" });
  });

  it("excludes archived and canceled performances from the miss window", () => {
    const performances = [1, 2, 3].map((day) => ({
      attendance: "Pending" as const,
      durationMinutes: 120,
      id: `performance-${String(day)}`,
      isArchived: day === 1,
      isCanceled: day !== 1,
      rsvp: "No" as const,
      startsAt: `2026-04-${String(day).padStart(2, "0")}T14:00:00.000Z`,
    }));

    const evaluation = evaluateProfileStatus({
      configuration,
      now: new Date("2026-04-20T12:00:00.000Z"),
      performances,
      profile: { currentStatus: "Active", isManual: false, isPerformer: true },
      timezone: "America/New_York",
    });

    expect(evaluation).toMatchObject({ nextStatus: "Active", triggerType: "none" });
  });

  it("leaves an Idle performer Idle without a future Yes RSVP", () => {
    const evaluation = evaluateProfileStatus({
      configuration,
      now: new Date("2026-04-20T12:00:00.000Z"),
      performances: [
        {
          attendance: "Pending",
          durationMinutes: 120,
          id: "ended-performance",
          isArchived: false,
          isCanceled: false,
          rsvp: "No",
          startsAt: "2026-04-01T14:00:00.000Z",
        },
      ],
      profile: { currentStatus: "Idle", isManual: false, isPerformer: true },
      timezone: "America/New_York",
    });

    expect(evaluation).toMatchObject({ nextStatus: "Idle", triggerType: "none" });
  });

  it("treats a performance as ended at the exact end time", () => {
    expect(
      performanceHasEnded(
        { durationMinutes: 120, startsAt: "2026-04-02T01:00:00.000Z" },
        new Date("2026-04-02T03:00:00.000Z"),
        "America/New_York",
      ),
    ).toBe(true);
    expect(
      performanceHasEnded(
        { durationMinutes: 120, startsAt: "2026-04-02T01:00:00.000Z" },
        new Date("2026-04-02T02:59:59.999Z"),
        "America/New_York",
      ),
    ).toBe(false);
  });

  it("returns no RSVP deadline for rehearsals or invalid inputs", () => {
    expect(
      calculateRsvpDeadline(
        { startsAt: "2026-04-08T23:00:00.000Z", type: "Rehearsal" },
        7,
        "America/New_York",
      ),
    ).toBeNull();
    expect(
      calculateRsvpDeadline(
        { startsAt: "2026-04-08T23:00:00.000Z", type: "Performance" },
        0,
        "America/New_York",
      ),
    ).toBeNull();
    expect(
      calculateRsvpDeadline({ startsAt: "not-a-date", type: "Performance" }, 7, "America/New_York"),
    ).toBeNull();
  });

  it("returns no On Break transition when disabled, manual, or not Idle", () => {
    const base = {
      enabled: true,
      isManual: false,
      now: new Date("2026-04-01T12:00:00.000Z"),
      status: "Idle" as const,
      statusChangedAt: "2026-04-01T14:30:00.000Z",
      timezone: "America/New_York",
      timeoutDays: 365,
    };
    expect(calculateOnBreakInactiveAt({ ...base, enabled: false })).toBeNull();
    expect(calculateOnBreakInactiveAt({ ...base, isManual: true })).toBeNull();
    expect(calculateOnBreakInactiveAt({ ...base, status: "Active" })).toBeNull();
    expect(calculateOnBreakInactiveAt({ ...base, status: "Inactive" })).toBeNull();
    expect(calculateOnBreakInactiveAt({ ...base, timeoutDays: 0 })).toBeNull();
    expect(calculateOnBreakInactiveAt({ ...base, statusChangedAt: "not-a-date" })).toBeNull();
  });
});
