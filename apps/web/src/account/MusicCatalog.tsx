import type {
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationMusicBulkUpdateRequest,
  OrganizationMusicLibrarySettings,
  OrganizationMusicPiece,
  OrganizationMusicPieceRequest,
  OrganizationRosterConfiguration,
  OrganizationVenue,
} from "@choir/contracts";
import {
  inspectMusicCsv,
  mapMusicCsvColumns,
  musicCsvColumnForHeader,
  musicCsvColumnOptions,
  zonedLocalDateTimeToUtc,
  type CsvColumnMapping,
  type MusicCsvInspection,
} from "@choir/domain";
import { DataTable, Dialog } from "@choir/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import {
  AuthApiError,
  bulkUpdateOrganizationMusicPieces,
  createOrganizationMusicPiece,
  deleteOrganizationMusicPiece,
  deletePrivateOrganizationFile,
  createOrganizationEvent,
  getOrganizationCalendarSettings,
  getOrganizationMusicLibrarySettings,
  getOrganizationRosterConfiguration,
  importOrganizationMusicCsv,
  listOrganizationMusic,
  listOrganizationEvents,
  listOrganizationVenues,
  uploadPrivateOrganizationFile,
  updateOrganizationMusicPiece,
  updateOrganizationMusicLibrarySettings,
  updateOrganizationEvent,
} from "../auth/api";
import { CsvImportDialog } from "./CsvImportDialog";
import { extractAudioDuration, extractAudioDurationFromUrl } from "./audioDuration";
import {
  computeDurationAutoFillDecision,
  computeExpectedTrackDuration,
  formatDetectedDuration,
  initialDurationAutoFillState,
  type DurationAutoFillState,
} from "./durationAutoFill";
import { learningTrackFileName, trackDescription } from "./learningTrackFilename";
import { buildMusicPublisherSearchUrl } from "./musicPublisherSearch";

const maximumAudioBytes = 20 * 1024 * 1024;

type MusicEditorTab = "details" | "performances" | "tracks";

const emptyPiece: OrganizationMusicPieceRequest = {
  arranger: "",
  catalogId: "",
  composer: "",
  copies: null,
  durationSeconds: null,
  genres: [],
  notes: "",
  parentId: null,
  purchaseDate: null,
  sectionBuckets: [],
  title: "",
  trackFileIds: {},
};

function requestFrom(piece: OrganizationMusicPiece): OrganizationMusicPieceRequest {
  return {
    arranger: piece.arranger,
    catalogId: piece.catalogId,
    composer: piece.composer,
    copies: piece.copies,
    durationSeconds: piece.durationSeconds,
    genres: piece.genres,
    notes: piece.notes,
    parentId: piece.parentId,
    purchaseDate: piece.purchaseDate,
    sectionBuckets: piece.sectionBuckets,
    title: piece.title,
    trackFileIds: piece.trackFileIds,
  };
}

function durationText(seconds: number | null): string {
  if (seconds === null) return "";
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

function audioTimeText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const wholeSeconds = Math.floor(seconds);
  return `${String(Math.floor(wholeSeconds / 60))}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function parseDuration(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{1,4}):([0-5]\d)$/.exec(trimmed);
  if (!match) return undefined;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const total = minutes * 60 + seconds;
  return total <= 86_400 ? total : undefined;
}

function uniqueLabels(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ];
}

const genreChipColors = [
  "teal",
  "blue",
  "violet",
  "rose",
  "orange",
  "green",
  "indigo",
  "gold",
] as const;
type GenreChipColor = (typeof genreChipColors)[number];

function genreKey(label: string): string {
  return label.trim().toLocaleLowerCase();
}

function uniqueGenreLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  return labels.reduce<string[]>((result, label) => {
    const trimmed = label.trim();
    const key = genreKey(trimmed);
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
    return result;
  }, []);
}

function genreChipColor(label: string): GenreChipColor {
  const value = genreKey(label);
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = hash * 31 + value.charCodeAt(index);
  }
  return genreChipColors[Math.abs(hash) % genreChipColors.length] ?? "teal";
}

function GenreChip({
  genre,
  onClick,
  onRemove,
  selected = false,
}: {
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
    <button aria-pressed={selected} className={className} type="button" onClick={onClick}>
      {genre}
    </button>
  );
}

function GenreChips({ genres }: { readonly genres: readonly string[] }) {
  return (
    <span className="music-genre-chips">
      {genres.map((genre) => (
        <GenreChip genre={genre} key={genreKey(genre)} />
      ))}
    </span>
  );
}

function MusicGenrePicker({
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

function MusicGenreFilter({
  genres,
  mode,
  onModeChange,
  onSearchChange,
  onToggle,
  search,
  selected,
}: {
  readonly genres: readonly string[];
  readonly mode: "and" | "or";
  readonly onModeChange: (mode: "and" | "or") => void;
  readonly onSearchChange: (value: string) => void;
  readonly onToggle: (genre: string) => void;
  readonly search: string;
  readonly selected: readonly string[];
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
          {selected.length > 0 ? `${String(selected.length)} selected` : "All genres"}
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
            {selected.length === 0 ? "All genres" : `${String(selected.length)} selected`}
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
          {visibleGenres.length > 0 ? (
            visibleGenres.map((genre) => (
              <GenreChip
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
            {selected.length > 0 ? "Select one or more genres" : "Choose genres to filter"}
          </span>
          <button
            className="button button--secondary"
            disabled={selected.length === 0}
            type="button"
            onClick={() => {
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

function composerText(piece: OrganizationMusicPiece): string {
  if (piece.composer && piece.arranger) return `${piece.composer} / arr. ${piece.arranger}`;
  return piece.composer || piece.arranger || "—";
}

function trackCount(
  piece: OrganizationMusicPiece,
  pieces: readonly OrganizationMusicPiece[],
): number {
  const directTracks = Object.values(piece.trackFileIds).filter(Boolean).length;
  const movementTracks = pieces
    .filter(({ parentId }) => parentId === piece.id)
    .reduce(
      (total, movement) => total + Object.values(movement.trackFileIds).filter(Boolean).length,
      0,
    );
  return directTracks + movementTracks;
}

function MusicCatalogTable({
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
  const sortParent = (piece: OrganizationMusicPiece): OrganizationMusicPiece =>
    piece.parentId ? (parents.get(piece.parentId) ?? piece) : piece;
  const selectedIdSet = new Set(selectedIds);
  const selectedVisibleCount = visiblePieces.reduce(
    (count, piece) => count + (selectedIdSet.has(piece.id) ? 1 : 0),
    0,
  );
  const allVisibleSelected =
    visiblePieces.length > 0 && selectedVisibleCount === visiblePieces.length;
  const someVisibleSelected = selectedVisibleCount > 0;
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
                aria-label="Select all shown music pieces"
                aria-checked={allVisibleSelected ? "true" : someVisibleSelected ? "mixed" : "false"}
                checked={allVisibleSelected}
                className="music-catalog-select-checkbox"
                disabled={visiblePieces.length === 0}
                type="checkbox"
                onChange={(event) => {
                  onSelectMany(event.target.checked ? visiblePieces.map(({ id }) => id) : []);
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
        rowLabel={(piece) => `Edit music piece ${piece.title}`}
        rows={visiblePieces}
      />
    </div>
  );
}

function SectionBuckets({
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

function trackKeys(
  piece: OrganizationMusicPiece,
  configuration: OrganizationRosterConfiguration,
  addedVoicePartLabels: readonly string[] = [],
): string[] {
  const keys = new Set([
    "tutti",
    ...configuration.sections.map(({ code }) => code),
    ...Object.keys(piece.trackFileIds),
    ...addedVoicePartLabels,
  ]);
  const sectionOrder = new Map(configuration.sections.map(({ code }, index) => [code, index]));
  const voicePartOrder = new Map(
    configuration.voiceParts.map(({ label }, index) => [label, index]),
  );
  const voicePartByLabel = new Map(
    configuration.voiceParts.map((voicePart) => [voicePart.label, voicePart]),
  );
  const voicePartStride = configuration.voiceParts.length + 2;

  return [...keys].toSorted((left, right) => {
    if (left === "tutti") return -1;
    if (right === "tutti") return 1;
    const leftSectionIndex = sectionOrder.get(left);
    const rightSectionIndex = sectionOrder.get(right);
    if (leftSectionIndex !== undefined && rightSectionIndex !== undefined) {
      return leftSectionIndex - rightSectionIndex;
    }
    if (leftSectionIndex !== undefined) return -1;
    if (rightSectionIndex !== undefined) return 1;
    const leftVoicePart = voicePartByLabel.get(left);
    const rightVoicePart = voicePartByLabel.get(right);
    if (leftVoicePart && rightVoicePart) {
      const sectionDifference =
        (sectionOrder.get(leftVoicePart.sectionCode) ?? Number.MAX_SAFE_INTEGER) -
        (sectionOrder.get(rightVoicePart.sectionCode) ?? Number.MAX_SAFE_INTEGER);
      return (
        sectionDifference * voicePartStride +
        (voicePartOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (voicePartOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
      );
    }
    if (leftVoicePart) return -1;
    if (rightVoicePart) return 1;
    return left.localeCompare(right);
  });
}

function validateAudioFile(file: File): string | null {
  if (!file.type.startsWith("audio/")) {
    return "Learning tracks must be valid audio files.";
  }
  if (file.size <= 0 || file.size > maximumAudioBytes) {
    return "Learning tracks must be larger than 0 bytes and no more than 20 MB.";
  }
  return null;
}

function eventRequestFrom(event: OrganizationEvent): OrganizationEventRequest {
  return {
    advancePriceCents: event.advancePriceCents,
    callTime: event.callTime,
    dayOfPriceCents: event.dayOfPriceCents,
    details: event.details,
    doorsOpenTime: event.doorsOpenTime,
    durationMinutes: event.durationMinutes,
    isTicketingEnabled: event.isTicketingEnabled,
    location: event.location,
    parentPerformanceId: event.parentPerformanceId,
    publicDetails: event.publicDetails,
    publicGraphicFileId: event.publicGraphicFileId,
    publishOnWebsite: event.publishOnWebsite,
    rsvpFollowUpLeadHours: event.rsvpFollowUpLeadHours,
    rsvpFollowUpMode: event.rsvpFollowUpMode,
    setList: event.setList,
    setListApproved: event.setListApproved,
    startsAt: event.startsAt,
    ticketCapacity: event.ticketCapacity,
    title: event.title,
    type: event.type,
    venueId: event.venueId,
  };
}

function performanceDateLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function pieceIdsForPerformance(
  piece: OrganizationMusicPiece,
  allPieces: readonly OrganizationMusicPiece[],
): ReadonlySet<string> {
  const ids = new Set<string>([piece.id]);
  if (piece.parentId) {
    ids.add(piece.parentId);
  } else {
    allPieces.forEach((candidate) => {
      if (candidate.parentId === piece.id) ids.add(candidate.id);
    });
  }
  return ids;
}

function performanceContainsPiece(
  event: OrganizationEvent,
  pieceIds: ReadonlySet<string>,
): boolean {
  return event.setList.some((item) => item.pieceId !== undefined && pieceIds.has(item.pieceId));
}

function performanceSetListItem(
  piece: OrganizationMusicPiece,
): NonNullable<OrganizationEvent["setList"]>[number] {
  return {
    composer: piece.composer || undefined,
    id: crypto.randomUUID(),
    pieceId: piece.id,
    title: piece.title,
    type: "song",
  };
}

function MusicPiecePerformances({
  allEvents,
  allPieces,
  onEventChanged,
  piece,
  timezone,
  venues,
}: {
  readonly allEvents: readonly OrganizationEvent[];
  readonly allPieces: readonly OrganizationMusicPiece[];
  readonly onEventChanged: (event: OrganizationEvent) => Promise<void>;
  readonly piece: OrganizationMusicPiece;
  readonly timezone: string;
  readonly venues: readonly OrganizationVenue[];
}) {
  const [quickTitle, setQuickTitle] = useState("");
  const [quickDate, setQuickDate] = useState("");
  const [quickVenueId, setQuickVenueId] = useState("");
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pieceIds = useMemo(() => pieceIdsForPerformance(piece, allPieces), [allPieces, piece]);
  const performances = useMemo(
    () => allEvents.filter((event) => event.type === "Performance"),
    [allEvents],
  );
  const linkedPerformances = useMemo(
    () => performances.filter((event) => performanceContainsPiece(event, pieceIds)),
    [performances, pieceIds],
  );
  const availablePerformances = useMemo(
    () => performances.filter((event) => !performanceContainsPiece(event, pieceIds)),
    [performances, pieceIds],
  );

  async function togglePerformance(event: OrganizationEvent): Promise<void> {
    setBusyId(event.id);
    setError(null);
    try {
      const linked = performanceContainsPiece(event, pieceIds);
      const setList = linked
        ? event.setList.filter((item) => item.pieceId === undefined || !pieceIds.has(item.pieceId))
        : [...event.setList, performanceSetListItem(piece)];
      const saved = await updateOrganizationEvent(event.id, {
        ...eventRequestFrom(event),
        setList,
      });
      await onEventChanged(saved);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The performance link could not be updated.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function quickAddPerformance(): Promise<void> {
    const title = quickTitle.trim();
    const startsAt = zonedLocalDateTimeToUtc(quickDate, timezone);
    if (!title || !startsAt) {
      setError("Enter a performance title and a valid date and time.");
      return;
    }
    setBusyId("quick-add");
    setError(null);
    try {
      const saved = await createOrganizationEvent({
        advancePriceCents: 0,
        callTime: "",
        dayOfPriceCents: 0,
        details: "Quick added from music library historic performance links.",
        doorsOpenTime: "",
        durationMinutes: null,
        isTicketingEnabled: false,
        location: "",
        parentPerformanceId: null,
        publicDetails: "",
        publicGraphicFileId: null,
        publishOnWebsite: false,
        rsvpFollowUpLeadHours: null,
        rsvpFollowUpMode: "inherit",
        setList: [performanceSetListItem(piece)],
        setListApproved: false,
        startsAt,
        ticketCapacity: null,
        title,
        type: "Performance",
        venueId: quickVenueId || null,
      });
      await onEventChanged(saved);
      setQuickTitle("");
      setQuickDate("");
      setQuickVenueId("");
      setShowQuickAdd(false);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The historic performance could not be created.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="music-piece-performances">
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="field">
        <span className="field-label">Linked performances</span>
        <div className="music-piece-performance-links">
          {linkedPerformances.length === 0 ? (
            <span className="field-help">No performances linked.</span>
          ) : (
            linkedPerformances.map((event) => (
              <span className="music-piece-performance-link" key={event.id}>
                {event.title} ({performanceDateLabel(event.startsAt, timezone)})
                <button
                  aria-label={`Unlink ${event.title}`}
                  disabled={busyId !== null}
                  type="button"
                  onClick={() => void togglePerformance(event)}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
      </div>
      <div className="music-piece-performance-actions">
        <label className="field">
          Add a performance
          <select
            disabled={busyId !== null}
            value=""
            onChange={(event) => {
              const selected = availablePerformances.find(({ id }) => id === event.target.value);
              if (selected) void togglePerformance(selected);
            }}
          >
            <option value="">Choose a performance…</option>
            {availablePerformances.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} ({performanceDateLabel(event.startsAt, timezone)})
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button--secondary"
          disabled={busyId !== null}
          type="button"
          onClick={() => {
            setError(null);
            setShowQuickAdd((current) => !current);
          }}
        >
          {showQuickAdd ? "Cancel quick add" : "Quick add performance"}
        </button>
      </div>
      {showQuickAdd ? (
        <div className="music-piece-quick-performance">
          <h3>Quick add historic performance</h3>
          <p className="field-help">Times are entered in {timezone}.</p>
          <label className="field">
            Performance title
            <input
              autoFocus
              placeholder="e.g. Spring Concert 2018"
              value={quickTitle}
              onChange={(event) => {
                setQuickTitle(event.target.value);
              }}
            />
          </label>
          <div className="music-fields-grid">
            <label className="field">
              Date and time
              <input
                type="datetime-local"
                value={quickDate}
                onChange={(event) => {
                  setQuickDate(event.target.value);
                }}
              />
            </label>
            <label className="field">
              Venue (optional)
              <select
                value={quickVenueId}
                onChange={(event) => {
                  setQuickVenueId(event.target.value);
                }}
              >
                <option value="">No venue</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="dialog__actions">
            <button
              className="button button--primary"
              disabled={busyId !== null}
              type="button"
              onClick={() => void quickAddPerformance()}
            >
              {busyId === "quick-add" ? "Creating…" : "Create and link"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MusicInlineAudioPlayer({ label, src }: { readonly label: string; readonly src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.load();
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
  }, [src]);

  function togglePlayback(): void {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  }

  return (
    <div
      className="music-audio-track__player"
      onChange={(event) => {
        event.stopPropagation();
      }}
      onInput={(event) => {
        event.stopPropagation();
      }}
    >
      <audio
        aria-label={`${label} learning track`}
        className="music-audio-track__audio"
        preload="metadata"
        ref={audioRef}
        src={src}
        onEnded={() => {
          setIsPlaying(false);
        }}
        onLoadedMetadata={(event) => {
          setDuration(
            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0,
          );
        }}
        onPause={() => {
          setIsPlaying(false);
        }}
        onPlay={() => {
          setIsPlaying(true);
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
        }}
      >
        <track kind="captions" />
      </audio>
      <button
        aria-label={isPlaying ? `Pause ${label}` : `Play ${label}`}
        className="button button--secondary button--small music-audio-track__play"
        title={isPlaying ? "Pause" : "Play"}
        type="button"
        onClick={togglePlayback}
      >
        <span aria-hidden="true">{isPlaying ? "❚❚" : "▶"}</span>
      </button>
      <span aria-hidden="true" className="music-audio-track__time">
        {audioTimeText(currentTime)}
      </span>
      <input
        aria-label={`Scrub ${label}`}
        className="music-audio-track__scrubber"
        disabled={duration <= 0}
        max={duration || 1}
        min={0}
        step={0.1}
        type="range"
        value={Math.min(currentTime, duration || 0)}
        onChange={(event) => {
          const nextTime = Number(event.target.value);
          setCurrentTime(nextTime);
          if (audioRef.current) audioRef.current.currentTime = nextTime;
        }}
      />
      <span aria-hidden="true" className="music-audio-track__time">
        {audioTimeText(duration)}
      </span>
    </div>
  );
}

function MusicTableTuttiPlayer({ piece }: { readonly piece: OrganizationMusicPiece }) {
  const fileId = piece.trackFileIds.tutti;
  const [expanded, setExpanded] = useState(false);

  if (!fileId) return <span>—</span>;
  if (!expanded) {
    return (
      <button
        className="button button--secondary button--small"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setExpanded(true);
        }}
      >
        <span aria-hidden="true">▶</span> Play
      </button>
    );
  }

  return (
    <div
      className="music-table-track-player"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <MusicInlineAudioPlayer label="Tutti" src={`/api/organization/files/${fileId}`} />
      <button
        aria-label={`Close player for ${piece.title}`}
        className="text-button"
        title="Close player"
        type="button"
        onClick={() => {
          setExpanded(false);
        }}
      >
        ×
      </button>
    </div>
  );
}

function MusicTuttiTrackDropzone({
  disabled,
  file,
  onChange,
}: {
  readonly disabled: boolean;
  readonly file: File | null;
  readonly onChange: (file: File | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFile(nextFile: File | null): void {
    if (!nextFile || disabled) return;
    const validationError = validateAudioFile(nextFile);
    if (validationError) {
      setError(validationError);
      onChange(null);
      return;
    }
    setError(null);
    onChange(nextFile);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files.item(0));
  }

  return (
    <fieldset className="music-tutti-track-field">
      <legend>Tutti Practice Track (Optional)</legend>
      <p className="field-help">Add the full-mix practice track now, or attach it later.</p>
      <label
        className={`music-tutti-dropzone${dragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          if (disabled) return;
          setDragging(false);
        }}
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDrop={handleDrop}
      >
        <span className="music-tutti-dropzone__label">
          {file ? (
            <>
              Selected: <strong>{file.name}</strong>
            </>
          ) : (
            <>
              Drag and drop a Tutti MP3 track here, or{" "}
              <span className="music-tutti-dropzone__browse">browse</span>
            </>
          )}
        </span>
        <input
          accept="audio/*"
          className="sr-only"
          disabled={disabled}
          type="file"
          onChange={(event) => {
            handleFile(event.target.files?.item(0) ?? null);
            event.target.value = "";
          }}
        />
      </label>
      {file ? (
        <div className="music-tutti-dropzone__selected">
          <span className="field-help">This track will be attached when you save the piece.</span>
          <button
            className="text-button"
            disabled={disabled}
            type="button"
            onClick={() => {
              setError(null);
              onChange(null);
            }}
          >
            Remove
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function MusicAudioTracks({
  configuration,
  onSaved,
  onTrackDurationDetected,
  piece,
}: {
  readonly configuration: OrganizationRosterConfiguration;
  readonly onSaved: (piece: OrganizationMusicPiece, message: string) => void;
  readonly onTrackDurationDetected: (trackKey: string, durationSeconds: number | null) => void;
  readonly piece: OrganizationMusicPiece;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [addedVoicePartLabels, setAddedVoicePartLabels] = useState<readonly string[]>([]);

  async function saveMapping(key: string, fileId: string | null): Promise<void> {
    const previousFileId = piece.trackFileIds[key];
    const mapping = fileId
      ? { ...piece.trackFileIds, [key]: fileId }
      : Object.fromEntries(Object.entries(piece.trackFileIds).filter(([label]) => label !== key));
    const saved = await updateOrganizationMusicPiece(piece.id, {
      ...requestFrom(piece),
      trackFileIds: mapping,
    });
    let message = fileId ? `${key} learning track attached.` : `${key} learning track removed.`;
    if (previousFileId && previousFileId !== fileId) {
      try {
        await deletePrivateOrganizationFile(previousFileId);
      } catch (caught: unknown) {
        if (!(caught instanceof AuthApiError && caught.status === 409)) {
          message += " The old file could not be reclaimed automatically.";
        }
      }
    }
    onSaved(saved, message);
  }

  async function upload(key: string, file: File): Promise<void> {
    const validationError = validateAudioFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setActiveKey(key);
    setError(null);
    try {
      const uploaded = await uploadPrivateOrganizationFile(
        file,
        learningTrackFileName(piece.title, key, configuration),
      );
      try {
        const durationSeconds = await extractAudioDuration(file);
        await saveMapping(key, uploaded.id);
        onTrackDurationDetected(key, durationSeconds);
      } catch (caught: unknown) {
        await deletePrivateOrganizationFile(uploaded.id).catch(() => undefined);
        throw caught;
      }
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The learning track could not be uploaded and attached.",
      );
    } finally {
      setActiveKey(null);
    }
  }

  function handleDrop(key: string, event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setDraggedKey(null);
    const file = event.dataTransfer.files.item(0);
    if (file) void upload(key, file);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setDraggedKey(null);
  }

  function handleFileSelection(key: string, event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.item(0);
    if (file) void upload(key, file);
    event.target.value = "";
  }

  async function remove(key: string): Promise<void> {
    setActiveKey(key);
    setError(null);
    try {
      await saveMapping(key, null);
      onTrackDurationDetected(key, null);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The learning track could not be removed.",
      );
    } finally {
      setActiveKey(null);
    }
  }

  const visibleKeys = trackKeys(piece, configuration, addedVoicePartLabels);
  const addableVoiceParts = configuration.voiceParts.filter(
    ({ label }) => !visibleKeys.includes(label),
  );

  return (
    <fieldset className="music-audio-tracks">
      <legend>Learning tracks</legend>
      <p className="field-help">
        Attach a full mix, section, or voice-part track. Organization members can play or download
        these files after signing in.
      </p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="music-audio-track-list">
        {visibleKeys.map((key) => {
          const fileId = piece.trackFileIds[key];
          const busy = activeKey === key;
          return (
            <div
              className={`music-audio-track${draggedKey === key ? " is-dragging" : ""}`}
              key={key}
              onDragEnter={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDraggedKey(key);
              }}
              onDragLeave={handleDragLeave}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "copy";
                setDraggedKey(key);
              }}
              onDrop={(event) => {
                handleDrop(key, event);
              }}
            >
              <span>
                <strong>{key === "tutti" ? "Tutti" : key}</strong>
                <small>{trackDescription(key, configuration)}</small>
              </span>
              {fileId ? (
                <div className="music-audio-track__controls">
                  <MusicInlineAudioPlayer
                    label={key === "tutti" ? "Tutti" : key}
                    src={`/api/organization/files/${fileId}`}
                  />
                  <a download href={`/api/organization/files/${fileId}`}>
                    Download
                  </a>
                  <button
                    className="button button--danger"
                    disabled={busy}
                    type="button"
                    onClick={() => void remove(key)}
                  >
                    {busy ? "Removing…" : "Remove"}
                  </button>
                </div>
              ) : (
                <label className="button button--secondary">
                  {busy ? "Uploading…" : "Upload audio"}
                  <input
                    accept="audio/*"
                    disabled={busy}
                    type="file"
                    onChange={(event) => {
                      handleFileSelection(key, event);
                    }}
                  />
                </label>
              )}
              {!fileId && !busy ? (
                <small className="music-audio-track__drop-hint">
                  Drop an audio file anywhere on this row
                </small>
              ) : null}
            </div>
          );
        })}
      </div>
      {addableVoiceParts.length > 0 ? (
        <div className="music-audio-track-add">
          <label htmlFor="music-add-voice-part">
            Add voice-part track slot
            <select
              id="music-add-voice-part"
              value=""
              onChange={(event) => {
                const label = event.target.value;
                if (!label) return;
                setAddedVoicePartLabels((current) => [...current, label]);
              }}
            >
              <option value="">Select voice part…</option>
              {addableVoiceParts.map(({ fullName, label }) => (
                <option key={label} value={label}>
                  {label} ({fullName})
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}

function MusicDeleteControls({
  busy,
  childCount,
  deleteConfirm,
  editingId,
  onAddMovement,
  onCancel,
  onConfirm,
  onRequest,
  onUnlinkChildren,
  unlinkChildren,
}: {
  readonly busy: boolean;
  readonly childCount: number;
  readonly deleteConfirm: boolean;
  readonly editingId: string | null;
  readonly onAddMovement: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly onRequest: () => void;
  readonly onUnlinkChildren: (enabled: boolean) => void;
  readonly unlinkChildren: boolean;
}) {
  return (
    <>
      <div className="form-actions music-piece-form__actions">
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Saving music…" : "Save music piece"}
        </button>
        {editingId ? (
          <button className="button button--secondary" type="button" onClick={onAddMovement}>
            Add movement
          </button>
        ) : null}
        {editingId && !deleteConfirm ? (
          <button className="button button--danger" type="button" onClick={onRequest}>
            Delete music piece
          </button>
        ) : null}
      </div>
      {deleteConfirm ? (
        <div className="danger-confirmation" role="group" aria-label="Confirm music deletion">
          <p>This cannot be undone. Referenced set-list pieces cannot be deleted.</p>
          {childCount > 0 ? (
            <label className="checkbox-row">
              <input
                checked={unlinkChildren}
                type="checkbox"
                onChange={(event) => {
                  onUnlinkChildren(event.target.checked);
                }}
              />
              Keep {String(childCount)} movement(s) as top-level works
            </label>
          ) : null}
          <div className="form-actions">
            <button
              className="button button--danger"
              disabled={busy || (childCount > 0 && !unlinkChildren)}
              type="button"
              onClick={onConfirm}
            >
              Confirm delete
            </button>
            <button
              className="button button--secondary"
              disabled={busy}
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MusicBulkEditDialog({
  busy,
  configuration,
  error,
  onApply,
  onClose,
  open,
  personNameOptions,
  selectedCount,
}: {
  readonly busy: boolean;
  readonly configuration: OrganizationRosterConfiguration;
  readonly error: string | null;
  readonly onApply: (changes: OrganizationMusicBulkUpdateRequest["changes"]) => void;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly personNameOptions: readonly string[];
  readonly selectedCount: number;
}) {
  const [changeComposer, setChangeComposer] = useState(false);
  const [changeArranger, setChangeArranger] = useState(false);
  const [changeGenres, setChangeGenres] = useState(false);
  const [changeSections, setChangeSections] = useState(false);
  const [composer, setComposer] = useState("");
  const [arranger, setArranger] = useState("");
  const [genres, setGenres] = useState("");
  const [sections, setSections] = useState<readonly string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const availableSections = configuration.sections.filter(({ trackOnly }) => !trackOnly);

  function submit(): void {
    const changes: OrganizationMusicBulkUpdateRequest["changes"] = {};
    if (changeComposer) changes.composer = composer.trim();
    if (changeArranger) changes.arranger = arranger.trim();
    if (changeGenres) changes.genres = uniqueLabels(genres);
    if (changeSections) changes.sectionBuckets = [...sections];
    if (Object.keys(changes).length === 0) {
      setFormError("Choose at least one field to change.");
      return;
    }
    setFormError(null);
    onApply(changes);
  }

  return (
    <Dialog
      description={`Apply shared metadata to ${String(selectedCount)} selected music pieces.`}
      onClose={onClose}
      open={open}
      title="Bulk edit music pieces"
    >
      <form
        className="form-stack music-bulk-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <datalist id="music-bulk-composer-arranger-options">
          {personNameOptions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <p className="field-help">
          Only the fields you select will change. Leave a selected text field blank to clear it.
        </p>
        {error || formError ? (
          <p className="notice notice--error" role="alert">
            {error ?? formError}
          </p>
        ) : null}
        <fieldset className="music-bulk-edit-fields">
          <legend>Fields to change</legend>
          <div className="music-bulk-edit-field">
            <label className="checkbox-row">
              <input
                checked={changeComposer}
                type="checkbox"
                onChange={(event) => {
                  setChangeComposer(event.target.checked);
                }}
              />
              Composer
            </label>
            <input
              aria-label="Bulk composer"
              disabled={!changeComposer}
              list="music-bulk-composer-arranger-options"
              placeholder="Leave blank to clear"
              value={composer}
              onChange={(event) => {
                setComposer(event.target.value);
              }}
            />
          </div>
          <div className="music-bulk-edit-field">
            <label className="checkbox-row">
              <input
                checked={changeArranger}
                type="checkbox"
                onChange={(event) => {
                  setChangeArranger(event.target.checked);
                }}
              />
              Arranger
            </label>
            <input
              aria-label="Bulk arranger"
              disabled={!changeArranger}
              list="music-bulk-composer-arranger-options"
              placeholder="Leave blank to clear"
              value={arranger}
              onChange={(event) => {
                setArranger(event.target.value);
              }}
            />
          </div>
          <div className="music-bulk-edit-field">
            <label className="checkbox-row">
              <input
                checked={changeGenres}
                type="checkbox"
                onChange={(event) => {
                  setChangeGenres(event.target.checked);
                }}
              />
              Genres
            </label>
            <input
              aria-label="Bulk genres"
              disabled={!changeGenres}
              placeholder="Comma separated; blank clears genres"
              value={genres}
              onChange={(event) => {
                setGenres(event.target.value);
              }}
            />
          </div>
          <div className="music-bulk-edit-field">
            <label className="checkbox-row">
              <input
                checked={changeSections}
                type="checkbox"
                onChange={(event) => {
                  setChangeSections(event.target.checked);
                }}
              />
              Sections using this music
            </label>
            <div className="music-bulk-edit-section-options">
              {availableSections.map((section) => (
                <label className="checkbox-row" key={section.code}>
                  <input
                    checked={sections.includes(section.code)}
                    disabled={!changeSections}
                    type="checkbox"
                    onChange={(event) => {
                      setSections((current) =>
                        event.target.checked
                          ? [...current, section.code]
                          : current.filter((code) => code !== section.code),
                      );
                    }}
                  />
                  {section.name} ({section.code})
                </label>
              ))}
            </div>
          </div>
        </fieldset>
        <div className="dialog__actions">
          <button
            className="button button--secondary"
            disabled={busy}
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Updating…" : `Update ${String(selectedCount)} pieces`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// eslint-disable-next-line complexity -- this coordinator owns catalog, editor, track, and import workflows.
export function MusicCatalog({ enabled }: { readonly enabled: boolean }) {
  const [pieces, setPieces] = useState<readonly OrganizationMusicPiece[]>([]);
  const [roster, setRoster] = useState<OrganizationRosterConfiguration | null>(null);
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [venues, setVenues] = useState<readonly OrganizationVenue[]>([]);
  const [timezone, setTimezone] = useState("UTC");
  const [publisherSearchTemplate, setPublisherSearchTemplate] = useState("");
  const [savedPublisherSearchTemplate, setSavedPublisherSearchTemplate] = useState("");
  const [publisherSettingsBusy, setPublisherSettingsBusy] = useState(false);
  const [publisherSettingsError, setPublisherSettingsError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [piece, setPiece] = useState<OrganizationMusicPieceRequest>(emptyPiece);
  const [pendingTuttiFile, setPendingTuttiFile] = useState<File | null>(null);
  const [durationInput, setDurationInput] = useState("");
  const [durationAutoFillLabel, setDurationAutoFillLabel] = useState<string | null>(null);
  const [durationDetectionNotice, setDurationDetectionNotice] = useState<string | null>(null);
  const [trackDurationCache, setTrackDurationCache] = useState<Record<string, number | null>>({});
  const [genresInput, setGenresInput] = useState("");
  const [copiesInput, setCopiesInput] = useState("");
  const [search, setSearch] = useState("");
  const [genreFilterSearch, setGenreFilterSearch] = useState("");
  const [genreFilterMode, setGenreFilterMode] = useState<"and" | "or">("or");
  const [selectedGenres, setSelectedGenres] = useState<readonly string[]>([]);
  const [selectedPieceIds, setSelectedPieceIds] = useState<readonly string[]>([]);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [unlinkChildren, setUnlinkChildren] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [musicImportCsv, setMusicImportCsv] = useState("");
  const [musicImportHeaders, setMusicImportHeaders] = useState<readonly string[]>([]);
  const [musicImportMappings, setMusicImportMappings] = useState<readonly CsvColumnMapping[]>([]);
  const [musicImportInspection, setMusicImportInspection] = useState<MusicCsvInspection | null>(
    null,
  );
  const [musicImportConfirmed, setMusicImportConfirmed] = useState(false);
  const [musicImportInspecting, setMusicImportInspecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<MusicEditorTab>("details");
  const durationAutoFillStateRef = useRef<DurationAutoFillState>(initialDurationAutoFillState);
  const durationInputRef = useRef("");
  const durationDetectionRequestRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationMusic(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
      listOrganizationEvents(controller.signal),
      listOrganizationVenues(controller.signal),
      getOrganizationCalendarSettings(controller.signal),
      getOrganizationMusicLibrarySettings(controller.signal),
    ])
      .then(([catalog, configuration, nextEvents, nextVenues, calendarSettings, musicSettings]) => {
        setPieces(catalog);
        setRoster(configuration);
        setEvents(nextEvents);
        setVenues(nextVenues);
        setTimezone(calendarSettings.timezone);
        setPublisherSearchTemplate(musicSettings.publisherSearchTemplate);
        setSavedPublisherSearchTemplate(musicSettings.publisherSearchTemplate);
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError("The music catalog could not be loaded.");
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  const topLevelPieces = useMemo(
    () => pieces.filter(({ id, parentId }) => !parentId && id !== editingId),
    [editingId, pieces],
  );
  const childCount = editingId ? pieces.filter(({ parentId }) => parentId === editingId).length : 0;
  const selectedPiece = pieces.find(({ id }) => id === editingId) ?? null;
  const availableGenres = useMemo(
    () =>
      uniqueGenreLabels(pieces.flatMap(({ genres }) => genres)).sort((a, b) => a.localeCompare(b)),
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

  function resetDurationDetection(): void {
    durationAutoFillStateRef.current = initialDurationAutoFillState;
    durationInputRef.current = "";
    durationDetectionRequestRef.current += 1;
    setDurationAutoFillLabel(null);
    setDurationDetectionNotice(null);
    setTrackDurationCache({});
  }

  function setDurationValue(value: string, manuallyEdited: boolean): void {
    durationInputRef.current = value;
    setDurationInput(value);
    if (manuallyEdited) {
      durationAutoFillStateRef.current = {
        ...durationAutoFillStateRef.current,
        manuallyEdited: true,
      };
      setDurationAutoFillLabel(null);
      setDurationDetectionNotice(null);
    }
  }

  const handleTrackDurationDetected = useCallback(
    (trackKey: string, durationSeconds: number | null): void => {
      setTrackDurationCache((current) => ({ ...current, [trackKey]: durationSeconds }));
      if (durationSeconds === null) return;
      setDurationDetectionNotice(null);
      const decision = computeDurationAutoFillDecision(
        durationAutoFillStateRef.current,
        durationInputRef.current,
        trackKey,
        durationSeconds,
      );
      if (!decision) return;
      durationAutoFillStateRef.current = decision.newState;
      durationInputRef.current = decision.newDuration;
      setDurationInput(decision.newDuration);
      setDurationAutoFillLabel(trackKey === "tutti" ? "Tutti" : trackKey);
    },
    [],
  );

  const handlePendingTuttiFileChange = useCallback(
    (file: File | null): void => {
      setPendingTuttiFile(file);
      const requestId = ++durationDetectionRequestRef.current;
      setDurationDetectionNotice(file ? "Reading track duration…" : null);
      if (!file) return;
      void extractAudioDuration(file).then((durationSeconds) => {
        if (requestId !== durationDetectionRequestRef.current) return;
        if (durationSeconds === null) {
          setDurationDetectionNotice(
            "The track duration could not be read automatically. Enter it manually.",
          );
          return;
        }
        handleTrackDurationDetected("tutti", durationSeconds);
      });
    },
    [handleTrackDurationDetected],
  );

  useEffect(() => {
    if (!dialogOpen || !editingId) return;
    const entries = Object.entries(piece.trackFileIds).filter(
      (entry): entry is [string, string] => entry[1].length > 0,
    );
    const requestId = ++durationDetectionRequestRef.current;
    if (entries.length === 0) return;
    let cancelled = false;
    void Promise.all(
      entries.map(async ([trackKey, fileId]) => {
        const durationSeconds = await extractAudioDurationFromUrl(
          `/api/organization/files/${encodeURIComponent(fileId)}`,
        );
        return [trackKey, durationSeconds] as const;
      }),
    ).then((durations) => {
      if (cancelled || requestId !== durationDetectionRequestRef.current) return;
      for (const [trackKey, durationSeconds] of durations) {
        handleTrackDurationDetected(trackKey, durationSeconds);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dialogOpen, editingId, handleTrackDurationDetected, piece.trackFileIds]);

  const expectedTrackDuration = useMemo(
    () => computeExpectedTrackDuration(trackDurationCache),
    [trackDurationCache],
  );
  const durationMismatch = useMemo(() => {
    if (expectedTrackDuration === null) return null;
    const currentSeconds = parseDuration(durationInput);
    if (currentSeconds === expectedTrackDuration) return null;
    return {
      current: durationInput.trim(),
      suggested: formatDetectedDuration(expectedTrackDuration),
    };
  }, [durationInput, expectedTrackDuration]);

  function setEditorPiece(
    selected: OrganizationMusicPiece,
    nextTab: MusicEditorTab = "details",
  ): void {
    setEditingId(selected.id);
    setPiece(requestFrom(selected));
    setPendingTuttiFile(null);
    setEditorTab(nextTab);
    resetDurationDetection();
    setDurationValue(durationText(selected.durationSeconds), false);
    setGenresInput(selected.genres.join(", "));
    setCopiesInput(selected.copies === null ? "" : String(selected.copies));
    setDeleteConfirm(false);
    setUnlinkChildren(false);
    setMessage(null);
    setError(null);
  }

  function closeDialog(): void {
    if (busy) return;
    setDialogOpen(false);
    setEditingId(null);
    setPiece(emptyPiece);
    setPendingTuttiFile(null);
    resetDurationDetection();
    setGenresInput("");
    setCopiesInput("");
    setDeleteConfirm(false);
    setUnlinkChildren(false);
    setError(null);
    setEditorTab("details");
  }

  function closeImportDialog(): void {
    if (busy) return;
    setImportDialogOpen(false);
    setImportFile(null);
    setMusicImportCsv("");
    setMusicImportHeaders([]);
    setMusicImportMappings([]);
    setMusicImportInspection(null);
    setMusicImportConfirmed(false);
    setMusicImportInspecting(false);
  }

  function closeBulkDialog(): void {
    if (busy) return;
    setBulkDialogOpen(false);
    setBulkError(null);
  }

  function handleMusicImportFile(file: File | null): void {
    setImportFile(file);
    setMusicImportCsv("");
    setMusicImportHeaders([]);
    setMusicImportMappings([]);
    setMusicImportInspection(null);
    setMusicImportConfirmed(false);
    setError(null);
    setMusicImportInspecting(Boolean(file));
    if (!file) return;
    void file
      .text()
      .then((csv) => {
        const initialInspection = inspectMusicCsv(csv);
        const mappings = initialInspection.headers.map((header, sourceIndex) => ({
          sourceIndex,
          targetHeader: musicCsvColumnForHeader(header),
        }));
        setMusicImportCsv(csv);
        setMusicImportHeaders(initialInspection.headers);
        setMusicImportMappings(mappings);
        const inspection = inspectMusicCsv(mapMusicCsvColumns(csv, mappings));
        setMusicImportInspection(inspection);
        if (inspection.fatalError) setError(inspection.fatalError);
      })
      .catch(() => {
        setError("The CSV could not be read.");
      })
      .finally(() => {
        setMusicImportInspecting(false);
      });
  }

  function handleMusicColumnMap(sourceIndex: number, targetHeader: string | null): void {
    const nextMappings = musicImportMappings.map((mapping) =>
      mapping.sourceIndex === sourceIndex ? { ...mapping, targetHeader } : mapping,
    );
    setMusicImportMappings(nextMappings);
    setMusicImportConfirmed(false);
    setMusicImportInspection(inspectMusicCsv(mapMusicCsvColumns(musicImportCsv, nextMappings)));
  }

  function selectPiece(selected: OrganizationMusicPiece): void {
    setEditorPiece(selected);
    setDialogOpen(true);
  }

  async function handlePerformanceChanged(event: OrganizationEvent): Promise<void> {
    setEvents((current) => {
      const exists = current.some((candidate) => candidate.id === event.id);
      return exists
        ? current.map((candidate) => (candidate.id === event.id ? event : candidate))
        : [...current, event].toSorted((left, right) =>
            left.startsAt.localeCompare(right.startsAt),
          );
    });
    try {
      setPieces(await listOrganizationMusic());
    } catch {
      // The event link is already saved; a later catalog refresh can recalculate its summary.
    }
  }

  function beginNew(parentId: string | null = null): void {
    setEditingId(null);
    setPiece({ ...emptyPiece, parentId });
    setPendingTuttiFile(null);
    resetDurationDetection();
    setGenresInput("");
    setCopiesInput("");
    setEditorTab("details");
    setDeleteConfirm(false);
    setMessage(null);
    setError(null);
    setDialogOpen(true);
  }

  async function save(): Promise<void> {
    const durationSeconds = parseDuration(durationInput);
    const copies = copiesInput.trim() ? Number(copiesInput) : null;
    if (durationSeconds === undefined) {
      setError("Duration must use minutes:seconds, such as 4:05.");
      return;
    }
    if (copies !== null && (!Number.isInteger(copies) || copies < 0 || copies > 1_000_000)) {
      setError("Copies must be a whole number from 0 through 1,000,000.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    let uploadedTuttiFileId: string | null = null;
    try {
      const request: OrganizationMusicPieceRequest = {
        ...piece,
        copies,
        durationSeconds,
        genres: uniqueLabels(genresInput),
      };
      if (!editingId && pendingTuttiFile) {
        const uploaded = await uploadPrivateOrganizationFile(pendingTuttiFile);
        uploadedTuttiFileId = uploaded.id;
        request.trackFileIds = { ...request.trackFileIds, tutti: uploaded.id };
      }
      const saved = editingId
        ? await updateOrganizationMusicPiece(editingId, request)
        : await createOrganizationMusicPiece(request);
      setPieces((current) =>
        editingId
          ? current.map((candidate) => (candidate.id === saved.id ? saved : candidate))
          : [...current, saved].sort((a, b) => a.title.localeCompare(b.title)),
      );
      setEditorPiece(saved);
      setMessage("Music piece saved.");
      setDialogOpen(false);
      setEditingId(null);
      setPiece(emptyPiece);
      setPendingTuttiFile(null);
      resetDurationDetection();
    } catch (caught: unknown) {
      let nextError =
        caught instanceof AuthApiError ? caught.message : "The music piece could not be saved.";
      if (uploadedTuttiFileId) {
        try {
          await deletePrivateOrganizationFile(uploadedTuttiFileId);
        } catch {
          nextError += " The temporary Tutti track could not be reclaimed automatically.";
        }
      }
      setError(nextError);
    } finally {
      setBusy(false);
    }
  }

  async function applyBulkChanges(
    changes: OrganizationMusicBulkUpdateRequest["changes"],
  ): Promise<void> {
    if (selectedPieces.length === 0) return;
    setBusy(true);
    setBulkError(null);
    setError(null);
    setMessage(null);
    try {
      const updated = await bulkUpdateOrganizationMusicPieces({
        changes,
        pieceIds: selectedPieces.map(({ id }) => id),
      });
      const updatedById = new Map(updated.map((candidate) => [candidate.id, candidate]));
      setPieces((current) =>
        current.map((candidate) => updatedById.get(candidate.id) ?? candidate),
      );
      setSelectedPieceIds([]);
      setBulkDialogOpen(false);
      setMessage(`${String(updated.length)} music piece(s) updated.`);
    } catch (caught: unknown) {
      setBulkError(
        caught instanceof AuthApiError ? caught.message : "The music pieces could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganizationMusicPiece(editingId, unlinkChildren);
      setPieces((current) =>
        current
          .filter(({ id }) => id !== editingId)
          .map((candidate) =>
            candidate.parentId === editingId ? { ...candidate, parentId: null } : candidate,
          ),
      );
      setDialogOpen(false);
      setEditingId(null);
      setPiece(emptyPiece);
      resetDurationDetection();
      setGenresInput("");
      setCopiesInput("");
      setDeleteConfirm(false);
      setUnlinkChildren(false);
      setMessage("Music piece deleted.");
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The music piece could not be deleted. It may still be referenced.",
      );
      setDeleteConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(): Promise<void> {
    if (!importFile) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const csv = await importFile.text();
      const imported = await importOrganizationMusicCsv(
        mapMusicCsvColumns(csv, musicImportMappings),
      );
      setPieces(await listOrganizationMusic());
      setImportFile(null);
      setImportDialogOpen(false);
      setMusicImportCsv("");
      setMusicImportHeaders([]);
      setMusicImportMappings([]);
      setMusicImportInspection(null);
      setMusicImportConfirmed(false);
      setMusicImportInspecting(false);
      setMessage(`${String(imported)} music piece(s) imported.`);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError ? caught.message : "The music CSV could not be imported.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function savePublisherSearchSettings(): Promise<void> {
    setPublisherSettingsBusy(true);
    setPublisherSettingsError(null);
    try {
      const settings: OrganizationMusicLibrarySettings = {
        publisherSearchTemplate: publisherSearchTemplate.trim(),
      };
      const saved = await updateOrganizationMusicLibrarySettings(settings);
      setPublisherSearchTemplate(saved.publisherSearchTemplate);
      setSavedPublisherSearchTemplate(saved.publisherSearchTemplate);
    } catch (caught: unknown) {
      setPublisherSettingsError(
        caught instanceof AuthApiError
          ? caught.message
          : "The publisher search setting could not be saved.",
      );
    } finally {
      setPublisherSettingsBusy(false);
    }
  }

  if (!enabled) return null;

  return (
    <section className="account-section music-catalog-section" aria-label="Music catalog">
      <div className="section-heading section-heading--compact">
        <p className="section-description">
          Manage owned works and movements. Audio tracks are stored securely as Organization files
          and will appear here when linked through the track workflow.
        </p>
      </div>
      <section
        className="music-publisher-settings"
        aria-labelledby="music-publisher-settings-title"
      >
        <div>
          <p className="eyebrow">Music Library setting</p>
          <h2 id="music-publisher-settings-title">Publisher catalog search</h2>
          <p>
            Add the publisher’s HTTPS search URL and use <code>{"{catalogId}"}</code> where the
            catalog number belongs. Matching rows will include a direct Search link.
          </p>
        </div>
        <div className="music-publisher-settings__form">
          <label className="field">
            Publisher search URL template
            <input
              aria-describedby="music-publisher-settings-help"
              placeholder="https://publisher.example/search?catalog={catalogId}"
              type="text"
              value={publisherSearchTemplate}
              onChange={(event) => {
                setPublisherSearchTemplate(event.target.value);
                setPublisherSettingsError(null);
              }}
            />
            <small className="field-help" id="music-publisher-settings-help">
              Leave blank to hide publisher links. HTTPS and the exact <code>{"{catalogId}"}</code>{" "}
              placeholder are required.
            </small>
          </label>
          <button
            className="button button--secondary"
            disabled={
              publisherSettingsBusy ||
              publisherSearchTemplate.trim() === savedPublisherSearchTemplate
            }
            type="button"
            onClick={() => {
              void savePublisherSearchSettings();
            }}
          >
            {publisherSettingsBusy ? "Saving…" : "Save publisher search"}
          </button>
        </div>
        {publisherSettingsError ? (
          <p className="notice notice--error" role="alert">
            {publisherSettingsError}
          </p>
        ) : null}
      </section>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="notice notice--success" role="status">
          {message}
        </p>
      ) : null}
      {!roster ? (
        <p>Loading music catalog…</p>
      ) : (
        <div className="music-catalog-layout">
          <div>
            <div className="music-catalog-toolbar">
              <label className="field">
                Search catalog
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                />
              </label>
              <MusicGenreFilter
                genres={availableGenres}
                mode={genreFilterMode}
                search={genreFilterSearch}
                selected={selectedGenres}
                onModeChange={setGenreFilterMode}
                onSearchChange={setGenreFilterSearch}
                onToggle={toggleGenre}
              />
              <button
                className="button button--secondary"
                disabled={selectedPieces.length === 0}
                type="button"
                onClick={() => {
                  setBulkError(null);
                  setBulkDialogOpen(true);
                }}
              >
                Bulk edit{selectedPieces.length > 0 ? ` (${String(selectedPieces.length)})` : ""}
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  beginNew();
                }}
              >
                Add music piece
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  setError(null);
                  setMessage(null);
                  setImportDialogOpen(true);
                }}
              >
                Import CSV
              </button>
              <a
                className="button button--secondary"
                download
                href="/api/organization/music/export"
              >
                Export CSV
              </a>
            </div>
            <MusicCatalogTable
              genreFilterMode={genreFilterMode}
              onEdit={selectPiece}
              onSelectMany={selectManyPieces}
              onToggleSelection={togglePieceSelection}
              pieces={pieces}
              publisherSearchTemplate={publisherSearchTemplate}
              search={search}
              selectedIds={selectedPieceIds}
              selectedGenres={selectedGenres}
            />
          </div>
          <Dialog
            description="Catalog metadata, sections, movements, learning tracks, and linked performances."
            onClose={closeDialog}
            open={dialogOpen}
            title={
              editingId ? "Edit music piece" : piece.parentId ? "Add movement" : "Add music piece"
            }
          >
            <form
              className="form-stack music-piece-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <datalist id="music-composer-arranger-options">
                {personNameOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <div className="music-piece-tabs" role="tablist" aria-label="Music piece editor">
                <button
                  aria-controls="music-piece-details"
                  aria-selected={editorTab === "details"}
                  className={editorTab === "details" ? "is-active" : undefined}
                  onClick={() => {
                    setEditorTab("details");
                  }}
                  role="tab"
                  type="button"
                >
                  Piece details
                </button>
                <button
                  aria-controls="music-piece-tracks"
                  aria-selected={editorTab === "tracks"}
                  className={editorTab === "tracks" ? "is-active" : undefined}
                  disabled={!selectedPiece}
                  onClick={() => {
                    setEditorTab("tracks");
                  }}
                  role="tab"
                  type="button"
                >
                  Practice tracks
                  {selectedPiece && Object.values(selectedPiece.trackFileIds).some(Boolean)
                    ? ` (${String(Object.values(selectedPiece.trackFileIds).filter(Boolean).length)})`
                    : ""}
                </button>
                <button
                  aria-controls="music-piece-performances"
                  aria-selected={editorTab === "performances"}
                  className={editorTab === "performances" ? "is-active" : undefined}
                  disabled={!selectedPiece}
                  onClick={() => {
                    setEditorTab("performances");
                  }}
                  role="tab"
                  type="button"
                >
                  Linked performances
                  {selectedPiece
                    ? ` (${String(events.filter((event) => event.type === "Performance" && performanceContainsPiece(event, pieceIdsForPerformance(selectedPiece, pieces))).length)})`
                    : ""}
                </button>
              </div>
              {editorTab === "details" ? (
                <div id="music-piece-details" role="tabpanel">
                  <div className="music-fields-grid">
                    <label className="field music-field--wide">
                      Title
                      <input
                        maxLength={500}
                        required
                        value={piece.title}
                        onChange={(event) => {
                          setPiece((current) => ({ ...current, title: event.target.value }));
                        }}
                      />
                    </label>
                    <label className="field">
                      Composer
                      <input
                        aria-autocomplete="list"
                        list="music-composer-arranger-options"
                        maxLength={300}
                        value={piece.composer}
                        onChange={(event) => {
                          setPiece((current) => ({ ...current, composer: event.target.value }));
                        }}
                      />
                    </label>
                    <label className="field">
                      Arranger
                      <input
                        aria-autocomplete="list"
                        list="music-composer-arranger-options"
                        maxLength={300}
                        value={piece.arranger}
                        onChange={(event) => {
                          setPiece((current) => ({ ...current, arranger: event.target.value }));
                        }}
                      />
                    </label>
                    <label className="field">
                      Catalog ID
                      <input
                        maxLength={200}
                        value={piece.catalogId}
                        onChange={(event) => {
                          setPiece((current) => ({ ...current, catalogId: event.target.value }));
                        }}
                      />
                    </label>
                    <label className="field">
                      Purchase date
                      <input
                        type="date"
                        value={piece.purchaseDate ?? ""}
                        onChange={(event) => {
                          setPiece((current) => ({
                            ...current,
                            purchaseDate: event.target.value || null,
                          }));
                        }}
                      />
                    </label>
                    <label className="field">
                      Copies
                      <input
                        inputMode="numeric"
                        min="0"
                        step="1"
                        type="number"
                        value={copiesInput}
                        onChange={(event) => {
                          setCopiesInput(event.target.value);
                        }}
                      />
                    </label>
                    <label className="field">
                      Duration (minutes:seconds)
                      <input
                        placeholder="4:05"
                        value={durationInput}
                        onChange={(event) => {
                          setDurationValue(event.target.value, true);
                        }}
                      />
                      {durationAutoFillLabel ? (
                        <small className="field-hint">
                          Auto-detected from “{durationAutoFillLabel}” track.
                        </small>
                      ) : null}
                      {durationDetectionNotice ? (
                        <small className="field-hint">{durationDetectionNotice}</small>
                      ) : null}
                      {durationMismatch ? (
                        <small className="music-duration-mismatch">
                          Tracks suggest {durationMismatch.suggested}.
                          {durationMismatch.current
                            ? ` Current: ${durationMismatch.current}. `
                            : " "}
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => {
                              setDurationValue(durationMismatch.suggested, true);
                            }}
                          >
                            Update
                          </button>
                        </small>
                      ) : null}
                    </label>
                    <label className="field music-field--wide">
                      Genres
                      <MusicGenrePicker
                        availableGenres={availableGenres}
                        selected={uniqueLabels(genresInput)}
                        onChange={(genres) => {
                          setGenresInput(genres.join(", "));
                        }}
                      />
                    </label>
                    <label className="field music-field--wide">
                      Parent work
                      <select
                        value={piece.parentId ?? ""}
                        onChange={(event) => {
                          setPiece((current) => ({
                            ...current,
                            parentId: event.target.value || null,
                          }));
                        }}
                      >
                        <option value="">Top-level work</option>
                        {topLevelPieces.map((parent) => (
                          <option key={parent.id} value={parent.id}>
                            {parent.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field music-field--wide">
                      Notes
                      <textarea
                        maxLength={100_000}
                        rows={4}
                        value={piece.notes}
                        onChange={(event) => {
                          setPiece((current) => ({ ...current, notes: event.target.value }));
                        }}
                      />
                    </label>
                  </div>
                  {!editingId ? (
                    <MusicTuttiTrackDropzone
                      disabled={busy}
                      file={pendingTuttiFile}
                      onChange={handlePendingTuttiFileChange}
                    />
                  ) : null}
                  <SectionBuckets
                    configuration={roster}
                    selected={piece.sectionBuckets}
                    onChange={(sectionBuckets) => {
                      setPiece((current) => ({ ...current, sectionBuckets }));
                    }}
                  />
                </div>
              ) : editorTab === "tracks" ? (
                selectedPiece ? (
                  <div id="music-piece-tracks" role="tabpanel">
                    <MusicAudioTracks
                      configuration={roster}
                      key={selectedPiece.id}
                      piece={selectedPiece}
                      onTrackDurationDetected={handleTrackDurationDetected}
                      onSaved={(saved, successMessage) => {
                        setPieces((current) =>
                          current.map((candidate) =>
                            candidate.id === saved.id ? saved : candidate,
                          ),
                        );
                        setEditorPiece(saved, "tracks");
                        setMessage(successMessage);
                      }}
                    />
                  </div>
                ) : (
                  <p className="notice">Save the piece first, then add practice tracks.</p>
                )
              ) : selectedPiece ? (
                <div id="music-piece-performances" role="tabpanel">
                  <MusicPiecePerformances
                    allEvents={events}
                    allPieces={pieces}
                    onEventChanged={handlePerformanceChanged}
                    piece={selectedPiece}
                    timezone={timezone}
                    venues={venues}
                  />
                </div>
              ) : (
                <p className="notice">Save the piece first, then link performances.</p>
              )}
              {editingId ? (
                <p className="field-help">
                  Learning tracks linked: {String(Object.keys(piece.trackFileIds).length)} ·
                  Movements: {String(childCount)}
                </p>
              ) : null}
              <MusicDeleteControls
                busy={busy}
                childCount={childCount}
                deleteConfirm={deleteConfirm}
                editingId={editingId}
                unlinkChildren={unlinkChildren}
                onAddMovement={() => {
                  beginNew(editingId);
                }}
                onCancel={() => {
                  setDeleteConfirm(false);
                }}
                onConfirm={() => void remove()}
                onRequest={() => {
                  setDeleteConfirm(true);
                }}
                onUnlinkChildren={(selected) => {
                  setUnlinkChildren(selected);
                }}
              />
            </form>
          </Dialog>
          <MusicBulkEditDialog
            busy={busy}
            configuration={roster}
            error={bulkError}
            onApply={(changes) => {
              void applyBulkChanges(changes);
            }}
            onClose={closeBulkDialog}
            open={bulkDialogOpen}
            personNameOptions={personNameOptions}
            selectedCount={selectedPieces.length}
            key={bulkDialogOpen ? "open" : "closed"}
          />
          <CsvImportDialog
            busy={busy || musicImportInspecting}
            columnWarnings={musicImportInspection?.warnings ?? []}
            columnMappings={musicImportMappings.map((mapping) => ({
              ...mapping,
              header: musicImportHeaders[mapping.sourceIndex] ?? "",
            }))}
            confirmed={musicImportConfirmed}
            description="Import up to 500 top-level works atomically. Existing catalog entries are retained."
            error={error}
            file={importFile}
            invalid={Boolean(musicImportInspection?.fatalError)}
            mappingOptions={musicCsvColumnOptions.map((value) => ({
              label: value,
              required: value === "Title",
              value,
            }))}
            onClose={closeImportDialog}
            onConfirmationChange={setMusicImportConfirmed}
            onFileChange={handleMusicImportFile}
            onImport={() => {
              void importCsv();
            }}
            onMapColumn={handleMusicColumnMap}
            open={importDialogOpen}
            title="Import music CSV"
          />
        </div>
      )}
    </section>
  );
}
