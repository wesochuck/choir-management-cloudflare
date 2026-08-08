import { describe, expect, it } from "vitest";

import { distributeSeatsAcrossRows, groupSeatAssignmentProfiles, seatingRowSummary } from "./utils";

const roster = {
  sections: [
    { code: "S", name: "Sopranos", color: "#111111", trackOnly: false },
    { code: "A", name: "Altos", color: "#222222", trackOnly: false },
    { code: "T", name: "Tenors", color: "#333333", trackOnly: false },
    { code: "B", name: "Basses", color: "#444444", trackOnly: false },
  ],
  voiceParts: [
    { label: "S1", fullName: "Soprano 1", sectionCode: "S" },
    { label: "A1", fullName: "Alto 1", sectionCode: "A" },
    { label: "A2", fullName: "Alto 2", sectionCode: "A" },
    { label: "T1", fullName: "Tenor 1", sectionCode: "T" },
  ],
};

describe("seat assignment candidate ordering", () => {
  it("puts the matching voice part first, then groups remaining sections by surname", () => {
    const groups = groupSeatAssignmentProfiles(
      [
        { id: "sue", displayName: "Sue Van Dyke", voicePart: "A1" },
        { id: "amy", displayName: "Amy Smith", voicePart: "A2" },
        { id: "ron", displayName: "Ron Van Dyke", voicePart: "A2" },
        { id: "aaron", displayName: "Aaron Brown", voicePart: "S1" },
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
        { id: "tenor", displayName: "Zoe Van Dyke", voicePart: "T1" },
        { id: "alto", displayName: "Ron Van Dyke", voicePart: "A1" },
        { id: "soprano", displayName: "Amy Smith", voicePart: "S1" },
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
});
