import { analyzeUploadedTrack } from "../../../loudness/client";
import type {
  MusicTrackAttachmentAssignment,
  MusicTrackAttachmentResult,
  OrganizationMusicPiece,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { useId, useMemo, useState } from "react";
import { uploadPrivateOrganizationFile } from "../../../../api/files";
import { attachBulkPracticeTracks } from "../../../../api/music";
import type { GroupReviewItem, UploadProgressState } from "./types";
import { getReviewGroupState, getValidTrackPartKeys } from "./reviewState";

interface PlannedAssignment {
  readonly durationSeconds: number | null;
  readonly file: File;
  readonly fileName: string;
  readonly partKey: string;
  readonly pieceId: string;
  readonly pieceTitle: string;
}

interface SkippedFile {
  readonly fileName: string;
  readonly groupTitle: string;
}

async function uploadAndAttachReviewedTracks(
  planned: readonly PlannedAssignment[],
  idempotencyKey: string,
  onUploadProgress: (fileName: string, completed: number) => void,
  onAttaching: () => void,
) {
  const uploadedAssignments: (MusicTrackAttachmentAssignment | undefined)[] = [];
  const concurrency = 3;
  let nextIndex = 0;
  let completedCount = 0;

  async function uploadWorker(): Promise<void> {
    while (nextIndex < planned.length) {
      const index = nextIndex++;
      const item = planned[index];
      if (!item) break;

      const uploaded = await uploadPrivateOrganizationFile(item.file, item.fileName);
      uploadedAssignments[index] = {
        durationSeconds: item.durationSeconds,
        expectedEmptySlot: true,
        fileId: uploaded.id,
        partKey: item.partKey,
        pieceId: item.pieceId,
      };
      completedCount += 1;
      onUploadProgress(item.fileName, completedCount);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, planned.length) }, () =>
    uploadWorker(),
  );
  await Promise.all(workers);
  onAttaching();

  const completeAssignments = planned.map((_, index) => {
    const assignment = uploadedAssignments[index];
    if (!assignment) throw new Error("An uploaded track is missing its attachment details");
    return assignment;
  });

  const result = await attachBulkPracticeTracks({
    assignments: completeAssignments,
    idempotencyKey,
  });
  const attached = new Set(
    result.results.filter((row) => row.status === "attached").map((row) => row.fileId),
  );
  for (let index = 0; index < planned.length; index++) {
    const item = planned[index];
    const assignment = completeAssignments[index];
    if (item && assignment && attached.has(assignment.fileId))
      analyzeUploadedTrack(assignment.fileId, item.file);
  }
  return result;
}

function extractPlannedAssignments(
  groups: readonly GroupReviewItem[],
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
  validPartKeys: ReadonlySet<string>,
): {
  planned: PlannedAssignment[];
  skippedCount: number;
  skippedFiles: SkippedFile[];
  isResolved: boolean;
} {
  const planned: PlannedAssignment[] = [];
  const skippedFiles: SkippedFile[] = [];
  let skippedCount = 0;
  let isResolved = true;

  for (const group of groups) {
    const reviewState = getReviewGroupState(group, pieceMap, validPartKeys);
    if (reviewState.groupStatus === "skipped") {
      skippedCount += group.files.length;
      skippedFiles.push(
        ...group.files.map((file) => ({
          fileName: file.fileName,
          groupTitle: group.inferredTitle,
        })),
      );
      continue;
    }
    if (reviewState.groupStatus !== "reviewed") {
      isResolved = false;
      continue;
    }
    if (!group.selectedPieceId) {
      isResolved = false;
      continue;
    }
    const piece = pieceMap.get(group.selectedPieceId);
    const fileStateById = new Map(
      reviewState.files.map((fileState) => [fileState.clientFileId, fileState]),
    );
    for (const file of group.files) {
      const fileState = fileStateById.get(file.clientFileId);
      if (fileState?.status === "excluded") {
        skippedCount += 1;
        skippedFiles.push({ fileName: file.fileName, groupTitle: group.inferredTitle });
      } else if (fileState?.status === "ready" && file.partKey && group.selectedPieceId) {
        planned.push({
          durationSeconds: file.durationSeconds,
          file: file.file,
          fileName: file.fileName,
          partKey: file.partKey,
          pieceId: group.selectedPieceId,
          pieceTitle: piece?.title ?? "Unknown Piece",
        });
      } else {
        isResolved = false;
      }
    }
  }

  return { isResolved, planned, skippedCount, skippedFiles };
}

function PlannedFilesTable({ planned }: { readonly planned: readonly PlannedAssignment[] }) {
  return (
    <div className="track-import-planned-table-container">
      <table className="track-import-files-table">
        <thead>
          <tr>
            <th scope="col">File name</th>
            <th scope="col">Voice part</th>
            <th scope="col">Destination piece</th>
          </tr>
        </thead>
        <tbody>
          {planned.map((p) => (
            <tr key={`${p.pieceId}-${p.fileName}`}>
              <td className="track-import-filename-cell">{p.fileName}</td>
              <td className="track-import-part-cell">
                <span className="badge badge--accent">{p.partKey}</span>
              </td>
              <td className="track-import-piece-cell">{p.pieceTitle}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SkippedFilesList({ files }: { readonly files: readonly SkippedFile[] }) {
  if (files.length === 0) return null;
  return (
    <section className="track-import-skipped-files" aria-label="Excluded and skipped files">
      <h4>Excluded or skipped files ({String(files.length)})</h4>
      <ul>
        {files.map((file, index) => (
          <li key={`${file.groupTitle}-${file.fileName}-${String(index)}`}>
            <strong>{file.fileName}</strong>
            <span>{file.groupTitle}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function getUploadSummaryDescription(
  plannedCount: number,
  destinationCount: number,
  isResolved: boolean,
): string {
  if (plannedCount > 0) {
    return `${String(plannedCount)} reviewed tracks will be uploaded to private storage and attached to ${String(destinationCount)} music library pieces.`;
  }
  if (isResolved) {
    return "Every file in this batch is excluded or belongs to a skipped group. No audio will be uploaded.";
  }
  return "One or more song groups still need a valid staff review. Return to Step 2 before continuing.";
}

function UploadConfirmationSummary({
  errorMessage,
  isBusy,
  isResolved,
  planned,
  progress,
  skippedCount,
  skippedFiles,
}: {
  readonly errorMessage: string | null;
  readonly isBusy: boolean;
  readonly isResolved: boolean;
  readonly planned: readonly PlannedAssignment[];
  readonly progress: UploadProgressState;
  readonly skippedCount: number;
  readonly skippedFiles: readonly SkippedFile[];
}) {
  const destinationCount = new Set(planned.map((item) => item.pieceId)).size;
  return (
    <div className="track-import-confirm-summary">
      <h3 className="track-import-confirm-title">
        {planned.length > 0 ? "Ready to upload practice tracks" : "Nothing is selected to upload"}
      </h3>
      <p className="track-import-confirm-desc">
        {getUploadSummaryDescription(planned.length, destinationCount, isResolved)}
        {skippedCount > 0 ? ` ${String(skippedCount)} files are excluded or skipped.` : ""}
      </p>
      {!isResolved ? (
        <div className="notice notice--error" role="alert">
          Some groups no longer have a valid staff review. Return to Step 2 and review every
          included file again.
        </div>
      ) : null}
      {errorMessage ? (
        <div className="notice notice--error" role="alert">
          {errorMessage}
        </div>
      ) : null}
      {isBusy ? (
        <div className="track-import-progress-card">
          <span className="track-import-progress-card__status">
            {progress.status === "uploading"
              ? `Uploading ${progress.currentFileName ?? "files"} (${String(progress.completed)} of ${String(progress.total)})`
              : "Attaching tracks to library pieces…"}
          </span>
          <div className="track-import-progress-bar">
            <div
              className="track-import-progress-bar__fill"
              style={{
                width: `${String(
                  progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0,
                )}%`,
              }}
            />
          </div>
        </div>
      ) : null}
      {!isBusy && progress.status !== "complete" && planned.length > 0 ? (
        <PlannedFilesTable planned={planned} />
      ) : null}
      {!isBusy && progress.status !== "complete" ? <SkippedFilesList files={skippedFiles} /> : null}
    </div>
  );
}

function UploadActionFooter({
  isBusy,
  isResolved,
  onBack,
  onFinishSkipped,
  onStartUpload,
  plannedCount,
}: {
  readonly isBusy: boolean;
  readonly isResolved: boolean;
  readonly onBack: () => void;
  readonly onFinishSkipped: () => void;
  readonly onStartUpload: () => void;
  readonly plannedCount: number;
}) {
  return (
    <div className="dialog__actions track-import-actions">
      <span className="track-import-actions__note">
        {plannedCount > 0
          ? "Audio files upload only after this confirmation. Excluded files are not sent."
          : isResolved
            ? "Review every included file in Step 2, or finish with the whole batch skipped."
            : "Return to Step 2 to finish reviewing the batch."}
      </span>
      <div className="track-import-actions__buttons">
        <button
          className="button button--secondary"
          disabled={isBusy}
          type="button"
          onClick={onBack}
        >
          Back
        </button>
        {plannedCount > 0 ? (
          <button
            className="button button--primary"
            disabled={isBusy || !isResolved}
            type="button"
            onClick={onStartUpload}
          >
            {isBusy ? "Uploading…" : `Upload & attach ${String(plannedCount)} tracks`}
          </button>
        ) : null}
        {plannedCount === 0 && isResolved ? (
          <button className="button button--primary" type="button" onClick={onFinishSkipped}>
            Finish without uploading
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function StepConfirmUpload({
  groups,
  onBack,
  onComplete,
  pieces,
  roster,
}: {
  readonly groups: readonly GroupReviewItem[];
  readonly onBack: () => void;
  readonly onComplete: (
    results: readonly MusicTrackAttachmentResult[],
    summary: {
      readonly attached: number;
      readonly conflict: number;
      readonly failed: number;
      readonly skipped: number;
    },
  ) => void;
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly roster: OrganizationRosterConfiguration | null;
}) {
  const [progress, setProgress] = useState<UploadProgressState>({
    completed: 0,
    currentFileName: null,
    status: "idle",
    total: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const idempotencyKey = useId();

  const pieceMap = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);
  const validPartKeys = useMemo(() => getValidTrackPartKeys(roster), [roster]);
  const { isResolved, planned, skippedCount, skippedFiles } = useMemo(
    () => extractPlannedAssignments(groups, pieceMap, validPartKeys),
    [groups, pieceMap, validPartKeys],
  );

  async function handleStartUpload() {
    if (!isResolved || planned.length === 0) return;

    setErrorMessage(null);
    setProgress({
      completed: 0,
      currentFileName: planned[0]?.fileName ?? null,
      status: "uploading",
      total: planned.length,
    });

    try {
      const response = await uploadAndAttachReviewedTracks(
        planned,
        idempotencyKey,
        (fileName, completed) => {
          setProgress((previous) => ({ ...previous, completed, currentFileName: fileName }));
        },
        () => {
          setProgress((previous) => ({ ...previous, status: "attaching" }));
        },
      );

      setProgress((prev) => ({
        ...prev,
        status: "complete",
      }));

      onComplete(response.results, {
        ...response.summary,
        skipped: response.summary.skipped + skippedCount,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to upload and attach tracks";
      setErrorMessage(msg);
      setProgress((prev) => ({
        ...prev,
        status: "error",
      }));
    }
  }

  const isBusy = progress.status === "uploading" || progress.status === "attaching";

  return (
    <div className="track-import-wizard-step">
      <UploadConfirmationSummary
        errorMessage={errorMessage}
        isBusy={isBusy}
        isResolved={isResolved}
        planned={planned}
        progress={progress}
        skippedCount={skippedCount}
        skippedFiles={skippedFiles}
      />
      <UploadActionFooter
        isBusy={isBusy}
        isResolved={isResolved}
        onBack={onBack}
        onFinishSkipped={() => {
          onComplete([], { attached: 0, conflict: 0, failed: 0, skipped: skippedCount });
        }}
        onStartUpload={() => {
          void handleStartUpload();
        }}
        plannedCount={planned.length}
      />
    </div>
  );
}
