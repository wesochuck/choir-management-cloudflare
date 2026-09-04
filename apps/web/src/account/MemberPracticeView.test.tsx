import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SingerLearningTrackPiece } from "@choir/contracts";

import { MemberPracticeView } from "./MemberPracticeView";
import { filterLibraryPieces, singerPiecesToPlaylistItems } from "./memberPracticeLibrary";

function piece(overrides: Partial<SingerLearningTrackPiece> = {}): SingerLearningTrackPiece {
  return {
    arranger: "",
    composer: "Mozart",
    durationSeconds: 240,
    id: "11111111-1111-4111-8111-111111111111",
    parentId: null,
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
  ];

  it("matches title, composer, and arranger case-insensitively", () => {
    expect(filterLibraryPieces(pieces, "alle", null, null)).toHaveLength(1);
    expect(filterLibraryPieces(pieces, "BACH", null, null)).toHaveLength(1);
    expect(filterLibraryPieces(pieces, "", null, null)).toHaveLength(2);
  });

  it("scopes to one piece including its children", () => {
    expect(
      filterLibraryPieces(pieces, "", null, "33333333-3333-4333-8333-333333333333"),
    ).toHaveLength(1);
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
