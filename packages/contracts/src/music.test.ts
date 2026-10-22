import { describe, expect, it } from "vitest";

import {
  organizationMusicCreditRenameRequestSchema,
  organizationMusicLibrarySettingsRequestSchema,
  organizationMusicLibrarySettingsResponseSchema,
  organizationMusicPiecesResponseSchema,
  organizationMusicPieceRequestSchema,
} from "./music";

describe("music movement order compatibility", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("accepts legacy omission, explicit undefined, empty order, and a saved order", () => {
    for (const extra of [
      {},
      { movementOrder: undefined },
      { movementOrder: [] },
      { movementOrder: [id] },
    ]) {
      expect(
        organizationMusicPieceRequestSchema.safeParse({ title: "Work", ...extra }).success,
      ).toBe(true);
    }
  });
  it("rejects null, duplicate IDs, and invalid IDs", () => {
    for (const movementOrder of [null, [id, id], ["not-an-id"]]) {
      expect(
        organizationMusicPieceRequestSchema.safeParse({ title: "Work", movementOrder }).success,
      ).toBe(false);
    }
  });
});

describe("organizationMusicCreditRenameRequestSchema", () => {
  it("trims valid exact credit names", () => {
    expect(
      organizationMusicCreditRenameRequestSchema.parse({
        currentName: "  Jane Doe ",
        newName: " Jane Q. Doe ",
      }),
    ).toEqual({ currentName: "Jane Doe", newName: "Jane Q. Doe" });
  });

  it("rejects missing, unchanged, and unknown request fields", () => {
    expect(
      organizationMusicCreditRenameRequestSchema.safeParse({
        currentName: "Jane Doe",
        newName: " Jane Doe ",
      }).success,
    ).toBe(false);
    expect(
      organizationMusicCreditRenameRequestSchema.safeParse({
        currentName: "",
        newName: "Jane Doe",
      }).success,
    ).toBe(false);
    expect(
      organizationMusicCreditRenameRequestSchema.safeParse({
        currentName: "Jane Doe",
        newName: "Jane Q. Doe",
        role: "composer",
      }).success,
    ).toBe(false);
  });

  it("accepts 300-character names and rejects 301-character names", () => {
    expect(
      organizationMusicCreditRenameRequestSchema.safeParse({
        currentName: "Current credit",
        newName: "n".repeat(300),
      }).success,
    ).toBe(true);
    expect(
      organizationMusicCreditRenameRequestSchema.safeParse({
        currentName: "Current credit",
        newName: "n".repeat(301),
      }).success,
    ).toBe(false);
  });
});

describe("organizationMusicPiecesResponseSchema", () => {
  const piece = {
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000000",
    title: "Piece",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const requestId = "00000000-0000-4000-8000-000000000001";

  it("accepts the 5,000-piece Organization catalog envelope", () => {
    expect(
      organizationMusicPiecesResponseSchema.safeParse({
        pieces: Array.from({ length: 5_000 }, () => piece),
        requestId,
      }).success,
    ).toBe(true);
  });

  it("rejects a catalog beyond the 5,000-piece envelope", () => {
    expect(
      organizationMusicPiecesResponseSchema.safeParse({
        pieces: Array.from({ length: 5_001 }, () => piece),
        requestId,
      }).success,
    ).toBe(false);
  });
});

describe("practice loudness target settings", () => {
  it("preserves omitted update values and defaults old responses", () => {
    expect(
      organizationMusicLibrarySettingsRequestSchema.parse({}).practiceLoudnessTargetLufs,
    ).toBeUndefined();
    expect(
      organizationMusicLibrarySettingsResponseSchema.parse({
        requestId: "00000000-0000-4000-8000-000000000001",
      }).practiceLoudnessTargetLufs,
    ).toBe(-18);
  });
  it.each([-30, -24, -18, -14.5, -10])(
    "accepts bounded targets (%s)",
    (practiceLoudnessTargetLufs) => {
      expect(
        organizationMusicLibrarySettingsRequestSchema.safeParse({ practiceLoudnessTargetLufs })
          .success,
      ).toBe(true);
    },
  );
  it.each([null, "-18", NaN, Infinity, -30.1, -9.9])(
    "rejects invalid targets (%s)",
    (practiceLoudnessTargetLufs) => {
      expect(
        organizationMusicLibrarySettingsRequestSchema.safeParse({ practiceLoudnessTargetLufs })
          .success,
      ).toBe(false);
    },
  );
});
