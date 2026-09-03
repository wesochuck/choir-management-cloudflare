import { describe, expect, it } from "vitest";

import { type PieceRow, toPlaylistItem } from "./playerStore";

describe("toPlaylistItem", () => {
  it("maps a pieceMap entry containing null values without converting to 'null' strings", () => {
    const item = {
      isFeaturedNumber: false,
      pieceId: "piece-nulls",
      title: "Chant",
    };
    const pieceMap = new Map<string, PieceRow>([
      [
        "piece-nulls",
        {
          arranger: null,
          composer: null,
          durationSeconds: null,
          id: "piece-nulls",
          parentId: null,
          title: "Chant",
          trackFileIds: null,
        },
      ],
    ]);

    const result = toPlaylistItem(item, pieceMap);
    expect(result.arranger).toBeUndefined();
    expect(result.composer).toBeUndefined();
    expect(result.durationSeconds).toBeUndefined();
    expect(result.title).toBe("Chant");
    expect(result.trackFileIds).toEqual({});
  });

  it("preserves non-null string and number fields when present", () => {
    const item = {
      isFeaturedNumber: true,
      pieceId: "piece-full",
      title: "Gloria",
    };
    const pieceMap = new Map<string, PieceRow>([
      [
        "piece-full",
        {
          arranger: "Shaw",
          composer: "Vivaldi",
          durationSeconds: 180,
          id: "piece-full",
          parentId: null,
          title: "Gloria",
          trackFileIds: JSON.stringify({ soprano: "file-1" }),
        },
      ],
    ]);

    const result = toPlaylistItem(item, pieceMap);
    expect(result.arranger).toBe("Shaw");
    expect(result.composer).toBe("Vivaldi");
    expect(result.durationSeconds).toBe(180);
    expect(result.isFeaturedNumber).toBe(true);
    expect(result.trackFileIds).toEqual({ soprano: "file-1" });
  });

  it("handles item with no pieceId (fallback to item composer)", () => {
    const item = {
      composer: "Traditional",
      isFeaturedNumber: false,
      title: "Hymn",
    };
    const pieceMap = new Map<string, PieceRow>();

    const result = toPlaylistItem(item, pieceMap);
    expect(result.composer).toBe("Traditional");
    expect(result.arranger).toBeUndefined();
    expect(result.pieceId).toBeUndefined();
    expect(result.trackFileIds).toEqual({});
  });
});
