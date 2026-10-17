import { expect, it } from "vitest";
import { coverImageOverflow, shiftCoverImagePosition } from "./imagePosition";

it("finds the overflow after cover scaling for portrait and landscape images", () => {
  expect(coverImageOverflow(1000, 1000, 1152, 416)).toEqual({ x: 0, y: 736 });
  expect(coverImageOverflow(2000, 500, 358, 416)).toEqual({ x: 1306, y: 0 });
  expect(coverImageOverflow(0, 0, 358, 416)).toEqual({ x: 0, y: 0 });
});
it("moves only cropped axes and clamps both edges without exposing blank space", () => {
  expect(shiftCoverImagePosition({ x: 50, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 400 })).toEqual({
    x: 50,
    y: 25,
  });
  expect(
    shiftCoverImagePosition({ x: 50, y: 50 }, { x: 1000, y: -1000 }, { x: 400, y: 400 }),
  ).toEqual({ x: 0, y: 100 });
  expect(shiftCoverImagePosition({ x: 50, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 0 })).toEqual({
    x: 50,
    y: 50,
  });
});
