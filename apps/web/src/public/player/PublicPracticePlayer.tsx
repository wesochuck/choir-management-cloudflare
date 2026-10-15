import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { Sheet } from "@choir/ui";

import { PlayerArtwork, PlayerTrackMetadata } from "./components/PlayerArtwork";
import { PlayerPartSelector } from "./components/PlayerPartSelector";
import {
  PlayerProgress,
  PlayerSecondaryControls,
  PlayerTransport,
} from "./components/PlayerProgress";
import { PlayerRehearsalOptions } from "./components/PlayerRehearsalOptions";
import { PlayerSetList } from "./components/PlayerSetList";
import {
  availableTrackKeys,
  formatTrackKey,
  resolveTrack,
  resolveTrackKey,
  updateMediaSessionPosition,
} from "./format";
import type { PracticeTrackSource } from "./source";
import type { PlayerDetails, PlayerPlaylistItem, ResolvedTrack } from "./types";
import { useAudioSession, type AudioSessionHandlers } from "./useAudioSession";
import { useAutoCacheOfflineCopies, useOfflineAudioUrl } from "./usePlayerOffline";
import { useOfflineCopies } from "../../offline/useOfflineCopies";

function OfflineStatusNotices({
  blockedFileId,
  currentFileId,
  onRetryPlayback,
  online,
  saveError,
}: {
  readonly blockedFileId: string | null;
  readonly currentFileId: string | undefined;
  readonly onRetryPlayback: () => void;
  readonly online: boolean;
  readonly saveError: boolean;
}) {
  const showOfflineBlocked = !online && blockedFileId !== null && blockedFileId === currentFileId;
  const showOnlinePlaybackError =
    online && blockedFileId !== null && blockedFileId === currentFileId;
  return (
    <>
      {showOfflineBlocked ? (
        <p className="notice notice--warning" role="status">
          This track isn&apos;t saved offline. Reconnect to download it.
        </p>
      ) : null}
      {showOnlinePlaybackError ? (
        <div className="notice notice--error" role="alert">
          <p>This track could not be played. Check your connection or audio source.</p>
          <button
            className="button button--secondary button--small mt-2"
            onClick={onRetryPlayback}
            type="button"
          >
            Retry audio
          </button>
        </div>
      ) : null}
      {saveError ? (
        <p className="notice notice--error" role="alert">
          This track couldn&apos;t be saved offline. Try again while online.
        </p>
      ) : null}
    </>
  );
}

function findInitialSelectedItemIndex(
  items: readonly PlayerPlaylistItem[],
  initialPieceId?: string,
  initialTrackKey?: string,
): number {
  if (!initialPieceId) return 0;
  const initialKey = initialTrackKey?.trim() ? initialTrackKey.trim() : "all";
  const initialPlayable = items.filter((item) => resolveTrack(item, initialKey) !== null);
  const found = initialPlayable.findIndex((item) => item.pieceId === initialPieceId);
  return found >= 0 ? found : 0;
}

function resolveSelectedTrackKey(
  userOverrideTrackKey: string | null,
  initialTrackKey: string | undefined,
  allTrackKeys: readonly string[],
  trackLabels?: Record<string, string>,
): string {
  if (userOverrideTrackKey !== null) return userOverrideTrackKey;
  if (initialTrackKey) {
    return resolveTrackKey(allTrackKeys, initialTrackKey, trackLabels) ?? initialTrackKey;
  }
  return allTrackKeys[0] ?? "tutti";
}

function computeActiveTrackKey(
  selectedTrackKey: string,
  allTrackKeys: readonly string[],
  hasInitialTrackKey: boolean,
): string {
  if (allTrackKeys.includes(selectedTrackKey) || hasInitialTrackKey) {
    return selectedTrackKey;
  }
  return allTrackKeys[0] ?? "tutti";
}

function computeAudioSrc(
  offlineUrl: string | null,
  currentTrack: { readonly fileId: string } | null,
  source: PracticeTrackSource,
): string {
  if (offlineUrl) return offlineUrl;
  if (currentTrack) return source.mediaUrl(currentTrack.fileId);
  return "";
}

interface PlayerAudioProps {
  readonly audioRef: React.RefObject<HTMLAudioElement | null>;
  readonly audioSrc: string;
  readonly autoplayRef: React.RefObject<boolean>;
  readonly currentItem: PlayerPlaylistItem | null;
  readonly currentTrack: ResolvedTrack | null;
  readonly duration: number;
  readonly handleAudioError: (event: SyntheticEvent<HTMLAudioElement>) => void;
  readonly handleEnded: () => void;
  readonly playCurrent: () => void;
  readonly playing: boolean;
  readonly setCurrentTime: (time: number) => void;
  readonly setDuration: (duration: number) => void;
  readonly setPlaying: (playing: boolean) => void;
  readonly startAt: number;
}

function PlayerAudio({
  audioRef,
  audioSrc,
  autoplayRef,
  currentItem,
  currentTrack,
  duration,
  handleAudioError,
  handleEnded,
  playCurrent,
  playing,
  setCurrentTime,
  setDuration,
  setPlaying,
  startAt,
}: PlayerAudioProps) {
  if (!currentItem || !currentTrack) return null;
  return (
    <audio
      aria-label={`${currentItem.title} ${formatTrackKey(currentTrack.key)} track`}
      className="public-player__audio"
      onEnded={handleEnded}
      onError={handleAudioError}
      onLoadedMetadata={(event) => {
        const nextDuration = Number.isFinite(event.currentTarget.duration)
          ? event.currentTarget.duration
          : 0;
        const initialTime = Math.min(startAt, nextDuration);
        setDuration(nextDuration);
        setCurrentTime(initialTime);
        event.currentTarget.currentTime = initialTime;
        updateMediaSessionPosition(initialTime, nextDuration, event.currentTarget);
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
        const time = event.currentTarget.currentTime;
        setCurrentTime(time);
        updateMediaSessionPosition(time, duration, event.currentTarget);
      }}
      preload="metadata"
      ref={audioRef}
      src={audioSrc}
    >
      <track kind="captions" />
    </audio>
  );
}

interface PlayerPlaybackControlsProps {
  readonly activeTrackKey: string;
  readonly blockedFileId: string | null;
  readonly currentIndex: number;
  readonly currentItem: PlayerPlaylistItem | null;
  readonly currentTrack: ResolvedTrack | null;
  readonly currentTime: number;
  readonly duration: number;
  readonly handleRetryPlayback: () => void;
  readonly handleSeek: (time: number) => void;
  readonly loopMode: "all" | "none" | "one";
  readonly nextTrack: () => void;
  readonly online: boolean;
  readonly playableCount: number;
  readonly playing: boolean;
  readonly previousTrack: () => void;
  readonly saveError: boolean;
  readonly togglePlay: () => void;
}

function PlayerPlaybackControls({
  activeTrackKey,
  blockedFileId,
  currentIndex,
  currentItem,
  currentTrack,
  currentTime,
  duration,
  handleRetryPlayback,
  handleSeek,
  loopMode,
  nextTrack,
  online,
  playableCount,
  playing,
  previousTrack,
  saveError,
  togglePlay,
}: PlayerPlaybackControlsProps) {
  if (!currentItem || !currentTrack) {
    return (
      <p className="public-player__empty" role="status">
        No practice tracks are available for this set list yet.
      </p>
    );
  }

  return (
    <>
      <PlayerTrackMetadata
        activeTrackKey={activeTrackKey}
        currentTrack={currentTrack}
        item={currentItem}
      />
      <OfflineStatusNotices
        blockedFileId={blockedFileId}
        currentFileId={currentTrack.fileId}
        onRetryPlayback={handleRetryPlayback}
        online={online}
        saveError={saveError}
      />
      <PlayerProgress
        currentTime={currentTime}
        duration={duration}
        onSeek={handleSeek}
        title={currentItem.title}
      />
      <PlayerTransport
        currentIndex={currentIndex}
        loopMode={loopMode}
        onNext={nextTrack}
        onPrevious={previousTrack}
        onTogglePlay={togglePlay}
        playableCount={playableCount}
        playing={playing}
      />
    </>
  );
}

interface PlayerSecondaryControlsWrapperProps {
  readonly hasTrack: boolean;
  readonly loopMode: "all" | "none" | "one";
  readonly onOpenQueue: () => void;
  readonly onOpenSettings: () => void;
  readonly onToggleLoop: () => void;
  readonly queueButtonRef: React.RefObject<HTMLButtonElement | null>;
  readonly queueCount: number;
  readonly settingsButtonRef: React.RefObject<HTMLButtonElement | null>;
}

function PlayerSecondaryControlsWrapper({
  hasTrack,
  loopMode,
  onOpenQueue,
  onOpenSettings,
  onToggleLoop,
  queueButtonRef,
  queueCount,
  settingsButtonRef,
}: PlayerSecondaryControlsWrapperProps) {
  if (!hasTrack) return null;
  return (
    <PlayerSecondaryControls
      loopMode={loopMode}
      onOpenQueue={onOpenQueue}
      onOpenSettings={onOpenSettings}
      onToggleLoop={onToggleLoop}
      queueButtonRef={queueButtonRef}
      queueCount={queueCount}
      settingsButtonRef={settingsButtonRef}
    />
  );
}

export function PublicPracticePlayer({
  details,
  initialPieceId,
  initialTrackKey,
  onTrackKeyChange,
  source,
}: {
  readonly details: PlayerDetails;
  readonly initialPieceId?: string | undefined;
  readonly initialTrackKey?: string | undefined;
  readonly onTrackKeyChange?: ((key: string) => void) | undefined;
  readonly source: PracticeTrackSource;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoplayRef = useRef(false);
  const gapTimerRef = useRef<number | null>(null);
  const queueButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);

  const [prevInitialPieceId, setPrevInitialPieceId] = useState(initialPieceId);
  const [selectedItemIndex, setSelectedItemIndex] = useState(() =>
    findInitialSelectedItemIndex(details.items, initialPieceId, initialTrackKey),
  );
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startAt, setStartAt] = useState(0);
  const [volume, setVolume] = useState(100);
  const [gapSeconds, setGapSeconds] = useState(0);
  const [loopMode, setLoopMode] = useState<"all" | "none" | "one">("none");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showGuide, setShowGuide] = useState(true);
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [blockedFileId, setBlockedFileId] = useState<string | null>(null);
  const [pendingOfflineIds, setPendingOfflineIds] = useState<ReadonlySet<string>>(new Set());
  const [saveError, setSaveError] = useState(false);

  const scope = typeof window === "undefined" ? "" : window.location.host;
  const {
    acquireOfflineUrl,
    ensureOfflineCopies,
    offlineIds,
    online,
    removeOfflineCopy,
    resolveOfflineUrl,
    saveOfflineCopy,
  } = useOfflineCopies({ scope, source });

  const allTrackKeys = useMemo(() => availableTrackKeys(details.items), [details.items]);
  const [userOverrideTrackKey, setUserOverrideTrackKey] = useState<string | null>(null);

  const selectedTrackKey = useMemo(
    () =>
      resolveSelectedTrackKey(
        userOverrideTrackKey,
        initialTrackKey,
        allTrackKeys,
        details.trackLabels,
      ),
    [allTrackKeys, details.trackLabels, initialTrackKey, userOverrideTrackKey],
  );

  const activeTrackKey = useMemo(
    () => computeActiveTrackKey(selectedTrackKey, allTrackKeys, Boolean(initialTrackKey)),
    [allTrackKeys, initialTrackKey, selectedTrackKey],
  );
  const playableItems = useMemo(
    () => details.items.filter((item) => resolveTrack(item, activeTrackKey) !== null),
    [activeTrackKey, details.items],
  );
  if (initialPieceId && initialPieceId !== prevInitialPieceId) {
    setPrevInitialPieceId(initialPieceId);
    const found = playableItems.findIndex((item) => item.pieceId === initialPieceId);
    if (found >= 0) {
      setSelectedItemIndex(found);
    }
  }
  const safeSelectedItemIndex = Math.min(selectedItemIndex, Math.max(playableItems.length - 1, 0));
  const currentItem = playableItems[safeSelectedItemIndex] ?? null;
  const currentTrack = currentItem ? resolveTrack(currentItem, activeTrackKey) : null;
  const currentIndex = currentItem ? playableItems.indexOf(currentItem) : -1;
  const offlineUrl = useOfflineAudioUrl(
    resolveOfflineUrl,
    currentTrack?.fileId,
    offlineIds,
    acquireOfflineUrl,
  );
  const audioSrc = computeAudioSrc(offlineUrl, currentTrack, source);
  const eventArtworkUrl = details.eventArtworkFileId
    ? source.artworkUrl(details.eventArtworkFileId)
    : null;

  useAutoCacheOfflineCopies(scope, details.items, activeTrackKey, ensureOfflineCopies);

  const prevEventIdRef = useRef(details.eventId);
  useEffect(() => {
    if (prevEventIdRef.current !== details.eventId) {
      prevEventIdRef.current = details.eventId;
      if (gapTimerRef.current !== null) {
        window.clearInterval(gapTimerRef.current);
        gapTimerRef.current = null;
      }
      setPlaying(false);
      setCountdown(null);
      setBlockedFileId(null);
      const targetIndex = initialPieceId
        ? Math.max(
            0,
            playableItems.findIndex((item) => item.pieceId === initialPieceId),
          )
        : 0;
      setSelectedItemIndex(targetIndex >= 0 ? targetIndex : 0);
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
  }, [details.eventId, initialPieceId, playableItems]);

  useEffect(() => {
    if ("audioSession" in navigator) {
      try {
        navigator.audioSession.type = "playback";
      } catch {
        // Non-blocking fallback
      }
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
    setCurrentTime(0);
    setDuration(0);
  }, [audioSrc]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  useEffect(() => {
    return () => {
      if (gapTimerRef.current !== null) window.clearInterval(gapTimerRef.current);
    };
  }, []);

  function playCurrent(): void {
    if (userOverrideTrackKey === null) {
      setUserOverrideTrackKey(selectedTrackKey);
    }
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
    setBlockedFileId(null);
  }

  function selectTrackKey(key: string): void {
    if (key === selectedTrackKey) return;
    setUserOverrideTrackKey(key);
    autoplayRef.current = playing;
    setSelectedItemIndex(0);
    setCountdown(null);
    setBlockedFileId(null);
    onTrackKeyChange?.(key);
  }

  function handleSaveOfflineCopy(fileId: string): void {
    setPendingOfflineIds((current) => new Set(current).add(fileId));
    setSaveError(false);
    void saveOfflineCopy(fileId)
      .catch(() => {
        setSaveError(true);
      })
      .finally(() => {
        setPendingOfflineIds((current) => {
          const next = new Set(current);
          next.delete(fileId);
          return next;
        });
      });
  }

  function handleRemoveOfflineCopy(fileId: string): void {
    void removeOfflineCopy(fileId).catch(() => {
      // Removal is best-effort; the pill clears on the next successful refresh.
    });
  }

  function handleAudioError(event: SyntheticEvent<HTMLAudioElement>): void {
    if (!currentTrack) return;
    // Cached tracks are already saved locally and must never trigger an offline-missing notice.
    if (offlineUrl || offlineIds.has(currentTrack.fileId)) return;
    // Ignore stale failures from a previous track: only the current source may raise the notice.
    const expected = source.mediaUrl(currentTrack.fileId);
    const failed = event.currentTarget.currentSrc;
    if (failed) {
      try {
        const base = window.location.href;
        if (new URL(failed, base).href !== new URL(expected, base).href) return;
      } catch {
        // Unparseable URLs fall through to the notice below.
      }
    }
    setBlockedFileId(currentTrack.fileId);
  }

  function handleRetryPlayback(): void {
    setBlockedFileId(null);
    if (audioRef.current) {
      audioRef.current.load();
      void audioRef.current.play().catch(() => {
        // Handled by onError if playback still fails
      });
    }
  }

  function nextTrack(autoPlay = playing): void {
    if (currentIndex < playableItems.length - 1) {
      selectItem(currentIndex + 1, autoPlay);
    } else if (loopMode === "all" && playableItems.length > 0) {
      selectItem(0, autoPlay);
    }
  }

  function previousTrack(): void {
    if (currentIndex > 0) {
      selectItem(currentIndex - 1, playing);
    } else if (loopMode === "all" && playableItems.length > 0) {
      selectItem(playableItems.length - 1, playing);
    }
  }

  function startNextTrack(): void {
    if (gapSeconds === 0 || document.visibilityState === "hidden") {
      nextTrack(true);
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
        nextTrack(true);
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

  function handleSeek(nextTime: number): void {
    const bounded = Math.max(0, Math.min(nextTime, duration || 0));
    setCurrentTime(bounded);
    if (audioRef.current) {
      audioRef.current.currentTime = bounded;
    }
    updateMediaSessionPosition(bounded, duration, audioRef.current);
  }

  function seekRelative(deltaSeconds: number): void {
    const nextTime = Math.max(0, Math.min(currentTime + deltaSeconds, duration || 0));
    handleSeek(nextTime);
  }

  // Media Session Updates
  useEffect(() => {
    if (!currentItem || !("mediaSession" in navigator)) return;
    try {
      // Only src is reliable: event images may be PNG or other sizes, so no
      // MIME or dimension descriptors are declared.
      const artwork = eventArtworkUrl ? [{ src: eventArtworkUrl }] : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        album: details.eventTitle,
        artist: currentItem.composer ?? currentItem.arranger ?? details.performerLabel ?? "",
        artwork,
        title: currentItem.title,
      });
    } catch {
      // Non-blocking MediaSession error
    }
  }, [currentItem, details.eventTitle, details.performerLabel, eventArtworkUrl]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }
  }, [playing]);

  const playRef = useRef(playCurrent);
  const togglePlayRef = useRef(togglePlay);
  const nextTrackRef = useRef(nextTrack);
  const prevTrackRef = useRef(previousTrack);
  const seekRelativeRef = useRef(seekRelative);
  const handleSeekRef = useRef(handleSeek);

  useEffect(() => {
    playRef.current = playCurrent;
    togglePlayRef.current = togglePlay;
    nextTrackRef.current = nextTrack;
    prevTrackRef.current = previousTrack;
    seekRelativeRef.current = seekRelative;
    handleSeekRef.current = handleSeek;
  });

  const audioSessionHandlersRef = useRef<AudioSessionHandlers>({
    onNextTrack: () => {
      nextTrackRef.current();
    },
    onPause: () => {
      togglePlayRef.current();
    },
    onPlay: () => {
      playRef.current();
    },
    onPreviousTrack: () => {
      prevTrackRef.current();
    },
    onSeekRelative: (offsetSeconds) => {
      seekRelativeRef.current(offsetSeconds);
    },
    onSeekTo: (timeSeconds) => {
      handleSeekRef.current(timeSeconds);
    },
  });

  useAudioSession(audioSessionHandlersRef);

  const isSetList = Boolean(details.eventId);
  const setListHeading = isSetList ? "Set List" : "Library tracks";
  const currentTrackFileId = currentTrack ? currentTrack.fileId : "";
  const hasTrack = currentItem !== null && currentTrack !== null;

  if (details.items.length === 0) {
    return (
      <div className="public-player__container">
        <PlayerPartSelector
          activeTrackKey={activeTrackKey}
          onSelectTrackKey={selectTrackKey}
          trackKeys={allTrackKeys}
          trackLabels={details.trackLabels}
        />
        <p className="public-player__empty" role="status">
          No practice tracks are available for this set list yet.
        </p>
      </div>
    );
  }

  return (
    <div className="public-player__layout-grid">
      {/* Hidden Persistent Audio Element */}
      <PlayerAudio
        audioRef={audioRef}
        audioSrc={audioSrc}
        autoplayRef={autoplayRef}
        currentItem={currentItem}
        currentTrack={currentTrack}
        duration={duration}
        handleAudioError={handleAudioError}
        handleEnded={handleEnded}
        playCurrent={playCurrent}
        playing={playing}
        setCurrentTime={setCurrentTime}
        setDuration={setDuration}
        setPlaying={setPlaying}
        startAt={startAt}
      />

      {/* Main Player Column */}
      <div className="public-player__main-column">
        <section
          aria-labelledby="public-player-now-playing"
          className="public-player__now-playing-card"
        >
          {/* Event artwork */}
          <PlayerArtwork artworkUrl={eventArtworkUrl} eventTitle={details.eventTitle} />

          <PlayerPlaybackControls
            activeTrackKey={activeTrackKey}
            blockedFileId={blockedFileId}
            currentIndex={currentIndex}
            currentItem={currentItem}
            currentTrack={currentTrack}
            currentTime={currentTime}
            duration={duration}
            handleRetryPlayback={handleRetryPlayback}
            handleSeek={handleSeek}
            loopMode={loopMode}
            nextTrack={nextTrack}
            online={online}
            playableCount={playableItems.length}
            playing={playing}
            previousTrack={previousTrack}
            saveError={saveError}
            togglePlay={togglePlay}
          />

          {/* Voice Part selection */}
          <PlayerPartSelector
            activeTrackKey={activeTrackKey}
            onSelectTrackKey={selectTrackKey}
            trackKeys={allTrackKeys}
            trackLabels={details.trackLabels}
          />

          {/* Secondary controls: Repeat, Set List, Settings */}
          <PlayerSecondaryControlsWrapper
            hasTrack={hasTrack}
            loopMode={loopMode}
            onOpenQueue={() => {
              setQueueOpen(true);
            }}
            onOpenSettings={() => {
              setSettingsOpen(true);
            }}
            onToggleLoop={() => {
              setLoopMode((mode) => (mode === "none" ? "all" : mode === "all" ? "one" : "none"));
            }}
            queueButtonRef={queueButtonRef}
            queueCount={playableItems.length}
            settingsButtonRef={settingsButtonRef}
          />
        </section>
      </div>

      {/* Desktop side panel: Set list */}
      <div className="public-player__desktop-panel">
        <PlayerSetList
          activeTrackKey={activeTrackKey}
          currentIndex={currentIndex}
          isSetList={isSetList}
          items={details.items}
          offlineIds={offlineIds}
          onRemoveOfflineCopy={handleRemoveOfflineCopy}
          onSaveOfflineCopy={handleSaveOfflineCopy}
          onSelectItem={(itemIndex) => {
            selectItem(itemIndex);
          }}
          online={online}
          pendingOfflineIds={pendingOfflineIds}
          playableItems={playableItems}
          source={source}
        />
        <div className="public-player__desktop-options">
          <PlayerRehearsalOptions
            countdown={countdown}
            currentTrackFileId={currentTrackFileId}
            gapSeconds={gapSeconds}
            onChangeGapSeconds={setGapSeconds}
            onChangeStartAt={updateStartAt}
            onChangeVolume={setVolume}
            onToggleGuide={() => {
              setShowGuide((current) => !current);
            }}
            showGuide={showGuide}
            source={source}
            startAt={startAt}
            volume={volume}
          />
        </div>
      </div>

      {/* Mobile Drawer: Set List */}
      <Sheet
        onClose={() => {
          setQueueOpen(false);
        }}
        open={queueOpen}
        presentation="mobile-fullscreen"
        restoreFocusRef={queueButtonRef}
        title="Set List"
      >
        <div className="public-player__sheet-container public-player__sheet-container--set-list">
          <header className="public-player__sheet-header public-player__sheet-header--set-list">
            <h2>{setListHeading}</h2>
            <p>
              {details.eventTitle} · {playableItems.length} tracks
            </p>
          </header>
          <PlayerSetList
            activeTrackKey={activeTrackKey}
            autoRevealActive={queueOpen}
            currentIndex={currentIndex}
            isSetList={isSetList}
            items={details.items}
            offlineIds={offlineIds}
            onRemoveOfflineCopy={handleRemoveOfflineCopy}
            onSaveOfflineCopy={handleSaveOfflineCopy}
            onSelectItem={(itemIndex) => {
              selectItem(itemIndex);
              setQueueOpen(false);
            }}
            online={online}
            pendingOfflineIds={pendingOfflineIds}
            playableItems={playableItems}
            presentation="mobile-picker"
            source={source}
          />
        </div>
      </Sheet>

      {/* Mobile Drawer: Settings */}
      <Sheet
        onClose={() => {
          setSettingsOpen(false);
        }}
        open={settingsOpen}
        restoreFocusRef={settingsButtonRef}
        title="Rehearsal Settings"
      >
        <div className="public-player__sheet-container">
          <div className="public-player__sheet-header">
            <p className="public-player__sheet-title">Rehearsal Settings</p>
            <p>Adjust playback options for practice</p>
          </div>
          <PlayerRehearsalOptions
            countdown={countdown}
            currentTrackFileId={currentTrackFileId}
            gapSeconds={gapSeconds}
            onChangeGapSeconds={setGapSeconds}
            onChangeStartAt={updateStartAt}
            showVolume={false}
            source={source}
            startAt={startAt}
          />
        </div>
      </Sheet>
    </div>
  );
}
