import type { OrganizationAttendanceRow, OrganizationRosterConfiguration } from "@choir/contracts";
import { describe, expect, it } from "vitest";

import { groupRowsBySection } from "./grouping";

const defaultMockConfig: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [
    { code: "S", color: "#3b82f6", name: "Sopranos", trackOnly: false },
    { code: "A", color: "#10b981", name: "Altos", trackOnly: false },
    { code: "T", color: "#f59e0b", name: "Tenors", trackOnly: false },
    { code: "B", color: "#ef4444", name: "Basses", trackOnly: false },
  ],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [
    { fullName: "Soprano 1", label: "S1", sectionCode: "S" },
    { fullName: "Soprano 2", label: "S2", sectionCode: "S" },
    { fullName: "Alto 1", label: "A1", sectionCode: "A" },
    { fullName: "Alto 2", label: "A2", sectionCode: "A" },
    { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
    { fullName: "Tenor 2", label: "T2", sectionCode: "T" },
    { fullName: "Bass 1", label: "B1", sectionCode: "B" },
    { fullName: "Bass 2", label: "B2", sectionCode: "B" },
  ],
};

function createMockRow(
  profileId: string,
  displayName: string,
  voicePart: string,
  rsvp: "Yes" | "No" | "Pending" = "Yes",
): OrganizationAttendanceRow {
  return {
    attendance: "Pending",
    displayName,
    profileId,
    rsvp,
    updatedAt: null,
    voicePart,
  };
}

describe("Attendance grouping and sorting", () => {
  it("combines A1 + A2 into one Alto section", () => {
    const rows: OrganizationAttendanceRow[] = [
      createMockRow("1", "Alice Adams", "A1"),
      createMockRow("2", "Bob Brown", "A2"),
      createMockRow("3", "Carol Carter", "A1"),
    ];

    const groups = groupRowsBySection(rows, defaultMockConfig);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("Altos");
    expect(groups[0]?.key).toBe("A");
    expect(groups[0]?.rows.map((r) => r.displayName)).toEqual([
      "Alice Adams",
      "Bob Brown",
      "Carol Carter",
    ]);
  });

  it("sorts combined section by surname using lastNameSortKey", () => {
    const rows: OrganizationAttendanceRow[] = [
      createMockRow("1", "Alice Walker", "A1"),
      createMockRow("2", "John van Horn", "A2"),
      createMockRow("3", "Bob Iverson", "A1"),
    ];

    const groups = groupRowsBySection(rows, defaultMockConfig);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("Altos");
    expect(groups[0]?.rows.map((r) => r.displayName)).toEqual([
      "Bob Iverson",
      "John van Horn",
      "Alice Walker",
    ]);
  });

  it("follows the configured section order rather than part names or first singer", () => {
    const customConfig: OrganizationRosterConfiguration = {
      ...defaultMockConfig,
      sections: [
        { code: "B", color: "#ef4444", name: "Basses", trackOnly: false },
        { code: "A", color: "#10b981", name: "Altos", trackOnly: false },
        { code: "T", color: "#f59e0b", name: "Tenors", trackOnly: false },
        { code: "S", color: "#3b82f6", name: "Sopranos", trackOnly: false },
      ],
    };

    const rows: OrganizationAttendanceRow[] = [
      createMockRow("1", "Sarah Smith", "S1"),
      createMockRow("2", "Ben Bass", "B1"),
      createMockRow("3", "Tom Tenor", "T1"),
      createMockRow("4", "Amy Alto", "A1"),
    ];

    const groups = groupRowsBySection(rows, customConfig);

    expect(groups.map((g) => g.name)).toEqual(["Basses", "Altos", "Tenors", "Sopranos"]);
    expect(groups.map((g) => g.key)).toEqual(["B", "A", "T", "S"]);
  });

  it("skips empty section groups", () => {
    const rows: OrganizationAttendanceRow[] = [
      createMockRow("1", "Sarah Smith", "S1"),
      createMockRow("2", "Ben Bass", "B1"),
    ];

    const groups = groupRowsBySection(rows, defaultMockConfig);

    expect(groups.map((g) => g.name)).toEqual(["Sopranos", "Basses"]);
  });

  it("puts blank or unrecognized parts into a final Other group and sorts them by surname", () => {
    const rows: OrganizationAttendanceRow[] = [
      createMockRow("1", "Alice Walker", "A1"),
      createMockRow("2", "Zachary Taylor", ""),
      createMockRow("3", "George Washington", "UnknownPart"),
      createMockRow("4", "John Adams", "   "),
    ];

    const groups = groupRowsBySection(rows, defaultMockConfig);

    expect(groups.map((g) => g.name)).toEqual(["Altos", "Other"]);
    const otherGroup = groups.find((g) => g.key === "other");
    expect(otherGroup).toBeDefined();
    expect(otherGroup?.rows.map((r) => r.displayName)).toEqual([
      "John Adams",
      "Zachary Taylor",
      "George Washington",
    ]);
  });

  it("applies the same grouping and sorting for RSVP and non-RSVP partitions", () => {
    const rsvpedRows: OrganizationAttendanceRow[] = [
      createMockRow("1", "Alice Walker", "A1", "Yes"),
      createMockRow("2", "Bob Iverson", "A2", "Yes"),
    ];
    const nonRsvpedRows: OrganizationAttendanceRow[] = [
      createMockRow("3", "Carol Davis", "A1", "No"),
      createMockRow("4", "David Brown", "A2", "Pending"),
    ];

    const rsvpedGroups = groupRowsBySection(rsvpedRows, defaultMockConfig);
    const nonRsvpedGroups = groupRowsBySection(nonRsvpedRows, defaultMockConfig);

    expect(rsvpedGroups[0]?.name).toBe("Altos");
    expect(rsvpedGroups[0]?.rows.map((r) => r.displayName)).toEqual([
      "Bob Iverson",
      "Alice Walker",
    ]);

    expect(nonRsvpedGroups[0]?.name).toBe("Altos");
    expect(nonRsvpedGroups[0]?.rows.map((r) => r.displayName)).toEqual([
      "David Brown",
      "Carol Davis",
    ]);
  });

  it("falls back gracefully when configuration is missing or empty", () => {
    const rows: OrganizationAttendanceRow[] = [
      createMockRow("1", "Alice Walker", "A1"),
      createMockRow("2", "Bob Iverson", "A1"),
    ];

    const groups = groupRowsBySection(rows, null);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("A1");
    expect(groups[0]?.rows.map((r) => r.displayName)).toEqual(["Bob Iverson", "Alice Walker"]);
  });
});
