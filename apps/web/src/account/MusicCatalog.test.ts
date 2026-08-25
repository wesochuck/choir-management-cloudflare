import { organizationRosterConfigurationRequestSchema } from "@choir/contracts";
import { describe, expect, it } from "vitest";

import { learningTrackFileName } from "./learningTrackFilename";

const configuration = organizationRosterConfigurationRequestSchema.parse({
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  rsvpExpiryEnabled: true,
  sections: [{ code: "S", color: "#1b4d3e", name: "Sopranos", trackOnly: false }],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  attendanceReportWarningThreshold: 1,
  voiceParts: [{ fullName: "Soprano 1", label: "S1", sectionCode: "S" }],
});

describe("learning track filenames", () => {
  it("includes the piece and track labels while keeping upload names safe", () => {
    expect(learningTrackFileName("Messiah / Part 1", "tutti", configuration)).toBe(
      "Messiah - Part 1 - Full mix.mp3",
    );
  });

  it("bounds long names to the private file filename limit", () => {
    const fileName = learningTrackFileName("x".repeat(500), "S1", configuration);
    expect(fileName).toHaveLength(255);
    expect(fileName.endsWith(".mp3")).toBe(true);
  });
});
