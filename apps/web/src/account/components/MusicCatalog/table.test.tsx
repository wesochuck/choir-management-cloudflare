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
    scoreFileIds: {},
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

describe("MusicCatalogTable Credit Filtering", () => {
  const pieces: readonly OrganizationMusicPiece[] = [
    {
      ...mockPiece("p1", "The Lord Bless You"),
      arranger: "Mark Hayes",
      composer: "John Rutter",
    },
    {
      ...mockPiece("p2", "Look at the World"),
      arranger: "",
      composer: "John Rutter",
    },
    {
      ...mockPiece("p3", "Amazing Grace"),
      arranger: "John Rutter",
      composer: "Traditional",
    },
    {
      ...mockPiece("p4", "Gloria (Parent Work)"),
      arranger: "",
      composer: "Various",
    },
    {
      ...mockPiece("p5", "Domine Deus (Movement)"),
      arranger: "",
      composer: "John Rutter",
      parentId: "p4",
    },
  ];

  it("filters strictly by exact composer when creditRole is composer", () => {
    const html = renderToString(
      <MusicCatalogTable
        creditFilter={{ name: "John Rutter", role: "composer" }}
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

    // p1 (composer: John Rutter) and p2 (composer: John Rutter) should match
    expect(html).toContain("The Lord Bless You");
    expect(html).toContain("Look at the World");
    // p3 (arranger: John Rutter, composer: Traditional) should NOT match
    expect(html).not.toContain("Amazing Grace");
    // p5 (composer: John Rutter, movement of p4) matches and causes parent p4 to render for context
    expect(html).toContain("Domine Deus (Movement)");
    expect(html).toContain("Gloria (Parent Work)");
  });

  it("filters strictly by exact arranger when creditRole is arranger", () => {
    const html = renderToString(
      <MusicCatalogTable
        creditFilter={{ name: "John Rutter", role: "arranger" }}
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

    // p3 has arranger John Rutter
    expect(html).toContain("Amazing Grace");
    // p2 has composer John Rutter, not arranger
    expect(html).not.toContain("Look at the World");
  });

  it("filters by composer or arranger when creditRole is any", () => {
    const html = renderToString(
      <MusicCatalogTable
        creditFilter={{ name: "John Rutter", role: "any" }}
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

    expect(html).toContain("The Lord Bless You");
    expect(html).toContain("Look at the World");
    expect(html).toContain("Amazing Grace");
    expect(html).toContain("Domine Deus (Movement)");
  });
});
