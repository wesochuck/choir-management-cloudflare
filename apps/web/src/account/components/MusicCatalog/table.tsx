import type { OrganizationMusicPiece, OrganizationRosterConfiguration } from "@choir/contracts";
import { DataTable, paginateRows } from "@choir/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildMusicPublisherSearchUrl } from "../../musicPublisherSearch";

import { GenreChips } from "./shared";
import { composerText, durationText, genreKey, trackCount } from "./utils";

import { MusicTableTuttiPlayer } from "./performances";

export function MusicCatalogTable({
  genreFilterMode,
  onEdit,
  onSelectMany,
  onToggleSelection,
  pieces,
  publisherSearchTemplate,
  search,
  selectedIds,
  selectedGenres,
}: {
  readonly genreFilterMode: "and" | "or";
  readonly onEdit: (piece: OrganizationMusicPiece) => void;
  readonly onSelectMany: (pieceIds: readonly string[]) => void;
  readonly onToggleSelection: (pieceId: string) => void;
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly publisherSearchTemplate: string;
  readonly search: string;
  readonly selectedIds: readonly string[];
  readonly selectedGenres: readonly string[];
}) {
  const parents = new Map(pieces.map((piece) => [piece.id, piece]));
  const trackCounts = useMemo(
    () => new Map(pieces.map((piece) => [piece.id, trackCount(piece, pieces)])),
    [pieces],
  );
  const needle = search.trim().toLocaleLowerCase();
  const selected = selectedGenres.map(genreKey);
  const matchesPiece = (piece: OrganizationMusicPiece): boolean => {
    const matchesSearch = [
      piece.title,
      piece.composer,
      piece.arranger,
      piece.catalogId,
      ...piece.genres,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle);
    const pieceGenres = piece.genres.map(genreKey);
    const matchesGenres =
      selected.length === 0 ||
      (genreFilterMode === "and"
        ? selected.every((genre) => pieceGenres.includes(genre))
        : selected.some((genre) => pieceGenres.includes(genre)));
    return matchesSearch && matchesGenres;
  };
  const matchingIds = new Set(pieces.filter(matchesPiece).map((piece) => piece.id));
  const childrenByParent = new Map<string, OrganizationMusicPiece[]>();
  pieces.forEach((piece) => {
    if (!piece.parentId) return;
    const children = childrenByParent.get(piece.parentId) ?? [];
    children.push(piece);
    childrenByParent.set(piece.parentId, children);
  });
  const visiblePieces: OrganizationMusicPiece[] = [];
  const includedIds = new Set<string>();
  pieces
    .filter((piece) => !piece.parentId)
    .forEach((parent) => {
      const matchingChildren = (childrenByParent.get(parent.id) ?? []).filter((child) =>
        matchingIds.has(child.id),
      );
      if (!matchingIds.has(parent.id) && matchingChildren.length === 0) return;
      visiblePieces.push(parent);
      includedIds.add(parent.id);
      matchingChildren.forEach((child) => {
        visiblePieces.push(child);
        includedIds.add(child.id);
      });
    });
  pieces.forEach((piece) => {
    if (!includedIds.has(piece.id) && matchingIds.has(piece.id)) visiblePieces.push(piece);
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset page on filter change
    setPage(1);
  }, [genreFilterMode, search, selectedGenres]);

  const sortParent = (piece: OrganizationMusicPiece): OrganizationMusicPiece =>
    piece.parentId ? (parents.get(piece.parentId) ?? piece) : piece;
  const pagePieces = paginateRows(visiblePieces, page, pageSize).rows;
  const selectedIdSet = new Set(selectedIds);
  const selectedVisibleCount = pagePieces.reduce(
    (count, piece) => count + (selectedIdSet.has(piece.id) ? 1 : 0),
    0,
  );
  const allVisibleSelected = pagePieces.length > 0 && selectedVisibleCount === pagePieces.length;
  const someVisibleSelected = pagePieces.length > 0 && selectedVisibleCount > 0;
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  return (
    <div className="music-catalog-table">
      <DataTable
        columns={[
          {
            header: "Select",
            headerContent: (
              <input
                ref={selectAllRef}
                aria-label="Select all on current page"
                aria-checked={allVisibleSelected ? "true" : someVisibleSelected ? "mixed" : "false"}
                checked={allVisibleSelected}
                className="music-catalog-select-checkbox"
                disabled={visiblePieces.length === 0}
                type="checkbox"
                onChange={(event) => {
                  onSelectMany(event.target.checked ? pagePieces.map(({ id }) => id) : []);
                }}
              />
            ),
            id: "select",
            mobileLabel: "Select",
            render: (piece) => (
              <input
                aria-label={`Select ${piece.title}`}
                checked={selectedIdSet.has(piece.id)}
                className="music-catalog-select-checkbox"
                type="checkbox"
                onChange={() => {
                  onToggleSelection(piece.id);
                }}
              />
            ),
          },
          {
            header: "Title",
            id: "title",
            render: (piece) => (
              <div className="music-table-title">
                <strong>{piece.parentId ? `↳ ${piece.title}` : piece.title}</strong>
                {piece.parentId ? (
                  <small>Movement of {parents.get(piece.parentId)?.title ?? "Unknown work"}</small>
                ) : null}
                {piece.genres.length > 0 ? <GenreChips genres={piece.genres} /> : null}
              </div>
            ),
            sortValue: (piece) => sortParent(piece).title,
          },
          {
            header: "Composer / arranger",
            id: "composer",
            render: composerText,
            sortValue: (piece) => composerText(sortParent(piece)),
          },
          {
            header: "Catalog ID",
            id: "catalogId",
            render: (piece) => piece.catalogId || "—",
            sortValue: (piece) => sortParent(piece).catalogId,
          },
          {
            header: "Publisher",
            id: "publisher",
            render: (piece) => {
              const url = buildMusicPublisherSearchUrl(publisherSearchTemplate, piece.catalogId);
              return url ? (
                <a
                  aria-label={`Search ${piece.catalogId} on the publisher website`}
                  className="music-publisher-search-link"
                  href={url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Search
                </a>
              ) : (
                "—"
              );
            },
            sortValue: (piece) => sortParent(piece).catalogId,
          },
          {
            header: "Duration",
            id: "duration",
            render: (piece) => durationText(piece.durationSeconds) || "—",
            sortValue: (piece) => sortParent(piece).durationSeconds,
          },
          {
            header: "Performances",
            id: "performances",
            render: (piece) => piece.performanceCount || "—",
            sortValue: (piece) => sortParent(piece).performanceCount,
          },
          {
            header: "Last performed",
            id: "lastPerformed",
            render: (piece) =>
              piece.lastPerformedAt ? new Date(piece.lastPerformedAt).toLocaleDateString() : "—",
            sortValue: (piece) => sortParent(piece).lastPerformedAt,
          },
          {
            header: "Play",
            id: "play",
            render: (piece) => <MusicTableTuttiPlayer piece={piece} />,
          },
          {
            header: "Tracks",
            id: "tracks",
            render: (piece) => {
              const count = trackCounts.get(piece.id) ?? 0;
              return count > 0 ? `${String(count)} attached` : "—";
            },
            sortValue: (piece) => trackCounts.get(sortParent(piece).id) ?? 0,
          },
          {
            header: "Actions",
            id: "actions",
            mobileLabel: "Manage",
            render: (piece) => (
              <button
                aria-label={`Edit music piece: ${piece.title}`}
                className="text-button"
                onClick={() => {
                  onEdit(piece);
                }}
                type="button"
              >
                Edit
              </button>
            ),
          },
        ]}
        emptyMessage="No music pieces match this catalog search."
        initialSort={{ columnId: "title", direction: "asc" }}
        keySelector={(piece) => piece.id}
        onRowClick={onEdit}
        pagination={{
          onPageChange: setPage,
          onPageSizeChange: (nextSize) => {
            setPageSize(nextSize);
            setPage(1);
          },
          page,
          pageSize,
          pageSizeOptions: [25, 50, 100],
        }}
        rowLabel={(piece) => `Edit music piece ${piece.title}`}
        rows={visiblePieces}
      />
    </div>
  );
}

export function SectionBuckets({
  configuration,
  onChange,
  selected,
}: {
  readonly configuration: OrganizationRosterConfiguration;
  readonly onChange: (sections: string[]) => void;
  readonly selected: readonly string[];
}) {
  const available = configuration.sections.filter(({ trackOnly }) => !trackOnly);
  return (
    <fieldset className="music-section-buckets">
      <legend>Sections using this music</legend>
      {available.map((section) => (
        <label className="checkbox-row" key={section.code}>
          <input
            checked={selected.includes(section.code)}
            type="checkbox"
            onChange={(event) => {
              onChange(
                event.target.checked
                  ? [...selected, section.code]
                  : selected.filter((code) => code !== section.code),
              );
            }}
          />
          {section.name} ({section.code})
        </label>
      ))}
    </fieldset>
  );
}
