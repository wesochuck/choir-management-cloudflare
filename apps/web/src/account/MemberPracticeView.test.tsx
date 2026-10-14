import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SingerLearningTrackPiece } from "@choir/contracts";

import { MemberPracticeView } from "./MemberPracticeView";
import {
  filterLibraryPieces,
  isPiecePlayableForPart,
  singerPiecesToPlaylistItems,
} from "./memberPracticeLibrary";

function piece(overrides: Partial<SingerLearningTrackPiece> = {}): SingerLearningTrackPiece {
  return {
    arranger: "",
    composer: "Mozart",
    durationSeconds: 240,
    id: "11111111-1111-4111-8111-111111111111",
    parentId: null,
    scoreFileIds: {},
    title: "Alleluia",
    trackFileIds: { alto: "file-alto", tutti: "file-tutti" },
    ...overrides,
  };
}

describe("singerPiecesToPlaylistItems", () => {
  it("maps library pieces to player items", () => {
    expect(
      singerPiecesToPlaylistItems([
        piece(),
        piece({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Ave Verum",
          trackFileIds: { tenor: "file-tenor" },
        }),
      ]),
    ).toEqual([
      {
        arranger: "",
        composer: "Mozart",
        durationSeconds: 240,
        pieceId: "11111111-1111-4111-8111-111111111111",
        title: "Alleluia",
        trackFileIds: { alto: "file-alto", tutti: "file-tutti" },
      },
      {
        arranger: "",
        composer: "Mozart",
        durationSeconds: 240,
        pieceId: "22222222-2222-4222-8222-222222222222",
        title: "Ave Verum",
        trackFileIds: { tenor: "file-tenor" },
      },
    ]);
  });
});

describe("isPiecePlayableForPart", () => {
  it("marks pieces without track files as unplayable", () => {
    expect(isPiecePlayableForPart(piece({ trackFileIds: {} }), "Alto")).toBe(false);
    expect(isPiecePlayableForPart(piece({ trackFileIds: {} }), null)).toBe(false);
  });

  it("marks piece with matching voice part track as playable", () => {
    expect(isPiecePlayableForPart(piece({ trackFileIds: { alto: "f-alto" } }), "Alto")).toBe(true);
    expect(isPiecePlayableForPart(piece({ trackFileIds: { alto: "f-alto" } }), "A1")).toBe(true);
    expect(isPiecePlayableForPart(piece({ trackFileIds: { tenor: "f-tenor" } }), "Tenor")).toBe(
      true,
    );
  });

  it("falls back to full mix / tutti / all when assigned part track is missing", () => {
    expect(isPiecePlayableForPart(piece({ trackFileIds: { tutti: "f-tutti" } }), "Bass")).toBe(
      true,
    );
    expect(isPiecePlayableForPart(piece({ trackFileIds: { fullmix: "f-mix" } }), "Soprano")).toBe(
      true,
    );
  });

  it("marks piece as unplayable if it only has audio for a different section and no full mix", () => {
    expect(isPiecePlayableForPart(piece({ trackFileIds: { soprano: "f-sop" } }), "Bass")).toBe(
      false,
    );
    expect(isPiecePlayableForPart(piece({ trackFileIds: { tenor: "f-ten" } }), "Alto")).toBe(false);
  });

  it("marks piece with any audio as playable when user has no assigned voice part", () => {
    expect(isPiecePlayableForPart(piece({ trackFileIds: { soprano: "f-sop" } }), null)).toBe(true);
    expect(isPiecePlayableForPart(piece({ trackFileIds: { soprano: "f-sop" } }), "")).toBe(true);
  });
});

describe("filterLibraryPieces", () => {
  const pieces = [
    piece(),
    piece({
      composer: "Bach",
      id: "22222222-2222-4222-8222-222222222222",
      parentId: "33333333-3333-4333-8333-333333333333",
      title: "Jesu, Joy",
      trackFileIds: { soprano: "file-soprano" },
    }),
    piece({
      composer: "Handel",
      id: "33333333-3333-4333-8333-333333333333",
      title: "Messiah",
      trackFileIds: {},
    }),
  ];

  it("matches title, composer, and arranger case-insensitively", () => {
    expect(filterLibraryPieces(pieces, "alle", null, null)).toHaveLength(1);
    expect(filterLibraryPieces(pieces, "BACH", null, null)).toHaveLength(1);
    expect(filterLibraryPieces(pieces, "", null, null)).toHaveLength(3);
  });

  it("scopes to one piece including its children", () => {
    expect(
      filterLibraryPieces(pieces, "", null, "33333333-3333-4333-8333-333333333333"),
    ).toHaveLength(2);
    expect(
      filterLibraryPieces(pieces, "", new Set(["11111111-1111-4111-8111-111111111111"]), null),
    ).toHaveLength(1);
  });

  it("combines scoping with search", () => {
    expect(filterLibraryPieces(pieces, "jesu", null, null)).toHaveLength(1);
    expect(
      filterLibraryPieces(pieces, "jesu", new Set(["11111111-1111-4111-8111-111111111111"]), null),
    ).toHaveLength(0);
  });

  it("filters to playable tracks only when playableOnly is true", () => {
    // For Alto: Alleluia has alto/tutti (playable), Jesu has soprano only (unplayable), Messiah has none (unplayable)
    expect(filterLibraryPieces(pieces, "", null, null, true, "Alto")).toHaveLength(1);
    expect(filterLibraryPieces(pieces, "", null, null, true, "Alto")[0]?.title).toBe("Alleluia");

    // When playableOnly is false, all 3 pieces are returned
    expect(filterLibraryPieces(pieces, "", null, null, false, "Alto")).toHaveLength(3);
  });
});

describe("MemberPracticeView", () => {
  it("renders nothing when disabled", () => {
    expect(renderToString(<MemberPracticeView enabled={false} />)).toBe("");
  });

  it("shows a loading state before the library arrives", () => {
    const html = renderToString(<MemberPracticeView enabled />);
    expect(html).toContain("Loading learning tracks…");
  });
});
