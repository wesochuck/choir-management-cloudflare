import { useEffect, useRef } from "react";
import type { useTuttiSuggestions } from "./useTuttiSuggestions";

export function TuttiSuggestions({
  actions,
  matching,
}: {
  readonly actions: ReturnType<typeof useTuttiSuggestions>;
  readonly matching: boolean;
}) {
  const applyRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<"apply" | "undo" | null>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === "apply") applyRef.current?.focus();
    if (target === "undo") undoRef.current?.focus();
  });
  if (actions.count === 0 && !actions.canUndo) return null;
  return (
    <section aria-label="Tutti suggestions" className="track-import-tutti-suggestions">
      <div>
        <strong>Tutti for unlabeled recordings</strong>
        <p>
          Use Tutti where no voice part was detected, then review each group. Conflicts still
          require a choice.
        </p>
      </div>
      {actions.count > 0 ? (
        <button
          className="button button--secondary"
          type="button"
          disabled={matching}
          ref={applyRef}
          onClick={() => {
            pendingFocus.current = "undo";
            actions.apply();
          }}
        >
          Use Tutti for {actions.count} unlabeled {actions.count === 1 ? "recording" : "recordings"}
        </button>
      ) : null}
      {actions.canUndo ? (
        <div role="status">
          Tutti applied. Later edits and reviewed groups will be kept.
          <button
            className="button button--ghost"
            type="button"
            disabled={matching}
            ref={undoRef}
            onClick={() => {
              pendingFocus.current = "apply";
              actions.undo();
            }}
          >
            Undo Tutti assignments
          </button>
        </div>
      ) : null}
    </section>
  );
}
