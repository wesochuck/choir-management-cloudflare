import type {
  MusicTrackAttachmentAssignment,
  MusicTrackAttachmentResult,
  OrganizationMusicPiece,
} from "@choir/contracts";
import { useId, useMemo, useState } from "react";
import { uploadPrivateOrganizationFile } from "../../../../api/files";
import { attachBulkPracticeTracks } from "../../../../api/music";
import type { GroupReviewItem, UploadProgressState } from "./types";

interface PlannedAssignment {
  readonly durationSeconds: number | null;
  readonly file: File;
  readonly fileName: string;
  readonly partKey: string;
  readonly pieceId: string;
  readonly pieceTitle: string;
}

function extractPlannedAssignments(
  groups: readonly GroupReviewItem[],
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
): { planned: PlannedAssignment[]; skippedCount: number } {
  const planned: PlannedAssignment[] = [];
  let skippedCount = 0;

  for (const group of groups) {
    if (!group.selectedPieceId) {
      skippedCount += group.files.length;
      continue;
    }
    const piece = pieceMap.get(group.selectedPieceId);
    for (const file of group.files) {
      if (!file.partKey) {
        skippedCount += 1;
      } else {
        planned.push({
          durationSeconds: file.durationSeconds,
          file: file.file,
          fileName: file.fileName,
          partKey: file.partKey,
          pieceId: group.selectedPieceId,
          pieceTitle: piece?.title ?? "Unknown Piece",
        });
      }
    }
  }

  return { planned, skippedCount };
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

export function StepConfirmUpload({
  groups,
  onBack,
  onComplete,
  pieces,
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
  const { planned, skippedCount } = useMemo(
    () => extractPlannedAssignments(groups, pieceMap),
    [groups, pieceMap],
  );

  async function handleStartUpload() {
    setErrorMessage(null);
    setProgress({
      completed: 0,
      currentFileName: planned[0]?.fileName ?? null,
      status: "uploading",
      total: planned.length,
    });

    try {
      const uploadedAssignments: MusicTrackAttachmentAssignment[] = [];
      const concurrency = 3;
      let nextIndex = 0;
      let completedCount = 0;

      async function worker() {
        while (nextIndex < planned.length) {
          const idx = nextIndex++;
          const item = planned[idx];
          if (!item) break;

          setProgress((prev) => ({
            ...prev,
            currentFileName: item.fileName,
          }));

          const uploaded = await uploadPrivateOrganizationFile(item.file, item.fileName);
          uploadedAssignments[idx] = {
            durationSeconds: item.durationSeconds,
            expectedEmptySlot: true,
            fileId: uploaded.id,
            partKey: item.partKey,
            pieceId: item.pieceId,
          };
          completedCount += 1;
          setProgress((prev) => ({
            ...prev,
            completed: completedCount,
          }));
        }
      }

      const workers = Array.from({ length: Math.min(concurrency, planned.length) }, () => worker());
      await Promise.all(workers);

      setProgress((prev) => ({
        ...prev,
        status: "attaching",
      }));

      const response = await attachBulkPracticeTracks({
        assignments: uploadedAssignments,
        idempotencyKey,
      });

      setProgress((prev) => ({
        ...prev,
        status: "complete",
      }));

      onComplete(response.results, response.summary);
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
      <div className="track-import-confirm-summary">
        <h3 className="track-import-confirm-title">Ready to upload practice tracks</h3>
        <p className="track-import-confirm-desc">
          {String(planned.length)} tracks will be uploaded to private storage and attached to{" "}
          {String(new Set(planned.map((p) => p.pieceId)).size)} music library pieces.
          {skippedCount > 0 ? ` ${String(skippedCount)} files will be skipped.` : ""}
        </p>

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
                    progress.total > 0
                      ? Math.round((progress.completed / progress.total) * 100)
                      : 0,
                  )}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {!isBusy && progress.status !== "complete" ? <PlannedFilesTable planned={planned} /> : null}
      </div>

      <div className="dialog__actions track-import-actions">
        <span className="track-import-actions__note">
          Audio files are uploaded directly to Organization private storage.
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
          <button
            className="button button--primary"
            disabled={isBusy || planned.length === 0}
            type="button"
            onClick={() => {
              void handleStartUpload();
            }}
          >
            {isBusy ? "Uploading…" : `Upload & attach ${String(planned.length)} tracks`}
          </button>
        </div>
      </div>
    </div>
  );
}
