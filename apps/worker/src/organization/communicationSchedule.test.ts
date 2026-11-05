import { describe, expect, it } from "vitest";
import { defaultRosterConfiguration } from "@choir/domain";
import { organizationRosterConfigurationRequestSchema } from "@choir/contracts";
import { attendanceReportDueAt, rsvpFollowUpSchedule } from "./communicationSchedule";

describe("attendance report schedule", () => {
  it("schedules the attendance report for 1:00 AM on the day following the event in the Organization timezone", () => {
    // 7:30 PM rehearsal on Nov 9, 2026 in Eastern Time
    const eveningEvent = "2026-11-10T00:30:00.000Z"; // 2026-11-09 19:30 EST
    const eveningDue = attendanceReportDueAt(eveningEvent, "America/New_York");
    expect(new Date(eveningDue).toISOString()).toBe("2026-11-10T06:00:00.000Z"); // 2026-11-10 01:00 EST

    // 10:00 AM performance on Nov 9, 2026 in Eastern Time
    const morningEvent = "2026-11-09T15:00:00.000Z"; // 2026-11-09 10:00 EST
    const morningDue = attendanceReportDueAt(morningEvent, "America/New_York");
    expect(new Date(morningDue).toISOString()).toBe("2026-11-10T06:00:00.000Z"); // Same overnight 1:00 AM slot
  });

  it("handles DST transitions and UTC properly", () => {
    const utcEvent = "2026-06-15T18:00:00.000Z";
    const utcDue = attendanceReportDueAt(utcEvent, "UTC");
    expect(new Date(utcDue).toISOString()).toBe("2026-06-16T01:00:00.000Z");

    // Event on March 10, 2024 (Spring Forward in America/New_York) -> next day March 11 01:00 EDT
    const springForwardEvent = "2024-03-10T23:00:00.000Z"; // 19:00 EDT
    const springForwardDue = attendanceReportDueAt(springForwardEvent, "America/New_York");
    expect(new Date(springForwardDue).toISOString()).toBe("2024-03-11T05:00:00.000Z"); // 01:00 EDT is UTC-4
  });

  it("returns NaN for invalid startsAt", () => {
    expect(attendanceReportDueAt("not-a-date", "America/New_York")).toBeNaN();
  });
});

// Fixed historical snapshots exercise both sides of the New York DST transition.
describe("communication RSVP schedule", () => {
  const configuration = organizationRosterConfigurationRequestSchema.parse({
    ...defaultRosterConfiguration,
    rsvpExpiryEnabled: true,
    rsvpFollowUpEnabled: true,
    rsvpFollowUpLeadHours: 48,
  });
  const event = {
    rsvpFollowUpMode: "inherit" as const,
    rsvpFollowUpLeadHours: null,
    rsvpDeadlineDate: "2024-03-10",
  };
  it("uses the Organization timezone and elapsed lead hours across DST", () => {
    const before = rsvpFollowUpSchedule(
      { ...event, rsvpDeadlineDate: "2024-03-09" },
      configuration,
      "America/New_York",
    );
    const after = rsvpFollowUpSchedule(event, configuration, "America/New_York");
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect((after?.deadlineAt ?? 0) - (before?.deadlineAt ?? 0)).toBe(23 * 3600000);
    expect((after?.deadlineAt ?? 0) - (after?.dueAt ?? 0)).toBe(48 * 3600000);
  });
  it("honors disabled, overrides, missing deadlines and the master switch", () => {
    expect(
      rsvpFollowUpSchedule({ ...event, rsvpFollowUpMode: "disabled" }, configuration, "UTC"),
    ).toBeNull();
    expect(
      rsvpFollowUpSchedule({ ...event, rsvpDeadlineDate: null }, configuration, "UTC"),
    ).toBeNull();
    expect(
      rsvpFollowUpSchedule(event, { ...configuration, rsvpExpiryEnabled: false }, "UTC"),
    ).toBeNull();
    const override = rsvpFollowUpSchedule(
      { ...event, rsvpFollowUpMode: "enabled", rsvpFollowUpLeadHours: 12 },
      configuration,
      "UTC",
    );
    expect((override?.deadlineAt ?? 0) - (override?.dueAt ?? 0)).toBe(12 * 3600000);
  });
});
