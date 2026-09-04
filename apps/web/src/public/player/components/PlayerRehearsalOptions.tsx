import type { PracticeTrackSource } from "../source";

export function PlayerRehearsalOptions({
  countdown,
  currentTrackFileId,
  gapSeconds,
  onChangeGapSeconds,
  onChangeStartAt,
  onChangeVolume,
  onToggleGuide,
  showGuide,
  showVolume = true,
  source,
  startAt,
  volume = 100,
}: {
  readonly countdown: number | null;
  readonly currentTrackFileId?: string;
  readonly gapSeconds: number;
  readonly onChangeGapSeconds: (gap: number) => void;
  readonly onChangeStartAt: (start: string) => void;
  readonly onChangeVolume?: (volume: number) => void;
  readonly onToggleGuide?: () => void;
  readonly showGuide?: boolean;
  readonly showVolume?: boolean;
  readonly source: PracticeTrackSource;
  readonly startAt: number;
  readonly volume?: number;
}) {
  return (
    <div className="public-player__options-container">
      <div className="public-player__options">
        <label className="public-player__option">
          <span>Start track at</span>
          <span className="public-player__inline-input">
            <input
              inputMode="decimal"
              min={0}
              onChange={(event) => {
                onChangeStartAt(event.target.value);
              }}
              step={1}
              type="number"
              value={startAt}
            />
            <small>seconds</small>
          </span>
          <small>Skips the beginning of this track every time you play it.</small>
        </label>
        {showVolume && onChangeVolume ? (
          <label className="public-player__option">
            <span className="public-player__option-heading">
              <span>Volume</span>
              <small>{String(volume)}%</small>
            </span>
            <input
              aria-label="Volume"
              max={100}
              min={0}
              onChange={(event) => {
                onChangeVolume(Number(event.target.value));
              }}
              type="range"
              value={volume}
            />
          </label>
        ) : null}
        <label className="public-player__option">
          <span>Gap between tracks</span>
          <select
            aria-label="Gap between tracks"
            onChange={(event) => {
              onChangeGapSeconds(Number(event.target.value));
            }}
            value={gapSeconds}
          >
            <option value={0}>None</option>
            <option value={2}>2 seconds</option>
            <option value={5}>5 seconds</option>
            <option value={10}>10 seconds</option>
          </select>
          <small>Adds silence before the next track starts.</small>
        </label>

        {currentTrackFileId ? (
          <div className="public-player__download-action">
            <a
              className="button button--secondary public-player__full-width-btn"
              download
              href={source.mediaUrl(currentTrackFileId)}
            >
              Download Current Track
            </a>
          </div>
        ) : null}
      </div>

      {countdown !== null ? (
        <p className="notice notice--info" role="status">
          Next track starts in {countdown} seconds.
        </p>
      ) : null}

      {onToggleGuide !== undefined ? (
        <button
          aria-expanded={showGuide}
          className="public-player__guide-toggle"
          onClick={onToggleGuide}
          type="button"
        >
          {showGuide ? "Hide control guide" : "Show control guide"}
        </button>
      ) : null}

      {showGuide ? (
        <div className="public-player__guide">
          <div>
            <strong>Start track at</strong>
            <span>Skips the beginning of this track every time you play it.</span>
          </div>
          <div>
            <strong>Gap between tracks</strong>
            <span>Adds silence before the next track starts.</span>
          </div>
          <div>
            <strong>Repeat</strong>
            <span>Choose whether to stop, repeat the set list, or repeat one track.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
