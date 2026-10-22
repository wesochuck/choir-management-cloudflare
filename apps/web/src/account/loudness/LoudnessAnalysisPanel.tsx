import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTable, type DataTableColumn, Dialog, DialogClose, NumberInput } from "@choir/ui";
import type { LoudnessFailure, OrganizationMusicPiece } from "@choir/contracts";
import {
  loudnessAnalysisEnabled,
  pauseLoudnessAnalysis,
  loudnessRequest,
  runLoudnessBatch,
  statusesSchema,
} from "./client";

import { AppLink } from "../components/AuthenticatedShell/navigation";
import { lazyWithRetry } from "../../offline/chunkRecovery";
const LoudnessRecordingRepair = lazyWithRetry(() =>
  import("./LoudnessRecordingRepair").then((module) => ({
    default: module.LoudnessRecordingRepair,
  })),
);

function invalidTargetLufs(value: number): boolean {
  return !Number.isFinite(value) || value < -30 || value > -10;
}

function formatLoudnessReason(
  reasonCode: LoudnessFailure["reasonCode"],
  status: LoudnessFailure["status"],
): string {
  if (status === "unsupported") return "Unsupported format (non-MP3)";
  switch (reasonCode) {
    case "invalid_audio":
      return "Corrupt audio data";
    case "unsupported_format":
      return "Unsupported format";
    case "processing_limit":
      return "Decode timed out (10 min)";
    case "analysis_unavailable":
      return "Decoder unavailable";
    default:
      return "Analysis failed";
  }
}

export function LoudnessAnalysisPanel({
  pieces = [],
  navigate,
  targetLufs = -18,
  savedTargetLufs = -18,
  onTargetChange,
  onSaveTarget,
  saving = false,
  onPieceSaved,
}: {
  readonly pieces?: readonly OrganizationMusicPiece[];
  readonly navigate?: (href: string) => void;
  readonly targetLufs?: number;
  readonly savedTargetLufs?: number;
  readonly onTargetChange?: (value: number) => void;
  readonly onSaveTarget?: () => void;
  readonly saving?: boolean;
  readonly onPieceSaved?: (piece: OrganizationMusicPiece) => void;
}) {
  const [repair, setRepair] = useState<LoudnessFailure | null>(null);
  const piecesByFile = useMemo(() => {
    const map = new Map<string, OrganizationMusicPiece[]>();
    for (const piece of pieces)
      for (const id of new Set(Object.values(piece.trackFileIds))) {
        const matches = map.get(id) ?? [];
        matches.push(piece);
        map.set(id, matches);
      }
    return map;
  }, [pieces]);
  const controller = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [failures, setFailures] = useState<readonly LoudnessFailure[]>([]);
  const refresh = useCallback(async () => {
    const data = statusesSchema.parse(await loudnessRequest(""));
    setSummary(
      data.statuses.map((row) => `${String(row.count)} ${row.status}`).join(" · ") ||
        "No recordings analyzed yet.",
    );
    setFailures(data.failures);
  }, []);
  useEffect(() => {
    if (!loudnessAnalysisEnabled()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      void loudnessRequest("")
        .then((value) => {
          if (cancelled) return;
          const data = statusesSchema.parse(value);
          setSummary(
            data.statuses.map((row) => `${String(row.count)} ${row.status}`).join(" · ") ||
              "No recordings analyzed yet.",
          );
          setFailures(data.failures);
        })
        .catch(() => {
          if (!cancelled) setSummary("Audio analysis status is unavailable.");
        })
        .finally(() => {
          if (!cancelled) timer = setTimeout(poll, 5000);
        });
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.current?.abort();
    };
  }, []);
  const run = useCallback(
    async (mode: "resume" | "retry_failed" | "reanalyze_all", fileId?: string) => {
      if (controller.current) return;
      const next = new AbortController();
      controller.current = next;
      setRunning(true);
      setError("");
      try {
        await runLoudnessBatch({ mode, fileId }, next.signal, setProgress);
      } catch (caught: unknown) {
        if (!next.signal.aborted)
          setError(caught instanceof Error ? caught.message : "Audio analysis failed.");
      } finally {
        setRunning(false);
        controller.current = null;
        void refresh().catch(() => undefined);
      }
    },
    [refresh],
  );

  const failureColumns: readonly DataTableColumn<LoudnessFailure>[] = useMemo(
    () => [
      {
        header: "Piece",
        id: "piece",
        mobileLabel: "Piece",
        sortValue: (row) => row.pieceTitle,
        render: (row) =>
          navigate && piecesByFile.has(row.fileId) ? (
            <div className="form-stack">
              {piecesByFile.get(row.fileId)?.map((piece) => (
                <AppLink
                  key={piece.id}
                  href={`/admin/library?${new URLSearchParams({ pieceId: piece.id, returnTo: "/admin/library/settings" }).toString()}`}
                  onNavigate={navigate}
                >
                  {piece.title}
                </AppLink>
              ))}
            </div>
          ) : (
            <span>{row.pieceTitle}</span>
          ),
      },
      {
        header: "File",
        id: "file",
        mobileLabel: "File",
        sortValue: (row) => row.fileName,
        render: (row) => <span>{row.fileName}</span>,
      },
      {
        header: "Issue",
        id: "issue",
        mobileLabel: "Issue",
        sortValue: (row) => formatLoudnessReason(row.reasonCode, row.status),
        render: (row) => <span>{formatLoudnessReason(row.reasonCode, row.status)}</span>,
      },
      {
        align: "right",
        header: "Action",
        id: "action",
        mobileLabel: "Action",
        render: (row) => (
          <div className="table-actions">
            <a
              className="button button--secondary button--small"
              download={row.fileName}
              href={`/api/organization/files/${encodeURIComponent(row.fileId)}`}
            >
              Download
            </a>
            <button
              className="button button--secondary button--small"
              type="button"
              disabled={running || !piecesByFile.has(row.fileId)}
              onClick={() => {
                setRepair(row);
              }}
              aria-label={`Replace recording ${row.fileName}`}
            >
              Replace file
            </button>
            {row.status === "failed" ? (
              <button
                aria-label={`Retry analysis for ${row.pieceTitle} - ${row.fileName}`}
                className="text-button"
                disabled={running}
                onClick={() => void run("retry_failed", row.fileId)}
                type="button"
              >
                Retry
              </button>
            ) : (
              <span className="field-help">Original volume</span>
            )}
          </div>
        ),
      },
    ],
    [navigate, piecesByFile, run, running],
  );

  if (!loudnessAnalysisEnabled()) return null;

  return (
    <fieldset aria-labelledby="audio-loudness-heading" className="music-loudness-settings">
      <legend id="audio-loudness-heading">Practice recording loudness</legend>
      <p>
        Analyze attached MP3s in this browser to bring practice volumes closer together. Originals
        and musical dynamics stay unchanged. Recordings with high peaks may remain quieter.
      </p>
      {onTargetChange ? (
        <div className="form-stack">
          <div className="field">
            <label htmlFor="practice-target-lufs">Target loudness (LUFS)</label>
            <NumberInput
              id="practice-target-lufs"
              min="-30"
              max="-10"
              step="0.5"
              value={targetLufs}
              disabled={saving}
              aria-describedby="practice-target-help"
              onChange={(event) => {
                onTargetChange(Number(event.target.value));
              }}
            />
            <p className="field-help" id="practice-target-help">
              Default: −18 LUFS. Range: −30 to −10. Less-negative values are louder. Applies when
              recordings are next loaded; existing measurements are reused. Peak protection may
              limit the result.
            </p>
          </div>
          <div className="button-row">
            <button
              className="button button--secondary"
              type="button"
              disabled={saving || targetLufs === savedTargetLufs || invalidTargetLufs(targetLufs)}
              onClick={onSaveTarget}
            >
              Save loudness target
            </button>
            <button
              className="text-button"
              type="button"
              disabled={saving || targetLufs === -18}
              onClick={() => {
                onTargetChange(-18);
              }}
            >
              Reset to −18 LUFS
            </button>
          </div>
        </div>
      ) : null}
      <p role="status">
        {summary} {progress}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="button-row">
        <button
          className="button button--secondary"
          disabled={running}
          onClick={() => void run("resume")}
          type="button"
        >
          Start / Resume analysis
        </button>
        <button
          className="button button--secondary"
          onClick={() => {
            controller.current?.abort();
            pauseLoudnessAnalysis();
          }}
          type="button"
        >
          Pause
        </button>
        <button
          className="button button--secondary"
          disabled={running}
          onClick={() => void run("retry_failed")}
          type="button"
        >
          Retry failed
        </button>
        <button
          className="button button--secondary"
          disabled={running}
          onClick={() => {
            setConfirm(true);
          }}
          type="button"
        >
          Reanalyze all
        </button>
      </div>
      {failures.length > 0 ? (
        <div className="loudness-failures form-stack">
          <h3>Failed or unsupported recordings</h3>
          <p className="field-help">
            The following recordings could not be normalized. Singers will hear them at their
            original volume.
          </p>
          <DataTable<LoudnessFailure>
            columns={failureColumns}
            emptyMessage="No failed recordings."
            initialSort={{ columnId: "piece", direction: "asc" }}
            keySelector={(row) => row.fileId}
            rows={failures}
          />
        </div>
      ) : null}
      {repair ? (
        <Suspense fallback={<p role="status">Loading recording controls…</p>}>
          <LoudnessRecordingRepair
            failure={repair}
            pieces={piecesByFile.get(repair.fileId) ?? []}
            onClose={() => {
              setRepair(null);
            }}
            onSaved={(piece) => {
              onPieceSaved?.(piece);
              void refresh().catch(() => undefined);
            }}
          />
        </Suspense>
      ) : null}
      <Dialog
        open={confirm}
        onClose={() => {
          setConfirm(false);
        }}
        title="Reanalyze all recordings"
      >
        <p>
          Replace existing measurements by analyzing every attached MP3 again? Keep this page open
          while processing.
        </p>
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Cancel
            </button>
          </DialogClose>
          <button
            className="button button--danger"
            onClick={() => {
              setConfirm(false);
              void run("reanalyze_all");
            }}
            type="button"
          >
            Reanalyze all
          </button>
        </div>
      </Dialog>
    </fieldset>
  );
}
