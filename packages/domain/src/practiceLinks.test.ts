import { expect, it } from "vitest";

import { isPracticePlayerPath, practiceSharePathSlug, practiceShareSlug } from "./practiceLinks";

it("uses readable, bounded title slugs", () => {
  expect(practiceShareSlug("  Noël & Winter Concert! ")).toBe("noel-winter-concert");
  expect(practiceShareSlug("♪♪")).toBe("performance");
  expect(practiceShareSlug("Winter Concert ".repeat(20)).length).toBeLessThanOrEqual(48);
});

it("recognizes only the short and legacy public player paths", () => {
  expect(practiceSharePathSlug("/practice/winter-concert/")).toBe("winter-concert");
  expect(practiceSharePathSlug("/practice/winter-concert/track")).toBeNull();
  expect(practiceSharePathSlug("/practice/" + "x".repeat(49))).toBeNull();
  expect(isPracticePlayerPath("/player")).toBe(true);
  expect(isPracticePlayerPath("/practice")).toBe(false);
});
