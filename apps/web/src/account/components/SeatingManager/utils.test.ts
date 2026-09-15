import type {
  OrganizationProfile,
  OrganizationRosterConfiguration,
  SeatingFormation,
} from "@choir/contracts";
import { defaultRosterConfiguration } from "@choir/domain";
import { describe, expect, it } from "vitest";

import {
  defaultSeatingRowCount,
  distributeSeatsAcrossRows,
  formationOrderOptions,
  groupSeatAssignmentProfiles,
  moveFormationOrderItem,
  normalizeFormationOrder,
  resolveDraggingProfile,
  seatingRowSummary,
  statusLabel,
} from "./utils";

const roster: OrganizationRosterConfiguration = {
  ...defaultRosterConfiguration,
  sections: [...defaultRosterConfiguration.sections],
  voiceParts: [...defaultRosterConfiguration.voiceParts],
};

describe("seat assignment candidate ordering", () => {
  it("puts the matching voice part first, then groups remaining sections by surname", () => {
    const groups = groupSeatAssignmentProfiles(
      [
        { displayName: "Sue Van Dyke", id: "sue", voicePart: "A1" },
        { displayName: "Amy Smith", id: "amy", voicePart: "A2" },
        { displayName: "Ron Van Dyke", id: "ron", voicePart: "A2" },
        { displayName: "Aaron Brown", id: "aaron", voicePart: "S1" },
      ],
      "A2",
      true,
      roster,
    );

    expect(groups.map(({ key }) => key)).toEqual(["A", "S"]);
    expect(groups[0]?.profiles.map(({ id }) => id)).toEqual(["amy", "ron", "sue"]);
    expect(groups[1]?.profiles.map(({ id }) => id)).toEqual(["aaron"]);
  });

  it("puts the whole suggested section first for section formations", () => {
    const groups = groupSeatAssignmentProfiles(
      [
        { displayName: "Zoe Van Dyke", id: "tenor", voicePart: "T1" },
        { displayName: "Ron Van Dyke", id: "alto", voicePart: "A1" },
        { displayName: "Amy Smith", id: "soprano", voicePart: "S1" },
      ],
      "A",
      false,
      roster,
    );

    expect(groups.map(({ key }) => key)).toEqual(["A", "S", "T"]);
    expect(groups[0]?.profiles.map(({ displayName }) => displayName)).toEqual(["Ron Van Dyke"]);
  });
});

describe("new seating chart layouts", () => {
  it("distributes singers as evenly as possible across rows", () => {
    expect(distributeSeatsAcrossRows(10, 3)).toEqual([4, 3, 3]);
    expect(distributeSeatsAcrossRows(12, 3)).toEqual([4, 4, 4]);
  });

  it("describes the live per-row capacity", () => {
    expect(seatingRowSummary(10, 3)).toBe(
      "10 singers across 3 rows — 3–4 singers per row, balanced as evenly as possible.",
    );
  });

  it("rejects layouts with no singers or more rows than singers", () => {
    expect(distributeSeatsAcrossRows(0, 1)).toEqual([]);
    expect(distributeSeatsAcrossRows(2, 3)).toEqual([]);
    expect(seatingRowSummary(0, 1)).toBe("Add at least one singer to create a seating layout.");
    expect(seatingRowSummary(2, 3)).toBe("Choose no more rows than singers.");
  });

  it("calculates default seating row count", () => {
    expect(defaultSeatingRowCount(0)).toBe(1);
    expect(defaultSeatingRowCount(2)).toBe(2);
    expect(defaultSeatingRowCount(20)).toBe(3);
  });
});

describe("resolveDraggingProfile", () => {
  const profile: OrganizationProfile = {
    bounceReason: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    displayName: "Jane Singer",
    doNotEmail: false,
    globalStatus: "Active",
    id: "00000000-0000-4000-8000-000000000001",
    isSectionLeader: false,
    lastBounceAt: "",
    notes: "",
    onBreakInactiveAt: null,
    phone: "",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveAdminNotifications: false,
    receiveAttendanceReports: false,
    receiveFinancialAlerts: false,
    receiveRsvpDeclineNotices: false,
    showInDirectory: true,
    hidden: false,
    statusChangedAt: "1970-01-01T00:00:00.000Z",
    statusChangeReason: "Initial status",
    statusIsManual: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    voicePart: "S1",
  };

  const profilesById = new Map<string, OrganizationProfile>([[profile.id, profile]]);
  const assignments = { "0-0": profile.id };

  it("resolves profile directly from profile token", () => {
    const result = resolveDraggingProfile(`profile:${profile.id}`, assignments, profilesById);
    expect(result.profile?.displayName).toBe("Jane Singer");
    expect(result.fallbackName).toBe("Profile");
  });

  it("resolves profile indirectly from seat token", () => {
    const result = resolveDraggingProfile("seat:0-0", assignments, profilesById);
    expect(result.profile?.displayName).toBe("Jane Singer");
    expect(result.fallbackName).toBe("Assigned Profile");
  });

  it("returns fallback for unknown tokens or null", () => {
    expect(resolveDraggingProfile(null, assignments, profilesById)).toEqual({
      fallbackName: "Profile",
      profile: undefined,
    });
    expect(resolveDraggingProfile("seat:1-0", assignments, profilesById)).toEqual({
      fallbackName: "Assigned Profile",
      profile: undefined,
    });
  });
});

describe("formation order helpers", () => {
  const voiceFormation: SeatingFormation = {
    id: "v-1",
    isVoicePartLayout: true,
    name: "Voice Parts",
    sectionOrder: ["S1", "A1"],
    strategy: "vertical_column",
  };

  const sectionFormation: SeatingFormation = {
    id: "s-1",
    isVoicePartLayout: false,
    name: "Sections",
    sectionOrder: ["S", "A"],
    strategy: "horizontal_row",
  };

  it("returns formation order options based on layout type", () => {
    expect(formationOrderOptions(voiceFormation, roster).length).toBeGreaterThan(0);
    expect(formationOrderOptions(sectionFormation, roster).length).toBeGreaterThan(0);
  });

  it("normalizes formation order retaining existing and appending missing", () => {
    const normalized = normalizeFormationOrder(voiceFormation, roster);
    expect(normalized[0]).toBe("S1");
    expect(normalized[1]).toBe("A1");
    expect(normalized).toContain("A2");
  });

  it("moves formation order items safely", () => {
    expect(moveFormationOrderItem(["A", "B", "C"], 0, 2)).toEqual(["B", "C", "A"]);
    expect(moveFormationOrderItem(["A", "B", "C"], 2, 0)).toEqual(["C", "A", "B"]);
    expect(moveFormationOrderItem(["A", "B", "C"], -1, 2)).toEqual(["A", "B", "C"]);
  });
});

describe("statusLabel", () => {
  it("converts Idle to On Break and preserves others", () => {
    expect(statusLabel("Idle")).toBe("On Break");
    expect(statusLabel("Active")).toBe("Active");
    expect(statusLabel("Inactive")).toBe("Inactive");
  });
});
