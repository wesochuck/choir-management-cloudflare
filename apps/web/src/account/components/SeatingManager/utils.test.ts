import { describe, expect, it } from "vitest";

import { groupSeatAssignmentProfiles } from "./utils";

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
