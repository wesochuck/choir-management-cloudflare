import { DataTable, type DataTableColumn } from "@choir/ui";
import type { OrganizationMusicPiece, OrganizationRosterConfiguration } from "@choir/contracts";
import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  DestinationPiecePicker,
  type DestinationPieceOption,
  type DestinationPiecePickerHandle,
} from "./DestinationPiecePicker";
import { TrackFileAudioPlayer } from "./TrackFileAudioPlayer";
import {
  areAllReviewGroupsResolved,
  getReviewGroupState,
  type ReviewGroupStatus,
} from "./reviewState";
import type { GroupFileAssignment, GroupReviewItem } from "./types";

type ReviewView = "guided" | "overview";
type ReviewFilter = "all" | "to_review" | "conflicts" | "reviewed" | "skipped";

interface ReviewQueueRow {
  readonly group: GroupReviewItem;
  readonly ordinal: number;
  readonly state: ReturnType<typeof getReviewGroupState>;
  readonly voicePartSortKey: string;
}

const FILTERS: readonly { readonly id: ReviewFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "to_review", label: "To review" },
  { id: "conflicts", label: "Conflicts" },
  { id: "reviewed", label: "Reviewed" },
  { id: "skipped", label: "Skipped" },
];

function statusLabel(status: ReviewGroupStatus): string {
  switch (status) {
    case "conflict":
      return "Conflict";
    case "needs_review":
      return "Needs review";
    case "reviewed":
      return "Reviewed";
    case "skipped":
      return "Skipped";
  }
}

function statusClass(status: ReviewGroupStatus): string {
  return `track-import-review-status track-import-review-status--${status}`;
}

function formatDuration(seconds: number | null): string {
  if (typeof seconds !== "number" || seconds <= 0) return "Duration unavailable";
  const mins = Math.floor(seconds / 60);
  const remSecs = String(seconds % 60).padStart(2, "0");
  return `${String(mins)}:${remSecs}`;
}

function voicePartLabel(
  partKey: string | null,
  roster: OrganizationRosterConfiguration | null,
): string {
  if (!partKey) return "Part needed";
  if (partKey === "tutti") return "Tutti";
  if (partKey === "accompaniment") return "Accompaniment";
  return roster?.voiceParts.find((part) => part.label === partKey)?.fullName ?? partKey;
}

function reviewFileLabel(
  status: "needs_review" | "conflict" | "ready" | "excluded",
  excluded: boolean,
  duplicatePart: boolean,
  occupied: boolean,
  partKey: string | null,
): string {
  if (excluded) return "Excluded";
  if (duplicatePart) return "Duplicate part conflict";
  if (occupied) return "Occupied slot conflict";
  if (status === "ready") return "Ready to upload";
  return partKey ? "Needs review" : "Part needed";
}

function reviewFileBadgeStatus(
  status: "needs_review" | "conflict" | "ready" | "excluded",
): ReviewGroupStatus {
  if (status === "conflict") return "conflict";
  if (status === "ready") return "reviewed";
  if (status === "excluded") return "skipped";
  return "needs_review";
}

function FileReviewRow({
  duplicatePart,
  excluded,
  file,
  canSplitGroup,
  groupSkipped,
  matching,
  onExclusionChanged,
  onPartChanged,
  onSplitFile,
  partOptions,
  piece,
  reviewStatus,
  roster,
  selectRef,
}: {
  readonly duplicatePart: boolean;
  readonly excluded: boolean;
  readonly file: GroupFileAssignment;
  readonly canSplitGroup: boolean;
  readonly groupSkipped: boolean;
  readonly matching: boolean;
  readonly onExclusionChanged: (excluded: boolean) => void;
  readonly onPartChanged: (partKey: string | null) => void;
  readonly onSplitFile: () => void;
  readonly partOptions: readonly { readonly key: string; readonly label: string }[];
  readonly piece: OrganizationMusicPiece | undefined;
  readonly reviewStatus: "needs_review" | "conflict" | "ready" | "excluded";
  readonly roster: OrganizationRosterConfiguration | null;
  readonly selectRef: (element: HTMLSelectElement | null) => void;
}) {
  const occupied = !excluded && Boolean(file.partKey && piece?.trackFileIds[file.partKey]);
  const unavailablePart =
    file.partKey !== null && !partOptions.some((option) => option.key === file.partKey);
  const label = reviewFileLabel(reviewStatus, excluded, duplicatePart, occupied, file.partKey);
  const badgeStatus = reviewFileBadgeStatus(reviewStatus);

  return (
    <article className={`track-import-review-file track-import-review-file--${reviewStatus}`}>
      <div className="track-import-review-file__audio">
        <div className="track-import-review-file__identity">
          <strong title={file.fileName}>{file.fileName}</strong>
          <span>{formatDuration(file.durationSeconds)}</span>
          <span className={statusClass(badgeStatus)}>{label}</span>
        </div>
        <TrackFileAudioPlayer
          durationSeconds={file.durationSeconds}
          file={file.file}
          fileName={file.fileName}
        />
      </div>
      <div className="track-import-review-file__mapping">
        <label>
          <span>Voice part</span>
          <select
            aria-label={`Voice part for ${file.fileName}`}
            disabled={excluded || groupSkipped || matching}
            onChange={(event) => {
              onPartChanged(event.target.value || null);
            }}
            ref={selectRef}
            value={file.partKey ?? ""}
          >
            <option value="">Choose a voice part</option>
            {unavailablePart ? (
              <option disabled value={file.partKey}>
                {voicePartLabel(file.partKey, roster)} (not configured)
              </option>
            ) : null}
            {partOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="track-import-review-file__actions">
          <button
            aria-label={excluded ? `Restore ${file.fileName} for review` : `Skip ${file.fileName}`}
            className="button button--secondary"
            disabled={groupSkipped || matching}
            type="button"
            onClick={() => {
              onExclusionChanged(!excluded);
            }}
          >
            {excluded ? "Restore file" : "Skip this file"}
          </button>
          {!groupSkipped && canSplitGroup ? (
            <button
              className="button button--ghost"
              disabled={matching}
              type="button"
              onClick={onSplitFile}
            >
              Match separately
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ReviewSummary({
  blockingConflicts,
  groupCount,
  reviewedGroups,
  totalFiles,
}: {
  readonly blockingConflicts: number;
  readonly groupCount: number;
  readonly reviewedGroups: number;
  readonly totalFiles: number;
}) {
  return (
    <section aria-label="Import review summary" className="track-import-review-summary">
      <div>
        <strong>{String(totalFiles)}</strong>
        <span>Files</span>
      </div>
      <div>
        <strong>{String(groupCount)}</strong>
        <span>Song groups</span>
      </div>
      <div className={blockingConflicts > 0 ? "track-import-review-summary__conflicts" : ""}>
        <strong>{String(blockingConflicts)}</strong>
        <span>Blocking conflicts</span>
      </div>
      <div>
        <strong>
          {String(reviewedGroups)} / {String(groupCount)}
        </strong>
        <span>Reviewed</span>
      </div>
    </section>
  );
}

function ReviewToolbar({
  matching,
  onAiMatch,
  onViewChange,
  view,
}: {
  readonly matching: boolean;
  readonly onAiMatch: () => void;
  readonly onViewChange: (view: ReviewView) => void;
  readonly view: ReviewView;
}) {
  return (
    <div className="track-import-review-toolbar">
      <div aria-label="Review display" className="track-import-review-view-toggle" role="group">
        <button
          aria-pressed={view === "guided"}
          className={view === "guided" ? "is-active" : ""}
          disabled={matching}
          type="button"
          onClick={() => {
            onViewChange("guided");
          }}
        >
          Guided review
        </button>
        <button
          aria-pressed={view === "overview"}
          className={view === "overview" ? "is-active" : ""}
          disabled={matching}
          type="button"
          onClick={() => {
            onViewChange("overview");
          }}
        >
          Batch overview
        </button>
      </div>
      <button
        className="button button--secondary"
        disabled={matching}
        type="button"
        onClick={onAiMatch}
      >
        {matching ? "Matching with Clef Flash…" : "Use Clef Flash"}
      </button>
    </div>
  );
}

function ReviewQueueItem({
  active,
  disabled,
  piece,
  row,
  onSelect,
}: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly piece: OrganizationMusicPiece | undefined;
  readonly row: ReviewQueueRow;
  readonly onSelect: () => void;
}) {
  const { group, ordinal, state } = row;
  const pieceLabel = piece ? ` · ${piece.title}` : " · No destination";
  return (
    <button
      aria-current={active ? "true" : undefined}
      className={`track-import-review-queue-item ${active ? "is-active" : ""}`}
      disabled={disabled}
      type="button"
      onClick={onSelect}
    >
      <span className="track-import-review-queue-item__ordinal">{String(ordinal)}</span>
      <span className="track-import-review-queue-item__copy">
        <strong>{group.inferredTitle}</strong>
        <small>
          {String(group.files.length)} {group.files.length === 1 ? "file" : "files"}
          {pieceLabel}
        </small>
      </span>
      <span className={statusClass(state.groupStatus)}>{statusLabel(state.groupStatus)}</span>
    </button>
  );
}

function ReviewQueue({
  activeGroupId,
  filteredRows,
  matching,
  onFilterChange,
  onQueueSearchChange,
  onSelectGroup,
  pieceMap,
  queueSearch,
  filter,
  groupCount,
}: {
  readonly activeGroupId: string;
  readonly filteredRows: readonly ReviewQueueRow[];
  readonly filter: ReviewFilter;
  readonly groupCount: number;
  readonly matching: boolean;
  readonly onFilterChange: (filter: ReviewFilter) => void;
  readonly onQueueSearchChange: (search: string) => void;
  readonly onSelectGroup: (groupId: string) => void;
  readonly pieceMap: ReadonlyMap<string, OrganizationMusicPiece>;
  readonly queueSearch: string;
}) {
  const activeIsVisible = filteredRows.some((row) => row.group.groupId === activeGroupId);
  return (
    <aside aria-label="Song group queue" className="track-import-review-queue">
      <div className="track-import-review-queue__header">
        <div>
          <h2>Song groups</h2>
          <span>{String(groupCount)} in this import batch</span>
        </div>
        <label className="track-import-review-queue__search">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="10.8" cy="10.8" r="6.8" />
            <path d="m16 16 5 5" />
          </svg>
          <span className="sr-only">Search this import batch</span>
          <input
            disabled={matching}
            onChange={(event) => {
              onQueueSearchChange(event.target.value);
            }}
            placeholder="Find a song in this batch"
            type="search"
            value={queueSearch}
          />
        </label>
        <div aria-label="Filter song groups" className="track-import-review-filters" role="group">
          {FILTERS.map((item) => (
            <button
              aria-pressed={filter === item.id}
              className={filter === item.id ? "is-active" : ""}
              disabled={matching}
              key={item.id}
              type="button"
              onClick={() => {
                onFilterChange(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="track-import-review-queue__list">
        {filteredRows.length === 0 ? (
          <div className="track-import-review-empty">
            <p>No song groups match this search or filter.</p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                onQueueSearchChange("");
                onFilterChange("all");
              }}
            >
              Clear search and filters
            </button>
            <p>All groups are also available in Batch overview.</p>
          </div>
        ) : (
          filteredRows.map((row) => (
            <ReviewQueueItem
              active={row.group.groupId === activeGroupId}
              disabled={matching}
              key={row.group.groupId}
              onSelect={() => {
                onSelectGroup(row.group.groupId);
              }}
              piece={pieceMap.get(row.group.selectedPieceId ?? "")}
              row={row}
            />
          ))
        )}
      </div>
      {!activeIsVisible ? (
        <p className="track-import-review-queue__hidden-note">
          The selected group is hidden by these filters. Clear the filter or search to show it.
        </p>
      ) : null}
    </aside>
  );
}

function GroupDetailHeader({
  groupStatus,
  group,
  groupCount,
  matching,
  ordinal,
  onNavigate,
}: {
  readonly group: GroupReviewItem;
  readonly groupStatus: ReviewGroupStatus;
  readonly groupCount: number;
  readonly matching: boolean;
  readonly ordinal: number;
  readonly onNavigate: (direction: -1 | 1) => void;
}) {
  return (
    <div className="track-import-review-detail__header">
      <div>
        <div className="track-import-review-detail__ordinal">
          Song {String(ordinal)} of {String(groupCount)}
          <span className={statusClass(groupStatus)}>{statusLabel(groupStatus)}</span>
        </div>
        <h2 id="track-import-review-group-heading">{group.inferredTitle}</h2>
        <p>
          {String(group.files.length)} {group.files.length === 1 ? "file" : "files"}
          {group.sequenceNumber ? ` · Set-list item ${group.sequenceNumber}` : ""}
        </p>
      </div>
      <div className="track-import-review-detail__navigation">
        <button
          aria-label="Previous song group"
          className="button button--secondary"
          disabled={matching || groupCount < 2}
          type="button"
          onClick={() => {
            onNavigate(-1);
          }}
        >
          ← Previous
        </button>
        <button
          aria-label="Next song group"
          className="button button--secondary"
          disabled={matching || groupCount < 2}
          type="button"
          onClick={() => {
            onNavigate(1);
          }}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function DestinationSection({
  activeEvidence,
  group,
  matching,
  options,
  performanceIds,
  pickerRef,
  onSelect,
}: {
  readonly activeEvidence: readonly string[];
  readonly group: GroupReviewItem;
  readonly matching: boolean;
  readonly onSelect: (pieceId: string | null) => void;
  readonly options: readonly DestinationPieceOption[];
  readonly performanceIds: ReadonlySet<string>;
  readonly pickerRef: RefObject<DestinationPiecePickerHandle | null>;
}) {
  const evidence =
    activeEvidence.length > 0
      ? activeEvidence.join(" · ")
      : group.selectedPieceId
        ? "This piece was selected manually."
        : "Choose a destination from the Music Library to continue.";
  return (
    <section aria-label="Destination piece" className="track-import-review-destination">
      <div className="track-import-review-destination__heading">
        <div>
          <h3>Music Library destination</h3>
          <p>One destination piece applies to every included file in this song group.</p>
        </div>
      </div>
      <DestinationPiecePicker
        disabled={matching || group.groupSkipped === true}
        id={`group-piece-${group.groupId}`}
        key={group.groupId}
        onSelect={onSelect}
        options={options}
        performancePieceIds={performanceIds}
        ref={pickerRef}
        selectedPieceId={group.selectedPieceId}
      />
      <p className="track-import-review-evidence">
        <strong>Why this match?</strong> {evidence}
      </p>
    </section>
  );
}

function ConflictSection({
  conflicts,
  duplicateConflict,
  filesById,
  groupId,
  matching,
  onOpenLibrary,
  onSkipFile,
  onFocusPart,
  occupiedConflict,
  selectedPieceTitle,
}: {
  readonly conflicts: ReturnType<typeof getReviewGroupState>["files"];
  readonly duplicateConflict: boolean;
  readonly filesById: ReadonlyMap<string, GroupFileAssignment>;
  readonly groupId: string;
  readonly matching: boolean;
  readonly onFocusPart: (clientFileId: string) => void;
  readonly onOpenLibrary: () => void;
  readonly onSkipFile: (groupId: string, clientFileId: string) => void;
  readonly occupiedConflict: boolean;
  readonly selectedPieceTitle: string | undefined;
}) {
  const conflictText = [
    ...(duplicateConflict
      ? ["This song group assigns the same incoming voice part more than once."]
      : []),
    ...(occupiedConflict
      ? [
          `${selectedPieceTitle ?? "The selected destination"} already contains one or more selected voice parts. Existing recordings remain protected.`,
        ]
      : []),
  ].join(" ");
  const firstConflict = conflicts[0];
  return (
    <section
      aria-labelledby="track-import-review-conflict-heading"
      className="track-import-review-conflict"
      role="alert"
    >
      <h3 id="track-import-review-conflict-heading">Resolve these conflicts before review</h3>
      <p>{conflictText}</p>
      <ul>
        {conflicts.map((conflict) => (
          <li key={conflict.clientFileId}>
            {filesById.get(conflict.clientFileId)?.fileName}: {conflict.conflictReason}
          </li>
        ))}
      </ul>
      <div className="track-import-review-conflict__actions">
        <button
          className="button button--secondary"
          disabled={matching}
          type="button"
          onClick={() => {
            if (firstConflict) onFocusPart(firstConflict.clientFileId);
          }}
        >
          Choose another voice part
        </button>
        <button
          className="button button--secondary"
          disabled={matching}
          type="button"
          onClick={onOpenLibrary}
        >
          Search library to change piece
        </button>
        <button
          className="button button--secondary"
          disabled={matching}
          type="button"
          onClick={() => {
            if (firstConflict) onSkipFile(groupId, firstConflict.clientFileId);
          }}
        >
          Skip this file
        </button>
      </div>
    </section>
  );
}

function FilesSection({
  activeFileStates,
  duplicatePartKeys,
  group,
  groupState,
  matching,
  onFileExclusionChanged,
  onPartChanged,
  onSplitFile,
  partOptions,
  piece,
  roster,
  selectRefs,
  setSelectedGroupId,
}: {
  readonly activeFileStates: ReadonlyMap<
    string,
    ReturnType<typeof getReviewGroupState>["files"][number]
  >;
  readonly duplicatePartKeys: ReadonlySet<string>;
  readonly group: GroupReviewItem;
  readonly groupState: ReturnType<typeof getReviewGroupState>;
  readonly matching: boolean;
  readonly onFileExclusionChanged: (
    groupId: string,
    clientFileId: string,
    excluded: boolean,
  ) => void;
  readonly onPartChanged: (groupId: string, clientFileId: string, partKey: string | null) => void;
  readonly onSplitFile: (clientFileId: string) => string | null;
  readonly partOptions: readonly { readonly key: string; readonly label: string }[];
  readonly piece: OrganizationMusicPiece | undefined;
  readonly roster: OrganizationRosterConfiguration | null;
  readonly selectRefs: RefObject<Map<string, HTMLSelectElement>>;
  readonly setSelectedGroupId: (groupId: string) => void;
}) {
  return (
    <section aria-label="Files in this song group" className="track-import-review-files">
      <div className="track-import-review-files__heading">
        <h3>Files and voice parts</h3>
        <span>
          {String(groupState.uploadableFileCount)} ready · {String(groupState.excludedFileCount)}{" "}
          excluded
        </span>
      </div>
      {group.files.map((file) => {
        const fileReview = activeFileStates.get(file.clientFileId);
        return (
          <FileReviewRow
            duplicatePart={file.partKey !== null && duplicatePartKeys.has(file.partKey)}
            excluded={group.groupSkipped === true || file.excluded === true}
            file={file}
            canSplitGroup={group.files.length > 1}
            groupSkipped={group.groupSkipped === true}
            matching={matching}
            key={file.clientFileId}
            onExclusionChanged={(excluded) => {
              onFileExclusionChanged(group.groupId, file.clientFileId, excluded);
            }}
            onPartChanged={(partKey) => {
              onPartChanged(group.groupId, file.clientFileId, partKey);
            }}
            onSplitFile={() => {
              if (group.files.length < 2) return;
              const newGroupId = onSplitFile(file.clientFileId);
              if (newGroupId) setSelectedGroupId(newGroupId);
            }}
            partOptions={partOptions}
            piece={piece}
            reviewStatus={fileReview?.status ?? "needs_review"}
            roster={roster}
            selectRef={(element) => {
              if (element) selectRefs.current.set(file.clientFileId, element);
              else selectRefs.current.delete(file.clientFileId);
            }}
          />
        );
      })}
    </section>
  );
}

function BatchOverview({
  columns,
  rows,
}: {
  readonly columns: readonly DataTableColumn<ReviewQueueRow>[];
  readonly rows: readonly ReviewQueueRow[];
}) {
  return (
    <section aria-label="Batch overview" className="track-import-review-overview">
      <h2>Every song group in this import</h2>
      <p>
        Review destinations, file counts, voice parts, and outstanding conflicts across the batch.
      </p>
      <DataTable
        columns={columns}
        emptyMessage="No song groups are available."
        keySelector={(row) => row.group.groupId}
        rows={rows}
      />
    </section>
  );
}

function ReviewNotices({
  matchError,
  matching,
}: {
  readonly matchError: string | null;
  readonly matching: boolean;
}) {
  return (
    <>
      {matchError ? <p role="alert">{matchError} Your current selections are preserved.</p> : null}
      {matching ? <p role="status">Getting Clef Flash suggestions…</p> : null}
    </>
  );
}

function ReviewModePanel({
  columns,
  guidedContent,
  rows,
  view,
}: {
  readonly columns: readonly DataTableColumn<ReviewQueueRow>[];
  readonly guidedContent: ReactNode;
  readonly rows: readonly ReviewQueueRow[];
  readonly view: ReviewView;
}) {
  if (view === "guided") return guidedContent;
  return <BatchOverview columns={columns} rows={rows} />;
}

function ReviewConflictPanel({
  conflicts,
  duplicateConflict,
  filesById,
  groupId,
  matching,
  onFocusPart,
  onOpenLibrary,
  onSkipFile,
  occupiedConflict,
  selectedPieceTitle,
}: {
  readonly conflicts: ReturnType<typeof getReviewGroupState>["files"];
  readonly duplicateConflict: boolean;
  readonly filesById: ReadonlyMap<string, GroupFileAssignment>;
  readonly groupId: string;
  readonly matching: boolean;
  readonly onFocusPart: (clientFileId: string) => void;
  readonly onOpenLibrary: () => void;
  readonly onSkipFile: (groupId: string, clientFileId: string) => void;
  readonly occupiedConflict: boolean;
  readonly selectedPieceTitle: string | undefined;
}) {
  if (conflicts.length === 0) return null;
  return (
    <ConflictSection
      conflicts={conflicts}
      duplicateConflict={duplicateConflict}
      filesById={filesById}
      groupId={groupId}
      matching={matching}
      onFocusPart={onFocusPart}
      onOpenLibrary={onOpenLibrary}
      onSkipFile={onSkipFile}
      occupiedConflict={occupiedConflict}
      selectedPieceTitle={selectedPieceTitle}
    />
  );
}

function queueRowMatchesFilter(status: ReviewGroupStatus, filter: ReviewFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "to_review":
      return status === "needs_review";
    case "conflicts":
      return status === "conflict";
    case "reviewed":
      return status === "reviewed";
    case "skipped":
      return status === "skipped";
  }
}

function queueRowMatchesSearch(
  group: GroupReviewItem,
  terms: readonly string[],
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
): boolean {
  if (terms.length === 0) return true;
  const piece = group.selectedPieceId ? pieceMap.get(group.selectedPieceId) : undefined;
  const searchable = [
    group.inferredTitle,
    piece?.title ?? "",
    piece?.composer ?? "",
    piece?.arranger ?? "",
    ...group.files.map((file) => file.fileName),
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => searchable.includes(term));
}

function filterReviewQueueRows(
  rows: readonly ReviewQueueRow[],
  filter: ReviewFilter,
  search: string,
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
): readonly ReviewQueueRow[] {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(
    ({ group, state }) =>
      queueRowMatchesFilter(state.groupStatus, filter) &&
      queueRowMatchesSearch(group, terms, pieceMap),
  );
}

type ReviewState = ReturnType<typeof getReviewGroupState>;

function buildQueueRows(
  groups: readonly GroupReviewItem[],
  groupStates: ReadonlyMap<string, ReviewState>,
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
  validPartKeys: ReadonlySet<string>,
  roster: OrganizationRosterConfiguration | null,
): readonly ReviewQueueRow[] {
  return groups.map((group, index) => ({
    group,
    ordinal: index + 1,
    state: groupStates.get(group.groupId) ?? getReviewGroupState(group, pieceMap, validPartKeys),
    voicePartSortKey: group.files.map((file) => voicePartLabel(file.partKey, roster)).join(", "),
  }));
}

function summarizeReviewGroups(
  groups: readonly GroupReviewItem[],
  groupStates: ReadonlyMap<string, ReviewState>,
) {
  let totalFiles = 0;
  let blockingConflicts = 0;
  let reviewedGroups = 0;
  let skippedGroups = 0;
  let resolvedGroups = 0;
  for (const group of groups) {
    const state = groupStates.get(group.groupId);
    totalFiles += group.files.length;
    blockingConflicts += state?.blockingConflictCount ?? 0;
    if (state?.groupStatus === "reviewed") reviewedGroups += 1;
    if (state?.groupStatus === "skipped") skippedGroups += 1;
    if (state?.groupStatus === "reviewed" || state?.groupStatus === "skipped") resolvedGroups += 1;
  }
  return { blockingConflicts, resolvedGroups, reviewedGroups, skippedGroups, totalFiles };
}

function buildDestinationOptions(
  groups: readonly GroupReviewItem[],
  selectedGroupId: string,
  performancePieceIds: readonly string[],
  pieces: readonly OrganizationMusicPiece[],
): readonly DestinationPieceOption[] {
  const active = groups.find((group) => group.groupId === selectedGroupId) ?? groups[0];
  const candidateRank = new Map(
    (active?.candidates ?? []).map((candidate, index) => [candidate.piece.id, index]),
  );
  const setListRank = new Map(performancePieceIds.map((pieceId, index) => [pieceId, index]));
  return pieces
    .map((piece) => ({
      arranger: piece.arranger,
      composer: piece.composer,
      id: piece.id,
      occupiedParts: Object.keys(piece.trackFileIds),
      searchText: `${piece.title} ${piece.composer} ${piece.arranger}`.toLowerCase(),
      title: piece.title,
      trackCount: Object.keys(piece.trackFileIds).length,
    }))
    .sort((left, right) => {
      const leftSetListRank = setListRank.get(left.id);
      const rightSetListRank = setListRank.get(right.id);
      if (leftSetListRank !== undefined && rightSetListRank !== undefined) {
        return leftSetListRank - rightSetListRank;
      }
      if (leftSetListRank !== undefined) return -1;
      if (rightSetListRank !== undefined) return 1;
      const leftCandidateRank = candidateRank.get(left.id);
      const rightCandidateRank = candidateRank.get(right.id);
      if (leftCandidateRank !== undefined && rightCandidateRank !== undefined) {
        return leftCandidateRank - rightCandidateRank;
      }
      if (leftCandidateRank !== undefined) return -1;
      if (rightCandidateRank !== undefined) return 1;
      return left.title.localeCompare(right.title);
    });
}

function getNextUnresolvedGroup(
  groups: readonly GroupReviewItem[],
  activeGroup: GroupReviewItem | undefined,
  groupStates: ReadonlyMap<string, ReviewState>,
): GroupReviewItem | undefined {
  if (!activeGroup) return undefined;
  const currentIndex = groups.findIndex((group) => group.groupId === activeGroup.groupId);
  for (let offset = 1; offset < groups.length; offset += 1) {
    const candidate = groups[(currentIndex + offset + groups.length) % groups.length];
    if (!candidate) continue;
    const status = groupStates.get(candidate.groupId)?.groupStatus;
    if (status !== "reviewed" && status !== "skipped") return candidate;
  }
  return undefined;
}

function getActiveGroup(
  groups: readonly GroupReviewItem[],
  selectedGroupId: string,
): GroupReviewItem | undefined {
  return groups.find((group) => group.groupId === selectedGroupId) ?? groups[0];
}

function getActiveGroupState(
  group: GroupReviewItem | undefined,
  groupStates: ReadonlyMap<string, ReviewState>,
): ReviewState | undefined {
  return group ? groupStates.get(group.groupId) : undefined;
}

function getSelectedPiece(
  group: GroupReviewItem | undefined,
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
): OrganizationMusicPiece | undefined {
  return group?.selectedPieceId ? pieceMap.get(group.selectedPieceId) : undefined;
}

function getActiveFileStateMap(state: ReviewState | undefined) {
  return new Map((state?.files ?? []).map((file) => [file.clientFileId, file]));
}

function getGroupFileMap(group: GroupReviewItem | undefined) {
  return new Map((group?.files ?? []).map((file) => [file.clientFileId, file]));
}

function getOptionalGroupConflictAnalysis(
  group: GroupReviewItem | undefined,
  state: ReviewState | undefined,
) {
  if (!group || !state) return undefined;
  return getGroupConflictAnalysis(group, state);
}

function buildPartOptions(roster: OrganizationRosterConfiguration | null) {
  const options: { key: string; label: string }[] = [{ key: "tutti", label: "Tutti" }];
  for (const voicePart of roster?.voiceParts ?? []) {
    options.push({ key: voicePart.label, label: voicePart.fullName });
  }
  options.push({ key: "accompaniment", label: "Accompaniment" });
  return options;
}

function getAdjacentGroupId(
  groups: readonly GroupReviewItem[],
  activeGroup: GroupReviewItem | undefined,
  direction: -1 | 1,
): string {
  if (!activeGroup) return "";
  const currentIndex = groups.findIndex((group) => group.groupId === activeGroup.groupId);
  const nextIndex = (currentIndex + direction + groups.length) % groups.length;
  return groups[nextIndex]?.groupId ?? "";
}

function selectNextGroup(
  group: GroupReviewItem | undefined,
  setSelectedGroupId: (groupId: string) => void,
): void {
  if (group) setSelectedGroupId(group.groupId);
}

function markReviewGroupAndAdvance(
  group: GroupReviewItem | undefined,
  state: ReviewState | undefined,
  onMarkGroupReviewed: (groupId: string) => void,
  onAdvance: () => void,
): void {
  if (!group || !state?.isEligibleForReview) return;
  onMarkGroupReviewed(group.groupId);
  onAdvance();
}

function getGroupConflictAnalysis(group: GroupReviewItem, state: ReviewState) {
  const filesById = new Map(group.files.map((file) => [file.clientFileId, file]));
  const conflicts = state.files.filter((file) => file.status === "conflict");
  const partCounts = new Map<string, number>();
  for (const file of group.files) {
    if (!file.excluded && file.partKey) {
      partCounts.set(file.partKey, (partCounts.get(file.partKey) ?? 0) + 1);
    }
  }
  const duplicatePartKeys = new Set<string>();
  for (const conflict of conflicts) {
    const file = filesById.get(conflict.clientFileId);
    if (file?.partKey && (partCounts.get(file.partKey) ?? 0) > 1) {
      duplicatePartKeys.add(file.partKey);
    }
  }
  return {
    conflicts,
    duplicateConflict: conflicts.some((file) => file.conflictReason?.includes("Duplicate")),
    duplicatePartKeys,
    filesById,
    occupiedConflict: conflicts.some((file) =>
      file.conflictReason?.includes("already has a recording"),
    ),
  };
}

function getGroupEvidence(group: GroupReviewItem | undefined): readonly string[] {
  if (!group) return [];
  if (group.aiSuggestion?.rationale) return [group.aiSuggestion.rationale];
  return (
    group.candidates.find((candidate) => candidate.piece.id === group.selectedPieceId)?.evidence ??
    []
  );
}

function OverviewSongCell({ row }: { readonly row: ReviewQueueRow }) {
  const { group, ordinal } = row;
  return (
    <div className="track-import-overview-song">
      <strong>{group.inferredTitle}</strong>
      <span>
        Song {String(ordinal)} · {String(group.files.length)}{" "}
        {group.files.length === 1 ? "file" : "files"}
      </span>
      <small>{group.files.map((file) => file.fileName).join(" · ")}</small>
    </div>
  );
}

function OverviewDestinationCell({
  piece,
}: {
  readonly piece: OrganizationMusicPiece | undefined;
}) {
  if (!piece) return <span>No destination selected</span>;
  return (
    <span>
      {piece.title}
      <small className="track-import-overview-subtext">
        {[piece.composer, piece.arranger ? `arr. ${piece.arranger}` : ""]
          .filter(Boolean)
          .join(" · ")}
      </small>
    </span>
  );
}

function OverviewVoicePartsCell({
  group,
  roster,
}: {
  readonly group: GroupReviewItem;
  readonly roster: OrganizationRosterConfiguration | null;
}) {
  if (group.groupSkipped) return <span>Entire group skipped</span>;
  return (
    <span>
      {group.files
        .map((file) =>
          file.excluded
            ? `${voicePartLabel(file.partKey, roster)} (excluded)`
            : voicePartLabel(file.partKey, roster),
        )
        .join(", ")}
    </span>
  );
}

function OverviewStatusCell({
  group,
  state,
}: {
  readonly group: GroupReviewItem;
  readonly state: ReviewState;
}) {
  return (
    <span>
      <span className={statusClass(state.groupStatus)}>{statusLabel(state.groupStatus)}</span>
      {state.blockingConflictCount > 0 ? (
        <small className="track-import-overview-subtext">
          {String(state.blockingConflictCount)} conflict
          {state.blockingConflictCount === 1 ? "" : "s"}
        </small>
      ) : null}
      {state.excludedFileCount > 0 && state.groupStatus !== "skipped" ? (
        <small className="track-import-overview-subtext">
          {String(state.excludedFileCount)} excluded file{state.excludedFileCount === 1 ? "" : "s"}
        </small>
      ) : null}
      <span className="sr-only">{group.inferredTitle}</span>
    </span>
  );
}

function buildOverviewColumns(
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
  roster: OrganizationRosterConfiguration | null,
  onReview: (groupId: string) => void,
): readonly DataTableColumn<ReviewQueueRow>[] {
  return [
    {
      header: "Song group",
      id: "song",
      mobileLabel: "Song group",
      render: (row) => <OverviewSongCell row={row} />,
      sortValue: ({ group }) => group.inferredTitle,
    },
    {
      align: "center",
      header: "Files",
      id: "files",
      mobileLabel: "Files",
      render: ({ group }) => String(group.files.length),
      sortValue: ({ group }) => group.files.length,
    },
    {
      header: "Destination",
      id: "destination",
      mobileLabel: "Destination",
      render: ({ group }) => (
        <OverviewDestinationCell piece={pieceMap.get(group.selectedPieceId ?? "")} />
      ),
      sortValue: ({ group }) => pieceMap.get(group.selectedPieceId ?? "")?.title,
    },
    {
      header: "Voice parts",
      id: "parts",
      mobileLabel: "Voice parts",
      render: ({ group }) => <OverviewVoicePartsCell group={group} roster={roster} />,
      sortValue: ({ voicePartSortKey }) => voicePartSortKey,
    },
    {
      header: "Review status",
      id: "status",
      mobileLabel: "Review status",
      render: ({ group, state }) => <OverviewStatusCell group={group} state={state} />,
      sortValue: ({ state }) =>
        ({ conflict: 0, needs_review: 1, reviewed: 2, skipped: 3 })[state.groupStatus],
    },
    {
      header: "Review",
      id: "actions",
      mobileLabel: "Review",
      render: ({ group }) => (
        <button
          className="button button--secondary"
          type="button"
          onClick={() => {
            onReview(group.groupId);
          }}
        >
          Review
        </button>
      ),
    },
  ];
}

function ReviewFooter({
  activeGroup,
  activeState,
  allResolved,
  blockingConflicts,
  groupCount,
  matching,
  onBack,
  onGroupSkipToggled,
  onNext,
  onReviewNext,
  onSelectNext,
  reviewedGroups,
  resolvedGroups,
  skippedGroups,
  hasOtherUnresolvedGroup,
}: {
  readonly activeGroup: GroupReviewItem;
  readonly activeState: ReturnType<typeof getReviewGroupState>;
  readonly allResolved: boolean;
  readonly blockingConflicts: number;
  readonly groupCount: number;
  readonly hasOtherUnresolvedGroup: boolean;
  readonly matching: boolean;
  readonly onBack: () => void;
  readonly onGroupSkipToggled: (groupId: string) => void;
  readonly onNext: () => void;
  readonly onReviewNext: () => void;
  readonly onSelectNext: () => void;
  readonly reviewedGroups: number;
  readonly resolvedGroups: number;
  readonly skippedGroups: number;
}) {
  let nextLabel = "Assign a destination and voice part";
  if (hasOtherUnresolvedGroup) nextLabel = "Review next unresolved";
  else if (activeState.groupStatus === "conflict") nextLabel = "Resolve conflicts above";

  return (
    <footer className="track-import-review-footer">
      <div aria-live="polite" className="track-import-review-footer__progress" role="status">
        <div aria-hidden="true" className="track-import-review-footer__progress-mark">
          {String(resolvedGroups)} / {String(groupCount)}
        </div>
        <div>
          <strong>
            {String(resolvedGroups)} of {String(groupCount)} groups resolved
          </strong>
          <p>
            {String(reviewedGroups)} reviewed · {String(skippedGroups)} skipped
            {blockingConflicts > 0 ? ` · ${String(blockingConflicts)} blocking conflicts` : ""}
          </p>
        </div>
      </div>
      <div className="track-import-review-footer__actions">
        <button
          className="button button--secondary"
          disabled={matching}
          type="button"
          onClick={onBack}
        >
          Back to files
        </button>
        <button
          className="button button--secondary"
          disabled={matching}
          type="button"
          onClick={() => {
            onGroupSkipToggled(activeGroup.groupId);
          }}
        >
          {activeState.groupStatus === "skipped" ? "Restore group" : "Skip group"}
        </button>
        {allResolved ? (
          <button
            className="button button--primary"
            disabled={matching}
            type="button"
            onClick={onNext}
          >
            Continue to confirmation
          </button>
        ) : activeState.groupStatus === "needs_review" && activeState.isEligibleForReview ? (
          <button
            className="button button--primary"
            disabled={matching}
            type="button"
            onClick={onReviewNext}
          >
            Mark reviewed &amp; next
          </button>
        ) : (
          <button
            className="button button--primary"
            disabled={matching || !hasOtherUnresolvedGroup}
            type="button"
            onClick={onSelectNext}
          >
            {nextLabel}
          </button>
        )}
      </div>
    </footer>
  );
}

export function StepReviewMatches({
  groups,
  matching,
  matchError,
  onAiMatch,
  onBack,
  onFileExclusionChanged,
  onGroupPieceChanged,
  onGroupSkipToggled,
  onMarkGroupReviewed,
  onNext,
  onPartChanged,
  onSplitFile,
  performancePieceIds,
  pieces,
  roster,
  validPartKeys,
}: {
  readonly groups: readonly GroupReviewItem[];
  readonly matching: boolean;
  readonly matchError: string | null;
  readonly onAiMatch: () => void;
  readonly onBack: () => void;
  readonly onFileExclusionChanged: (
    groupId: string,
    clientFileId: string,
    excluded: boolean,
  ) => void;
  readonly onGroupPieceChanged: (groupId: string, pieceId: string | null) => void;
  readonly onGroupSkipToggled: (groupId: string) => void;
  readonly onMarkGroupReviewed: (groupId: string) => void;
  readonly onNext: () => void;
  readonly onPartChanged: (groupId: string, clientFileId: string, partKey: string | null) => void;
  readonly onSplitFile: (clientFileId: string) => string | null;
  readonly performancePieceIds: readonly string[];
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly roster: OrganizationRosterConfiguration | null;
  readonly validPartKeys: ReadonlySet<string>;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [view, setView] = useState<ReviewView>("guided");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [queueSearch, setQueueSearch] = useState("");
  const partSelectRefs = useRef(new Map<string, HTMLSelectElement>());
  const destinationPickerRef = useRef<DestinationPiecePickerHandle>(null);

  const pieceMap = useMemo(() => new Map(pieces.map((piece) => [piece.id, piece])), [pieces]);
  const performanceIds = useMemo(() => new Set(performancePieceIds), [performancePieceIds]);
  const groupStates = useMemo(
    () =>
      new Map(
        groups.map((group) => [group.groupId, getReviewGroupState(group, pieceMap, validPartKeys)]),
      ),
    [groups, pieceMap, validPartKeys],
  );
  const groupOrdinals = useMemo(
    () => new Map(groups.map((group, index) => [group.groupId, index + 1])),
    [groups],
  );
  const activeGroup = getActiveGroup(groups, selectedGroupId);
  const activeState = getActiveGroupState(activeGroup, groupStates);
  const allResolved = areAllReviewGroupsResolved(groups, pieceMap, validPartKeys);
  const { blockingConflicts, resolvedGroups, reviewedGroups, skippedGroups, totalFiles } = useMemo(
    () => summarizeReviewGroups(groups, groupStates),
    [groups, groupStates],
  );

  const partOptions = useMemo(() => buildPartOptions(roster), [roster]);

  const destinationOptions = useMemo(
    () => buildDestinationOptions(groups, selectedGroupId, performancePieceIds, pieces),
    [groups, performancePieceIds, pieces, selectedGroupId],
  );
  const queueRows = useMemo(
    () => buildQueueRows(groups, groupStates, pieceMap, validPartKeys, roster),
    [groupStates, groups, pieceMap, roster, validPartKeys],
  );
  const filteredQueueRows = useMemo(
    () => filterReviewQueueRows(queueRows, filter, queueSearch, pieceMap),
    [filter, pieceMap, queueRows, queueSearch],
  );
  const activeEvidence = getGroupEvidence(activeGroup);

  const overviewColumns = useMemo(
    () =>
      buildOverviewColumns(pieceMap, roster, (groupId) => {
        setSelectedGroupId(groupId);
        setView("guided");
      }),
    [pieceMap, roster],
  );

  const nextUnresolvedGroup = getNextUnresolvedGroup(groups, activeGroup, groupStates);
  function selectNextUnresolved(): void {
    selectNextGroup(nextUnresolvedGroup, setSelectedGroupId);
  }

  function handleMarkReviewedAndNext(): void {
    markReviewGroupAndAdvance(activeGroup, activeState, onMarkGroupReviewed, selectNextUnresolved);
  }

  const hasOtherUnresolvedGroup = nextUnresolvedGroup !== undefined;
  const selectedPiece = getSelectedPiece(activeGroup, pieceMap);
  const activeFileStates = getActiveFileStateMap(activeState);
  const activeGroupFilesById = getGroupFileMap(activeGroup);
  const conflictAnalysis = getOptionalGroupConflictAnalysis(activeGroup, activeState);
  const activeGroupConflicts = conflictAnalysis?.conflicts ?? [];
  const duplicatePartKeys = conflictAnalysis?.duplicatePartKeys ?? new Set<string>();
  const hasDuplicatePartConflict = conflictAnalysis?.duplicateConflict ?? false;
  const hasOccupiedSlotConflict = conflictAnalysis?.occupiedConflict ?? false;

  function navigateGroup(direction: -1 | 1): void {
    setSelectedGroupId(getAdjacentGroupId(groups, activeGroup, direction));
  }

  if (!activeGroup || !activeState) {
    return <div className="track-import-wizard-step">No song groups are available to review.</div>;
  }

  const guidedContent = (
    <div className="track-import-review-guided">
      <ReviewQueue
        activeGroupId={activeGroup.groupId}
        filter={filter}
        filteredRows={filteredQueueRows}
        groupCount={groups.length}
        matching={matching}
        onFilterChange={setFilter}
        onQueueSearchChange={setQueueSearch}
        onSelectGroup={(groupId) => {
          setSelectedGroupId(groupId);
        }}
        pieceMap={pieceMap}
        queueSearch={queueSearch}
      />
      <section
        aria-labelledby="track-import-review-group-heading"
        className="track-import-review-detail"
      >
        <GroupDetailHeader
          group={activeGroup}
          groupCount={groups.length}
          groupStatus={activeState.groupStatus}
          matching={matching}
          onNavigate={navigateGroup}
          ordinal={groupOrdinals.get(activeGroup.groupId) ?? 1}
        />
        <DestinationSection
          activeEvidence={activeEvidence}
          group={activeGroup}
          matching={matching}
          onSelect={(pieceId) => {
            onGroupPieceChanged(activeGroup.groupId, pieceId);
          }}
          options={destinationOptions}
          performanceIds={performanceIds}
          pickerRef={destinationPickerRef}
        />
        <ReviewConflictPanel
          conflicts={activeGroupConflicts}
          duplicateConflict={hasDuplicatePartConflict}
          filesById={activeGroupFilesById}
          groupId={activeGroup.groupId}
          matching={matching}
          onFocusPart={(clientFileId) => {
            partSelectRefs.current.get(clientFileId)?.focus();
          }}
          onOpenLibrary={() => {
            destinationPickerRef.current?.openSearch();
          }}
          onSkipFile={(groupId, clientFileId) => {
            onFileExclusionChanged(groupId, clientFileId, true);
          }}
          occupiedConflict={hasOccupiedSlotConflict}
          selectedPieceTitle={selectedPiece?.title}
        />
        <FilesSection
          activeFileStates={activeFileStates}
          duplicatePartKeys={duplicatePartKeys}
          group={activeGroup}
          groupState={activeState}
          matching={matching}
          onFileExclusionChanged={onFileExclusionChanged}
          onPartChanged={onPartChanged}
          onSplitFile={onSplitFile}
          partOptions={partOptions}
          piece={selectedPiece}
          roster={roster}
          selectRefs={partSelectRefs}
          setSelectedGroupId={setSelectedGroupId}
        />
      </section>
    </div>
  );

  return (
    <div className="track-import-wizard-step track-import-wizard-step--review">
      <ReviewSummary
        blockingConflicts={blockingConflicts}
        groupCount={groups.length}
        reviewedGroups={reviewedGroups}
        totalFiles={totalFiles}
      />
      <ReviewNotices matchError={matchError} matching={matching} />
      <ReviewToolbar matching={matching} onAiMatch={onAiMatch} onViewChange={setView} view={view} />
      <ReviewModePanel
        columns={overviewColumns}
        guidedContent={guidedContent}
        rows={queueRows}
        view={view}
      />
      <ReviewFooter
        activeGroup={activeGroup}
        activeState={activeState}
        allResolved={allResolved}
        blockingConflicts={blockingConflicts}
        groupCount={groups.length}
        hasOtherUnresolvedGroup={hasOtherUnresolvedGroup}
        matching={matching}
        onBack={onBack}
        onGroupSkipToggled={onGroupSkipToggled}
        onNext={onNext}
        onReviewNext={handleMarkReviewedAndNext}
        onSelectNext={() => {
          selectNextUnresolved();
        }}
        reviewedGroups={reviewedGroups}
        resolvedGroups={resolvedGroups}
        skippedGroups={skippedGroups}
      />
    </div>
  );
}
