import { describe, expect, it } from "vitest";

import {
  canInsertSetListCustomEntryAt,
  calculateSetListDuration,
  calculateSetListTiming,
  calculateSetListTransitionCount,
  formatSetListDuration,
  hasSetListPiece,
  isSetListQuickCue,
  moveSetListItem,
  normalizeSetListDuration,
  parseSetListDuration,
  type SetListTimingItem,
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

  it("blocks custom-entry insertion immediately before or after a Quick Cue", () => {
    const items = [
      { type: "song" },
      { cueKind: "quick" as const, type: "intermission" },
      { type: "song" },
    ];

    expect(isSetListQuickCue(items[1] ?? {})).toBe(true);
    expect(canInsertSetListCustomEntryAt(items, 0)).toBe(true);
    expect(canInsertSetListCustomEntryAt(items, 1)).toBe(false);
    expect(canInsertSetListCustomEntryAt(items, 2)).toBe(false);
    expect(canInsertSetListCustomEntryAt(items, 3)).toBe(true);
  });

  it("accepts an empty-list boundary and rejects invalid insertion boundaries", () => {
    expect(canInsertSetListCustomEntryAt([], 0)).toBe(true);
    expect(canInsertSetListCustomEntryAt([], -1)).toBe(false);
    expect(canInsertSetListCustomEntryAt([], 1)).toBe(false);
    expect(canInsertSetListCustomEntryAt([], 0.5)).toBe(false);
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

    it("omits transitions within a contiguous multi-movement work", () => {
      const items = [
        { pieceId: "first", duration: "3:00" },
        { pieceId: "movement-1", parentPieceId: "work", duration: "4:00" },
        { pieceId: "movement-2", parentPieceId: "work", duration: "5:00" },
        { pieceId: "last", duration: "2:00" },
      ];
      expect(calculateSetListTiming(items, 30)).toMatchObject({
        defaultTransitionCount: 2,
        songsDuration: 840,
        defaultTransitionDuration: 60,
        estimatedRuntime: 900,
      });
    });

    it("does not add pauses between a parent heading and its movements", () => {
      const items = [
        { pieceId: "work", duration: "0:00" },
        { pieceId: "movement-1", parentPieceId: "work", duration: "3:00" },
        { pieceId: "movement-2", parentPieceId: "work", duration: "4:00" },
      ];
      expect(calculateSetListTiming(items, 30).estimatedRuntime).toBe(420);
    });

    it.each([
      [
        { pieceId: "a", parentPieceId: "work-a" },
        { pieceId: "b", parentPieceId: "work-b" },
      ],
      [{ pieceId: "a", parentPieceId: "work" }, { pieceId: "other" }],
      [{ pieceId: "same" }, { pieceId: "same" }],
      [{}, {}],
    ])(
      "keeps transitions for separate songs or unknown relationships (%j, %j)",
      (first, second) => {
        expect(calculateSetListTransitionCount([first, second])).toBe(1);
      },
    );

    it("does not merge movements separated by another song or a Custom entry", () => {
      const first = { pieceId: "a", parentPieceId: "work", duration: "3:00" };
      const second = { pieceId: "b", parentPieceId: "work", duration: "4:00" };
      expect(calculateSetListTransitionCount([first, { pieceId: "other" }, second])).toBe(2);
      expect(
        calculateSetListTiming([first, { type: "intermission", duration: "2:00" }, second], 30),
      ).toMatchObject({
        defaultTransitionCount: 0,
        intermissionsDuration: 120,
        estimatedRuntime: 540,
      });
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

    it("handles Song / Quick cue / Song -> 0 automatic transitions and 0 cue duration", () => {
      const items = [
        { duration: "3:00", type: "song" },
        { cueKind: "quick" as const, duration: "", type: "intermission" },
        { duration: "4:00", type: "song" },
      ];
      expect(calculateSetListTransitionCount(items)).toBe(0);
      const timing = calculateSetListTiming(items, 30);
      expect(timing.defaultTransitionCount).toBe(0);
      expect(timing.defaultTransitionDuration).toBe(0);
      expect(timing.songsDuration).toBe(420);
      expect(timing.intermissionsDuration).toBe(0);
      expect(timing.quickCueCount).toBe(1);
      expect(timing.missingDurationCustomCount).toBe(0);
      expect(timing.estimatedRuntime).toBe(420);
    });

    it("handles Quick cues at beginning and end of a set list", () => {
      const items = [
        { cueKind: "quick" as const, type: "intermission" }, // Welcome
        { duration: "3:00", type: "song" },
        { duration: "4:00", type: "song" },
        { cueKind: "quick" as const, type: "intermission" }, // Dismissal
      ];
      expect(calculateSetListTransitionCount(items)).toBe(1);
      const timing = calculateSetListTiming(items, 30);
      expect(timing.defaultTransitionCount).toBe(1);
      expect(timing.defaultTransitionDuration).toBe(30);
      expect(timing.songsDuration).toBe(420);
      expect(timing.intermissionsDuration).toBe(0);
      expect(timing.quickCueCount).toBe(2);
      expect(timing.missingDurationCustomCount).toBe(0);
      expect(timing.estimatedRuntime).toBe(450);
    });

    it("handles consecutive cues (Song -> Quick -> Timed -> Song)", () => {
      const items = [
        { duration: "3:00", type: "song" },
        { cueKind: "quick" as const, type: "intermission" },
        { cueKind: "timed" as const, duration: "10:00", type: "intermission" },
        { duration: "4:00", type: "song" },
      ];
      expect(calculateSetListTransitionCount(items)).toBe(0);
      const timing = calculateSetListTiming(items, 30);
      expect(timing.defaultTransitionCount).toBe(0);
      expect(timing.defaultTransitionDuration).toBe(0);
      expect(timing.songsDuration).toBe(420);
      expect(timing.intermissionsDuration).toBe(600);
      expect(timing.quickCueCount).toBe(1);
      expect(timing.missingDurationCustomCount).toBe(0);
      expect(timing.estimatedRuntime).toBe(1_020);
    });

    it("ignores stale duration on Quick cue and does not report missing duration", () => {
      const items = [
        { duration: "3:00", type: "song" },
        { cueKind: "quick" as const, duration: "5:00", type: "intermission" }, // stale duration ignored!
        { duration: "4:00", type: "song" },
      ];
      const timing = calculateSetListTiming(items, 30);
      expect(timing.intermissionsDuration).toBe(0);
      expect(timing.quickCueCount).toBe(1);
      expect(timing.missingDurationCustomCount).toBe(0);
      expect(timing.estimatedRuntime).toBe(420);
    });

    it("matches acceptance example: 5 songs, transitions, quick cue, and timed cue", () => {
      // 5 songs totaling 15:13 = 913 seconds
      const songs: readonly [
        SetListTimingItem,
        SetListTimingItem,
        SetListTimingItem,
        SetListTimingItem,
        SetListTimingItem,
      ] = [
        { duration: "3:00", type: "song" },
        { duration: "3:00", type: "song" },
        { duration: "3:00", type: "song" },
        { duration: "3:00", type: "song" },
        { duration: "3:13", type: "song" },
      ];

      // 1. Initially: 5 adjacent songs, 30s default -> 4 transitions (2:00) -> 17:13 (1033s)
      const initial = calculateSetListTiming(songs, 30);
      expect(initial.songsDuration).toBe(913);
      expect(initial.defaultTransitionCount).toBe(4);
      expect(initial.defaultTransitionDuration).toBe(120);
      expect(initial.intermissionsDuration).toBe(0);
      expect(initial.quickCueCount).toBe(0);
      expect(initial.estimatedRuntime).toBe(1_033);

      // 2. Insert Quick cue between song 1 and 2:
      // 3 transitions = 90s, 0s cue -> 16:43 (1003s)
      const withQuick = calculateSetListTiming(
        [
          songs[0],
          { cueKind: "quick" as const, type: "intermission" },
          songs[1],
          songs[2],
          songs[3],
          songs[4],
        ],
        30,
      );
      expect(withQuick.songsDuration).toBe(913);
      expect(withQuick.defaultTransitionCount).toBe(3);
      expect(withQuick.defaultTransitionDuration).toBe(90);
      expect(withQuick.intermissionsDuration).toBe(0);
      expect(withQuick.quickCueCount).toBe(1);
      expect(withQuick.missingDurationCustomCount).toBe(0);
      expect(withQuick.estimatedRuntime).toBe(1_003);

      // 3. Change that entry to a Timed cue of 1:15 (75s):
      // 3 transitions = 90s, 75s cue -> 17:58 (1078s)
      const withTimed = calculateSetListTiming(
        [
          songs[0],
          { cueKind: "timed" as const, duration: "1:15", type: "intermission" },
          songs[1],
          songs[2],
          songs[3],
          songs[4],
        ],
        30,
      );
      expect(withTimed.songsDuration).toBe(913);
      expect(withTimed.defaultTransitionCount).toBe(3);
      expect(withTimed.defaultTransitionDuration).toBe(90);
      expect(withTimed.intermissionsDuration).toBe(75);
      expect(withTimed.quickCueCount).toBe(0);
      expect(withTimed.missingDurationCustomCount).toBe(0);
      expect(withTimed.estimatedRuntime).toBe(1_078);
    });

    it("tracks conversion timed -> quick -> timed cleanly", () => {
      const songA = { duration: "2:00", type: "song" };
      const songB = { duration: "3:00", type: "song" };

      // Timed with missing duration -> missingDurationCustomCount: 1
      const initialTimed = { cueKind: "timed" as const, duration: "", type: "intermission" };
      const timing1 = calculateSetListTiming([songA, initialTimed, songB], 30);
      expect(timing1.missingDurationCustomCount).toBe(1);
      expect(timing1.intermissionsDuration).toBe(0);
      expect(timing1.quickCueCount).toBe(0);

      // Convert to quick -> missingDurationCustomCount: 0, quickCueCount: 1
      const convertedQuick = {
        cueKind: "quick" as const,
        duration: undefined,
        type: "intermission",
      };
      const timing2 = calculateSetListTiming([songA, convertedQuick, songB], 30);
      expect(timing2.missingDurationCustomCount).toBe(0);
      expect(timing2.intermissionsDuration).toBe(0);
      expect(timing2.quickCueCount).toBe(1);

      // Convert to timed with duration "2:00" -> intermissionsDuration: 120, missingDurationCustomCount: 0
      const convertedTimed = { cueKind: "timed" as const, duration: "2:00", type: "intermission" };
      const timing3 = calculateSetListTiming([songA, convertedTimed, songB], 30);
      expect(timing3.missingDurationCustomCount).toBe(0);
      expect(timing3.intermissionsDuration).toBe(120);
      expect(timing3.quickCueCount).toBe(0);
      expect(timing3.estimatedRuntime).toBe(420);
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
