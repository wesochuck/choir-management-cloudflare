import type { OrganizationMusicPiece, OrganizationMusicPieceRequest } from "@choir/contracts";
import { useMemo } from "react";
import { genreKey, uniqueGenreLabels } from "../utils";

export function useMusicDerived({
  editingId,
  piece,
  pieces,
  selectedPieceIds,
}: {
  readonly editingId: string | null;
  readonly piece: OrganizationMusicPieceRequest;
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly selectedPieceIds: readonly string[];
}) {
  const topLevelPieces = useMemo(
    () => pieces.filter(({ id, parentId }) => !parentId && id !== editingId),
    [editingId, pieces],
  );

  const childCount = editingId ? pieces.filter(({ parentId }) => parentId === editingId).length : 0;

  const selectedPiece = useMemo(
    () => pieces.find(({ id }) => id === editingId) ?? null,
    [editingId, pieces],
  );

  const availableGenres = useMemo(
    () =>
      uniqueGenreLabels(pieces.flatMap(({ genres }) => genres)).sort((a, b) => a.localeCompare(b)),
    [pieces],
  );

  const genreCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const musicPiece of pieces) {
      for (const genre of uniqueGenreLabels(musicPiece.genres)) {
        const key = genreKey(genre);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [pieces]);

  const uncategorizedCount = useMemo(
    () => pieces.filter(({ genres }) => genres.length === 0).length,
    [pieces],
  );

  const personNameOptions = useMemo(
    () =>
      [
        ...new Set(
          [
            ...pieces.flatMap(({ arranger, composer }) => [arranger.trim(), composer.trim()]),
            piece.composer.trim(),
            piece.arranger.trim(),
          ].filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [piece.arranger, piece.composer, pieces],
  );

  const selectedPieces = useMemo(
    () => pieces.filter(({ id }) => selectedPieceIds.includes(id)),
    [pieces, selectedPieceIds],
  );

  return {
    availableGenres,
    childCount,
    genreCounts,
    personNameOptions,
    selectedPiece,
    selectedPieces,
    topLevelPieces,
    uncategorizedCount,
  };
}
