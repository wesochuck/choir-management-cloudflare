import { describe, expect, it } from "vitest";

import type { OrganizationMusicPiece } from "@choir/contracts";

import {
  normalizeDurationInput,
  parseDuration,
  resolvePreferredPracticeTrack,
  summarizeMusicCredits,
} from "./utils";

function piece(id: string, composer: string, arranger: string): OrganizationMusicPiece {
  return {
    arranger,
    catalogId: "",
    composer,
    copies: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    durationSeconds: null,
    genres: [],
    id,
    lastPerformedAt: null,
    notes: "",
    parentId: null,
    performanceCount: 0,
    purchaseDate: null,
    sectionBuckets: [],
    title: id,
    trackFileIds: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("music duration input", () => {
  it("repairs minute-only and short seconds values", () => {
    expect(normalizeDurationInput("3")).toBe("3:00");
    expect(normalizeDurationInput("3:")).toBe("3:00");
    expect(normalizeDurationInput("3:5")).toBe("3:05");
  });

  it("parses repaired values as seconds", () => {
    expect(parseDuration("3")).toBe(180);
    expect(parseDuration("3:5")).toBe(185);
    expect(parseDuration("3:60")).toBeUndefined();
  });
});

describe("summarizeMusicCredits", () => {
  it("keeps exact case variants separate and counts each piece once per role and total", () => {
    expect(
      summarizeMusicCredits([
        piece("one", "Jane Doe", "Jane Doe"),
        piece("two", " Jane Doe ", "A. Smith"),
        piece("three", "jane doe", ""),
        piece("four", "", "Jane Doe"),
      ]),
    ).toEqual([
      { arrangerPieces: 1, composerPieces: 0, name: "A. Smith", totalPieces: 1 },
      { arrangerPieces: 0, composerPieces: 1, name: "jane doe", totalPieces: 1 },
      { arrangerPieces: 2, composerPieces: 2, name: "Jane Doe", totalPieces: 3 },
    ]);
  });
});

describe("resolvePreferredPracticeTrack", () => {
  it("returns null when no practice tracks are uploaded or all ids are blank", () => {
    expect(resolvePreferredPracticeTrack(piece("p1", "", ""))).toBeNull();
    expect(
      resolvePreferredPracticeTrack({
        ...piece("p2", "", ""),
        trackFileIds: { tutti: "   ", soprano: "" },
      }),
    ).toBeNull();
  });

  it("prefers tutti track if present", () => {
    expect(
      resolvePreferredPracticeTrack({
        ...piece("p1", "", ""),
        trackFileIds: {
          alto: "file-alto",
          everyone: "file-everyone",
          soprano: "file-soprano",
          tutti: "file-tutti",
        },
      }),
    ).toEqual({
      fileId: "file-tutti",
      key: "tutti",
      label: "Tutti",
    });
  });

  it("handles case-insensitive Tutti key", () => {
    expect(
      resolvePreferredPracticeTrack({
        ...piece("p1", "", ""),
        trackFileIds: {
          Soprano: "file-soprano",
          Tutti: "file-tutti-capital",
        },
      }),
    ).toEqual({
      fileId: "file-tutti-capital",
      key: "Tutti",
      label: "Tutti",
    });
  });

  it("prefers everyone track if tutti is not present", () => {
    expect(
      resolvePreferredPracticeTrack({
        ...piece("p1", "", ""),
        trackFileIds: {
          alto: "file-alto",
          everyone: "file-everyone",
          soprano: "file-soprano",
        },
      }),
    ).toEqual({
      fileId: "file-everyone",
      key: "everyone",
      label: "Everyone",
    });
  });

  it("falls back to any playable uploaded track when neither tutti nor everyone exists", () => {
    expect(
      resolvePreferredPracticeTrack({
        ...piece("p1", "", ""),
        trackFileIds: {
          tenor: "file-tenor",
        },
      }),
    ).toEqual({
      fileId: "file-tenor",
      key: "tenor",
      label: "Tenor",
    });
  });
});
