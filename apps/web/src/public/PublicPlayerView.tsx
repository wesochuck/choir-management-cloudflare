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

// eslint-disable-next-line complexity -- this player keeps transport and rehearsal controls together.
function PublicPracticePlayer({
  details,
  token,
}: {
  readonly details: PlayerDetails;
  readonly token: string;
}) {
  const performerLabel = details.performerLabel ?? "Performer";
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
  const [loopMode, setLoopMode] = useState<"none" | "all" | "one">("none");
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
        <div className="public-player__track-pills" aria-label="Track selection">
          {trackKeys.map((key) => (
            <button
              aria-pressed={activeTrackKey === key}
              className={activeTrackKey === key ? "is-active" : undefined}
              key={key}
              type="button"
              onClick={() => {
                selectTrackKey(key);
              }}
            >
              {formatTrackKey(key)}
            </button>
          ))}
          {voicePartKeys.length > 0 ? (
            <label className="public-player__voice-part-select">
              <span className="sr-only">Add individual {performerLabel.toLowerCase()}</span>
              <select
                aria-label={`Add individual ${performerLabel.toLowerCase()}`}
                value={voicePartKeys.includes(activeTrackKey) ? activeTrackKey : ""}
                onChange={(event) => {
                  if (event.target.value) selectTrackKey(event.target.value);
                }}
              >
                <option value="">Add {performerLabel.toLowerCase()}…</option>
                {voicePartKeys.map((key) => (
                  <option key={key} value={key}>
                    {formatTrackKey(key)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <p className="public-player__empty" role="status">
          No practice tracks are available for this set list yet.
        </p>
      </>
    );
  }

  return (
    <>
      <nav className="public-player__track-pills" aria-label="Track selection">
        {trackKeys.map((key) => (
          <button
            aria-pressed={activeTrackKey === key}
            className={activeTrackKey === key ? "is-active" : undefined}
            key={key}
            type="button"
            onClick={() => {
              selectTrackKey(key);
            }}
          >
            {formatTrackKey(key)}
          </button>
        ))}
        {voicePartKeys.length > 0 ? (
          <label className="public-player__voice-part-select">
            <span className="sr-only">Add individual {performerLabel.toLowerCase()}</span>
            <select
              aria-label={`Add individual ${performerLabel.toLowerCase()}`}
              value={voicePartKeys.includes(activeTrackKey) ? activeTrackKey : ""}
              onChange={(event) => {
                if (event.target.value) selectTrackKey(event.target.value);
              }}
            >
              <option value="">Add {performerLabel.toLowerCase()}…</option>
              {voicePartKeys.map((key) => (
                <option key={key} value={key}>
                  {formatTrackKey(key)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </nav>

      <section className="public-player__now-playing" aria-labelledby="public-player-now-playing">
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
          preload="metadata"
          ref={audioRef}
          src={source}
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
        >
          <track kind="captions" />
        </audio>

        <div className="public-player__progress">
          <input
            aria-label={`Seek ${currentItem.title}`}
            max={duration || 1}
            min={0}
            step={0.1}
            type="range"
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => {
              const next = Number(event.target.value);
              setCurrentTime(next);
              if (audioRef.current) audioRef.current.currentTime = next;
            }}
          />
          <div>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="public-player__transport">
          <button
            aria-label="Previous track"
            className="button button--secondary button--small"
            disabled={currentIndex <= 0}
            type="button"
            onClick={() => {
              selectItem(currentIndex - 1, false);
            }}
          >
            Previous
          </button>
          <button
            className="button button--primary public-player__play"
            type="button"
            onClick={togglePlay}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button
            aria-label="Next track"
            className="button button--secondary button--small"
            disabled={currentIndex >= playableItems.length - 1 && loopMode !== "all"}
            type="button"
            onClick={nextTrack}
          >
            Next
          </button>
          <button
            aria-pressed={loopMode !== "none"}
            className="public-player__repeat"
            type="button"
            onClick={() => {
              setLoopMode((mode) => (mode === "none" ? "all" : mode === "all" ? "one" : "none"));
            }}
          >
            {loopMode === "none" ? "No repeat" : loopMode === "all" ? "Repeat all" : "Repeat one"}
          </button>
        </div>

        <div className="public-player__options">
          <label className="public-player__option">
            <span>Start track at</span>
            <span className="public-player__inline-input">
              <input
                inputMode="decimal"
                min={0}
                step={1}
                type="number"
                value={startAt}
                onChange={(event) => {
                  updateStartAt(event.target.value);
                }}
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
              type="range"
              value={volume}
              onChange={(event) => {
                setVolume(Number(event.target.value));
              }}
            />
          </label>
          <label className="public-player__option">
            <span>Gap between tracks</span>
            <select
              value={gapSeconds}
              onChange={(event) => {
                setGapSeconds(Number(event.target.value));
              }}
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
          type="button"
          onClick={() => {
            setShowGuide((current) => !current);
          }}
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
      </section>

      <section className="public-player__set-list" aria-labelledby="public-player-set-list">
        <div className="public-player__set-list-heading">
          <div>
            <h2 id="public-player-set-list">Set List</h2>
            <p>{String(details.items.length)} tracks</p>
          </div>
        </div>
        <p className="public-player__set-list-help">
          Choose a track to start practicing. Part and section tracks fall back to Tutti when a
          specific recording is not available.
        </p>
        <ol>
          {details.items.map((item, index) => {
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
                  type="button"
                  onClick={() => {
                    selectItem(itemIndex);
                  }}
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
