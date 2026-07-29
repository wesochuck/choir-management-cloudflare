import type { OrganizationEvent, SingerLearningTrackPiece } from "@choir/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { AuthApiError, listOrganizationEvents, listSingerLearningTracks } from "../auth/api";
import {
  listOfflineAudioIds,
  offlineAudioUrl,
  removeOfflineAudio,
  saveOfflineAudio,
} from "../offline/mediaStore";

interface LearningTrack {
  readonly fileId: string;
  readonly key: string;
  readonly parentTitle: string | null;
  readonly piece: SingerLearningTrackPiece;
}

type LoopMode = "all" | "none" | "one";

function tracksFrom(pieces: readonly SingerLearningTrackPiece[]): LearningTrack[] {
  const titles = new Map(pieces.map(({ id, title }) => [id, title]));
  return pieces.flatMap((piece) =>
    Object.entries(piece.trackFileIds).map(([key, fileId]) => ({
      fileId,
      key,
      parentTitle: piece.parentId ? (titles.get(piece.parentId) ?? null) : null,
      piece,
    })),
  );
}

function trackLabel(key: string): string {
  return key === "tutti" ? "Tutti / full mix" : key;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${String(Math.floor(seconds / 60))}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function pieceIdsForEvent(event: OrganizationEvent): ReadonlySet<string> {
  return new Set(event.setList.flatMap((item) => (item.pieceId ? [item.pieceId] : [])));
}

function trackBelongsToPiece(track: LearningTrack, pieceId: string): boolean {
  return track.piece.id === pieceId || track.piece.parentId === pieceId;
}

// eslint-disable-next-line complexity -- this is the standalone practice player and its controls.
export function LearningTrackPlayer({ enabled }: { readonly enabled: boolean }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const eventId = params.get("eventId");
  const pieceId = params.get("pieceId");
  const scope = window.location.host;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const countdownRef = useRef<number | null>(null);
  const [pieces, setPieces] = useState<readonly SingerLearningTrackPiece[]>([]);
  const [eventTitle, setEventTitle] = useState<string | null>(null);
  const [focusedPieceIds, setFocusedPieceIds] = useState<ReadonlySet<string> | null>(null);
  const [offlineIds, setOfflineIds] = useState<ReadonlySet<string>>(new Set());
  const [offlineUrls, setOfflineUrls] = useState<Readonly<Record<string, string>>>({});
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [voiceFilter, setVoiceFilter] = useState("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loopMode, setLoopMode] = useState<LoopMode>("none");
  const [gapSeconds, setGapSeconds] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const eventsRequest = eventId
      ? listOrganizationEvents(controller.signal)
      : Promise.resolve<readonly OrganizationEvent[]>([]);
    void Promise.allSettled([listSingerLearningTracks(controller.signal), eventsRequest]).then(
      async ([piecesResult, eventsResult]) => {
        if (controller.signal.aborted) return;
        if (piecesResult.status !== "fulfilled") {
          const caught: unknown = piecesResult.reason;
          setError(
            caught instanceof AuthApiError
              ? caught.message
              : "The Organization practice library could not be loaded.",
          );
          setLoaded(true);
          return;
        }
        const tracks = tracksFrom(piecesResult.value);
        const downloaded = await listOfflineAudioIds(scope).catch(() => new Set<string>());
        const urls = Object.fromEntries(
          (
            await Promise.all(
              tracks
                .filter(({ fileId }) => downloaded.has(fileId))
                .map(async ({ fileId }) => [fileId, await offlineAudioUrl(scope, fileId)] as const),
            )
          ).flatMap(([fileId, url]) => (url ? [[fileId, url] as const] : [])),
        );
        setPieces(piecesResult.value);
        setOfflineIds(downloaded);
        setOfflineUrls(urls);
        if (eventId && eventsResult.status === "fulfilled") {
          const event = eventsResult.value.find(({ id }) => id === eventId);
          if (event) {
            setEventTitle(event.title);
            setFocusedPieceIds(pieceIdsForEvent(event));
          }
        }
        setLoaded(true);
      },
    );
    return () => {
      controller.abort();
    };
  }, [enabled, eventId, scope]);

  const tracks = useMemo(() => tracksFrom(pieces), [pieces]);
  const focusedTracks = useMemo(() => {
    if (pieceId) {
      const matching = tracks.filter((track) => trackBelongsToPiece(track, pieceId));
      if (matching.length > 0) return matching;
    }
    if (focusedPieceIds && focusedPieceIds.size > 0) {
      const matching = tracks.filter((track) =>
        [...focusedPieceIds].some((id) => trackBelongsToPiece(track, id)),
      );
      if (matching.length > 0) return matching;
    }
    return tracks;
  }, [focusedPieceIds, pieceId, tracks]);
  const voiceParts = useMemo(
    () => [...new Set(focusedTracks.map(({ key }) => key))].toSorted(),
    [focusedTracks],
  );
  const visibleTracks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return focusedTracks.filter((track) => {
      const matchesVoice = voiceFilter === "all" || track.key === voiceFilter;
      const matchesSearch =
        !normalized ||
        `${track.piece.title} ${track.piece.composer} ${track.piece.arranger}`
          .toLocaleLowerCase()
          .includes(normalized);
      return matchesVoice && matchesSearch;
    });
  }, [focusedTracks, query, voiceFilter]);
  const safeSelectedIndex = Math.min(selectedIndex, Math.max(visibleTracks.length - 1, 0));
  const currentTrack = visibleTracks[safeSelectedIndex] ?? visibleTracks[0] ?? null;
  const currentTrackIndex = currentTrack ? visibleTracks.indexOf(currentTrack) : -1;
  const source = currentTrack
    ? (offlineUrls[currentTrack.fileId] ?? `/api/organization/files/${currentTrack.fileId}`)
    : "";

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.load();
    }
  }, [source]);

  useEffect(() => {
    return () => {
      if (countdownRef.current !== null) window.clearInterval(countdownRef.current);
    };
  }, []);

  function playCurrent(): void {
    void audioRef.current?.play().then(
      () => {
        setIsPlaying(true);
      },
      () => {
        setIsPlaying(false);
        setError("This track could not be played. Check the audio file or your connection.");
      },
    );
  }

  function togglePlay(): void {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      playCurrent();
    }
  }

  function selectTrack(index: number, autoplay = true): void {
    if (index < 0 || index >= visibleTracks.length) return;
    setSelectedIndex(index);
    setIsPlaying(autoplay);
    setCountdown(null);
  }

  function nextTrack(): void {
    if (currentTrackIndex < visibleTracks.length - 1) {
      selectTrack(currentTrackIndex + 1);
    } else if (loopMode === "all" && visibleTracks.length > 0) {
      selectTrack(0);
    }
  }

  function previousTrack(): void {
    if (currentTrackIndex > 0) selectTrack(currentTrackIndex - 1, false);
  }

  function handleEnded(): void {
    if (loopMode === "one") {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        playCurrent();
      }
      return;
    }
    if (currentTrackIndex >= visibleTracks.length - 1 && loopMode !== "all") {
      setIsPlaying(false);
      return;
    }
    if (gapSeconds === 0) {
      nextTrack();
      return;
    }
    setIsPlaying(false);
    setCountdown(gapSeconds);
    let remaining = gapSeconds;
    countdownRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (countdownRef.current !== null) window.clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdown(null);
        nextTrack();
      } else {
        setCountdown(remaining);
      }
    }, 1_000);
  }

  async function save(track: LearningTrack): Promise<void> {
    setBusyFileId(track.fileId);
    setError(null);
    try {
      await saveOfflineAudio(scope, track.fileId, `/api/organization/files/${track.fileId}`);
      const url = await offlineAudioUrl(scope, track.fileId);
      setOfflineIds((current) => new Set([...current, track.fileId]));
      if (url) setOfflineUrls((current) => ({ ...current, [track.fileId]: url }));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The track could not be saved offline.");
    } finally {
      setBusyFileId(null);
    }
  }

  async function remove(track: LearningTrack): Promise<void> {
    setBusyFileId(track.fileId);
    setError(null);
    try {
      await removeOfflineAudio(scope, track.fileId);
      setOfflineIds((current) => new Set([...current].filter((id) => id !== track.fileId)));
      setOfflineUrls((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => id !== track.fileId)),
      );
    } catch {
      setError("The offline copy could not be removed.");
    } finally {
      setBusyFileId(null);
    }
  }

  if (!enabled) return null;
  const title = eventTitle ? `Practice player · ${eventTitle}` : "Practice player";
  return (
    <section className="account-section practice-player" aria-labelledby="practice-player-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Practice</p>
        <h2 id="practice-player-title">{title}</h2>
        <p className="section-description">
          Play learning tracks one at a time, switch voice parts, and rehearse without opening a
          separate audio tab.
        </p>
      </div>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {!loaded ? <p>Loading learning tracks…</p> : null}
      {loaded && tracks.length === 0 ? (
        <p className="empty-state">No private learning tracks are available yet.</p>
      ) : null}
      {loaded && tracks.length > 0 ? (
        <>
          <div className="practice-player__filters">
            <label className="field">
              Search tracks
              <input
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Search title or composer"
                type="search"
                value={query}
              />
            </label>
            <div className="practice-player__voice-filter" aria-label="Voice part filter">
              <span className="field-label">Voice part</span>
              <div className="button-row">
                <button
                  className={`button button--small ${voiceFilter === "all" ? "button--primary" : "button--secondary"}`}
                  onClick={() => {
                    setVoiceFilter("all");
                  }}
                  type="button"
                >
                  All
                </button>
                {voiceParts.map((part) => (
                  <button
                    className={`button button--small ${voiceFilter === part ? "button--primary" : "button--secondary"}`}
                    key={part}
                    onClick={() => {
                      setVoiceFilter(part);
                    }}
                    type="button"
                  >
                    {part === "tutti" ? "Tutti" : part.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {currentTrack ? (
            <div className="practice-player__now-playing">
              <div className="practice-player__track-heading">
                <div>
                  <p className="eyebrow">Now playing</p>
                  <h3>{currentTrack.piece.title}</h3>
                  <p>
                    {trackLabel(currentTrack.key)}
                    {currentTrack.parentTitle ? ` · From ${currentTrack.parentTitle}` : ""}
                    {currentTrack.piece.composer ? ` · ${currentTrack.piece.composer}` : ""}
                  </p>
                </div>
                <span className="status-pill">
                  {currentTrackIndex + 1} / {visibleTracks.length}
                </span>
              </div>
              <audio
                ref={audioRef}
                controls
                onEnded={handleEnded}
                onLoadedMetadata={(event) => {
                  setCurrentTime(0);
                  setDuration(event.currentTarget.duration);
                  if (isPlaying) {
                    void event.currentTarget.play().catch(() => {
                      setIsPlaying(false);
                    });
                  }
                }}
                onPause={() => {
                  setIsPlaying(false);
                }}
                onPlay={() => {
                  setIsPlaying(true);
                }}
                onTimeUpdate={(event) => {
                  setCurrentTime(event.currentTarget.currentTime);
                }}
                preload="metadata"
                src={source}
              >
                <track kind="captions" />
              </audio>
              <div className="practice-player__controls">
                <button className="button button--secondary" onClick={previousTrack} type="button">
                  Previous
                </button>
                <button className="button button--primary" onClick={togglePlay} type="button">
                  {isPlaying ? "Pause" : "Play"}
                </button>
                <button className="button button--secondary" onClick={nextTrack} type="button">
                  Next
                </button>
                <button
                  className="button button--secondary"
                  onClick={() => {
                    setLoopMode((mode) =>
                      mode === "none" ? "all" : mode === "all" ? "one" : "none",
                    );
                  }}
                  type="button"
                >
                  {loopMode === "none"
                    ? "No repeat"
                    : loopMode === "all"
                      ? "Repeat all"
                      : "Repeat one"}
                </button>
              </div>
              <div className="practice-player__options">
                <label className="field">
                  Position
                  <input
                    max={duration || 0}
                    min={0}
                    onChange={(event) => {
                      const nextTime = Number(event.target.value);
                      setCurrentTime(nextTime);
                      if (audioRef.current) audioRef.current.currentTime = nextTime;
                    }}
                    step={0.1}
                    type="range"
                    value={currentTime}
                  />
                  <span className="field-help">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </label>
                <label className="field">
                  Gap between tracks
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
            </div>
          ) : (
            <p className="empty-state">No tracks match the current filters.</p>
          )}
          <ol className="practice-player__playlist" aria-label="Practice tracks">
            {visibleTracks.map((track, index) => {
              const saved = offlineIds.has(track.fileId);
              return (
                <li
                  className={
                    index === currentTrackIndex ? "practice-player__playlist-item--active" : ""
                  }
                  key={`${track.piece.id}-${track.key}`}
                >
                  <button
                    className="practice-player__playlist-select"
                    onClick={() => {
                      selectTrack(index);
                    }}
                    type="button"
                  >
                    <span className="practice-player__playlist-number">{index + 1}</span>
                    <span>
                      <strong>{track.piece.title}</strong>
                      <small>
                        {trackLabel(track.key)}
                        {track.piece.composer ? ` · ${track.piece.composer}` : ""}
                      </small>
                    </span>
                  </button>
                  <div className="button-row">
                    {saved ? <span className="status-pill">Saved offline</span> : null}
                    <button
                      className="text-button"
                      disabled={busyFileId !== null}
                      onClick={() => void (saved ? remove(track) : save(track))}
                      type="button"
                    >
                      {busyFileId === track.fileId
                        ? "Working…"
                        : saved
                          ? "Remove offline"
                          : "Save offline"}
                    </button>
                    <a
                      className="text-button"
                      download
                      href={`/api/organization/files/${track.fileId}`}
                    >
                      Download
                    </a>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </section>
  );
}
