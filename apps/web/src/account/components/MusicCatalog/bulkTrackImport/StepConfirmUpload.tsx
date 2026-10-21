import type { OrganizationMusicPiece, OrganizationRosterConfiguration } from "@choir/contracts";
import { useMemo, useState } from "react";
import type { GroupReviewItem } from "./types";
import { getReviewGroupState, getValidTrackPartKeys } from "./reviewState";
import type { ImportFileState, ImportRunResult, PlannedImportFile } from "./useImportSession";
import type { useImportSession } from "./useImportSession";

interface SkippedFile {
  readonly fileName: string;
  readonly groupTitle: string;
}

function extractPlannedAssignments(
  groups: readonly GroupReviewItem[],
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
  validPartKeys: ReadonlySet<string>,
): {
  planned: PlannedImportFile[];
  skippedCount: number;
  skippedFiles: SkippedFile[];
  isResolved: boolean;
} {
  const planned: PlannedImportFile[] = [];
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
          clientFileId: file.clientFileId,
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

function PlannedFilesTable({
  files,
}: {
  readonly files: readonly {
    readonly fileName: string;
    readonly partKey: string;
    readonly pieceId: string;
    readonly pieceTitle: string;
  }[];
}) {
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
          {files.map((p) => (
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
    return `${String(plannedCount)} reviewed tracks will upload to private storage under a recoverable import session, then attach to ${String(destinationCount)} music library pieces.`;
  }
  if (isResolved) {
    return "Every file in this batch is excluded or belongs to a skipped group. No audio will be uploaded.";
  }
  return "One or more song groups still need a valid staff review. Return to Step 2 before continuing.";
}

function ConfirmNotices({
  conflictCount,
  errorMessage,
  isResolved,
}: {
  readonly conflictCount: number;
  readonly errorMessage: string | null;
  readonly isResolved: boolean;
}) {
  return (
    <>
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
      {conflictCount > 0 ? (
        <div className="notice notice--error" role="alert">
          {String(conflictCount)} destination slots are occupied by other tracks. Review the
          conflicts in Step 2, or exclude those files before continuing.
        </div>
      ) : null}
    </>
  );
}

function UploadProgressBar({
  activeCount,
  totalCount,
}: {
  readonly activeCount: number;
  readonly totalCount: number;
}) {
  const percent = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0;
  return (
    <div className="track-import-progress-card">
      <span className="track-import-progress-card__status">
        Working through the import session…
      </span>
      <div className="track-import-progress-bar">
        <div className="track-import-progress-bar__fill" style={{ width: `${String(percent)}%` }} />
      </div>
    </div>
  );
}

function ActionButtons({
  failedCount,
  isBusy,
  isResolved,
  onBack,
  onFinishWithoutUpload,
  onRetryFailed,
  onStartUpload,
  plannedCount,
}: {
  readonly failedCount: number;
  readonly isBusy: boolean;
  readonly isResolved: boolean;
  readonly onBack: () => void;
  readonly onFinishWithoutUpload: () => void;
  readonly onRetryFailed: () => void;
  readonly onStartUpload: () => void;
  readonly plannedCount: number;
}) {
  return (
    <div className="track-import-actions__buttons">
      <button className="button button--secondary" disabled={isBusy} type="button" onClick={onBack}>
        Back
      </button>
      {failedCount > 0 && !isBusy ? (
        <button className="button button--secondary" type="button" onClick={onRetryFailed}>
          Retry {String(failedCount)} failed upload{failedCount === 1 ? "" : "s"}
        </button>
      ) : null}
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
      {plannedCount === 0 && isResolved && !isBusy ? (
        <button className="button button--primary" type="button" onClick={onFinishWithoutUpload}>
          Finish without uploading
        </button>
      ) : null}
    </div>
  );
}

function actionNote(plannedCount: number, isResolved: boolean): string {
  if (plannedCount > 0) {
    return "Audio files upload only after this confirmation. Excluded files are not sent.";
  }
  if (isResolved) {
    return "Review every included file in Step 2, or finish with the whole batch skipped.";
  }
  return "Return to Step 2 to finish reviewing the batch.";
}

function statusLabel(status: ImportFileState["status"]): string {
  switch (status) {
    case "pending":
      return "Waiting";
    case "hashing":
      return "Verifying";
    case "uploading":
      return "Uploading";
    case "uploaded":
      return "Uploaded";
    case "upload_failed":
      return "Upload failed";
    case "committed":
      return "Attached";
    case "conflict":
      return "Slot occupied";
    case "skipped":
      return "Skipped";
  }
}

function FileRecoveryTable({ files }: { readonly files: readonly ImportFileState[] }) {
  return (
    <div className="track-import-planned-table-container">
      <table className="track-import-files-table">
        <thead>
          <tr>
            <th scope="col">File name</th>
            <th scope="col">Destination</th>
            <th scope="col">Status</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.clientFileId}>
              <td className="track-import-filename-cell">{file.fileName}</td>
              <td className="track-import-piece-cell">
                {file.pieceTitle} · {file.partKey}
              </td>
              <td>
                <span
                  className={
                    file.status === "uploaded" || file.status === "committed"
                      ? "badge badge--success"
                      : file.status === "upload_failed" || file.status === "conflict"
                        ? "badge badge--warning"
                        : "badge badge--neutral"
                  }
                >
                  {statusLabel(file.status)}
                </span>
              </td>
              <td className="track-import-piece-cell">{file.error ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StepConfirmUpload({
  groups,
  onBack,
  onComplete,
  pieces,
  roster,
  session,
}: {
  readonly groups: readonly GroupReviewItem[];
  readonly onBack: () => void;
  readonly onComplete: (result: ImportRunResult, skippedCount: number) => void;
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly roster: OrganizationRosterConfiguration | null;
  readonly session: ReturnType<typeof useImportSession>;
}) {
  const [localError, setLocalError] = useState<string | null>(null);

  const pieceMap = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);
  const validPartKeys = useMemo(() => getValidTrackPartKeys(roster), [roster]);
  const { isResolved, planned, skippedCount, skippedFiles } = useMemo(
    () => extractPlannedAssignments(groups, pieceMap, validPartKeys),
    [groups, pieceMap, validPartKeys],
  );

  const isBusy = session.phase === "running";
  const showRecovery = session.files.length > 0;
  const failedCount = session.files.filter((file) => file.status === "upload_failed").length;
  const conflictCount = session.files.filter((file) => file.status === "conflict").length;
  const errorMessage = localError ?? session.errorMessage;

  async function handleStartUpload() {
    if (!isResolved || planned.length === 0 || session.phase === "running") return;
    setLocalError(null);
    try {
      const receipt = await session.confirmPlanned(planned);
      if (receipt) onComplete(receipt, skippedCount);
    } catch (error: unknown) {
      setLocalError(error instanceof Error ? error.message : "The import could not be completed.");
    }
  }

  async function handleRetryFailed() {
    const allUploaded = await session.retryUploads();
    if (!allUploaded) return;
    const receipt = await session.retryCommit();
    if (receipt) onComplete(receipt, skippedCount);
  }

  function handleFinishWithoutUpload() {
    onComplete(
      {
        commitSummary: { attached: 0, conflict: 0, failed: 0, skipped: 0 },
        manifestRevision: session.manifestRevision,
        sessionId: session.sessionId ?? "",
      },
      skippedCount,
    );
  }

  return (
    <div className="track-import-wizard-step">
      <div className="track-import-confirm-summary">
        <h3 className="track-import-confirm-title">
          {planned.length > 0 ? "Ready to upload practice tracks" : "Nothing is selected to upload"}
        </h3>
        <p className="track-import-confirm-desc">
          {getUploadSummaryDescription(
            planned.length,
            new Set(planned.map((item) => item.pieceId)).size,
            isResolved,
          )}
          {skippedCount > 0 ? ` ${String(skippedCount)} files are excluded or skipped.` : ""}
        </p>
        <ConfirmNotices
          conflictCount={conflictCount}
          errorMessage={errorMessage}
          isResolved={isResolved}
        />
        {isBusy ? (
          <UploadProgressBar activeCount={session.activeCount} totalCount={session.files.length} />
        ) : null}
        {!showRecovery && isResolved && planned.length > 0 ? (
          <PlannedFilesTable files={planned} />
        ) : null}
        {showRecovery ? <FileRecoveryTable files={session.files} /> : null}
        {!isBusy && !showRecovery ? <SkippedFilesList files={skippedFiles} /> : null}
      </div>
      <div className="dialog__actions track-import-actions">
        <span className="track-import-actions__note">{actionNote(planned.length, isResolved)}</span>
        <ActionButtons
          failedCount={failedCount}
          isBusy={isBusy}
          isResolved={isResolved}
          onBack={onBack}
          onFinishWithoutUpload={handleFinishWithoutUpload}
          onRetryFailed={() => {
            void handleRetryFailed();
          }}
          onStartUpload={() => {
            void handleStartUpload();
          }}
          plannedCount={planned.length}
        />
      </div>
    </div>
  );
}
