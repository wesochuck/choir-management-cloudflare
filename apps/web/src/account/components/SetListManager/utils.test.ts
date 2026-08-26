import {
  organizationEventSchema,
  organizationMusicPieceSchema,
  type OrganizationEvent,
  type OrganizationMusicPiece,
} from "@choir/contracts";
import { describe, expect, it } from "vitest";

import { effectiveSetListItemNotes, setListDocumentText, setListPreviewRows } from "./utils";
import type { SetListItem } from "./types";

const pieceId = "3f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f";
const otherPieceId = "4f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f";

function piece(overrides: Partial<OrganizationMusicPiece> = {}): OrganizationMusicPiece {
  return organizationMusicPieceSchema.parse({
    composer: "Greg Gilpin",
    createdAt: "2026-01-15T12:00:00.000Z",
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
