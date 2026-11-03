import type { OrganizationMusicPiece, OrganizationRosterConfiguration } from "@choir/contracts";
import type { RefObject } from "react";
import {
  formatDuration,
  reviewFileBadgeStatus,
  reviewFileLabel,
  statusClass,
  voicePartLabel,
  type ReviewState,
} from "./reviewSelectors";
import { TrackFileAudioPlayer } from "./TrackFileAudioPlayer";
import { canSuggestTutti } from "./tuttiSuggestions";
import type { GroupFileAssignment, GroupReviewItem } from "./types";

function TuttiFileHint({
  file,
  groupSkipped,
  matching,
  onPartChanged,
  action = false,
}: {
  readonly action?: boolean;
  readonly file: GroupFileAssignment;
  readonly groupSkipped: boolean;
  readonly matching: boolean;
  readonly onPartChanged: (part: string) => void;
}) {
  if (groupSkipped || !canSuggestTutti(file)) return null;
  if (!action)
    return (
      <p className="track-import-tutti-hint">
        <strong>Tutti · suggested</strong> — No voice part found in the filename.
      </p>
    );
  return (
    <button
      className="button button--secondary"
      type="button"
      disabled={matching}
      aria-label={`Use Tutti for ${file.fileName}`}
      onClick={(event) => {
        onPartChanged("tutti");
        event.currentTarget
          .closest(".track-import-review-file__mapping")
          ?.querySelector("select")
          ?.focus();
      }}
    >
      Use Tutti
    </button>
  );
}

function FilePartSuggestionPrompt({
  disabled,
  file,
  onDismissPartSuggestion,
  onPartChanged,
  roster,
}: {
  readonly disabled: boolean;
  readonly file: GroupFileAssignment;
  readonly onDismissPartSuggestion: () => void;
  readonly onPartChanged: (partKey: string | null) => void;
  readonly roster: OrganizationRosterConfiguration | null;
}) {
  if (!file.suggestedPartKey || file.suggestedPartKey === file.partKey) return null;

  return (
    <div className="track-import-review-file__suggestion">
      <p>
        Suggested: <strong>{voicePartLabel(file.suggestedPartKey, roster)}</strong>
        {typeof file.suggestedPartProbability === "number"
          ? ` (${String(Math.round(file.suggestedPartProbability * 100))}% confidence)`
          : ""}
        {file.partSuggestionReason === "conflict" ? " · Resolves duplicate part" : ""}
      </p>
      <div className="track-import-actions__buttons">
        <button
          className="button button--secondary button--small"
          disabled={disabled}
          type="button"
          onClick={() => {
            onPartChanged(file.suggestedPartKey ?? null);
          }}
        >
          Use suggestion
        </button>
        <button
          className="button button--ghost button--small"
          disabled={disabled}
          type="button"
          onClick={onDismissPartSuggestion}
        >
          Keep current
        </button>
      </div>
    </div>
  );
}

function FileReviewRowActions({
  canSplitGroup,
  excluded,
  file,
  groupSkipped,
  matching,
  onExclusionChanged,
  onPartChanged,
  onSplitFile,
}: {
  readonly canSplitGroup: boolean;
  readonly excluded: boolean;
  readonly file: GroupFileAssignment;
  readonly groupSkipped: boolean;
  readonly matching: boolean;
  readonly onExclusionChanged: (excluded: boolean) => void;
  readonly onPartChanged: (partKey: string | null) => void;
  readonly onSplitFile: () => void;
}) {
  return (
    <div className="track-import-review-file__actions">
      <TuttiFileHint
        action
        file={file}
        groupSkipped={groupSkipped}
        matching={matching}
        onPartChanged={onPartChanged}
      />
      <button
        aria-label={excluded ? `Restore ${file.fileName} for review` : `Skip ${file.fileName}`}
        className="button button--ghost track-import-review-file__skip"
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
  );
}

function FileReviewRow({
  duplicatePart,
  excluded,
  file,
  canSplitGroup,
  groupSkipped,
  matching,
  onDismissPartSuggestion,
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
  readonly onDismissPartSuggestion: () => void;
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
  const disabledActions = excluded || groupSkipped || matching;

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
          <span className="track-import-review-file__part-label">
            Section or voice part
            {file.partProvenance === "ai" ? (
              <span className="badge badge--accent track-import-ai-badge">AI suggested</span>
            ) : null}
          </span>
          <select
            aria-label={`Section or voice part for ${file.fileName}`}
            disabled={disabledActions}
            onChange={(event) => {
              onPartChanged(event.target.value || null);
            }}
            ref={selectRef}
            value={file.partKey ?? ""}
          >
            <option value="">Choose a section or voice part</option>
            {unavailablePart ? (
              <option disabled value={file.partKey}>
                {voicePartLabel(file.partKey, roster)} (not configured)
              </option>
            ) : null}
            {partOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
                {file.partProvenance === "ai" && file.partKey === option.key
                  ? " (AI suggested)"
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <FilePartSuggestionPrompt
          disabled={disabledActions}
          file={file}
          onDismissPartSuggestion={onDismissPartSuggestion}
          onPartChanged={onPartChanged}
          roster={roster}
        />
        <TuttiFileHint
          file={file}
          groupSkipped={groupSkipped}
          matching={matching}
          onPartChanged={onPartChanged}
        />
        <FileReviewRowActions
          canSplitGroup={canSplitGroup}
          excluded={excluded}
          file={file}
          groupSkipped={groupSkipped}
          matching={matching}
          onExclusionChanged={onExclusionChanged}
          onPartChanged={onPartChanged}
          onSplitFile={onSplitFile}
        />
      </div>
    </article>
  );
}

export function FilesSection({
  activeFileStates,
  duplicatePartKeys,
  group,
  groupState,
  matching,
  onDismissPartSuggestion,
  onFileExclusionChanged,
  onPartChanged,
  onSplitFile,
  partOptions,
  piece,
  roster,
  selectRefs,
  setSelectedGroupId,
}: {
  readonly activeFileStates: ReadonlyMap<string, ReviewState["files"][number]>;
  readonly duplicatePartKeys: ReadonlySet<string>;
  readonly group: GroupReviewItem;
  readonly groupState: ReviewState;
  readonly matching: boolean;
  readonly onDismissPartSuggestion: (groupId: string, clientFileId: string) => void;
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
        <h3>Your recordings and voice parts</h3>
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
            onDismissPartSuggestion={() => {
              onDismissPartSuggestion(group.groupId, file.clientFileId);
            }}
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
