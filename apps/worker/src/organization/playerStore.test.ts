import { describe, expect, it } from "vitest";

import { type PieceRow, readTrackLabels, toPlaylistItem } from "./playerStore";

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

describe("readTrackLabels", () => {
  it("maps section codes, voice parts, and tutti aliases from configuration", () => {
    const config = {
      sections: [
        { code: "S", name: "Sopranos" },
        { code: "A", name: "Altos" },
        { code: "T", name: "Tenors" },
        { code: "B", name: "Basses" },
        { code: "SATB", name: "Full Chorus" },
        { code: "O", name: "Orchestra" },
      ],
      voiceParts: [
        { fullName: "Soprano 1", label: "S1" },
        { fullName: "Soprano 2", label: "S2" },
        { fullName: "Alto 1", label: "A1" },
        { fullName: "Alto 2", label: "A2" },
        { fullName: "Tenor 1", label: "T1" },
        { fullName: "Tenor 2", label: "T2" },
        { fullName: "Bass 1", label: "B1" },
        { fullName: "Bass 2", label: "B2" },
      ],
    };

    const labels = readTrackLabels(config);

    expect(labels.S1).toBe("Soprano 1");
    expect(labels.B1).toBe("Bass 1");
    expect(labels.T1).toBe("Tenor 1");
    expect(labels.A1).toBe("Alto 1");
    expect(labels.SATB).toBe("Full Chorus");
    expect(labels.O).toBe("Orchestra");
    expect(labels.tutti).toBe("Choir Mix");
    expect(labels.choirmix).toBe("Choir Mix");
  });

  it("prioritizes voicePart fullName over section name if their codes collide", () => {
    const config = {
      sections: [{ code: "S1", name: "Soprano Section" }],
      voiceParts: [{ fullName: "Soprano 1 (Solo)", label: "S1" }],
    };

    const labels = readTrackLabels(config);
    expect(labels.S1).toBe("Soprano 1 (Solo)");
  });
});
