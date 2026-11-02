import { describe, expect, it } from "vitest";
import { isUnusualTime } from "./unusualTime";

describe("unusual local times", () => {
  it.each(["00:00", "02:30", "11:59", "22:01", "23:59", "22:00:01", "22:00:00.001"])(
    "warns for %s",
    (value) => {
      expect(isUnusualTime(value)).toBe(true);
      expect(isUnusualTime(`2026-11-01T${value}`)).toBe(true);
    },
  );
  it.each(["12:00", "21:59", "22:00", "", "2:", "25:00", "12:60"])(
    "does not warn for %s",
    (value) => {
      expect(isUnusualTime(value)).toBe(false);
    },
  );
});
