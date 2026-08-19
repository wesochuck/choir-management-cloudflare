import { useEffect, useMemo, useRef, useState } from "react";

interface PlayerPlaylistItem {
  readonly arranger?: string;
  readonly composer?: string;
  readonly durationSeconds?: number;
  readonly isFeaturedNumber?: boolean;
  readonly notes?: string;
  readonly pieceId?: string;
  readonly title: string;
  readonly trackFileIds: Record<string, string>;
}

interface PlayerDetails {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventStartsAt: string;
  readonly items: PlayerPlaylistItem[];
  readonly performerLabel?: string;
  readonly profileName?: string;
}

interface ResolvedTrack {
  readonly fallback: boolean;
  readonly fileId: string;
  readonly key: string;
}

type PageStatus =
  | { readonly type: "loading" }
  | { readonly type: "no_token" }
  | { readonly type: "not_found" }
  | { readonly type: "ready"; readonly details: PlayerDetails }
  | { readonly type: "error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isPlayerPlaylistItem(value: unknown): value is PlayerPlaylistItem {
  if (!isRecord(value) || typeof value.title !== "string" || !isStringRecord(value.trackFileIds)) {
    return false;
  }
  return (
    (value.arranger === undefined || typeof value.arranger === "string") &&
    (value.composer === undefined || typeof value.composer === "string") &&
    (value.durationSeconds === undefined || typeof value.durationSeconds === "number") &&
    (value.isFeaturedNumber === undefined || typeof value.isFeaturedNumber === "boolean") &&
    (value.notes === undefined || typeof value.notes === "string") &&
    (value.pieceId === undefined || typeof value.pieceId === "string")
  );
}

function isPlayerDetails(value: unknown): value is PlayerDetails {
  return (
    isRecord(value) &&
    typeof value.eventId === "string" &&
    typeof value.eventTitle === "string" &&
    typeof value.eventStartsAt === "string" &&
    Array.isArray(value.items) &&
    value.items.every(isPlayerPlaylistItem) &&
    (value.performerLabel === undefined || typeof value.performerLabel === "string") &&
    (value.profileName === undefined || typeof value.profileName === "string")
  );
}

async function fetchPlayerDetails(token: string): Promise<PlayerDetails> {
  const response = await fetch("/api/public/player-details", {
    body: JSON.stringify({ token }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("not_found");
  const data: unknown = await response.json();
  if (!isPlayerDetails(data)) throw new Error("invalid_response");
  return data;
}

async function fetchPublicPlayerPlaylist(token: string): Promise<PlayerDetails> {
  const response = await fetch(`/api/public/player/playlist?token=${encodeURIComponent(token)}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("not_found");
  const data: unknown = await response.json();
  if (!isRecord(data) || !isRecord(data.event) || !Array.isArray(data.pieces)) {
    throw new Error("invalid_response");
  }
  const { event } = data;
  if (
    typeof event.id !== "string" ||
    typeof event.title !== "string" ||
    typeof event.date !== "string" ||
    !data.pieces.every(isPlayerPlaylistItem)
  ) {
    throw new Error("invalid_response");
  }
  return {
    eventId: event.id,
    eventTitle: event.title,
    eventStartsAt: event.date,
    items: data.pieces,
    performerLabel: typeof data.performerLabel === "string" ? data.performerLabel : "Performer",
  };
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  });
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const wholeSeconds = Math.floor(seconds);
  return `${String(Math.floor(wholeSeconds / 60))}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function formatTrackKey(key: string): string {
  return key === "tutti" ? "Tutti" : key.toUpperCase();
}

function availableTrackKeys(items: readonly PlayerPlaylistItem[]): string[] {
  const keys = new Set(items.flatMap((item) => Object.keys(item.trackFileIds)));
  return [...keys].sort((left, right) => {
    if (left === "tutti") return -1;
    if (right === "tutti") return 1;
    return left.localeCompare(right);
  });
}

function isIndividualVoicePart(key: string): boolean {
  return /^[a-z]+\d+$/i.test(key);
}

function resolveTrack(item: PlayerPlaylistItem, requestedKey: string): ResolvedTrack | null {
  const requestedFileId = item.trackFileIds[requestedKey];
  if (requestedFileId) {
    return { fallback: false, fileId: requestedFileId, key: requestedKey };
  }
  const tuttiFileId = item.trackFileIds.tutti;
  if (tuttiFileId) {
    return { fallback: requestedKey !== "tutti", fileId: tuttiFileId, key: "tutti" };
  }
  return null;
}

function playerMediaUrl(fileId: string, token: string): string {
  return `/api/public/player/media/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`;
}

function TrackSelectionNav({
  activeTrackKey,
  onSelectTrackKey,
  trackKeys,
  voicePartKeys,
}: {
  readonly activeTrackKey: string;
  readonly onSelectTrackKey: (key: string) => void;
  readonly trackKeys: readonly string[];
  readonly voicePartKeys: readonly string[];
}) {
  return (
    <nav aria-label="Track selection" className="public-player__track-pills">
      {trackKeys.map((key) => (
        <button
          aria-pressed={activeTrackKey === key}
          className={activeTrackKey === key ? "is-active" : undefined}
          key={key}
          onClick={() => {
            onSelectTrackKey(key);
          }}
          type="button"
        >
          {formatTrackKey(key)}
        </button>
      ))}
      {voicePartKeys.length > 0 ? (
        <label className="public-player__voice-part-select">
          <span className="sr-only">Add individual part</span>
          <select
            aria-label="Add individual part"
            onChange={(event) => {
              if (event.target.value) onSelectTrackKey(event.target.value);
            }}
            value={voicePartKeys.includes(activeTrackKey) ? activeTrackKey : ""}
          >
            <option value="">Add part…</option>
            {voicePartKeys.map((key) => (
              <option key={key} value={key}>
                {formatTrackKey(key)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </nav>
  );
}

function PlayerProgressBar({
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
  return (
    <div className="public-player__progress">
      <input
        aria-label={`Seek ${title}`}
        max={duration || 1}
        min={0}
        onChange={(event) => {
          onSeek(Number(event.target.value));
        }}
        step={0.1}
        type="range"
        value={Math.min(currentTime, duration || 0)}
      />
      <div>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

function PlayerTransportControls({
  currentIndex,
  loopMode,
  onNext,
  onPrevious,
  onToggleLoop,
  onTogglePlay,
  playableCount,
  playing,
}: {
  readonly currentIndex: number;
  readonly loopMode: "all" | "none" | "one";
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onToggleLoop: () => void;
  readonly onTogglePlay: () => void;
  readonly playableCount: number;
  readonly playing: boolean;
}) {
  return (
    <div className="public-player__transport">
      <button
        aria-label="Previous track"
        className="button button--secondary button--small"
        disabled={currentIndex <= 0}
        onClick={onPrevious}
        type="button"
      >
        Previous
      </button>
      <button
        className="button button--primary public-player__play"
        onClick={onTogglePlay}
        type="button"
      >
        {playing ? "Pause" : "Play"}
      </button>
      <button
        aria-label="Next track"
        className="button button--secondary button--small"
        disabled={currentIndex >= playableCount - 1 && loopMode !== "all"}
        onClick={onNext}
        type="button"
      >
        Next
      </button>
      <button
        aria-pressed={loopMode !== "none"}
        className="public-player__repeat"
        onClick={onToggleLoop}
        type="button"
      >
        {loopMode === "none" ? "No repeat" : loopMode === "all" ? "Repeat all" : "Repeat one"}
      </button>
    </div>
  );
}

function PlayerRehearsalOptions({
  countdown,
  gapSeconds,
  onChangeGapSeconds,
  onChangeStartAt,
  onChangeVolume,
  onToggleGuide,
  showGuide,
  startAt,
  volume,
}: {
  readonly countdown: number | null;
  readonly gapSeconds: number;
  readonly onChangeGapSeconds: (gap: number) => void;
  readonly onChangeStartAt: (start: string) => void;
  readonly onChangeVolume: (volume: number) => void;
  readonly onToggleGuide: () => void;
  readonly showGuide: boolean;
  readonly startAt: number;
  readonly volume: number;
}) {
  return (
    <>
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
        <label className="public-player__option">
          <span>Gap between tracks</span>
          <select
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
        </label>
      </div>
      {countdown !== null ? (
        <p className="notice notice--info" role="status">
          Next track starts in {countdown} seconds.
        </p>
      ) : null}
      <button
        aria-expanded={showGuide}
        className="public-player__guide-toggle"
        onClick={onToggleGuide}
        type="button"
      >
        {showGuide ? "Hide control guide" : "Show control guide"}
      </button>
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
    </>
  );
}

function PlayerSetList({
  activeTrackKey,
  currentIndex,
  items,
  onSelectItem,
  playableItems,
  token,
}: {
  readonly activeTrackKey: string;
  readonly currentIndex: number;
  readonly items: readonly PlayerPlaylistItem[];
  readonly onSelectItem: (itemIndex: number) => void;
  readonly playableItems: readonly PlayerPlaylistItem[];
  readonly token: string;
}) {
  return (
    <section aria-labelledby="public-player-set-list" className="public-player__set-list">
      <div className="public-player__set-list-heading">
        <div>
          <h2 id="public-player-set-list">Set List</h2>
          <p>{String(items.length)} tracks</p>
        </div>
      </div>
      <p className="public-player__set-list-help">
        Choose a track to start practicing. Part and section tracks fall back to Tutti when a
        specific recording is not available.
      </p>
      <ol>
        {items.map((item, index) => {
          const track = resolveTrack(item, activeTrackKey);
          const itemIndex = playableItems.indexOf(item);
          const active = itemIndex === currentIndex;
          return (
            <li
              className={active ? "is-active" : undefined}
              key={item.pieceId ?? `${item.title}-${String(index)}`}
            >
              <button
                className="public-player__set-list-item"
                disabled={track === null}
                onClick={() => {
                  onSelectItem(itemIndex);
                }}
                type="button"
              >
                <span>
                  <strong>{item.title}</strong>
                  {item.composer ? <small>{item.composer}</small> : null}
                </span>
                {track ? (
                  <span className="public-player__item-track">
                    {track.fallback ? "Tutti" : formatTrackKey(track.key)}
                  </span>
                ) : (
                  <span className="public-player__item-track">Unavailable</span>
                )}
              </button>
              {track ? (
                <a
                  className="button button--secondary button--small"
                  download
                  href={playerMediaUrl(track.fileId, token)}
                >
                  Download file
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PublicPracticePlayer({
  details,
  token,
}: {
  readonly details: PlayerDetails;
  readonly token: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoplayRef = useRef(false);
  const gapTimerRef = useRef<number | null>(null);
  const [selectedTrackKey, setSelectedTrackKey] = useState("tutti");
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startAt, setStartAt] = useState(0);
  const [volume, setVolume] = useState(100);
  const [gapSeconds, setGapSeconds] = useState(0);
  const [loopMode, setLoopMode] = useState<"all" | "none" | "one">("none");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showGuide, setShowGuide] = useState(true);

  const allTrackKeys = useMemo(() => availableTrackKeys(details.items), [details.items]);
  const voicePartKeys = useMemo(
    () => allTrackKeys.filter((key) => isIndividualVoicePart(key)),
    [allTrackKeys],
  );
  const sectionTrackKeys = useMemo(() => {
    const sections = allTrackKeys.filter((key) => !isIndividualVoicePart(key));
    return sections.length > 0 ? sections : allTrackKeys.slice(0, 1);
  }, [allTrackKeys]);
  const activeTrackKey = allTrackKeys.includes(selectedTrackKey)
    ? selectedTrackKey
    : (allTrackKeys[0] ?? "tutti");
  const trackKeys = useMemo(
    () =>
      voicePartKeys.includes(activeTrackKey)
        ? [...sectionTrackKeys, activeTrackKey]
        : sectionTrackKeys,
    [activeTrackKey, sectionTrackKeys, voicePartKeys],
  );
  const playableItems = useMemo(
    () => details.items.filter((item) => resolveTrack(item, activeTrackKey) !== null),
    [activeTrackKey, details.items],
  );
  const safeSelectedItemIndex = Math.min(selectedItemIndex, Math.max(playableItems.length - 1, 0));
  const currentItem = playableItems[safeSelectedItemIndex] ?? null;
  const currentTrack = currentItem ? resolveTrack(currentItem, activeTrackKey) : null;
  const currentIndex = currentItem ? playableItems.indexOf(currentItem) : -1;
  const source = currentTrack ? playerMediaUrl(currentTrack.fileId, token) : "";

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
    setCurrentTime(0);
    setDuration(0);
  }, [source]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  useEffect(() => {
    return () => {
      if (gapTimerRef.current !== null) window.clearInterval(gapTimerRef.current);
    };
  }, []);

  function playCurrent(): void {
    void audioRef.current?.play().then(
      () => {
        setPlaying(true);
      },
      () => {
        setPlaying(false);
      },
    );
  }

  function selectItem(index: number, autoplay = true): void {
    if (index < 0 || index >= playableItems.length) return;
    if (gapTimerRef.current !== null) {
      window.clearInterval(gapTimerRef.current);
      gapTimerRef.current = null;
    }
    autoplayRef.current = autoplay;
    setSelectedItemIndex(index);
    setPlaying(autoplay);
    setCountdown(null);
  }

  function selectTrackKey(key: string): void {
    if (key === selectedTrackKey) return;
    autoplayRef.current = playing;
    setSelectedTrackKey(key);
    setSelectedItemIndex(0);
    setCountdown(null);
  }

  function nextTrack(): void {
    if (currentIndex < playableItems.length - 1) {
      selectItem(currentIndex + 1);
    } else if (loopMode === "all" && playableItems.length > 0) {
      selectItem(0);
    }
  }

  function startNextTrack(): void {
    if (gapSeconds === 0) {
      nextTrack();
      return;
    }
    setPlaying(false);
    setCountdown(gapSeconds);
    let remaining = gapSeconds;
    gapTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (gapTimerRef.current !== null) window.clearInterval(gapTimerRef.current);
        gapTimerRef.current = null;
        setCountdown(null);
        nextTrack();
      } else {
        setCountdown(remaining);
      }
    }, 1_000);
  }

  function handleEnded(): void {
    if (loopMode === "one") {
      if (audioRef.current) {
        audioRef.current.currentTime = startAt;
        playCurrent();
      }
      return;
    }
    if (currentIndex >= playableItems.length - 1 && loopMode !== "all") {
      setPlaying(false);
      return;
    }
    startNextTrack();
  }

  function togglePlay(): void {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }
    playCurrent();
  }

  function updateStartAt(value: string): void {
    const next = Math.max(0, Number(value) || 0);
    setStartAt(next);
    if (audioRef.current && duration > 0) {
      audioRef.current.currentTime = Math.min(next, duration);
      setCurrentTime(Math.min(next, duration));
    }
  }

  if (!currentItem || !currentTrack) {
    return (
      <>
        <TrackSelectionNav
          activeTrackKey={activeTrackKey}
          onSelectTrackKey={selectTrackKey}
          trackKeys={trackKeys}
          voicePartKeys={voicePartKeys}
        />
        <p className="public-player__empty" role="status">
          No practice tracks are available for this set list yet.
        </p>
      </>
    );
  }

  return (
    <>
      <TrackSelectionNav
        activeTrackKey={activeTrackKey}
        onSelectTrackKey={selectTrackKey}
        trackKeys={trackKeys}
        voicePartKeys={voicePartKeys}
      />

      <section aria-labelledby="public-player-now-playing" className="public-player__now-playing">
        <div className="public-player__track-heading">
          <div>
            <p className="eyebrow">Now playing</p>
            <h2 id="public-player-now-playing">{currentItem.title}</h2>
            <p>
              {currentTrack.fallback
                ? `Tutti fallback${currentItem.composer ? ` · ${currentItem.composer}` : ""}`
                : `${formatTrackKey(currentTrack.key)}${currentItem.composer ? ` · ${currentItem.composer}` : ""}`}
            </p>
          </div>
          <span className="public-player__track-badge">
            {formatTrackKey(currentTrack.key).toUpperCase()}
          </span>
        </div>

        <audio
          aria-label={`${currentItem.title} ${formatTrackKey(currentTrack.key)} track`}
          className="public-player__audio"
          onEnded={handleEnded}
          onLoadedMetadata={(event) => {
            const nextDuration = Number.isFinite(event.currentTarget.duration)
              ? event.currentTarget.duration
              : 0;
            const initialTime = Math.min(startAt, nextDuration);
            setDuration(nextDuration);
            setCurrentTime(initialTime);
            event.currentTarget.currentTime = initialTime;
            if (autoplayRef.current || playing) {
              autoplayRef.current = false;
              playCurrent();
            }
          }}
          onPause={() => {
            setPlaying(false);
          }}
          onPlay={() => {
            setPlaying(true);
          }}
          onTimeUpdate={(event) => {
            setCurrentTime(event.currentTarget.currentTime);
          }}
          preload="metadata"
          ref={audioRef}
          src={source}
        >
          <track kind="captions" />
        </audio>

        <PlayerProgressBar
          currentTime={currentTime}
          duration={duration}
          onSeek={(nextTime) => {
            setCurrentTime(nextTime);
            if (audioRef.current) audioRef.current.currentTime = nextTime;
          }}
          title={currentItem.title}
        />

        <PlayerTransportControls
          currentIndex={currentIndex}
          loopMode={loopMode}
          onNext={nextTrack}
          onPrevious={() => {
            selectItem(currentIndex - 1, false);
          }}
          onToggleLoop={() => {
            setLoopMode((mode) => (mode === "none" ? "all" : mode === "all" ? "one" : "none"));
          }}
          onTogglePlay={togglePlay}
          playableCount={playableItems.length}
          playing={playing}
        />

        <PlayerRehearsalOptions
          countdown={countdown}
          gapSeconds={gapSeconds}
          onChangeGapSeconds={setGapSeconds}
          onChangeStartAt={updateStartAt}
          onChangeVolume={setVolume}
          onToggleGuide={() => {
            setShowGuide((current) => !current);
          }}
          showGuide={showGuide}
          startAt={startAt}
          volume={volume}
        />
      </section>

      <PlayerSetList
        activeTrackKey={activeTrackKey}
        currentIndex={currentIndex}
        items={details.items}
        onSelectItem={(itemIndex) => {
          selectItem(itemIndex);
        }}
        playableItems={playableItems}
        token={token}
      />
    </>
  );
}

export function PublicPlayerView() {
  const location = useMemo(() => new URLSearchParams(window.location.search), []);
  const token = location.get("token");
  const isSetListPlayer = location.get("mode") === "set-list";
  const [pageStatus, setPageStatus] = useState<PageStatus>({
    type: token ? "loading" : "no_token",
  });

  useEffect(() => {
    window.history.replaceState(null, "", "/player");
    if (!token) return;
    const load = isSetListPlayer ? fetchPublicPlayerPlaylist(token) : fetchPlayerDetails(token);
    void load
      .then((details) => {
        setPageStatus({ details, type: "ready" });
      })
      .catch(() => {
        setPageStatus({ type: "not_found" });
      });
  }, [isSetListPlayer, token]);

  if (pageStatus.type === "no_token") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="player-title">
          <h1 id="player-title">Player Link Required</h1>
          <p className="notice notice--info" role="status">
            Please use the practice-player link from your Organization.
          </p>
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "loading") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="player-title">
          <h1 id="player-title">Loading practice player…</h1>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "not_found") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="player-title">
          <h1 id="player-title">Link Not Found</h1>
          <p className="notice notice--error" role="alert">
            This practice-player link is invalid or expired. Ask an Organization manager for a new
            link.
          </p>
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
        </section>
      </main>
    );
  }

  if (pageStatus.type !== "ready") return null;
  const details = pageStatus.details;

  return (
    <main className="public-player-layout">
      <section className="public-player" aria-labelledby="player-title">
        <header className="public-player__header">
          <p className="eyebrow">Practice player</p>
          <h1 id="player-title">{details.eventTitle}</h1>
          <p>{formatDate(details.eventStartsAt)}</p>
          {details.profileName ? <p>Welcome, {details.profileName}.</p> : null}
        </header>
        <PublicPracticePlayer details={details} token={token ?? ""} />
      </section>
    </main>
  );
}
