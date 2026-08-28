import { describe, expect, it } from "vitest";

import {
  organizationMusicCreditRenameRequestSchema,
  organizationMusicPiecesResponseSchema,
} from "./music";

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
