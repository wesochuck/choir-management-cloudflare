import { AiMatchResult } from "./AiMatchResult";
import type { AiMatchOutcome } from "./aiMatchPresentation";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";

export interface DestinationPiecePickerHandle {
  openSearch: () => void;
}

export interface SuggestedPieceAlternative {
  readonly arranger?: string | null;
  readonly composer?: string | null;
  readonly pieceId: string;
  readonly probability?: number | null;
  readonly title: string;
}

export interface DestinationPieceOption {
  readonly arranger: string;
  readonly composer: string;
  readonly id: string;
  readonly occupiedParts: readonly string[];
  readonly searchText: string;
  readonly title: string;
  readonly trackCount: number;
}

export function DestinationPiecePicker({
  aiMatchOutcome,
  disabled,
  id,
  onSelect,
  options,
  performancePieceIds,
  ref,
  selectedPieceId,
  suggestedAlternatives,
}: {
  readonly aiMatchOutcome?: AiMatchOutcome | undefined;
  readonly disabled: boolean;
  readonly id: string;
  readonly onSelect: (pieceId: string | null) => void;
  readonly options: readonly DestinationPieceOption[];
  readonly performancePieceIds: ReadonlySet<string>;
  readonly ref?: Ref<DestinationPiecePickerHandle>;
  readonly selectedPieceId: string | null;
  readonly suggestedAlternatives?: readonly SuggestedPieceAlternative[] | undefined;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resultsId = `${id}-results`;

  const matchingOptions = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return options.filter((option) => terms.every((term) => option.searchText.includes(term)));
  }, [options, search]);
  const selected = options.find((option) => option.id === selectedPieceId);
  const performanceOptions = matchingOptions.filter((option) => performancePieceIds.has(option.id));
  const libraryOptions = matchingOptions.filter((option) => !performancePieceIds.has(option.id));

  useEffect(() => {
    if (isOpen) searchInputRef.current?.focus();
  }, [isOpen]);

  useImperativeHandle(
    ref,
    () => ({
      openSearch: () => {
        setIsOpen(true);
      },
    }),
    [],
  );

  function closeSearch(restoreFocus: boolean): void {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function renderOptions(items: readonly DestinationPieceOption[]) {
    return items.map((option) => {
      const isSelected = option.id === selectedPieceId;
      const occupiedHint =
        option.occupiedParts.length > 0
          ? `Occupied slots: ${option.occupiedParts.join(", ")}`
          : "No occupied slots";
      return (
        <li key={option.id}>
          <button
            aria-current={isSelected ? "true" : undefined}
            className="track-import-library-search__option"
            disabled={disabled}
            type="button"
            onClick={() => {
              onSelect(option.id);
              closeSearch(true);
            }}
          >
            <span className="track-import-library-search__option-copy">
              <span className="track-import-library-search__option-title">{option.title}</span>
              <span className="track-import-library-search__option-credit">
                {[option.composer, option.arranger ? `arr. ${option.arranger}` : ""]
                  .filter(Boolean)
                  .join(" · ") || "Composer and arranger not listed"}
              </span>
              <span className="track-import-library-search__option-hint">{occupiedHint}</span>
            </span>
            <span className="track-import-library-search__option-count">
              {isSelected ? "Selected · " : ""}
              {String(option.trackCount)} existing tracks
            </span>
          </button>
        </li>
      );
    });
  }

  return (
    <div
      className={`track-import-piece-picker${selected ? "" : " track-import-piece-picker--unmatched"}`}
    >
      <div className="track-import-piece-picker__summary" aria-live="polite">
        {selected ? (
          <>
            <h3>{selected.title}</h3>
            <p>
              {[selected.composer, selected.arranger ? `arr. ${selected.arranger}` : ""]
                .filter(Boolean)
                .join(" · ") || "Composer and arranger not listed"}
            </p>
            <span>
              {String(selected.trackCount)} existing practice track
              {selected.trackCount === 1 ? "" : "s"}
            </span>
            {selected.occupiedParts.length > 0 ? (
              <span>Occupied voice parts: {selected.occupiedParts.join(", ")}</span>
            ) : null}
          </>
        ) : (
          <>
            <h3>No Music Library piece selected</h3>
            <p>
              These recordings aren’t linked to a library piece yet. Search Music Library to choose
              where they belong.
            </p>
          </>
        )}
      </div>
      {aiMatchOutcome ? (
        <AiMatchResult
          outcome={aiMatchOutcome}
          alternatives={suggestedAlternatives ?? []}
          disabled={disabled}
          onSelect={onSelect}
        />
      ) : null}
      <button
        aria-controls={resultsId}
        aria-expanded={isOpen}
        className="track-import-library-search__trigger"
        disabled={disabled}
        ref={triggerRef}
        type="button"
        onClick={() => {
          setIsOpen((current) => !current);
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="10.8" cy="10.8" r="6.8" />
          <path d="m16 16 5 5" />
        </svg>
        <span>{selected ? "Change piece" : "Search Music Library"}</span>
      </button>
      <section
        aria-label="Music Library search"
        className="track-import-library-search"
        hidden={!isOpen}
        id={resultsId}
      >
        <label className="track-import-library-search__input-wrap">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="10.8" cy="10.8" r="6.8" />
            <path d="m16 16 5 5" />
          </svg>
          <span className="sr-only">Search titles, composers, or arrangers</span>
          <input
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch(true);
              }
            }}
            placeholder="Search titles, composers, arrangers"
            ref={searchInputRef}
            type="search"
            value={search}
          />
        </label>
        <div className="track-import-library-search__results">
          {matchingOptions.length === 0 ? (
            <p className="track-import-library-search__empty">
              No matching pieces. Try a different title, composer, or arranger.
            </p>
          ) : (
            <>
              {performanceOptions.length > 0 ? (
                <section aria-label="Performance Set List">
                  <h4>Performance Set List</h4>
                  <ul>{renderOptions(performanceOptions)}</ul>
                </section>
              ) : null}
              {libraryOptions.length > 0 ? (
                <section aria-label="Entire Music Library">
                  <h4>Entire Music Library</h4>
                  <ul>{renderOptions(libraryOptions)}</ul>
                </section>
              ) : null}
            </>
          )}
        </div>
        <div className="track-import-library-search__actions">
          <span role="status">{String(matchingOptions.length)} matching pieces</span>
          <button
            className="button button--secondary"
            disabled={disabled}
            type="button"
            onClick={() => {
              closeSearch(true);
            }}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
