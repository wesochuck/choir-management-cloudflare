import { describe, expect, it } from "vitest";

import {
  calculateSetListDuration,
  calculateSetListTiming,
  calculateSetListTransitionCount,
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

  describe("transition count and timing calculations", () => {
    it("handles empty set list -> 0 transitions", () => {
      expect(calculateSetListTransitionCount([])).toBe(0);
      const timing = calculateSetListTiming([], 30);
      expect(timing.defaultTransitionCount).toBe(0);
      expect(timing.defaultTransitionDuration).toBe(0);
      expect(timing.estimatedRuntime).toBe(0);
    });

    it("handles one song -> 0 transitions", () => {
      const items = [{ duration: "3:00", type: "song" }];
      expect(calculateSetListTransitionCount(items)).toBe(0);
      const timing = calculateSetListTiming(items, 30);
      expect(timing.defaultTransitionCount).toBe(0);
      expect(timing.defaultTransitionDuration).toBe(0);
      expect(timing.songsDuration).toBe(180);
      expect(timing.estimatedRuntime).toBe(180);
    });

    it("handles two consecutive songs -> 1 transition", () => {
      const items = [
        { duration: "3:00", type: "song" },
        { duration: "4:00", type: "song" },
      ];
      expect(calculateSetListTransitionCount(items)).toBe(1);
      const timing = calculateSetListTiming(items, 30);
      expect(timing.defaultTransitionCount).toBe(1);
      expect(timing.defaultTransitionDuration).toBe(30);
      expect(timing.songsDuration).toBe(420);
      expect(timing.estimatedRuntime).toBe(450);
    });

    it("handles three consecutive songs -> 2 transitions", () => {
      const items = [
        { duration: "3:00", type: "song" },
        { duration: "4:00", type: "song" },
        { duration: "5:00", type: "song" },
      ];
      expect(calculateSetListTransitionCount(items)).toBe(2);
      const timing = calculateSetListTiming(items, 30);
      expect(timing.defaultTransitionCount).toBe(2);
      expect(timing.defaultTransitionDuration).toBe(60);
      expect(timing.songsDuration).toBe(720);
      expect(timing.estimatedRuntime).toBe(780);
    });

    it("handles Song / Custom entry / Song -> 0 automatic transitions across that gap", () => {
      const items = [
        { duration: "3:00", type: "song" },
        { duration: "2:00", type: "intermission" }, // Custom entry (e.g. Announcement)
        { duration: "4:00", type: "song" },
      ];
      expect(calculateSetListTransitionCount(items)).toBe(0);
      const timing = calculateSetListTiming(items, 30);
      expect(timing.defaultTransitionCount).toBe(0);
      expect(timing.defaultTransitionDuration).toBe(0);
      expect(timing.songsDuration).toBe(420);
      expect(timing.intermissionsDuration).toBe(120);
      expect(timing.estimatedRuntime).toBe(540);
    });

    it("handles Song / Intermission / Song / Song -> only final gap gets default transition", () => {
      const items = [
        { duration: "3:00", type: "song" },
        { duration: "15:00", type: "intermission" },
        { duration: "4:00", type: "song" },
        { duration: "2:00", type: "song" },
      ];
      expect(calculateSetListTransitionCount(items)).toBe(1);
      const timing = calculateSetListTiming(items, 45);
      expect(timing.defaultTransitionCount).toBe(1);
      expect(timing.defaultTransitionDuration).toBe(45);
      expect(timing.songsDuration).toBe(540);
      expect(timing.intermissionsDuration).toBe(900);
      expect(timing.estimatedRuntime).toBe(1_485);
    });

    it("counts custom type: 'song' items as songs", () => {
      const items = [
        { duration: "3:00", type: "song" },
        { duration: "2:30" }, // omitted type defaults to song
        { duration: "4:00", type: "song" },
      ];
      expect(calculateSetListTransitionCount(items)).toBe(2);
      const timing = calculateSetListTiming(items, 20);
      expect(timing.defaultTransitionCount).toBe(2);
      expect(timing.defaultTransitionDuration).toBe(40);
      expect(timing.estimatedRuntime).toBe(180 + 150 + 240 + 40);
    });

    it("preserves current totals when default transition is 0", () => {
      const items = [
        { duration: "3:00", type: "song" },
        { duration: "4:00", type: "song" },
        { duration: "10:00", type: "intermission" },
      ];
      const timing = calculateSetListTiming(items, 0);
      expect(timing.defaultTransitionCount).toBe(1);
      expect(timing.defaultTransitionDuration).toBe(0);
      expect(timing.songsDuration).toBe(420);
      expect(timing.intermissionsDuration).toBe(600);
      expect(timing.estimatedRuntime).toBe(1_020);
    });

    it("detects custom entries with missing/blank duration", () => {
      const items = [
        { duration: "3:00", type: "song" },
        { duration: "", type: "intermission" },
        { duration: undefined, type: "intermission" },
        { duration: "5:00", type: "intermission" },
      ];
      const timing = calculateSetListTiming(items, 30);
      expect(timing.missingDurationCustomCount).toBe(2);
      expect(timing.intermissionsDuration).toBe(300);
    });

    it("supports custom duration resolver", () => {
      const items = [
        { id: "song-1", type: "song" },
        { id: "song-2", type: "song" },
      ];
      const lookup = new Map([
        ["song-1", 100],
        ["song-2", 200],
      ]);
      const timing = calculateSetListTiming(items, 15, (item) => lookup.get(item.id) ?? 0);
      expect(timing.songsDuration).toBe(300);
      expect(timing.defaultTransitionCount).toBe(1);
      expect(timing.defaultTransitionDuration).toBe(15);
      expect(timing.estimatedRuntime).toBe(315);
    });
  });
});
