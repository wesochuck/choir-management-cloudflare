import { describe, expect, it } from "vitest";
import { defaultRosterConfiguration } from "@choir/domain";
import { organizationRosterConfigurationRequestSchema } from "@choir/contracts";
import { rsvpFollowUpSchedule } from "./communicationSchedule";

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
