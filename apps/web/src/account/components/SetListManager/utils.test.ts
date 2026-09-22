import {
  organizationEventSchema,
  organizationMusicPieceSchema,
  type OrganizationEvent,
  type OrganizationMusicPiece,
} from "@choir/contracts";
import { describe, expect, it } from "vitest";

import {
  effectiveSetListItemComposer,
  effectiveSetListItemDuration,
  effectiveSetListItemDurationSeconds,
  effectiveSetListItemNotes,
  musicPiecesForSetListItem,
  resolveSetListPreferredPracticeTrack,
  setListDocumentText,
  setListItemForEdit,
  setListItemRecordingStatus,
  setListPreviewRows,
  setListPrintedCredit,
  setListRecordingCoverage,
} from "./utils";
import type { SetListItem } from "./types";

const pieceId = "3f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f";
const otherPieceId = "4f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f";

function piece(overrides: Partial<OrganizationMusicPiece> = {}): OrganizationMusicPiece {
  return organizationMusicPieceSchema.parse({
    composer: "Greg Gilpin",
    createdAt: "2026-01-15T12:00:00.000Z",
    durationSeconds: 195,
    notes: "Key change after the second verse. Acknowledge the accompanist.",
    title: "A Holiday Road of Carols",
    updatedAt: "2026-01-15T12:00:00.000Z",
    ...overrides,
    id: overrides.id ?? pieceId,
  });
}

const music = [piece()];

describe("effectiveSetListItemNotes", () => {
  it("prefers the item's own notes over the linked library piece notes", () => {
    const item: SetListItem = {
      id: "item-1",
      notes: "Announce the arranger before this one.",
      pieceId,
      title: "A Holiday Road of Carols",
      type: "song",
    };
    expect(effectiveSetListItemNotes(item, music)).toBe("Announce the arranger before this one.");
  });

  it("falls back to the linked library piece notes when item notes are blank", () => {
    const item: SetListItem = {
      id: "item-1",
      notes: "   ",
      pieceId,
      title: "A Holiday Road of Carols",
      type: "song",
    };
    expect(effectiveSetListItemNotes(item, music)).toBe(
      "Key change after the second verse. Acknowledge the accompanist.",
    );
  });

  it("uses item notes when no library piece is linked", () => {
    const item: SetListItem = {
      id: "item-1",
      notes: "Intermission lasts ten minutes.",
      title: "Intermission",
      type: "intermission",
    };
    expect(effectiveSetListItemNotes(item, music)).toBe("Intermission lasts ten minutes.");
  });

  it("returns an empty string when neither item nor library notes exist", () => {
    const item: SetListItem = {
      id: "item-1",
      pieceId: otherPieceId,
      title: "Unlinked",
      type: "song",
    };
    expect(effectiveSetListItemNotes(item, music)).toBe("");
  });
});

describe("setListDocumentText notes", () => {
  const event: OrganizationEvent = organizationEventSchema.parse({
    createdAt: "2026-08-01T12:00:00.000Z",
    id: "5f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
    location: "Community Hall",
    setList: [],
    startsAt: "2026-12-05T19:30:00.000Z",
    title: "Winter Concert",
    type: "Performance",
    updatedAt: "2026-08-01T12:00:00.000Z",
  });

  const items: SetListItem[] = [
    { id: "item-1", pieceId, title: "A Holiday Road of Carols", type: "song" },
    {
      id: "item-2",
      notes: "Serve refreshments in the lobby.",
      title: "Intermission",
      type: "intermission",
    },
  ];

  it("omits notes by default so the shared copy stays compact", () => {
    const text = setListDocumentText(event, items, music);
    expect(text).toContain("1. A Holiday Road of Carols ~ Greg Gilpin");
    expect(text).not.toContain("Notes:");
  });

  it("appends linked library notes and custom entry notes when enabled", () => {
    const text = setListDocumentText(event, items, music, true);
    expect(text).toContain(
      "   Notes: Key change after the second verse. Acknowledge the accompanist.",
    );
    expect(text).toContain("Intermission");
    expect(text).toContain("   Notes: Serve refreshments in the lobby.");
  });

  it("indents continuation lines of multi-line notes", () => {
    const multiLine: SetListItem[] = [
      {
        id: "item-1",
        notes: "First line.\nSecond line.",
        title: "Intermission",
        type: "intermission",
      },
    ];
    const text = setListDocumentText(event, multiLine, [], true);
    expect(text).toContain("   Notes: First line.\n   Second line.");
  });
});

describe("setListPrintedCredit", () => {
  it("prefers arranger over composer and adds 'arr. ' prefix when both exist", () => {
    expect(setListPrintedCredit("Jane Doe", "John Smith")).toBe("arr. Jane Doe");
  });

  it("shows arranger with 'arr. ' prefix when composer is absent", () => {
    expect(setListPrintedCredit("Jane Doe", undefined)).toBe("arr. Jane Doe");
    expect(setListPrintedCredit("Jane Doe", "")).toBe("arr. Jane Doe");
    expect(setListPrintedCredit("Jane Doe", null)).toBe("arr. Jane Doe");
  });

  it("shows composer with no prefix when arranger is absent", () => {
    expect(setListPrintedCredit(undefined, "John Smith")).toBe("John Smith");
    expect(setListPrintedCredit("", "John Smith")).toBe("John Smith");
    expect(setListPrintedCredit(null, "John Smith")).toBe("John Smith");
  });

  it("returns empty string when neither arranger nor composer exists", () => {
    expect(setListPrintedCredit(undefined, undefined)).toBe("");
    expect(setListPrintedCredit("", "")).toBe("");
    expect(setListPrintedCredit(null, null)).toBe("");
  });

  it("trims surrounding whitespace from arranger and composer", () => {
    expect(setListPrintedCredit("  Jane Doe  ", "  John Smith  ")).toBe("arr. Jane Doe");
    expect(setListPrintedCredit("   ", "  John Smith  ")).toBe("John Smith");
  });

  it("treats whitespace-only values as absent", () => {
    expect(setListPrintedCredit("   ", "   ")).toBe("");
  });
});

describe("setListDocumentText credit precedence", () => {
  const event: OrganizationEvent = organizationEventSchema.parse({
    createdAt: "2026-08-01T12:00:00.000Z",
    id: "5f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
    location: "Community Hall",
    setList: [],
    startsAt: "2026-12-05T19:30:00.000Z",
    title: "Winter Concert",
    type: "Performance",
    updatedAt: "2026-08-01T12:00:00.000Z",
  });

  const pieceBoth = piece({
    arranger: "Peter J. Wilhousky",
    composer: "Mykola Leontovych",
    id: "11111111-1111-4111-8111-111111111111",
    title: "Carol of the Bells",
  });

  const pieceComposerOnly = piece({
    arranger: "",
    composer: "George Frideric Handel",
    id: "22222222-2222-4222-8222-222222222222",
    title: "Messiah",
  });

  const pieceArrangerOnly = piece({
    arranger: "Moses Hogan",
    composer: "",
    id: "33333333-3333-4333-8333-333333333333",
    title: "Elijah Rock",
  });

  const pieceNeither = piece({
    arranger: "",
    composer: "",
    id: "44444444-4444-4444-8444-444444444444",
    title: "Traditional Chants",
  });

  const catalog = [pieceBoth, pieceComposerOnly, pieceArrangerOnly, pieceNeither];

  it("shows only the arranger with 'arr. ' prefix when both arranger and composer exist", () => {
    const items: SetListItem[] = [
      { id: "item-1", pieceId: pieceBoth.id, title: pieceBoth.title, type: "song" },
    ];
    const text = setListDocumentText(event, items, catalog);
    expect(text).toContain("1. Carol of the Bells ~ arr. Peter J. Wilhousky");
    expect(text).not.toContain("Mykola Leontovych");
  });

  it("shows only the arranger with 'arr. ' prefix when only arranger exists", () => {
    const items: SetListItem[] = [
      { id: "item-1", pieceId: pieceArrangerOnly.id, title: pieceArrangerOnly.title, type: "song" },
    ];
    const text = setListDocumentText(event, items, catalog);
    expect(text).toContain("1. Elijah Rock ~ arr. Moses Hogan");
  });

  it("shows composer with no prefix when only composer exists", () => {
    const items: SetListItem[] = [
      { id: "item-1", pieceId: pieceComposerOnly.id, title: pieceComposerOnly.title, type: "song" },
    ];
    const text = setListDocumentText(event, items, catalog);
    expect(text).toContain("1. Messiah ~ George Frideric Handel");
  });

  it("shows no separator or credit when neither arranger nor composer exists", () => {
    const items: SetListItem[] = [
      { id: "item-1", pieceId: pieceNeither.id, title: pieceNeither.title, type: "song" },
    ];
    const text = setListDocumentText(event, items, catalog);
    expect(text).toContain("1. Traditional Chants");
    expect(text).not.toContain("~");
    expect(text).not.toContain("arr.");
  });

  it("trims surrounding whitespace and ignores whitespace-only credits", () => {
    const customItemWhitespace: SetListItem = {
      composer: "   ",
      id: "item-1",
      title: "Whitespace Song",
      type: "song",
    };
    const text = setListDocumentText(event, [customItemWhitespace], []);
    expect(text).toContain("1. Whitespace Song");
    expect(text).not.toContain("~");
    expect(text).not.toContain("arr.");
  });

  it("leaves intermission items without credit formatting", () => {
    const items: SetListItem[] = [
      { id: "item-1", pieceId: pieceBoth.id, title: pieceBoth.title, type: "song" },
      { id: "item-2", title: "Intermission", type: "intermission" },
    ];
    const text = setListDocumentText(event, items, catalog);
    expect(text).toContain("1. Carol of the Bells ~ arr. Peter J. Wilhousky");
    expect(text).toContain("Intermission");
  });
});

describe("setListPreviewRows notes", () => {
  it("carries the effective notes so the preview can render them", () => {
    const rows = setListPreviewRows(
      [{ id: "item-1", pieceId, title: "A Holiday Road of Carols", type: "song" }],
      music,
    );
    expect(rows[0]?.notes).toBe("Key change after the second verse. Acknowledge the accompanist.");
  });
});

describe("effectiveSetListItemDuration and effectiveSetListItemDurationSeconds", () => {
  it("prefers the item's own duration over the library piece duration", () => {
    const item: SetListItem = {
      duration: "4:15",
      id: "item-1",
      pieceId,
      title: "A Holiday Road of Carols",
      type: "song",
    };
    expect(effectiveSetListItemDuration(item, music)).toBe("4:15");
    expect(effectiveSetListItemDurationSeconds(item, music)).toBe(255);
  });

  it("falls back to the linked library piece duration when item duration is absent or blank", () => {
    const item: SetListItem = {
      id: "item-1",
      pieceId,
      title: "A Holiday Road of Carols",
      type: "song",
    };
    expect(effectiveSetListItemDuration(item, music)).toBe("3:15");
    expect(effectiveSetListItemDurationSeconds(item, music)).toBe(195);
  });

  it("uses custom entry duration without a linked piece", () => {
    const item: SetListItem = {
      duration: "10 min",
      id: "item-2",
      title: "Intermission",
      type: "intermission",
    };
    expect(effectiveSetListItemDuration(item, music)).toBe("10:00");
    expect(effectiveSetListItemDurationSeconds(item, music)).toBe(600);
  });

  it("returns undefined and 0 when neither item nor library piece has a duration", () => {
    const item: SetListItem = {
      id: "item-3",
      pieceId: otherPieceId,
      title: "Unknown Piece",
      type: "song",
    };
    expect(effectiveSetListItemDuration(item, music)).toBeUndefined();
    expect(effectiveSetListItemDurationSeconds(item, music)).toBe(0);
  });
});

describe("effectiveSetListItemComposer", () => {
  it("prefers item's own composer", () => {
    const item: SetListItem = {
      composer: "Custom Composer",
      id: "item-1",
      pieceId,
      title: "A Holiday Road of Carols",
      type: "song",
    };
    expect(effectiveSetListItemComposer(item, music)).toBe("Custom Composer");
  });

  it("falls back to linked library piece composer", () => {
    const item: SetListItem = {
      id: "item-1",
      pieceId,
      title: "A Holiday Road of Carols",
      type: "song",
    };
    expect(effectiveSetListItemComposer(item, music)).toBe("Greg Gilpin");
  });

  it("returns undefined for intermission items", () => {
    const item: SetListItem = {
      composer: "Someone",
      id: "item-2",
      title: "Intermission",
      type: "intermission",
    };
    expect(effectiveSetListItemComposer(item, music)).toBeUndefined();
  });
});

describe("setListItemForEdit", () => {
  it("falls back to item duration if linked piece duration is null", () => {
    const musicWithoutDuration = [piece({ durationSeconds: null })];
    const item: SetListItem = {
      duration: "2:45",
      id: "item-1",
      pieceId,
      title: "A Holiday Road of Carols",
      type: "song",
    };
    const edited = setListItemForEdit(item, musicWithoutDuration);
    expect(edited.duration).toBe("2:45");
  });

  it("uses linked piece duration when present", () => {
    const item: SetListItem = {
      id: "item-1",
      pieceId,
      title: "A Holiday Road of Carols",
      type: "song",
    };
    const edited = setListItemForEdit(item, music);
    expect(edited.duration).toBe("3:15");
  });
});

describe("musicPiecesForSetListItem", () => {
  it("returns empty array when item has no pieceId", () => {
    const item: SetListItem = { id: "item-1", title: "Custom Song", type: "song" };
    expect(musicPiecesForSetListItem(item, music)).toEqual([]);
  });

  it("returns exact piece and child movements", () => {
    const parent = piece({ id: pieceId, title: "Messiah" });
    const child1 = piece({
      id: "5f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
      parentId: pieceId,
      title: "Comfort Ye",
    });
    const child2 = piece({
      id: "6f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
      parentId: pieceId,
      title: "Ev'ry Valley",
    });
    const item: SetListItem = { id: "item-1", pieceId, title: "Messiah", type: "song" };
    const pieces = musicPiecesForSetListItem(item, [parent, child1, child2]);
    expect(pieces.map((p) => p.id)).toEqual([pieceId, child1.id, child2.id]);
  });
});

const validFileId1 = "11111111-1111-4111-8111-111111111111";
const validFileId2 = "22222222-2222-4222-8222-222222222222";

describe("resolveSetListPreferredPracticeTrack", () => {
  it("exact linked piece with Tutti selects Tutti with fallback: false", () => {
    const pieceWithTutti = piece({
      id: pieceId,
      trackFileIds: {
        soprano: validFileId2,
        tutti: validFileId1,
      },
    });
    const item: SetListItem = { id: "item-1", pieceId, title: "Piece", type: "song" };
    const resolved = resolveSetListPreferredPracticeTrack(item, [pieceWithTutti]);
    expect(resolved).toEqual({
      fallback: false,
      fileId: validFileId1,
      sourcePieceId: pieceId,
      sourcePieceTitle: pieceWithTutti.title,
      trackKey: "tutti",
      trackLabel: "Tutti",
    });
  });

  it("exact linked piece without Tutti but Everyone selects Everyone with fallback: true", () => {
    const pieceWithEveryone = piece({
      id: pieceId,
      trackFileIds: {
        alto: validFileId2,
        everyone: validFileId1,
      },
    });
    const item: SetListItem = { id: "item-1", pieceId, title: "Piece", type: "song" };
    const resolved = resolveSetListPreferredPracticeTrack(item, [pieceWithEveryone]);
    expect(resolved).toEqual({
      fallback: true,
      fileId: validFileId1,
      sourcePieceId: pieceId,
      sourcePieceTitle: pieceWithEveryone.title,
      trackKey: "everyone",
      trackLabel: "Everyone",
    });
  });

  it("exact linked piece with only a voice-part track selects that track and labels it accurately", () => {
    const pieceWithTenor = piece({
      id: pieceId,
      trackFileIds: {
        tenor: validFileId1,
      },
    });
    const item: SetListItem = { id: "item-1", pieceId, title: "Piece", type: "song" };
    const resolved = resolveSetListPreferredPracticeTrack(item, [pieceWithTenor]);
    expect(resolved).toEqual({
      fallback: true,
      fileId: validFileId1,
      sourcePieceId: pieceId,
      sourcePieceTitle: pieceWithTenor.title,
      trackKey: "tenor",
      trackLabel: "Tenor",
    });
  });

  it("no tracks returns null (unavailable)", () => {
    const pieceNoTracks = piece({
      id: pieceId,
      trackFileIds: {},
    });
    const item: SetListItem = { id: "item-1", pieceId, title: "Piece", type: "song" };
    expect(resolveSetListPreferredPracticeTrack(item, [pieceNoTracks])).toBeNull();
  });

  it("parent item with one child recording resolves child recording", () => {
    const parentPiece = piece({
      id: pieceId,
      title: "Gloria",
      trackFileIds: {},
    });
    const childMovement = piece({
      id: "5f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
      parentId: pieceId,
      title: "Gloria in Excelsis Deo",
      trackFileIds: { tutti: validFileId1 },
    });
    const item: SetListItem = { id: "item-1", pieceId, title: "Gloria", type: "song" };
    const resolved = resolveSetListPreferredPracticeTrack(item, [parentPiece, childMovement]);
    expect(resolved).toEqual({
      fallback: true,
      fileId: validFileId1,
      sourcePieceId: childMovement.id,
      sourcePieceTitle: childMovement.title,
      trackKey: "tutti",
      trackLabel: "Tutti",
    });
  });

  it("parent item with multiple child recordings returns null (ambiguous state)", () => {
    const parentPiece = piece({
      id: pieceId,
      title: "Gloria",
      trackFileIds: {},
    });
    const child1 = piece({
      id: "5f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
      parentId: pieceId,
      title: "Movement 1",
      trackFileIds: { tutti: validFileId1 },
    });
    const child2 = piece({
      id: "6f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
      parentId: pieceId,
      title: "Movement 2",
      trackFileIds: { tutti: validFileId2 },
    });
    const item: SetListItem = { id: "item-1", pieceId, title: "Gloria", type: "song" };
    expect(resolveSetListPreferredPracticeTrack(item, [parentPiece, child1, child2])).toBeNull();
  });
});

describe("setListItemRecordingStatus", () => {
  it("returns status: custom for intermission items", () => {
    const item: SetListItem = { id: "item-1", title: "Intermission", type: "intermission" };
    expect(setListItemRecordingStatus(item, music)).toEqual({ status: "custom" });
  });

  it("returns status: missing for song without pieceId or tracks", () => {
    const itemNoPiece: SetListItem = { id: "item-1", title: "Uncataloged Song", type: "song" };
    expect(setListItemRecordingStatus(itemNoPiece, music)).toEqual({ status: "missing" });

    const pieceNoTracks = piece({ id: pieceId, trackFileIds: {} });
    const itemWithPiece: SetListItem = { id: "item-2", pieceId, title: "Song", type: "song" };
    expect(setListItemRecordingStatus(itemWithPiece, [pieceNoTracks])).toEqual({
      status: "missing",
    });
  });

  it("returns status: available with track details when recording exists", () => {
    const pieceWithTrack = piece({
      id: pieceId,
      trackFileIds: { tutti: validFileId1 },
    });
    const item: SetListItem = { id: "item-1", pieceId, title: "Song", type: "song" };
    const status = setListItemRecordingStatus(item, [pieceWithTrack]);
    expect(status).toEqual({
      status: "available",
      track: {
        fallback: false,
        fileId: validFileId1,
        sourcePieceId: pieceId,
        sourcePieceTitle: pieceWithTrack.title,
        trackKey: "tutti",
        trackLabel: "Tutti",
      },
    });
  });

  it("returns status: multiple when multiple child pieces have recordings", () => {
    const parentPiece = piece({ id: pieceId, trackFileIds: {} });
    const child1 = piece({
      id: "5f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
      parentId: pieceId,
      trackFileIds: { tutti: validFileId1 },
    });
    const child2 = piece({
      id: "6f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
      parentId: pieceId,
      trackFileIds: { tutti: validFileId2 },
    });
    const item: SetListItem = { id: "item-1", pieceId, title: "Gloria", type: "song" };
    expect(setListItemRecordingStatus(item, [parentPiece, child1, child2])).toEqual({
      childCount: 2,
      status: "multiple",
    });
  });
});

describe("setListRecordingCoverage", () => {
  it("counts song rows only, excludes Custom entries, and returns correct totals", () => {
    const song1Piece = piece({ id: pieceId, trackFileIds: { tutti: validFileId1 } });
    const song2Piece = piece({ id: otherPieceId, trackFileIds: {} });
    const musicList = [song1Piece, song2Piece];

    const items: SetListItem[] = [
      { id: "1", pieceId, title: "Song with Recording", type: "song" },
      { id: "2", title: "Intermission", type: "intermission" },
      { id: "3", pieceId: otherPieceId, title: "Song missing Recording", type: "song" },
      { id: "4", title: "Announcements", type: "intermission" },
      { id: "5", title: "Uncataloged Song", type: "song" },
    ];

    const coverage = setListRecordingCoverage(items, musicList);
    expect(coverage).toEqual({
      songCount: 3,
      songsMissingRecording: 2,
      songsWithRecording: 1,
    });
  });

  it("counts multi-child recordings as available in coverage", () => {
    const parentPiece = piece({ id: pieceId, trackFileIds: {} });
    const child1 = piece({
      id: "5f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
      parentId: pieceId,
      trackFileIds: { tutti: validFileId1 },
    });
    const child2 = piece({
      id: "6f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
      parentId: pieceId,
      trackFileIds: { tutti: validFileId2 },
    });
    const items: SetListItem[] = [{ id: "1", pieceId, title: "Gloria", type: "song" }];

    const coverage = setListRecordingCoverage(items, [parentPiece, child1, child2]);
    expect(coverage).toEqual({
      songCount: 1,
      songsMissingRecording: 0,
      songsWithRecording: 1,
    });
  });
});
