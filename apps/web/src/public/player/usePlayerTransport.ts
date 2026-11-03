import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";

import type { OfflineAudioLease } from "../../offline/mediaStore";
import { subscribeNetworkStatus } from "../../offline/network";
import { updateMediaSessionPosition } from "./format";
import type { PracticeTrackSource } from "./source";
import {
  computeAudioSrc,
  findInitialSelectedItemIndex,
  resolveCurrentPlayerTrack,
  writePersistedTrackKey,
} from "./trackSelection";
import type { PlayerDetails, PlayerPlaylistItem, ResolvedTrack } from "./types";
import { useAudioSession, type AudioSessionHandlers } from "./useAudioSession";
import { useLoudnessGain } from "./useLoudnessGain";
import { useOfflineAudio } from "./usePlayerOffline";

const MAX_STREAM_RETRIES = 3;
const STREAM_RETRY_DELAYS = [300, 1000, 2500] as const;

function useTrackLoudness(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  track: ResolvedTrack | null,
  item: PlayerPlaylistItem | null,
  details: PlayerDetails,
  src: string,
  offline: boolean,
  cachedVersion: string | null,
) {
  const id = track?.fileId ?? "";
  const measurement = details.loudnessByFileId?.[id] ?? item?.loudnessByFileId?.[id];
  return useLoudnessGain(
    audioRef,
    `${id}:${src}`,
    offline && measurement?.contentVersion !== cachedVersion ? undefined : measurement,
  );
}

export function usePlayerTransport({
  acquireOfflineUrl,
  activeTrackKey,
  details,
  eventArtworkUrl,
  initialPieceId,
  initialTrackKey,
  markSelectorEngaged,
  offlineIds,
  onTrackKeyChange,
  pinnedTracksByPieceId,
  playableItems,
  resolveOfflineUrl,
  selectedTrackKey,
  setUserOverrideTrackKey,
  source,
  userOverrideTrackKey,
}: {
  readonly acquireOfflineUrl: (fileId: string) => Promise<OfflineAudioLease | null>;
  readonly activeTrackKey: string;
  readonly details: PlayerDetails;
  readonly eventArtworkUrl: string | null;
  readonly initialPieceId: string | undefined;
  readonly initialTrackKey: string | undefined;
  readonly markSelectorEngaged: () => void;
  readonly offlineIds: ReadonlySet<string>;
  readonly onTrackKeyChange: ((key: string) => void) | undefined;
  readonly pinnedTracksByPieceId: Readonly<Record<string, string>>;
  readonly playableItems: readonly PlayerPlaylistItem[];
  readonly resolveOfflineUrl: (fileId: string) => Promise<string | null>;
  readonly selectedTrackKey: string;
  readonly setUserOverrideTrackKey: (key: string | null) => void;
  readonly source: PracticeTrackSource;
  readonly userOverrideTrackKey: string | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoplayRef = useRef(false);
  const gapTimerRef = useRef<number | null>(null);
  const currentTimeRef = useRef(0);
  const wantPlayingRef = useRef(false);
  const resumeTimeRef = useRef<number | null>(null);
  const isReloadingRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const prevTrackFileIdRef = useRef<string | undefined>(undefined);
  const prevAudioSrcRef = useRef<string>("");

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
  const [blockedFileId, setBlockedFileId] = useState<string | null>(null);

  if (initialPieceId && initialPieceId !== prevInitialPieceId) {
    setPrevInitialPieceId(initialPieceId);
    const found = playableItems.findIndex((item) => item.pieceId === initialPieceId);
    if (found >= 0) {
      setSelectedItemIndex(found);
    }
  }
  const safeSelectedItemIndex = Math.min(selectedItemIndex, Math.max(playableItems.length - 1, 0));
  const currentItem = playableItems[safeSelectedItemIndex] ?? null;
  const currentTrack = resolveCurrentPlayerTrack(
    currentItem,
    activeTrackKey,
    pinnedTracksByPieceId,
  );
  const currentIndex = currentItem ? playableItems.indexOf(currentItem) : -1;
  const offlineAudio = useOfflineAudio(
    resolveOfflineUrl,
    currentTrack?.fileId,
    offlineIds,
    acquireOfflineUrl,
  );
  const offlineUrl = offlineAudio.url;
  const audioSrc = computeAudioSrc(offlineUrl, currentTrack, source);
  const prepareLoudness = useTrackLoudness(
    audioRef,
    currentTrack,
    currentItem,
    details,
    audioSrc,
    offlineUrl !== null,
    offlineAudio.contentVersion,
  );

  const prevEventIdRef = useRef(details.eventId);
  useEffect(() => {
    if (prevEventIdRef.current !== details.eventId) {
      prevEventIdRef.current = details.eventId;
      if (gapTimerRef.current !== null) {
        window.clearInterval(gapTimerRef.current);
        gapTimerRef.current = null;
      }
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      wantPlayingRef.current = false;
      resumeTimeRef.current = null;
      retryCountRef.current = 0;
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

  const playRef = useRef(playCurrent);

  const triggerAudioReload = useCallback((): void => {
    resumeTimeRef.current = currentTimeRef.current;
    autoplayRef.current = true;
    isReloadingRef.current = true;
    audioRef.current?.load();
    playRef.current();
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (prevAudioSrcRef.current === audioSrc) return;

    const isSameTrack =
      prevTrackFileIdRef.current !== undefined &&
      prevTrackFileIdRef.current === currentTrack?.fileId;

    prevTrackFileIdRef.current = currentTrack?.fileId;
    prevAudioSrcRef.current = audioSrc;

    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (isSameTrack) {
      resumeTimeRef.current = currentTimeRef.current > 0 ? currentTimeRef.current : null;
      autoplayRef.current = wantPlayingRef.current;
      isReloadingRef.current = wantPlayingRef.current;
      audio.load();
      return;
    }

    retryCountRef.current = 0;
    resumeTimeRef.current = null;
    isReloadingRef.current = autoplayRef.current;
    audio.pause();
    audio.load();
    setCurrentTime(0);
    currentTimeRef.current = 0;
    setDuration(0);
  }, [audioSrc, currentTrack?.fileId]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume, currentTrack?.fileId]);

  useEffect(() => {
    return () => {
      if (gapTimerRef.current !== null) window.clearInterval(gapTimerRef.current);
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    };
  }, []);

  function playCurrent(): void {
    prepareLoudness();
    wantPlayingRef.current = true;
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
    prepareLoudness();
    if (index < 0 || index >= playableItems.length) return;
    if (gapTimerRef.current !== null) {
      window.clearInterval(gapTimerRef.current);
      gapTimerRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = 0;
    resumeTimeRef.current = null;
    autoplayRef.current = autoplay;
    wantPlayingRef.current = autoplay;
    setSelectedItemIndex(index);
    setPlaying(autoplay);
    setCountdown(null);
    setBlockedFileId(null);
  }

  function selectTrackKey(key: string): void {
    prepareLoudness();
    // Any manual choice counts as engagement — even re-choosing the
    // displayed automatic default — while playback-driven overrides below
    // (playCurrent) deliberately do not. The explicit choice also persists
    // across refreshes/reloads for visitors without a roster part.
    markSelectorEngaged();
    writePersistedTrackKey(key);
    if (key === selectedTrackKey) return;
    setUserOverrideTrackKey(key);
    autoplayRef.current = playing;
    wantPlayingRef.current = playing;
    setSelectedItemIndex(0);
    setCountdown(null);
    setBlockedFileId(null);
    onTrackKeyChange?.(key);
  }

  function handleAudioError(event: SyntheticEvent<HTMLAudioElement>): void {
    if (!currentTrack) return;
    // Cached tracks are already saved locally and must never trigger an offline-missing notice.
    if (offlineUrl || offlineIds.has(currentTrack.fileId)) {
      if (wantPlayingRef.current && retryCountRef.current < MAX_STREAM_RETRIES) {
        retryCountRef.current += 1;
        triggerAudioReload();
      }
      return;
    }
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
    if (
      wantPlayingRef.current &&
      typeof navigator !== "undefined" &&
      navigator.onLine &&
      retryCountRef.current < MAX_STREAM_RETRIES
    ) {
      retryCountRef.current += 1;
      const delay = STREAM_RETRY_DELAYS[retryCountRef.current - 1] ?? 1000;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        triggerAudioReload();
      }, delay);
      return;
    }
    setBlockedFileId(currentTrack.fileId);
    setPlaying(false);
  }

  function handleStalled(): void {
    if (!wantPlayingRef.current || !currentTrack) return;
    if (offlineUrl || offlineIds.has(currentTrack.fileId)) {
      triggerAudioReload();
      return;
    }
    if (
      typeof navigator !== "undefined" &&
      navigator.onLine &&
      retryCountRef.current < MAX_STREAM_RETRIES &&
      retryTimerRef.current === null
    ) {
      retryCountRef.current += 1;
      const delay = STREAM_RETRY_DELAYS[retryCountRef.current - 1] ?? 1000;
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        triggerAudioReload();
      }, delay);
    }
  }

  function handleRetryPlayback(): void {
    retryCountRef.current = 0;
    wantPlayingRef.current = true;
    setBlockedFileId(null);
    triggerAudioReload();
  }

  useEffect(() => {
    return subscribeNetworkStatus(() => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (!wantPlayingRef.current || !currentTrack) return;
      const audio = audioRef.current;
      if (blockedFileId !== null || audio?.paused || audio?.error) {
        if (retryTimerRef.current !== null) {
          window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        retryCountRef.current = 0;
        setBlockedFileId(null);
        triggerAudioReload();
      }
    });
  }, [blockedFileId, currentTrack, triggerAudioReload]);

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
    wantPlayingRef.current = false;
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
        currentTimeRef.current = startAt;
        playCurrent();
      }
      return;
    }
    if (currentIndex >= playableItems.length - 1 && loopMode !== "all") {
      wantPlayingRef.current = false;
      setPlaying(false);
      return;
    }
    startNextTrack();
  }

  function togglePlay(): void {
    if (!audioRef.current) return;
    if (playing) {
      wantPlayingRef.current = false;
      audioRef.current.pause();
      setPlaying(false);
      return;
    }
    wantPlayingRef.current = true;
    playCurrent();
  }

  function updateStartAt(value: string): void {
    const next = Math.max(0, Number(value) || 0);
    setStartAt(next);
    if (audioRef.current && duration > 0) {
      const bounded = Math.min(next, duration);
      audioRef.current.currentTime = bounded;
      currentTimeRef.current = bounded;
      setCurrentTime(bounded);
    }
  }

  function handleSeek(nextTime: number): void {
    const bounded = Math.max(0, Math.min(nextTime, duration || 0));
    currentTimeRef.current = bounded;
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

  return {
    audioRef,
    audioSrc,
    autoplayRef,
    blockedFileId,
    countdown,
    currentIndex,
    currentItem,
    currentTime,
    currentTimeRef,
    currentTrack,
    duration,
    gapSeconds,
    handleAudioError,
    handleEnded,
    handleRetryPlayback,
    handleSeek,
    handleStalled,
    isReloadingRef,
    loopMode,
    nextTrack,
    playCurrent,
    playing,
    previousTrack,
    resumeTimeRef,
    retryCountRef,
    selectItem,
    selectTrackKey,
    setCurrentTime,
    setDuration,
    setGapSeconds,
    setLoopMode,
    setPlaying,
    setVolume,
    startAt,
    togglePlay,
    updateStartAt,
    volume,
    wantPlayingRef,
  };
}
