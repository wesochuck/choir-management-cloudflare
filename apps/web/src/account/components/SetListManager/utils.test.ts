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
  setListDocumentText,
  setListItemForEdit,
  setListPreviewRows,
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
