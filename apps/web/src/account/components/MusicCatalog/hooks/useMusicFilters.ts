import { useState } from "react";
import { genreKey } from "../utils";

export function useMusicFilters() {
  const [search, setSearch] = useState("");
  const [genreFilterSearch, setGenreFilterSearch] = useState("");
  const [genreFilterMode, setGenreFilterMode] = useState<"and" | "or">("or");
  const [selectedGenres, setSelectedGenres] = useState<readonly string[]>([]);
  const [selectedPieceIds, setSelectedPieceIds] = useState<readonly string[]>([]);

  function toggleGenre(genre: string): void {
    setSelectedGenres((current) =>
      current.some((item) => genreKey(item) === genreKey(genre))
        ? current.filter((item) => genreKey(item) !== genreKey(genre))
        : [...current, genre],
    );
  }

  function togglePieceSelection(pieceId: string): void {
    setSelectedPieceIds((current) =>
      current.includes(pieceId) ? current.filter((id) => id !== pieceId) : [...current, pieceId],
    );
  }

  function selectManyPieces(pieceIds: readonly string[]): void {
    if (pieceIds.length === 0) {
      setSelectedPieceIds([]);
      return;
    }
    setSelectedPieceIds((current) => [...new Set([...current, ...pieceIds])]);
  }

  return {
    genreFilterMode,
    genreFilterSearch,
    search,
    selectManyPieces,
    selectedGenres,
    selectedPieceIds,
    setGenreFilterMode,
    setGenreFilterSearch,
    setSearch,
    setSelectedGenres,
    setSelectedPieceIds,
    toggleGenre,
    togglePieceSelection,
  };
}
