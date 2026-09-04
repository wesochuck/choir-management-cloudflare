import { useEffect, useMemo, useRef, useState } from "react";
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
import type { PlayerDetails } from "./types";
import { useAudioSession, type AudioSessionHandlers } from "./useAudioSession";
import { useAutoCacheOfflineCopies, useOfflineAudioUrl } from "./usePlayerOffline";
import { useOfflineCopies } from "../../offline/useOfflineCopies";

function OfflineStatusNotices({
  blockedFileId,
  currentFileId,
  saveError,
}: {
  readonly blockedFileId: string | null;
  readonly currentFileId: string | undefined;
  readonly saveError: boolean;
}) {
  const showOfflineBlocked = blockedFileId !== null && blockedFileId === currentFileId;
  return (
    <>
      {showOfflineBlocked ? (
        <p className="notice notice--warning" role="status">
          This track isn&apos;t saved offline. Reconnect to download it.
        </p>
      ) : null}
      {saveError ? (
        <p className="notice notice--error" role="alert">
          This track couldn&apos;t be saved offline. Try again while online.
        </p>
      ) : null}
    </>
  );
}

export function PublicPracticePlayer({
  details,
  initialTrackKey,
  source,
}: {
  readonly details: PlayerDetails;
  readonly initialTrackKey?: string | undefined;
  readonly source: PracticeTrackSource;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoplayRef = useRef(false);
  const gapTimerRef = useRef<number | null>(null);
  const queueButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);

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
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [blockedFileId, setBlockedFileId] = useState<string | null>(null);
  const [pendingOfflineIds, setPendingOfflineIds] = useState<ReadonlySet<string>>(new Set());
  const [saveError, setSaveError] = useState(false);

  const scope = typeof window === "undefined" ? "" : window.location.host;
  const {
    ensureOfflineCopies,
    offlineIds,
    online,
    removeOfflineCopy,
    resolveOfflineUrl,
    saveOfflineCopy,
  } = useOfflineCopies({ scope, source });

  const allTrackKeys = useMemo(() => availableTrackKeys(details.items), [details.items]);
  const [selectedTrackKey, setSelectedTrackKey] = useState(() => {
    if (initialTrackKey) {
      return resolveTrackKey(allTrackKeys, initialTrackKey) ?? initialTrackKey;
    }
    return allTrackKeys[0] ?? "tutti";
  });
  const activeTrackKey =
    allTrackKeys.includes(selectedTrackKey) || initialTrackKey
      ? selectedTrackKey
      : (allTrackKeys[0] ?? "tutti");
  const playableItems = useMemo(
    () => details.items.filter((item) => resolveTrack(item, activeTrackKey) !== null),
    [activeTrackKey, details.items],
  );
  const safeSelectedItemIndex = Math.min(selectedItemIndex, Math.max(playableItems.length - 1, 0));
  const currentItem = playableItems[safeSelectedItemIndex] ?? null;
  const currentTrack = currentItem ? resolveTrack(currentItem, activeTrackKey) : null;
  const currentIndex = currentItem ? playableItems.indexOf(currentItem) : -1;
  const offlineUrl = useOfflineAudioUrl(resolveOfflineUrl, currentTrack?.fileId);
  const audioSrc = offlineUrl ?? (currentTrack ? source.mediaUrl(currentTrack.fileId) : "");
  const eventArtworkUrl = details.eventArtworkFileId
    ? source.artworkUrl(details.eventArtworkFileId)
    : null;

  useAutoCacheOfflineCopies(scope, details.items, activeTrackKey, ensureOfflineCopies);

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

  function handleAudioError(): void {
    if (typeof navigator !== "undefined" && !navigator.onLine && currentTrack) {
      setBlockedFileId(currentTrack.fileId);
    }
  }

  function nextTrack(): void {
    if (currentIndex < playableItems.length - 1) {
      selectItem(currentIndex + 1);
    } else if (loopMode === "all" && playableItems.length > 0) {
      selectItem(0);
    }
  }

  function previousTrack(): void {
    if (currentIndex > 0) {
      selectItem(currentIndex - 1, false);
    } else if (loopMode === "all" && playableItems.length > 0) {
      selectItem(playableItems.length - 1, false);
    }
  }

  function startNextTrack(): void {
    if (gapSeconds === 0 || document.visibilityState === "hidden") {
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
      const artwork = eventArtworkUrl
        ? [{ sizes: "512x512", src: eventArtworkUrl, type: "image/jpeg" }]
        : [];
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

  if (!currentItem || !currentTrack) {
    return (
      <div className="public-player__container">
        <PlayerPartSelector
          activeTrackKey={activeTrackKey}
          onSelectTrackKey={selectTrackKey}
          trackKeys={allTrackKeys}
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

      {/* Main Player Column */}
      <div className="public-player__main-column">
        <section
          aria-labelledby="public-player-now-playing"
          className="public-player__now-playing-card"
        >
          {/* Event artwork */}
          <PlayerArtwork artworkUrl={eventArtworkUrl} eventTitle={details.eventTitle} />

          {/* Now playing metadata & Tutti fallback status */}
          <PlayerTrackMetadata
            activeTrackKey={activeTrackKey}
            currentTrack={currentTrack}
            item={currentItem}
          />
          <OfflineStatusNotices
            blockedFileId={blockedFileId}
            currentFileId={currentTrack.fileId}
            saveError={saveError}
          />

          {/* Progress bar */}
          <PlayerProgress
            currentTime={currentTime}
            duration={duration}
            onSeek={handleSeek}
            title={currentItem.title}
          />

          {/* Transport controls */}
          <PlayerTransport
            currentIndex={currentIndex}
            loopMode={loopMode}
            onNext={nextTrack}
            onPrevious={previousTrack}
            onTogglePlay={togglePlay}
            playableCount={playableItems.length}
            playing={playing}
          />

          {/* Voice Part selection */}
          <PlayerPartSelector
            activeTrackKey={activeTrackKey}
            onSelectTrackKey={selectTrackKey}
            trackKeys={allTrackKeys}
          />

          {/* Secondary controls: Repeat, Set List, Settings */}
          <PlayerSecondaryControls
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
            currentTrackFileId={currentTrack.fileId}
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
        restoreFocusRef={queueButtonRef}
        title="Set List"
      >
        <div className="public-player__sheet-container">
          <div className="public-player__sheet-header">
            <p className="public-player__sheet-title">Set List</p>
            <p>
              {details.eventTitle} · {playableItems.length} tracks
            </p>
          </div>
          <PlayerSetList
            activeTrackKey={activeTrackKey}
            currentIndex={currentIndex}
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
            currentTrackFileId={currentTrack.fileId}
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
