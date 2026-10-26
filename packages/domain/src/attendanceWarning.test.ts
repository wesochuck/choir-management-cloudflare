import { describe, expect, it } from "vitest";
import { hasAttendanceWarning } from "./attendanceWarning";

describe("attendance warning threshold", () => {
  it.each([
    [0, false],
    [1, false],
    [2, false],
    [3, true],
    [4, true],
  ])("count %i with threshold 2 warns: %s", (count, expected) => {
    expect(hasAttendanceWarning(count, 2)).toBe(expected);
  });
});
