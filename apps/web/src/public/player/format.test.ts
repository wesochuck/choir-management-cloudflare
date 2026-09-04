import { describe, expect, it } from "vitest";

import {
  availableTrackKeys,
  formatDate,
  formatTime,
  formatTrackKey,
  resolveTrack,
  resolveTrackKey,
} from "./format";
import type { PlayerPlaylistItem } from "./types";

describe("format utilities", () => {
  describe("formatDate", () => {
    it("formats ISO date string in long UTC format", () => {
      expect(formatDate("2026-10-15T19:00:00.000Z")).toContain("October");
      expect(formatDate("2026-10-15T19:00:00.000Z")).toContain("2026");
    });

    it("returns raw string if invalid date", () => {
      expect(formatDate("invalid-date")).toBe("invalid-date");
    });
  });

  describe("formatTime", () => {
    it("formats seconds into m:ss", () => {
      expect(formatTime(0)).toBe("0:00");
      expect(formatTime(65)).toBe("1:05");
      expect(formatTime(125)).toBe("2:05");
    });

    it("handles non-finite or negative numbers gracefully", () => {
      expect(formatTime(-5)).toBe("0:00");
      expect(formatTime(NaN)).toBe("0:00");
      expect(formatTime(Infinity)).toBe("0:00");
    });
  });

  describe("formatTrackKey", () => {
    it("formats tutti as Tutti and others as uppercase", () => {
      expect(formatTrackKey("tutti")).toBe("Tutti");
      expect(formatTrackKey("soprano")).toBe("SOPRANO");
      expect(formatTrackKey("s1")).toBe("S1");
    });
  });

  describe("availableTrackKeys", () => {
    it("collects and sorts keys putting tutti first", () => {
      const items: PlayerPlaylistItem[] = [
        { title: "Song 1", trackFileIds: { soprano: "f1", tutti: "f2" } },
        { title: "Song 2", trackFileIds: { alto: "f3", tutti: "f4" } },
      ];
      expect(availableTrackKeys(items)).toEqual(["tutti", "alto", "soprano"]);
    });
  });
});

describe("resolveTrack fallback hierarchy", () => {
  const baseItem: PlayerPlaylistItem = {
    title: "Angels we have heard on high",
    trackFileIds: {},
  };

  it("1. plays part recording if available (exact match)", () => {
    const item: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: {
        S1: "file-s1",
        S: "file-s",
        tutti: "file-tutti",
      },
    };
    const resolved = resolveTrack(item, "S1");
    expect(resolved).toEqual({
      fallback: false,
      fileId: "file-s1",
      key: "S1",
    });
  });

  it("1b. plays part recording if available (case-insensitive normalized match)", () => {
    const item: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: {
        soprano1: "file-soprano1",
        tutti: "file-tutti",
      },
    };
    const resolved = resolveTrack(item, "Soprano 1");
    expect(resolved).toEqual({
      fallback: false,
      fileId: "file-soprano1",
      key: "soprano1",
    });
  });

  it("2. falls back to section recording track if part is unavailable", () => {
    const item: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: {
        S: "file-s-section",
        tutti: "file-tutti",
        tenor: "file-tenor",
      },
    };
    // S1 requested, no S1, but section S exists -> should pick S over tutti
    const resolved = resolveTrack(item, "S1");
    expect(resolved).toEqual({
      fallback: true,
      fileId: "file-s-section",
      key: "S",
    });
  });

  it("2b. falls back to section named track (e.g. soprano) for part (e.g. S1 or soprano1)", () => {
    const item: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: {
        soprano: "file-soprano-section",
        tutti: "file-tutti",
      },
    };
    const resolved = resolveTrack(item, "S1");
    expect(resolved).toEqual({
      fallback: true,
      fileId: "file-soprano-section",
      key: "soprano",
    });
  });

  it("2c. supports Alto, Tenor, and Bass section recording fallbacks", () => {
    const altoItem: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: { A: "file-a", tutti: "file-tutti" },
    };
    expect(resolveTrack(altoItem, "A2")).toEqual({
      fallback: true,
      fileId: "file-a",
      key: "A",
    });

    const tenorItem: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: { tenor: "file-tenor", tutti: "file-tutti" },
    };
    expect(resolveTrack(tenorItem, "T1")).toEqual({
      fallback: true,
      fileId: "file-tenor",
      key: "tenor",
    });

    const bassItem: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: { B: "file-b", tutti: "file-tutti" },
    };
    expect(resolveTrack(bassItem, "Bass 2")).toEqual({
      fallback: true,
      fileId: "file-b",
      key: "B",
    });
  });

  it("2d. when section is requested (e.g. S) and piece only has section parts (e.g. S1), plays section part before full mix", () => {
    const item: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: {
        S1: "file-s1",
        tutti: "file-tutti",
      },
    };
    const resolved = resolveTrack(item, "S");
    expect(resolved).toEqual({
      fallback: true,
      fileId: "file-s1",
      key: "S1",
    });
  });

  it("3. falls back to full mix track (tutti) if neither part nor section is available", () => {
    const item: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: {
        tutti: "file-tutti",
        tenor: "file-tenor",
      },
    };
    // S1 requested, no S1, no S section -> should pick tutti over tenor
    const resolved = resolveTrack(item, "S1");
    expect(resolved).toEqual({
      fallback: true,
      fileId: "file-tutti",
      key: "tutti",
    });
  });

  it("3b. supports choir mix aliases as full mix track", () => {
    const item: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: {
        choirmix: "file-choirmix",
        tenor: "file-tenor",
      },
    };
    const resolved = resolveTrack(item, "S1");
    expect(resolved).toEqual({
      fallback: true,
      fileId: "file-choirmix",
      key: "choirmix",
    });
  });

  it("4. falls back to ANY available file associated with the track if no full mix track", () => {
    // This is the exact scenario reported: S requested, but piece only has tenor track
    const item: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: {
        tenor: "file-tenor",
      },
    };
    const resolved = resolveTrack(item, "S");
    expect(resolved).toEqual({
      fallback: true,
      fileId: "file-tenor",
      key: "tenor",
    });
  });

  it("4b. falls back to ANY file when voice part is requested and piece only has other parts", () => {
    const item: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: {
        bass: "file-bass",
      },
    };
    const resolved = resolveTrack(item, "Soprano 1");
    expect(resolved).toEqual({
      fallback: true,
      fileId: "file-bass",
      key: "bass",
    });
  });

  it("4c. falls back to ANY file when tutti is requested and piece only has voice parts", () => {
    const item: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: {
        alto: "file-alto",
      },
    };
    const resolved = resolveTrack(item, "tutti");
    expect(resolved).toEqual({
      fallback: true,
      fileId: "file-alto",
      key: "alto",
    });
  });

  it("returns null when no audio files are associated with the track", () => {
    const emptyItem: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: {},
    };
    expect(resolveTrack(emptyItem, "S")).toBeNull();
    expect(resolveTrack(emptyItem, "tutti")).toBeNull();
  });

  it("ignores whitespace-only or empty string file IDs", () => {
    const item: PlayerPlaylistItem = {
      ...baseItem,
      trackFileIds: {
        S: "   ",
        tutti: "",
      },
    };
    expect(resolveTrack(item, "S")).toBeNull();
  });

  describe("resolveTrackKey", () => {
    const keys = ["alto", "t2", "tenor", "tutti"];

    it("prefers the exact key", () => {
      expect(resolveTrackKey(keys, "t2")).toBe("t2");
    });

    it("matches roster spellings case-insensitively", () => {
      expect(resolveTrackKey(keys, "T2")).toBe("t2");
      expect(resolveTrackKey(keys, "ALTO")).toBe("alto");
    });

    it("returns null for section-level spellings so playback fallback decides", () => {
      // "Tenor 2" matches no key exactly; per-item resolution still finds the tenor section.
      expect(resolveTrackKey(keys, "Tenor 2")).toBeNull();
    });

    it("returns null when nothing matches", () => {
      expect(resolveTrackKey(keys, "bass")).toBeNull();
      expect(resolveTrackKey([], "t2")).toBeNull();
    });
  });
});
