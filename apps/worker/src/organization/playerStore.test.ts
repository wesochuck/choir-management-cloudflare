import { describe, expect, it } from "vitest";

import {
  type PieceRow,
  readTrackLabels,
  resolveSetListPlaylistItems,
  toPlaylistItem,
} from "./playerStore";

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

  it("falls back to item composer when piece composer is an empty string", () => {
    const item = {
      composer: "Item Composer",
      isFeaturedNumber: false,
      pieceId: "piece-empty-composer",
      title: "Piece Title",
    };
    const pieceMap = new Map<string, PieceRow>([
      [
        "piece-empty-composer",
        {
          arranger: null,
          composer: "",
          durationSeconds: null,
          id: "piece-empty-composer",
          parentId: null,
          title: "Piece Title",
          trackFileIds: null,
        },
      ],
    ]);

    const result = toPlaylistItem(item, pieceMap);
    expect(result.composer).toBe("Item Composer");
  });
});

describe("resolveSetListPlaylistItems", () => {
  const parentHolder: PieceRow = {
    arranger: "Gjeilo Arr",
    composer: "Ola Gjeilo",
    durationSeconds: null,
    id: "parent-holder-id",
    movementOrderJson: JSON.stringify(["mov-1-id", "mov-2-id"]),
    parentId: null,
    title: "Sunrise Mass",
    trackFileIds: "{}",
  };

  const movement1: PieceRow = {
    arranger: null,
    composer: null,
    durationSeconds: 240,
    id: "mov-1-id",
    movementOrderJson: null,
    parentId: "parent-holder-id",
    title: "The Spheres",
    trackFileIds: JSON.stringify({ soprano: "f-spheres-soprano" }),
  };

  const movement2: PieceRow = {
    arranger: null,
    composer: null,
    durationSeconds: 300,
    id: "mov-2-id",
    movementOrderJson: null,
    parentId: "parent-holder-id",
    title: "Sunrise",
    trackFileIds: JSON.stringify({ alto: "f-sunrise-alto" }),
  };

  it("omits parent holder and preserves each movement's own tracks when parent holder and movements are in set list", () => {
    const setList = [
      {
        pieceId: "parent-holder-id",
        title: "Sunrise Mass",
      },
      {
        pieceId: "mov-1-id",
        title: "The Spheres",
      },
      {
        pieceId: "mov-2-id",
        title: "Sunrise",
      },
    ];

    const pieceMap = new Map<string, PieceRow>([
      ["parent-holder-id", parentHolder],
      ["mov-1-id", movement1],
      ["mov-2-id", movement2],
    ]);

    const childrenMap = new Map<string, PieceRow[]>([["parent-holder-id", [movement1, movement2]]]);

    const items = resolveSetListPlaylistItems(setList, pieceMap, childrenMap);

    expect(items).toHaveLength(2);
    expect(items[0]?.pieceId).toBe("mov-1-id");
    expect(items[0]?.title).toBe("The Spheres");
    expect(items[0]?.composer).toBe("Ola Gjeilo");
    expect(items[0]?.arranger).toBe("Gjeilo Arr");
    expect(items[0]?.trackFileIds).toEqual({ soprano: "f-spheres-soprano" });
    expect(items[1]?.pieceId).toBe("mov-2-id");
    expect(items[1]?.title).toBe("Sunrise");
    expect(items[1]?.composer).toBe("Ola Gjeilo");
    expect(items[1]?.arranger).toBe("Gjeilo Arr");
    expect(items[1]?.trackFileIds).toEqual({ alto: "f-sunrise-alto" });
  });

  it("expands parent holder alone in set list into movements in movementOrderJson order with each movement's own tracks", () => {
    const setList = [
      {
        isFeaturedNumber: true,
        notes: "Full mass performance",
        pieceId: "parent-holder-id",
        title: "Sunrise Mass",
      },
    ];

    const pieceMap = new Map<string, PieceRow>([["parent-holder-id", parentHolder]]);

    // Children in reverse order to ensure movementOrderJson sorting is verified
    const childrenMap = new Map<string, PieceRow[]>([["parent-holder-id", [movement2, movement1]]]);

    const items = resolveSetListPlaylistItems(setList, pieceMap, childrenMap);

    expect(items).toHaveLength(2);
    expect(items[0]?.pieceId).toBe("mov-1-id");
    expect(items[0]?.title).toBe("The Spheres");
    expect(items[0]?.composer).toBe("Ola Gjeilo");
    expect(items[0]?.arranger).toBe("Gjeilo Arr");
    expect(items[0]?.durationSeconds).toBe(240);
    expect(items[0]?.isFeaturedNumber).toBe(true);
    expect(items[0]?.notes).toBe("Full mass performance");
    expect(items[0]?.trackFileIds).toEqual({ soprano: "f-spheres-soprano" });

    expect(items[1]?.pieceId).toBe("mov-2-id");
    expect(items[1]?.title).toBe("Sunrise");
    expect(items[1]?.composer).toBe("Ola Gjeilo");
    expect(items[1]?.trackFileIds).toEqual({ alto: "f-sunrise-alto" });
  });

  it("keeps parent piece's own trackFileIds without overwriting from children when parent has tracks", () => {
    const parentWithTracks: PieceRow = {
      arranger: "Shaw",
      composer: "Handel",
      durationSeconds: 600,
      id: "parent-with-tracks-id",
      movementOrderJson: JSON.stringify(["mov-1-id"]),
      parentId: null,
      title: "Messiah Highlights",
      trackFileIds: JSON.stringify({ tutti: "f-messiah-tutti" }),
    };

    const setList = [
      {
        pieceId: "parent-with-tracks-id",
        title: "Messiah Highlights",
      },
    ];

    const pieceMap = new Map<string, PieceRow>([["parent-with-tracks-id", parentWithTracks]]);
    const childrenMap = new Map<string, PieceRow[]>([["parent-with-tracks-id", [movement1]]]);

    const items = resolveSetListPlaylistItems(setList, pieceMap, childrenMap);

    expect(items).toHaveLength(1);
    expect(items[0]?.pieceId).toBe("parent-with-tracks-id");
    expect(items[0]?.title).toBe("Messiah Highlights");
    expect(items[0]?.trackFileIds).toEqual({ tutti: "f-messiah-tutti" });
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
