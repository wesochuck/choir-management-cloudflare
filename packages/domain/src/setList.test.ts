import { describe, expect, it } from "vitest";

import {
  calculateSetListDuration,
  formatSetListDuration,
  hasSetListPiece,
  moveSetListItem,
  normalizeSetListDuration,
  parseSetListDuration,
} from "./setList";

describe("set-list rules", () => {
  it("parses legacy duration formats and rejects malformed values", () => {
    expect(parseSetListDuration("4:05")).toBe(245);
    expect(parseSetListDuration("1:02:03")).toBe(3_723);
    expect(parseSetListDuration("7 mins 5 sec")).toBe(425);
    expect(parseSetListDuration("12")).toBe(720);
    expect(parseSetListDuration("4:75")).toBeNull();
    expect(parseSetListDuration("later")).toBeNull();
  });

  it("formats and totals valid durations without inflating invalid entries", () => {
    expect(calculateSetListDuration([{ duration: "3:30" }, { duration: "10 min" }, {}])).toBe(810);
    expect(formatSetListDuration(810)).toBe("13:30");
    expect(formatSetListDuration(3_723)).toBe("1:02:03");
    expect(normalizeSetListDuration("2")).toBe("2:00");
    expect(normalizeSetListDuration("1:02")).toBe("1:02");
    expect(normalizeSetListDuration("later")).toBe("later");
  });

  it("detects linked duplicates and moves only within list bounds", () => {
    const items = [{ pieceId: "alpha" }, { pieceId: "bravo" }];
    expect(hasSetListPiece(items, "alpha")).toBe(true);
    expect(hasSetListPiece(items, "charlie")).toBe(false);
    expect(moveSetListItem(items, 1, -1)).toEqual([{ pieceId: "bravo" }, { pieceId: "alpha" }]);
    expect(moveSetListItem(items, 0, -1)).toBe(items);
  });
});
