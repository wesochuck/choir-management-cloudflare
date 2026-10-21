import { useEffect, useRef, useState } from "react";
import { Dialog, DialogClose } from "@choir/ui";
import {
  loudnessAnalysisEnabled,
  pauseLoudnessAnalysis,
  loudnessRequest,
  runLoudnessBatch,
  statusesSchema,
} from "./client";

export function LoudnessAnalysisPanel() {
  const controller = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  async function refresh() {
    const data = statusesSchema.parse(await loudnessRequest(""));
    setSummary(
      data.statuses.map((row) => `${String(row.count)} ${row.status}`).join(" · ") ||
        "No recordings analyzed yet.",
    );
  }
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
        })
        .catch(() => {
          if (!cancelled) setError("Audio analysis status is unavailable.");
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
  if (!loudnessAnalysisEnabled()) return null;
  async function run(mode: "resume" | "retry_failed" | "reanalyze_all") {
    if (controller.current) return;
    const next = new AbortController();
    controller.current = next;
    setRunning(true);
    setError("");
    try {
      await runLoudnessBatch({ mode }, next.signal, setProgress);
    } catch (caught: unknown) {
      if (!next.signal.aborted)
        setError(caught instanceof Error ? caught.message : "Audio analysis failed.");
    } finally {
      setRunning(false);
      controller.current = null;
      void refresh().catch(() => undefined);
    }
  }
  return (
    <section aria-labelledby="audio-loudness-heading" className="section-card">
      <h2 id="audio-loudness-heading">Practice recording loudness</h2>
      <p>
        Analyze attached MP3s in this browser to bring practice volumes closer together. Originals
        and musical dynamics stay unchanged. Recordings with high peaks may remain quieter.
      </p>
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
    </section>
  );
}
