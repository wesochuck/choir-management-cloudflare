import { useCallback, useState } from "react";
import { genreKey, type MusicCreditFilter } from "../utils";

export function useMusicFilters({
  creditFilter: initialCreditFilter,
  onClearCreditFilter,
}: {
  readonly creditFilter?: MusicCreditFilter | null | undefined;
  readonly onClearCreditFilter?: (() => void) | undefined;
} = {}) {
  const [search, setSearch] = useState("");
  const [genreFilterSearch, setGenreFilterSearch] = useState("");
  const [genreFilterMode, setGenreFilterMode] = useState<"and" | "or">("or");
  const [selectedGenres, setSelectedGenres] = useState<readonly string[]>([]);
  const [selectedPieceIds, setSelectedPieceIds] = useState<readonly string[]>([]);
  const [showUncategorized, setShowUncategorized] = useState(false);
  const [creditFilterOverride, setCreditFilterOverride] = useState<
    MusicCreditFilter | null | undefined
  >(undefined);
  const [prevInitial, setPrevInitial] = useState(initialCreditFilter);

  if (
    initialCreditFilter?.name !== prevInitial?.name ||
    initialCreditFilter?.role !== prevInitial?.role
  ) {
    setPrevInitial(initialCreditFilter);
    setCreditFilterOverride(undefined);
  }

  const creditFilter =
    creditFilterOverride !== undefined ? creditFilterOverride : (initialCreditFilter ?? null);

  const clearCreditFilter = useCallback(() => {
    setCreditFilterOverride(null);
    onClearCreditFilter?.();
  }, [onClearCreditFilter]);

  const setCreditFilter = useCallback((next: MusicCreditFilter | null) => {
    setCreditFilterOverride(next);
  }, []);

  function toggleGenre(genre: string): void {
    setShowUncategorized(false);
    setSelectedGenres((current) =>
      current.some((item) => genreKey(item) === genreKey(genre))
        ? current.filter((item) => genreKey(item) !== genreKey(genre))
        : [...current, genre],
    );
  }

  function toggleUncategorized(): void {
    setShowUncategorized((current) => {
      const next = !current;
      if (next) setSelectedGenres([]);
      return next;
    });
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

  function deselectManyPieces(pieceIds: readonly string[]): void {
    const ids = new Set(pieceIds);
    setSelectedPieceIds((current) => current.filter((id) => !ids.has(id)));
  }

  return {
    clearCreditFilter,
    creditFilter,
    genreFilterMode,
    genreFilterSearch,
    search,
    deselectManyPieces,
    selectManyPieces,
    selectedGenres,
    selectedPieceIds,
    setCreditFilter,
    setGenreFilterMode,
    setGenreFilterSearch,
    setSearch,
    setSelectedGenres: (genres: readonly string[]) => {
      setSelectedGenres(genres);
      if (genres.length > 0) setShowUncategorized(false);
    },
    setSelectedPieceIds,
    setShowUncategorized,
    showUncategorized,
    toggleGenre,
    togglePieceSelection,
    toggleUncategorized,
  };
}
