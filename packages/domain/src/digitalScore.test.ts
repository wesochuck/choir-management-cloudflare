import { describe, expect, it } from "vitest";

import {
  memberCanAccessPiece,
  memberCanAccessScoreFile,
  type ScoreAccessEvent,
  type ScoreAccessPiece,
} from "./digitalScore";

const parentPiece: ScoreAccessPiece = {
  id: "piece-parent",
  parentId: null,
  scoreFileIds: { primary: "file-parent-score" },
};

const movementWithoutOwnScore: ScoreAccessPiece = {
  id: "piece-movement-1",
  parentId: "piece-parent",
  scoreFileIds: {},
};

const movementWithOwnScore: ScoreAccessPiece = {
  id: "piece-movement-2",
  parentId: "piece-parent",
  scoreFileIds: { primary: "file-movement-score" },
};

const standalonePiece: ScoreAccessPiece = {
  id: "piece-standalone",
  parentId: null,
  scoreFileIds: { primary: "file-standalone-score" },
};

const allPieces = [parentPiece, movementWithoutOwnScore, movementWithOwnScore, standalonePiece];

describe("digitalScore member access policy (SEC-03)", () => {
  it("denies score access when set lists are unapproved or events are canceled", () => {
    const events: readonly ScoreAccessEvent[] = [
      {
        id: "evt-draft",
        isCanceled: false,
        parentPerformanceId: null,
        setList: [{ pieceId: "piece-standalone" }],
        setListApproved: false,
        type: "Performance",
      },
      {
        id: "evt-canceled",
        isCanceled: true,
        parentPerformanceId: null,
        setList: [{ pieceId: "piece-standalone" }],
        setListApproved: true,
        type: "Performance",
      },
    ];

    expect(memberCanAccessPiece(standalonePiece, events)).toBe(false);
    expect(memberCanAccessScoreFile("file-standalone-score", allPieces, events)).toBe(false);
  });

  it("allows parent score fallback when an approved movement has no own score", () => {
    const events: readonly ScoreAccessEvent[] = [
      {
        id: "evt-approved",
        isCanceled: false,
        parentPerformanceId: null,
        setList: [{ pieceId: "piece-movement-1" }],
        setListApproved: true,
        type: "Performance",
      },
    ];

    expect(memberCanAccessScoreFile("file-parent-score", allPieces, events)).toBe(true);
    expect(memberCanAccessScoreFile("file-movement-score", allPieces, events)).toBe(false);
  });

  it("does not expose parent score when an approved movement has its own score", () => {
    const events: readonly ScoreAccessEvent[] = [
      {
        id: "evt-approved",
        isCanceled: false,
        parentPerformanceId: null,
        setList: [{ pieceId: "piece-movement-2" }],
        setListApproved: true,
        type: "Performance",
      },
    ];

    expect(memberCanAccessScoreFile("file-movement-score", allPieces, events)).toBe(true);
    expect(memberCanAccessScoreFile("file-parent-score", allPieces, events)).toBe(false);
  });

  it("inherits approved parent performance set lists for linked rehearsals", () => {
    const events: readonly ScoreAccessEvent[] = [
      {
        id: "evt-perf",
        isCanceled: false,
        parentPerformanceId: null,
        setList: [{ pieceId: "piece-standalone" }],
        setListApproved: true,
        type: "Performance",
      },
      {
        id: "evt-reh",
        isCanceled: false,
        parentPerformanceId: "evt-perf",
        setList: [],
        setListApproved: false,
        type: "Rehearsal",
      },
    ];

    expect(memberCanAccessPiece(standalonePiece, events)).toBe(true);
    expect(memberCanAccessScoreFile("file-standalone-score", allPieces, events)).toBe(true);
  });
});
