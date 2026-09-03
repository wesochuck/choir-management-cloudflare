import type { OrganizationMusicPiece } from "@choir/contracts";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MusicCatalogTable } from "./table";
import { pieceTrackCount } from "./utils";

function mockPiece(
  id: string,
  title: string,
  trackFileIds: Record<string, string> = {},
): OrganizationMusicPiece {
  return {
    arranger: "",
    catalogId: `CAT-${id}`,
    composer: "Composer",
    copies: 10,
    createdAt: "2026-08-01T00:00:00Z",
    durationSeconds: 120,
    genres: ["Sacred"],
    id,
    lastPerformedAt: null,
    notes: "",
    parentId: null,
    performanceCount: 1,
    purchaseDate: null,
    sectionBuckets: [],
    title,
    trackFileIds,
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

describe("MusicCatalogTable Play Column Sorting", () => {
  it("renders a sortable header button for the Play column", () => {
    const pieces = [
      mockPiece("p1", "Piece Without Tracks", {}),
      mockPiece("p2", "Piece With Tracks", { tutti: "track-1" }),
    ];

    const html = renderToString(
      <MusicCatalogTable
        genreFilterMode="and"
        onDeselectMany={vi.fn()}
        onEdit={vi.fn()}
        onSelectMany={vi.fn()}
        onToggleSelection={vi.fn()}
        pieces={pieces}
        publisherSearchTemplate=""
        search=""
        selectedGenres={[]}
        selectedIds={[]}
        showUncategorized={false}
      />,
    );

    expect(html).toContain('aria-label="Sort by Play"');
    expect(html).toContain("Play");
  });

  it("evaluates track counts such that selections without practice tracks sort first in ascending order", () => {
    const unTrackedPiece1 = mockPiece("p1", "Alpha Untracked", {});
    const unTrackedPiece2 = mockPiece("p2", "Beta Untracked", { tutti: "   " });
    const singleTrackPiece = mockPiece("p3", "Gamma Tutti", { tutti: "uuid-tutti" });
    const multiTrackPiece = mockPiece("p4", "Delta Full", {
      alto: "uuid-a",
      bass: "uuid-b",
      soprano: "uuid-s",
      tenor: "uuid-t",
      tutti: "uuid-tut",
    });

    expect(pieceTrackCount(unTrackedPiece1)).toBe(0);
    expect(pieceTrackCount(unTrackedPiece2)).toBe(0);
    expect(pieceTrackCount(singleTrackPiece)).toBe(1);
    expect(pieceTrackCount(multiTrackPiece)).toBe(5);

    const pieces = [multiTrackPiece, unTrackedPiece1, singleTrackPiece, unTrackedPiece2];

    const ascendingSorted = [...pieces].sort(
      (left, right) => pieceTrackCount(left) - pieceTrackCount(right),
    );

    expect(ascendingSorted.map((piece) => piece.id)).toEqual(["p1", "p2", "p3", "p4"]);

    const descendingSorted = [...pieces].sort(
      (left, right) => pieceTrackCount(right) - pieceTrackCount(left),
    );

    expect(descendingSorted.map((piece) => piece.id)).toEqual(["p4", "p3", "p1", "p2"]);
  });
});
