import { describe, expect, it } from "vitest";

import { validateSeatingConfig } from "./seatingConfiguration";

describe("validateSeatingConfig", () => {
  it("returns true when all sections have capacity > 0", () => {
    expect(
      validateSeatingConfig([
        { id: "S", name: "Soprano", capacity: 10 },
        { id: "A", name: "Alto", capacity: 5 },
      ]),
    ).toBe(true);
  });

  it("returns false if any section has a capacity of 0", () => {
    expect(
      validateSeatingConfig([
        { id: "S", name: "Soprano", capacity: 10 },
        { id: "A", name: "Alto", capacity: 0 },
      ]),
    ).toBe(false);
  });

  it("returns false if any section has a negative capacity", () => {
    expect(
      validateSeatingConfig([
        { id: "S", name: "Soprano", capacity: 10 },
        { id: "A", name: "Alto", capacity: -5 },
      ]),
    ).toBe(false);
  });

  it("returns true for an empty array", () => {
    expect(validateSeatingConfig([])).toBe(true);
  });
});
