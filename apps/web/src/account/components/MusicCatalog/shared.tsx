import { useEffect, useRef, useState } from "react";

import { genreChipColor, genreKey, uniqueGenreLabels } from "./utils";

export function GenreChip({
  count,
  genre,
  onClick,
  onRemove,
  selected = false,
}: {
  readonly count?: number;
  readonly genre: string;
  readonly onClick?: () => void;
  readonly onRemove?: () => void;
  readonly selected?: boolean;
}) {
  const className = `music-genre-chip music-genre-chip--${genreChipColor(genre)}${selected ? " is-selected" : ""}`;
  if (!onClick) {
    return (
      <span className={className}>
        {genre}
        {count !== undefined ? (
          <span aria-label={`${String(count)} pieces`} className="music-genre-chip__count">
            {count}
          </span>
        ) : null}
        {onRemove ? (
          <button
            aria-label={`Remove ${genre} genre`}
            className="music-genre-chip__remove"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }}
          >
            ×
          </button>
        ) : null}
      </span>
    );
  }
  return (
    <button
      aria-label={`${genre}${count !== undefined ? `, ${String(count)} pieces` : ""}`}
      aria-pressed={selected}
      className={className}
      type="button"
      onClick={onClick}
    >
      {genre}
      {count !== undefined ? <span className="music-genre-chip__count">{count}</span> : null}
    </button>
  );
}

export function GenreChips({ genres }: { readonly genres: readonly string[] }) {
  return (
    <span className="music-genre-chips">
      {genres.map((genre) => (
        <GenreChip genre={genre} key={genreKey(genre)} />
      ))}
    </span>
  );
}

export function MusicGenrePicker({
  availableGenres,
  onChange,
  selected,
}: {
  readonly availableGenres: readonly string[];
  readonly onChange: (genres: string[]) => void;
  readonly selected: readonly string[];
}) {
  const pickerRef = useRef<HTMLDetailsElement>(null);
  const [search, setSearch] = useState("");
  const [newGenre, setNewGenre] = useState("");
  const options = uniqueGenreLabels([...availableGenres, ...selected]);
  const visibleGenres = options.filter((genre) => genreKey(genre).includes(genreKey(search)));

  useEffect(() => {
    function closeWhenClickedAway(event: PointerEvent): void {
      const picker = pickerRef.current;
      if (!picker?.open || !(event.target instanceof Node) || picker.contains(event.target)) return;
      picker.open = false;
    }

    document.addEventListener("pointerdown", closeWhenClickedAway);
    return () => {
      document.removeEventListener("pointerdown", closeWhenClickedAway);
    };
  }, []);

  function toggleGenre(genre: string): void {
    const selectedKey = genreKey(genre);
    onChange(
      selected.some((item) => genreKey(item) === selectedKey)
        ? selected.filter((item) => genreKey(item) !== selectedKey)
        : [...selected, genre],
    );
  }

  function addNewGenre(): void {
    const trimmed = newGenre.trim();
    if (!trimmed) return;
    const existing = options.find((genre) => genreKey(genre) === genreKey(trimmed));
    const nextGenre = existing ?? trimmed;
    if (!selected.some((genre) => genreKey(genre) === genreKey(nextGenre))) {
      onChange([...selected, nextGenre]);
    }
    setNewGenre("");
    setSearch("");
  }

  return (
    <details className="music-genre-picker" ref={pickerRef}>
      <summary aria-label="Select genres">
        <span className="music-genre-picker__summary-value">
          {selected.length > 0 ? (
            selected.map((genre) => (
              <GenreChip
                genre={genre}
                key={genreKey(genre)}
                onRemove={() => {
                  toggleGenre(genre);
                }}
              />
            ))
          ) : (
            <span className="music-genre-picker__placeholder">Select genres…</span>
          )}
        </span>
        <span aria-hidden="true" className="music-genre-picker__caret">
          ⌃
        </span>
      </summary>
      <div
        className="music-genre-picker__panel"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="music-genre-picker__header">
          <span>{selected.length} selected</span>
          <button
            className="text-button"
            disabled={selected.length === 0}
            type="button"
            onClick={() => {
              onChange([]);
            }}
          >
            Clear All
          </button>
        </div>
        <input
          aria-label="Filter genres"
          placeholder="Filter…"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <div className="music-genre-picker__options">
          {visibleGenres.length > 0 ? (
            visibleGenres.map((genre) => (
              <GenreChip
                genre={genre}
                key={genreKey(genre)}
                selected={selected.some((item) => genreKey(item) === genreKey(genre))}
                onClick={() => {
                  toggleGenre(genre);
                }}
              />
            ))
          ) : (
            <span className="music-genre-picker__empty">No matching genres.</span>
          )}
        </div>
        <div className="music-genre-picker__add">
          <input
            aria-label="New genre"
            placeholder="Add new…"
            type="text"
            value={newGenre}
            onChange={(event) => {
              setNewGenre(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addNewGenre();
              }
            }}
          />
          <button className="button button--secondary" type="button" onClick={addNewGenre}>
            Add
          </button>
        </div>
        <div className="music-genre-picker__footer">
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              if (pickerRef.current) pickerRef.current.open = false;
            }}
          >
            Done
          </button>
        </div>
      </div>
    </details>
  );
}

export function MusicGenreFilter({
  counts,
  genres,
  mode,
  onModeChange,
  onSearchChange,
  onToggle,
  onToggleUncategorized,
  search,
  selected,
  showUncategorized,
  uncategorizedCount,
}: {
  readonly counts?: ReadonlyMap<string, number>;
  readonly genres: readonly string[];
  readonly mode: "and" | "or";
  readonly onModeChange: (mode: "and" | "or") => void;
  readonly onSearchChange: (value: string) => void;
  readonly onToggle: (genre: string) => void;
  readonly onToggleUncategorized?: () => void;
  readonly search: string;
  readonly selected: readonly string[];
  readonly showUncategorized?: boolean;
  readonly uncategorizedCount?: number;
}) {
  const filterRef = useRef<HTMLDetailsElement>(null);
  const visibleGenres = genres.filter((genre) => genreKey(genre).includes(genreKey(search)));

  useEffect(() => {
    function closeWhenClickedAway(event: PointerEvent): void {
      const filter = filterRef.current;
      if (!filter?.open || !(event.target instanceof Node) || filter.contains(event.target)) {
        return;
      }
      filter.open = false;
    }

    document.addEventListener("pointerdown", closeWhenClickedAway);
    return () => {
      document.removeEventListener("pointerdown", closeWhenClickedAway);
    };
  }, []);

  return (
    <details className="music-genre-filter" ref={filterRef}>
      <summary>
        Genres
        <span className="music-genre-filter__summary-count">
          {showUncategorized
            ? "Uncategorized"
            : selected.length > 0
              ? `${String(selected.length)} selected`
              : "All genres"}
        </span>
      </summary>
      <div
        className="music-genre-filter__panel"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="music-genre-filter__header">
          <strong>
            {showUncategorized
              ? "Uncategorized"
              : selected.length === 0
                ? "All genres"
                : `${String(selected.length)} selected`}
          </strong>
          <div aria-label="Genre match mode" className="music-genre-filter__mode" role="group">
            <button
              aria-pressed={mode === "or"}
              className={mode === "or" ? "is-active" : undefined}
              type="button"
              onClick={() => {
                onModeChange("or");
              }}
            >
              OR
            </button>
            <button
              aria-pressed={mode === "and"}
              className={mode === "and" ? "is-active" : undefined}
              type="button"
              onClick={() => {
                onModeChange("and");
              }}
            >
              AND
            </button>
          </div>
        </div>
        <input
          aria-label="Filter genres"
          placeholder="Filter genres…"
          type="search"
          value={search}
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
        />
        <div className="music-genre-filter__options">
          <GenreChip
            count={uncategorizedCount ?? 0}
            genre="No genre"
            selected={Boolean(showUncategorized)}
            onClick={() => {
              onToggleUncategorized?.();
            }}
          />
          {visibleGenres.length > 0 ? (
            visibleGenres.map((genre) => (
              <GenreChip
                count={counts?.get(genreKey(genre)) ?? 0}
                genre={genre}
                key={genreKey(genre)}
                selected={selected.some((item) => genreKey(item) === genreKey(genre))}
                onClick={() => {
                  onToggle(genre);
                }}
              />
            ))
          ) : (
            <span className="music-genre-filter__empty">No matching genres.</span>
          )}
        </div>
        <div className="music-genre-filter__footer">
          <span>
            {showUncategorized || selected.length > 0
              ? "Select one or more genres"
              : "Choose genres to filter"}
          </span>
          <button
            className="button button--secondary"
            disabled={selected.length === 0 && !showUncategorized}
            type="button"
            onClick={() => {
              if (showUncategorized) onToggleUncategorized?.();
              selected.forEach((genre) => {
                onToggle(genre);
              });
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </details>
  );
}
