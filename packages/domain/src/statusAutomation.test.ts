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
  rsvpExpiryLeadDays: 7,
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
