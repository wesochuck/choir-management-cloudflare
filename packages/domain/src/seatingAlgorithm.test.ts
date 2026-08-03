import { describe, expect, it } from "vitest";

import { calculateSeatingSuggestions, isSeatingSectionMismatch } from "./seatingAlgorithm";

describe("seating formation rules", () => {
  it("fills horizontal rows from the visual front with continuous section spillover", () => {
    expect(
      calculateSeatingSuggestions([10, 10], { A: 10, S: 10 }, ["S", "A"], "horizontal_row"),
    ).toMatchObject({ "0-0": "S", "0-9": "S", "1-0": "A", "1-9": "A" });
  });

  it("leaves excess horizontal seats unassigned", () => {
    expect(calculateSeatingSuggestions([3, 3], { S: 2 }, ["S"], "horizontal_row")).toEqual({
      "0-0": "S",
      "0-1": "S",
    });
  });

  it("centers active vertical-column seats and assigns sections left to right", () => {
    expect(
      calculateSeatingSuggestions([5, 7], { A: 2, S: 2 }, ["S", "A"], "vertical_column"),
    ).toEqual({ "0-1": "S", "0-2": "A", "1-2": "S", "1-3": "A" });
  });

  it("returns no suggestions without singers, seats, or section order", () => {
    expect(calculateSeatingSuggestions([4], {}, ["S"], "vertical_column")).toEqual({});
    expect(calculateSeatingSuggestions([], { S: 1 }, ["S"], "vertical_column")).toEqual({});
    expect(calculateSeatingSuggestions([4], { S: 1 }, [], "vertical_column")).toEqual({});
  });

  it("never suggests seats outside the configured chart when singers exceed capacity", () => {
    const suggestions = calculateSeatingSuggestions([1, 1], { S: 3 }, ["S"], "vertical_column");
    expect(suggestions).toEqual({ "0-0": "S", "1-0": "S" });
    expect(Object.keys(suggestions).every((key) => /^\d+-\d+$/.test(key))).toBe(true);
  });

  it("flags only known voice parts assigned against another suggested section", () => {
    const voiceParts = [
      { label: "S1", sectionCode: "S" },
      { label: "A1", sectionCode: "A" },
    ];
    expect(isSeatingSectionMismatch("S1", "S", voiceParts)).toBe(false);
    expect(isSeatingSectionMismatch("S1", "A", voiceParts)).toBe(true);
    expect(isSeatingSectionMismatch("Unknown", "S", voiceParts)).toBe(false);
    expect(isSeatingSectionMismatch(undefined, "S", voiceParts)).toBe(false);
  });
});
