import { useState } from "react";

import type { OrganizationMusicPiece } from "@choir/contracts";
import type { ImportCommitSummary, ImportFileState } from "./useImportSession";

interface PieceActivityResult {
  readonly attachedParts: readonly string[];
  readonly conflictedParts: readonly string[];
  readonly failedParts: readonly string[];
  readonly pieceId: string;
  readonly pieceTitle: string;
}

function statusBadgeClass(status: ImportFileState["status"]): string {
  switch (status) {
    case "committed":
      return "badge badge--success";
    case "conflict":
    case "upload_failed":
      return "badge badge--warning";
    default:
      return "badge badge--neutral";
  }
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
      return "Needs retry";
    case "committed":
      return "Attached";
    case "conflict":
      return "Slot occupied";
    case "skipped":
      return "Skipped";
  }
}

function ResultStatCards({
  actionableConflict,
  summary,
}: {
  readonly actionableConflict: number;
  readonly summary: ImportCommitSummary;
}) {
  return (
    <div className="track-import-stat-cards">
      <div className="track-import-stat-card track-import-stat-card--success">
        <span className="track-import-stat-card__number">{String(summary.attached)}</span>
        <div className="track-import-stat-card__text">
          <span className="track-import-stat-card__label">Tracks attached</span>
          <span className="track-import-stat-card__desc">New practice recordings</span>
        </div>
      </div>

      <div className="track-import-stat-card track-import-stat-card--neutral">
        <span className="track-import-stat-card__number">{String(summary.skipped)}</span>
        <div className="track-import-stat-card__text">
          <span className="track-import-stat-card__label">Files skipped</span>
          <span className="track-import-stat-card__desc">Not sent or attached</span>
        </div>
      </div>

      <div className="track-import-stat-card track-import-stat-card--warning">
        <span className="track-import-stat-card__number">
          {String(summary.conflict + actionableConflict)}
        </span>
        <div className="track-import-stat-card__text">
          <span className="track-import-stat-card__label">Slots protected</span>
          <span className="track-import-stat-card__desc">Existing files untouched</span>
        </div>
      </div>
    </div>
  );
}

function FileOutcomeTable({ files }: { readonly files: readonly ImportFileState[] }) {
  if (files.length === 0) {
    return (
      <p className="track-import-empty-results">
        The reviewed batch contains no files to upload. The skipped files were not sent to storage.
      </p>
    );
  }
  return (
    <div className="track-import-activity-section">
      <h4 className="track-import-activity-title">Per-file outcome</h4>
      <div className="track-import-activity-table-container">
        <table className="track-import-files-table">
          <thead>
            <tr>
              <th scope="col">File name</th>
              <th scope="col">Destination</th>
              <th scope="col">Result</th>
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
                  <span className={statusBadgeClass(file.status)}>{statusLabel(file.status)}</span>
                </td>
                <td className="track-import-piece-cell">{file.error ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActivityTable({
  activityList,
  onOpenPiece,
  pieceMap,
}: {
  readonly activityList: readonly PieceActivityResult[];
  readonly onOpenPiece: ((pieceId: string) => void) | undefined;
  readonly pieceMap: ReadonlyMap<string, OrganizationMusicPiece>;
}) {
  if (activityList.length === 0) return null;
  return (
    <div className="track-import-activity-section">
      <h4 className="track-import-activity-title">Import activity</h4>
      <div className="track-import-activity-table-container">
        <table className="track-import-files-table">
          <thead>
            <tr>
              <th scope="col">Music library piece</th>
              <th scope="col">Track assignments</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {activityList.map((item) => (
              <tr key={item.pieceId}>
                <td className="track-import-piece-cell">
                  {onOpenPiece && pieceMap.has(item.pieceId) ? (
                    <button
                      className="text-button text-link"
                      type="button"
                      onClick={() => {
                        onOpenPiece(item.pieceId);
                      }}
                    >
                      {item.pieceTitle}
                    </button>
                  ) : (
                    item.pieceTitle
                  )}
                </td>
                <td className="track-import-assignments-cell">
                  {[
                    ...item.attachedParts,
                    ...item.conflictedParts.map((p) => `${p} (conflict)`),
                    ...item.failedParts.map((p) => `${p} (failed)`),
                  ].join(", ") || "None"}
                </td>
                <td className="track-import-result-badge-cell">
                  {item.conflictedParts.length > 0 || item.failedParts.length > 0 ? (
                    <span className="badge badge--warning">
                      {String(item.conflictedParts.length + item.failedParts.length)} need attention
                    </span>
                  ) : (
                    <span className="badge badge--success">
                      {String(item.attachedParts.length)} attached
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecoveryNotices({
  actionableConflict,
  actionableFailed,
}: {
  readonly actionableConflict: number;
  readonly actionableFailed: number;
}) {
  return (
    <>
      {actionableFailed > 0 ? (
        <div className="notice notice--error" role="alert">
          {String(actionableFailed)} file{actionableFailed === 1 ? "" : "s"} failed to upload.
          Already uploaded files are kept and will not be sent again.
        </div>
      ) : null}
      {actionableConflict > 0 ? (
        <div className="notice notice--error" role="alert">
          {String(actionableConflict)} destination slot{actionableConflict === 1 ? "" : "s"} became
          occupied. Remap those files to free slots in Step 2, then confirm again.
        </div>
      ) : null}
    </>
  );
}

function RecoveryActions({
  actionableConflict,
  actionableFailed,
  allSkipped,
  awaitingAttach,
  busyAction,
  confirmingDiscard,
  onCloseAndResume,
  onDiscard,
  onFinish,
  onReviewConflicts,
  onRetryAttach,
  onRetryUploads,
  onToggleDiscard,
}: {
  readonly actionableConflict: number;
  readonly actionableFailed: number;
  readonly allSkipped: boolean;
  readonly awaitingAttach: boolean;
  readonly busyAction: string | null;
  readonly confirmingDiscard: boolean;
  readonly onCloseAndResume: () => void;
  readonly onDiscard: () => Promise<void>;
  readonly onFinish: () => void;
  readonly onReviewConflicts: () => void;
  readonly onRetryAttach: () => Promise<void>;
  readonly onRetryUploads: () => Promise<void>;
  readonly onToggleDiscard: (confirming: boolean) => void;
}) {
  const showResume =
    !allSkipped && (actionableFailed > 0 || actionableConflict > 0 || awaitingAttach);
  return (
    <div className="dialog__actions track-import-actions">
      <span className="track-import-actions__note">
        {allSkipped
          ? "No audio was uploaded."
          : "Tracks are now accessible in practice players and the Music Library."}
      </span>
      <div className="track-import-actions__buttons">
        {actionableFailed > 0 ? (
          <button
            className="button button--secondary"
            disabled={busyAction !== null}
            type="button"
            onClick={() => {
              void onRetryUploads();
            }}
          >
            {busyAction === "retry-uploads"
              ? "Retrying…"
              : `Retry ${String(actionableFailed)} upload${actionableFailed === 1 ? "" : "s"}`}
          </button>
        ) : null}
        {awaitingAttach ? (
          <button
            className="button button--secondary"
            disabled={busyAction !== null}
            type="button"
            onClick={() => {
              void onRetryAttach();
            }}
          >
            {busyAction === "retry-attach" ? "Attaching…" : "Retry attach"}
          </button>
        ) : null}
        {actionableConflict > 0 ? (
          <button
            className="button button--secondary"
            disabled={busyAction !== null}
            type="button"
            onClick={onReviewConflicts}
          >
            Review conflicts in Step 2
          </button>
        ) : null}
        {showResume ? (
          <button
            className="button button--secondary"
            disabled={busyAction !== null}
            type="button"
            onClick={onCloseAndResume}
          >
            Close and resume later
          </button>
        ) : null}
        {confirmingDiscard ? (
          <>
            <button
              className="button button--secondary"
              disabled={busyAction !== null}
              type="button"
              onClick={() => {
                onToggleDiscard(false);
              }}
            >
              Cancel
            </button>
            <button
              className="button button--danger"
              disabled={busyAction !== null}
              type="button"
              onClick={() => {
                void onDiscard();
              }}
            >
              Confirm discard
            </button>
          </>
        ) : (
          <button
            className="button button--secondary"
            disabled={busyAction !== null}
            type="button"
            onClick={() => {
              onToggleDiscard(true);
            }}
          >
            Discard import
          </button>
        )}
        <button className="button button--primary" type="button" onClick={onFinish}>
          Return to Music Library
        </button>
      </div>
    </div>
  );
}

/**
 * Import outcome with recovery. Every action here reuses the server session:
 * retries never re-upload bytes that are already stored, conflicts return to
 * Step 2 for remapping, and closing keeps the session resumable until it is
 * explicitly discarded.
 */
export function StepResults({
  files,
  onCloseAndResume,
  onDiscard,
  onFinish,
  onOpenPiece,
  onRetryAttach,
  onRetryUploads,
  onReviewConflicts,
  pieces,
  summary,
}: {
  readonly files: readonly ImportFileState[];
  readonly onCloseAndResume: () => void;
  readonly onDiscard: () => Promise<void>;
  readonly onFinish: () => void;
  readonly onOpenPiece?: ((pieceId: string) => void) | undefined;
  readonly onRetryAttach: () => Promise<void>;
  readonly onRetryUploads: () => Promise<void>;
  readonly onReviewConflicts: () => void;
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly summary: ImportCommitSummary;
}) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const pieceMap = new Map(pieces.map((p) => [p.id, p]));

  const affectedPieceIds = Array.from(new Set(files.map((f) => f.pieceId)));
  const activityList: PieceActivityResult[] = affectedPieceIds.map((pieceId) => {
    const pieceFiles = files.filter((r) => r.pieceId === pieceId);
    const piece = pieceMap.get(pieceId);
    return {
      attachedParts: pieceFiles.filter((r) => r.status === "committed").map((r) => r.partKey),
      conflictedParts: pieceFiles.filter((r) => r.status === "conflict").map((r) => r.partKey),
      failedParts: pieceFiles.filter((r) => r.status === "upload_failed").map((r) => r.partKey),
      pieceId,
      pieceTitle: piece?.title ?? "Unknown Piece",
    };
  });

  const actionableFailed = files.filter((file) => file.status === "upload_failed").length;
  const actionableConflict = files.filter((file) => file.status === "conflict").length;
  const awaitingAttach =
    actionableFailed === 0 &&
    actionableConflict === 0 &&
    files.some((file) => file.status === "uploaded");
  const hasConflicts = summary.conflict > 0 || actionableConflict > 0;
  const allSkipped =
    summary.attached === 0 && summary.failed === 0 && !hasConflicts && actionableFailed === 0;

  async function runAction(name: string, action: () => Promise<void>): Promise<void> {
    setBusyAction(name);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="track-import-wizard-step">
      <div className="track-import-results-header">
        <h3 className="track-import-results-title">
          {allSkipped ? "No tracks uploaded" : "Import completed"}
        </h3>
        {allSkipped ? (
          <span className="badge badge--neutral">All files skipped</span>
        ) : hasConflicts || summary.failed > 0 || actionableFailed > 0 ? (
          <span className="badge badge--warning">Partial success</span>
        ) : (
          <span className="badge badge--success">Completed successfully</span>
        )}
      </div>

      <ResultStatCards actionableConflict={actionableConflict} summary={summary} />
      <FileOutcomeTable files={files} />
      <ActivityTable activityList={activityList} onOpenPiece={onOpenPiece} pieceMap={pieceMap} />
      <RecoveryNotices
        actionableConflict={actionableConflict}
        actionableFailed={actionableFailed}
      />

      <div className="notice notice--success track-import-safety-banner" role="status">
        <span aria-hidden="true" className="track-import-check-icon">
          ✓
        </span>
        <span>
          {allSkipped
            ? "No files were uploaded, and no preexisting practice-track assignments were changed."
            : "No preexisting practice-track assignments or recordings were replaced or deleted."}
        </span>
      </div>

      <RecoveryActions
        actionableConflict={actionableConflict}
        actionableFailed={actionableFailed}
        allSkipped={allSkipped}
        awaitingAttach={awaitingAttach}
        busyAction={busyAction}
        confirmingDiscard={confirmingDiscard}
        onCloseAndResume={onCloseAndResume}
        onDiscard={() => runAction("discard", onDiscard)}
        onFinish={onFinish}
        onReviewConflicts={onReviewConflicts}
        onRetryAttach={() => runAction("retry-attach", onRetryAttach)}
        onRetryUploads={() => runAction("retry-uploads", onRetryUploads)}
        onToggleDiscard={setConfirmingDiscard}
      />
    </div>
  );
}
