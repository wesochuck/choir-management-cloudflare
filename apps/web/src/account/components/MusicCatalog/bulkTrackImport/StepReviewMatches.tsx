import { TuttiSuggestions } from "./TuttiSuggestionActions";
import type { useTuttiSuggestions } from "./useTuttiSuggestions";
import { presentAiMatch } from "./aiMatchPresentation";
import type {
  MusicTrackImportGroupRepairSuggestion,
  OrganizationMusicPiece,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  DestinationPiecePicker,
  type DestinationPieceOption,
  type DestinationPiecePickerHandle,
} from "./DestinationPiecePicker";
import { BatchOverview } from "./ReviewBatchOverview";
import { FilesSection } from "./ReviewFileRow";
import {
  buildDestinationOptions,
  buildPartOptions,
  buildQueueRows,
  FILTERS,
  filterReviewQueueRows,
  getActiveFileStateMap,
  getActiveGroup,
  getActiveGroupState,
  getAdjacentGroupId,
  getGroupEvidence,
  getGroupFileMap,
  getNextUnresolvedGroup,
  getOptionalGroupConflictAnalysis,
  getSelectedPiece,
  markReviewGroupAndAdvance,
  selectNextGroup,
  statusClass,
  summarizeReviewGroups,
  type ReviewFilter,
  type ReviewQueueRow,
  type ReviewState,
  type ReviewView,
} from "./reviewSelectors";
import {
  areAllReviewGroupsResolved,
  getReviewGroupState,
  getReviewStatusLabel,
  getReviewNextAction,
  type ReviewGroupStatus,
} from "./reviewState";
import type { GroupFileAssignment, GroupReviewItem } from "./types";

function ReviewSummary({
  blockingConflicts,
  groupCount,
  totalFiles,
}: {
  readonly blockingConflicts: number;
  readonly groupCount: number;
  readonly totalFiles: number;
}) {
  return (
    <section aria-label="Import review summary" className="track-import-review-summary">
      <div>
        <strong>{String(totalFiles)}</strong>
        <span>{totalFiles === 1 ? "File" : "Files"}</span>
      </div>
      <div>
        <strong>{String(groupCount)}</strong>
        <span>{groupCount === 1 ? "Song group" : "Song groups"}</span>
      </div>
      {blockingConflicts > 0 ? (
        <div className="track-import-review-summary__conflicts">
          <strong>{String(blockingConflicts)}</strong>
          <span>Blocking conflicts</span>
        </div>
      ) : null}
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
      <div className="track-import-review-ai-action">
        <button
          className="button button--secondary"
          disabled={matching}
          type="button"
          onClick={onAiMatch}
          aria-describedby="track-import-ai-scope"
        >
          {matching ? "Matching with AI…" : "AI Match batch"}
        </button>
        <small id="track-import-ai-scope">
          Optional suggestions for the whole batch. Your edits and reviewed groups stay protected.
        </small>
      </div>
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
      <span className={statusClass(state.groupStatus)}>
        {getReviewStatusLabel(state, Boolean(piece))}
      </span>
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
  reviewLabel,
  groupStatus,
  group,
  groupCount,
  matching,
  ordinal,
  onNavigate,
}: {
  readonly reviewLabel: string;
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
          <h2 id="track-import-review-group-heading">
            Recording group {String(ordinal)} of {String(groupCount)}
          </h2>
          <span className={statusClass(groupStatus)}>{reviewLabel}</span>
        </div>
        <p>
          {String(group.files.length)} {group.files.length === 1 ? "file" : "files"}
          {group.sequenceNumber ? ` · Track #${group.sequenceNumber}` : ""}
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
  const aiPresentation = useMemo(() => presentAiMatch(group, options), [group, options]);

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
        suggestedAlternatives={aiPresentation.alternatives}
        aiMatchOutcome={aiPresentation.outcome}
      />
      {group.selectedPieceId ? (
        <details className="track-import-review-evidence" key={`evidence-${group.groupId}`}>
          <summary>Why this match?</summary>
          <p>{evidence}</p>
        </details>
      ) : null}
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
  readonly conflicts: ReviewState["files"];
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
          Choose another section or voice part
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

function ReviewNotices({
  groups,
  matchError,
  matching,
}: {
  readonly groups: readonly GroupReviewItem[];
  readonly matchError: string | null;
  readonly matching: boolean;
}) {
  const aiChecked = groups.filter((group) => group.aiSuggestion).length;
  const includedGroups = groups.filter(
    (group) => !group.groupSkipped && group.files.some((file) => !file.excluded),
  );
  const destinations = includedGroups.filter((group) => group.selectedPieceId).length;
  return (
    <>
      {matchError ? <p role="alert">{matchError} Your current selections are preserved.</p> : null}
      {matching ? (
        <p role="status">Getting AI suggestions…</p>
      ) : aiChecked > 0 && !matchError ? (
        <p role="status" className="track-import-ai-batch-result">
          AI matching complete. {String(destinations)} of {String(includedGroups.length)} included
          song groups have a destination. Review each included destination and voice part before
          uploading.
        </p>
      ) : null}
    </>
  );
}

function ReviewModePanel({
  guidedContent,
  onReviewGroup,
  pieceMap,
  roster,
  rows,
  view,
}: {
  readonly guidedContent: ReactNode;
  readonly onReviewGroup: (groupId: string) => void;
  readonly pieceMap: ReadonlyMap<string, OrganizationMusicPiece>;
  readonly roster: OrganizationRosterConfiguration | null;
  readonly rows: readonly ReviewQueueRow[];
  readonly view: ReviewView;
}) {
  if (view === "guided") return guidedContent;
  return (
    <BatchOverview onReviewGroup={onReviewGroup} pieceMap={pieceMap} roster={roster} rows={rows} />
  );
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
  readonly conflicts: ReviewState["files"];
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

function ReviewFooter({
  tuttiActions,
  needsDestination,
  resolveLabel,
  onResolveCurrent,
  canResolveCurrent,
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
  readonly tuttiActions: ReturnType<typeof useTuttiSuggestions>;
  readonly needsDestination: boolean;
  readonly resolveLabel: string;
  readonly onResolveCurrent: () => void;
  readonly canResolveCurrent: boolean;
  readonly activeGroup: GroupReviewItem;
  readonly activeState: ReviewState;
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
  return (
    <footer className="track-import-review-footer">
      <div aria-live="polite" className="track-import-review-footer__progress" role="status">
        <div>
          <strong>
            {String(resolvedGroups)} of {String(groupCount)} groups resolved
          </strong>
          <p>
            {String(reviewedGroups)} reviewed · {String(skippedGroups)} skipped
            {blockingConflicts > 0 ? ` · ${String(blockingConflicts)} blocking conflicts` : ""}
          </p>
          {needsDestination ? <p>Select a Music Library piece to enable review.</p> : null}
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
        <TuttiSuggestions actions={tuttiActions} matching={matching} />
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
        ) : needsDestination ? (
          <button className="button button--primary" disabled type="button">
            Mark reviewed &amp; next
          </button>
        ) : (
          <button
            className="button button--primary"
            disabled={matching || (!canResolveCurrent && !hasOtherUnresolvedGroup)}
            type="button"
            onClick={canResolveCurrent ? onResolveCurrent : onSelectNext}
          >
            {canResolveCurrent ? resolveLabel : "Review next unresolved"}
          </button>
        )}
      </div>
    </footer>
  );
}

function useReviewAction(
  activeState: ReturnType<typeof getActiveGroupState>,
  hasDestination: boolean,
  view: ReviewView,
  setView: (view: ReviewView) => void,
  partSelectRefs: RefObject<Map<string, HTMLSelectElement>>,
) {
  const pendingFocus = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (view !== "guided") return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (!target) return;
    const select = partSelectRefs.current.get(target);
    if (select && typeof select.scrollIntoView === "function")
      select.scrollIntoView({ block: "center" });
    select?.focus();
  }, [focusRequest, partSelectRefs, view]);

  const nextAction = activeState ? getReviewNextAction(activeState, hasDestination) : "next";
  const resolveLabel = nextAction === "conflict" ? "Resolve conflicts" : "Choose voice part";
  function resolveCurrentGroup(): void {
    if (!activeState) return;
    const file = activeState.files.find(
      (file) => file.status === (nextAction === "conflict" ? "conflict" : "needs_review"),
    );
    if (!file) return;
    pendingFocus.current = file.clientFileId;
    setView("guided");
    setFocusRequest((value) => value + 1);
  }
  return {
    needsDestination: nextAction === "piece",
    canResolveCurrent: nextAction === "part" || nextAction === "conflict",
    resolveLabel,
    resolveCurrentGroup,
  };
}

function GroupRepairSuggestions({
  matching,
  onAcceptProposal,
  onDismissProposal,
  proposals,
}: {
  readonly matching: boolean;
  readonly onAcceptProposal?:
    ((suggestion: MusicTrackImportGroupRepairSuggestion) => void) | undefined;
  readonly onDismissProposal?:
    ((suggestion: MusicTrackImportGroupRepairSuggestion) => void) | undefined;
  readonly proposals?: readonly MusicTrackImportGroupRepairSuggestion[] | undefined;
}) {
  if (!proposals || proposals.length === 0) return null;

  return (
    <section
      aria-label="Suggested song group changes"
      className="notice notice--info track-import-group-repairs"
    >
      <h4>Suggested group changes</h4>
      <p>
        Clef AI identified potential song grouping improvements. Review and accept to reorganize.
      </p>
      <ul>
        {proposals.map((proposal, index) => {
          const description =
            proposal.kind === "merge_groups"
              ? `Merge song groups ${proposal.groupIds.join(" and ")} into one group.`
              : proposal.kind === "split_group"
                ? `Split group ${proposal.sourceGroupId} into ${String(proposal.fileSubsets.length)} separate song groups.`
                : `Move files from ${proposal.sourceGroupId} to ${proposal.targetGroupId}.`;
          return (
            <li key={`proposal-${String(index)}-${proposal.kind}`}>
              <div>
                <strong>{description}</strong>
                <p>{proposal.evidence}</p>
              </div>
              <div className="track-import-actions__buttons">
                <button
                  className="button button--secondary"
                  disabled={matching}
                  type="button"
                  onClick={() => onAcceptProposal?.(proposal)}
                >
                  Accept
                </button>
                <button
                  className="button button--ghost"
                  disabled={matching}
                  type="button"
                  onClick={() => onDismissProposal?.(proposal)}
                >
                  Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function StepReviewMatches({
  tuttiActions,
  groups,
  matching,
  matchError,
  onAcceptGroupRepair,
  onAiMatch,
  onBack,
  onDismissGroupRepair,
  onDismissPartSuggestion,
  onFileExclusionChanged,
  onGroupPieceChanged,
  onGroupSkipToggled,
  onMarkGroupReviewed,
  onNext,
  onPartChanged,
  onSplitFile,
  pendingGroupRepairs,
  performancePieceIds,
  pieces,
  roster,
  validPartKeys,
}: {
  readonly tuttiActions: ReturnType<typeof useTuttiSuggestions>;
  readonly groups: readonly GroupReviewItem[];
  readonly matching: boolean;
  readonly matchError: string | null;
  readonly onAcceptGroupRepair?:
    ((suggestion: MusicTrackImportGroupRepairSuggestion) => void) | undefined;
  readonly onAiMatch: () => void;
  readonly onBack: () => void;
  readonly onDismissGroupRepair?:
    ((suggestion: MusicTrackImportGroupRepairSuggestion) => void) | undefined;
  readonly onDismissPartSuggestion?: ((groupId: string, clientFileId: string) => void) | undefined;
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
  readonly pendingGroupRepairs?: readonly MusicTrackImportGroupRepairSuggestion[] | undefined;
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
  const activeEvidence = getGroupEvidence(activeGroup, pieces, performancePieceIds);

  const nextUnresolvedGroup = getNextUnresolvedGroup(groups, activeGroup, groupStates);
  function selectNextUnresolved(): void {
    selectNextGroup(nextUnresolvedGroup, setSelectedGroupId);
  }

  function handleMarkReviewedAndNext(): void {
    markReviewGroupAndAdvance(activeGroup, activeState, onMarkGroupReviewed, selectNextUnresolved);
  }

  const hasOtherUnresolvedGroup = nextUnresolvedGroup !== undefined;
  const { needsDestination, canResolveCurrent, resolveLabel, resolveCurrentGroup } =
    useReviewAction(
      activeState,
      Boolean(getSelectedPiece(activeGroup, pieceMap)),
      view,
      setView,
      partSelectRefs,
    );
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
      <section aria-label={activeGroup.inferredTitle} className="track-import-review-detail">
        <GroupDetailHeader
          group={activeGroup}
          groupCount={groups.length}
          groupStatus={activeState.groupStatus}
          reviewLabel={getReviewStatusLabel(activeState, Boolean(selectedPiece))}
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
          onDismissPartSuggestion={onDismissPartSuggestion ?? (() => undefined)}
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
        totalFiles={totalFiles}
      />
      <ReviewNotices groups={groups} matchError={matchError} matching={matching} />
      <ReviewToolbar matching={matching} onAiMatch={onAiMatch} onViewChange={setView} view={view} />
      <GroupRepairSuggestions
        matching={matching}
        onAcceptProposal={onAcceptGroupRepair}
        onDismissProposal={onDismissGroupRepair}
        proposals={pendingGroupRepairs}
      />
      <ReviewModePanel
        guidedContent={guidedContent}
        onReviewGroup={(groupId) => {
          setSelectedGroupId(groupId);
          setView("guided");
        }}
        pieceMap={pieceMap}
        roster={roster}
        rows={queueRows}
        view={view}
      />
      <ReviewFooter
        tuttiActions={tuttiActions}
        needsDestination={needsDestination}
        resolveLabel={resolveLabel}
        onResolveCurrent={resolveCurrentGroup}
        canResolveCurrent={canResolveCurrent}
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
