import type { CSSProperties, RefObject } from "react";

import { formatTime } from "../format";

export function PlayerProgress({
  currentTime,
  duration,
  onSeek,
  title,
}: {
  readonly currentTime: number;
  readonly duration: number;
  readonly onSeek: (nextTime: number) => void;
  readonly title: string;
}) {
  const safeDuration = duration > 0 ? duration : 0;
  const progressPercent =
    safeDuration > 0 ? (Math.min(currentTime, safeDuration) / safeDuration) * 100 : 0;

  return (
    <div className="public-player__progress">
      <input
        aria-label={`Seek ${title}`}
        aria-valuemax={Math.round(duration)}
        aria-valuemin={0}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
        className="public-player__scrubber"
        max={duration || 1}
        min={0}
        onChange={(event) => {
          onSeek(Number(event.target.value));
        }}
        step={0.1}
        style={{ "--range-progress": `${String(progressPercent)}%` } as CSSProperties}
        type="range"
        value={Math.min(currentTime, duration || 0)}
      />
      <div className="public-player__progress-times">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

export function PlayerTransport({
  currentIndex,
  loopMode,
  onNext,
  onPrevious,
  onTogglePlay,
  playableCount,
  playing,
}: {
  readonly currentIndex: number;
  readonly loopMode: "all" | "none" | "one";
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onTogglePlay: () => void;
  readonly playableCount: number;
  readonly playing: boolean;
}) {
  return (
    <div className="public-player__transport">
      <button
        aria-label="Previous track"
        className="button button--secondary public-player__transport-btn"
        disabled={currentIndex <= 0 && loopMode !== "all"}
        onClick={onPrevious}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="24"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="24"
        >
          <polygon points="19 20 9 12 19 4 19 20" />
          <line x1="5" x2="5" y1="19" y2="5" />
        </svg>
        <span className="sr-only">Previous track</span>
      </button>
      <button
        aria-label={playing ? "Pause" : "Play"}
        className="button button--primary public-player__play"
        onClick={onTogglePlay}
        type="button"
      >
        {playing ? (
          <svg aria-hidden="true" fill="currentColor" height="24" viewBox="0 0 24 24" width="24">
            <rect height="16" rx="1.5" width="4.5" x="5" y="4" />
            <rect height="16" rx="1.5" width="4.5" x="14.5" y="4" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            className="public-player__play-icon--play"
            fill="currentColor"
            height="24"
            viewBox="0 0 24 24"
            width="24"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        )}
        <span className="sr-only">{playing ? "Pause" : "Play"}</span>
      </button>
      <button
        aria-label="Next track"
        className="button button--secondary public-player__transport-btn"
        disabled={currentIndex >= playableCount - 1 && loopMode !== "all"}
        onClick={onNext}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="24"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="24"
        >
          <polygon points="5 4 15 12 5 20 5 4" />
          <line x1="19" x2="19" y1="5" y2="19" />
        </svg>
        <span className="sr-only">Next track</span>
      </button>
    </div>
  );
}

export function PlayerSecondaryControls({
  loopMode,
  onOpenQueue,
  onOpenSettings,
  onToggleLoop,
  queueButtonRef,
  queueCount,
  settingsButtonRef,
}: {
  readonly loopMode: "all" | "none" | "one";
  readonly onOpenQueue: () => void;
  readonly onOpenSettings: () => void;
  readonly onToggleLoop: () => void;
  readonly queueButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly queueCount: number;
  readonly settingsButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const repeatLabel =
    loopMode === "none" ? "No repeat" : loopMode === "all" ? "Repeat all" : "Repeat one";

  return (
    <div className="public-player__secondary-controls">
      <button
        aria-label={repeatLabel}
        aria-pressed={loopMode !== "none"}
        className="public-player__repeat"
        onClick={onToggleLoop}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <polyline points="17 1 21 5 17 9" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
        <span>{repeatLabel}</span>
      </button>

      <button
        aria-label={`Set list (${String(queueCount)} tracks)`}
        className="public-player__secondary-btn"
        onClick={onOpenQueue}
        ref={queueButtonRef}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <line x1="8" x2="21" y1="6" y2="6" />
          <line x1="8" x2="21" y1="12" y2="12" />
          <line x1="8" x2="21" y1="18" y2="18" />
          <line x1="3" x2="3.01" y1="6" y2="6" />
          <line x1="3" x2="3.01" y1="12" y2="12" />
          <line x1="3" x2="3.01" y1="18" y2="18" />
        </svg>
        <span>Set List ({String(queueCount)})</span>
      </button>

      <button
        aria-label="Rehearsal settings"
        className="public-player__secondary-btn"
        onClick={onOpenSettings}
        ref={settingsButtonRef}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span>Settings</span>
      </button>
    </div>
  );
}
