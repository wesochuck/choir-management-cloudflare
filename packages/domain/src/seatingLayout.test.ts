import { describe, expect, it } from "vitest";

import {
  addRow,
  addSeat,
  moveAssignment,
  removeRow,
  removeSeat,
  unassignProfile,
} from "./seatingLayout";

const state = {
  assignments: { "0-0": "profile-a", "0-2": "profile-b", "1-1": "profile-c" },
  rowCounts: [3, 2],
  sectionSuggestions: { "0-0": "S", "0-2": "A", "1-1": "T" },
};

describe("seating layout transformations", () => {
  it("adds a front row and shifts both maps", () => {
    expect(addRow(state, "front", 4)).toEqual({
      assignments: { "1-0": "profile-a", "1-2": "profile-b", "2-1": "profile-c" },
      rowCounts: [4, 3, 2],
      sectionSuggestions: { "1-0": "S", "1-2": "A", "2-1": "T" },
    });
  });

  it("adds a back row without changing keys", () => {
    expect(addRow(state, "back").rowCounts).toEqual([3, 2, 10]);
    expect(addRow(state, "back").assignments).toEqual(state.assignments);
  });

  it("adds and removes seats while shifting later seats left", () => {
    expect(addSeat(state, 0).rowCounts).toEqual([4, 2]);
    expect(removeSeat(state, 0, 1)).toEqual({
      assignments: { "0-0": "profile-a", "0-1": "profile-b", "1-1": "profile-c" },
      rowCounts: [2, 2],
      sectionSuggestions: { "0-0": "S", "0-1": "A", "1-1": "T" },
    });
  });

  it("removes a row and shifts later rows up", () => {
    expect(removeRow(state, 0)).toEqual({
      assignments: { "0-1": "profile-c" },
      rowCounts: [2],
      sectionSuggestions: { "0-1": "T" },
    });
  });

  it("swaps occupied seats and deduplicates a shelf assignment", () => {
    expect(moveAssignment(state.assignments, "0-0", "0-2")).toEqual({
      "0-0": "profile-b",
      "0-2": "profile-a",
      "1-1": "profile-c",
    });
    expect(moveAssignment(state.assignments, "", "0-2", "profile-c")).toEqual({
      "0-0": "profile-a",
      "0-2": "profile-c",
    });
    expect(unassignProfile(state.assignments, "profile-b")).toEqual({
      "0-0": "profile-a",
      "1-1": "profile-c",
    });
  });
});
