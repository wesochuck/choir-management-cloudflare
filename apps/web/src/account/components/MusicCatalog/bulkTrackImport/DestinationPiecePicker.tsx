import { useMemo, useState } from "react";

export interface DestinationPieceOption {
  readonly id: string;
  readonly label: string;
  readonly searchText: string;
  readonly trackCount: number;
}

export function DestinationPiecePicker({
  disabled,
  id,
  onSelect,
  options,
  performancePieceIds,
  selectedPieceId,
}: {
  readonly disabled: boolean;
  readonly id: string;
  readonly onSelect: (pieceId: string | null) => void;
  readonly options: readonly DestinationPieceOption[];
  readonly performancePieceIds: ReadonlySet<string>;
  readonly selectedPieceId: string | null;
}) {
  const [search, setSearch] = useState("");
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchingOptions = options.filter((option) =>
    terms.every((term) => option.searchText.includes(term)),
  );
  const matchingIds = new Set(matchingOptions.map((option) => option.id));
  const selected = useMemo(
    () => options.find((option) => option.id === selectedPieceId),
    [options, selectedPieceId],
  );
  const performanceOptions = matchingOptions.filter((option) => performancePieceIds.has(option.id));
  const libraryOptions = matchingOptions.filter((option) => !performancePieceIds.has(option.id));
  const renderOption = (option: DestinationPieceOption) => (
    <option key={option.id} value={option.id}>
      {option.label}
    </option>
  );

  return (
    <div className="track-import-group-piece-select field">
      <label htmlFor={`${id}-search`}>
        Search library
        <input
          disabled={disabled}
          id={`${id}-search`}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="Title, composer, or arranger"
          type="search"
          value={search}
        />
      </label>
      {terms.length > 0 ? (
        <p className="field-help" role="status">
          {matchingOptions.length === 0
            ? "No matching pieces. Try another title, composer, or arranger."
            : `${String(matchingOptions.length)} matching ${matchingOptions.length === 1 ? "piece" : "pieces"}`}
        </p>
      ) : null}
      <label htmlFor={id}>Destination music piece</label>
      <div className="track-import-piece-select-row">
        <select
          disabled={disabled}
          id={id}
          onChange={(event) => {
            onSelect(event.target.value || null);
          }}
          value={selectedPieceId ?? ""}
        >
          <option value="">-- Choose a music library piece --</option>
          {selected && !matchingIds.has(selected.id) ? (
            <optgroup label="Current selection">{renderOption(selected)}</optgroup>
          ) : null}
          {performanceOptions.length > 0 ? (
            <optgroup label="Performance Set List">{performanceOptions.map(renderOption)}</optgroup>
          ) : null}
          <optgroup label="Entire Music Library">{libraryOptions.map(renderOption)}</optgroup>
        </select>
        {selected ? (
          <span className="badge badge--neutral">
            {String(selected.trackCount)} existing tracks
          </span>
        ) : null}
      </div>
    </div>
  );
}
