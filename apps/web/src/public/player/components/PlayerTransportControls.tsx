import type { SyntheticEvent } from "react";

import { formatTrackKey, updateMediaSessionPosition } from "../format";
import type { PlayerPlaylistItem, ResolvedTrack } from "../types";
import { OfflineStatusNotices } from "./OfflineStatusNotices";
import { PlayerArtwork, PlayerTrackMetadata } from "./PlayerArtwork";
import { PlayerPartSelector } from "./PlayerPartSelector";
import { PlayerProgress, PlayerSecondaryControls, PlayerTransport } from "./PlayerProgress";

interface PlayerAudioProps {
  readonly audioRef: React.RefObject<HTMLAudioElement | null>;
  readonly audioSrc: string;
  readonly autoplayRef: { current: boolean };
  readonly currentItem: PlayerPlaylistItem | null;
  readonly currentTrack: ResolvedTrack | null;
  readonly currentTimeRef: { current: number };
  readonly duration: number;
  readonly handleAudioError: (event: SyntheticEvent<HTMLAudioElement>) => void;
  readonly handleEnded: () => void;
  readonly handleStalled: () => void;
  readonly isReloadingRef: { current: boolean };
  readonly playCurrent: () => void;
  readonly playing: boolean;
  readonly resumeTimeRef: { current: number | null };
  readonly retryCountRef: { current: number };
  readonly setCurrentTime: (time: number) => void;
  readonly setDuration: (duration: number) => void;
  readonly setPlaying: (playing: boolean) => void;
  readonly startAt: number;
  readonly wantPlayingRef: { current: boolean };
}

export function PlayerAudio({
  audioRef,
  audioSrc,
  autoplayRef,
  currentItem,
  currentTrack,
  currentTimeRef,
  duration,
  handleAudioError,
  handleEnded,
  handleStalled,
  isReloadingRef,
  playCurrent,
  playing,
  resumeTimeRef,
  retryCountRef,
  setCurrentTime,
  setDuration,
  setPlaying,
  startAt,
  wantPlayingRef,
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
        const targetTime =
          resumeTimeRef.current !== null
            ? Math.min(resumeTimeRef.current, nextDuration)
            : Math.min(startAt, nextDuration);
        resumeTimeRef.current = null;
        isReloadingRef.current = false;
        setDuration(nextDuration);
        setCurrentTime(targetTime);
        currentTimeRef.current = targetTime;
        event.currentTarget.currentTime = targetTime;
        updateMediaSessionPosition(targetTime, nextDuration, event.currentTarget);
        if (autoplayRef.current || wantPlayingRef.current || playing) {
          autoplayRef.current = false;
          playCurrent();
        }
      }}
      onPause={(event) => {
        if (isReloadingRef.current) return;
        if (
          wantPlayingRef.current &&
          (event.currentTarget.error !== null ||
            (typeof navigator !== "undefined" && !navigator.onLine))
        ) {
          return;
        }
        setPlaying(false);
      }}
      onPlay={() => {
        isReloadingRef.current = false;
        wantPlayingRef.current = true;
        setPlaying(true);
      }}
      onStalled={handleStalled}
      onTimeUpdate={(event) => {
        const time = event.currentTarget.currentTime;
        currentTimeRef.current = time;
        setCurrentTime(time);
        updateMediaSessionPosition(time, duration, event.currentTarget);
        if (time > 0) {
          retryCountRef.current = 0;
        }
      }}
      preload={playing ? "auto" : "metadata"}
      ref={audioRef}
      src={audioSrc}
    >
      <track kind="captions" />
    </audio>
  );
}

interface PlayerTrackShowcaseProps {
  readonly activeTrackKey: string;
  readonly artworkUrl: string | null;
  readonly currentItem: PlayerPlaylistItem | null;
  readonly currentTrack: ResolvedTrack | null;
  readonly eventTitle: string;
  readonly onClearPin: () => void;
  readonly onOpenPieceTrackSelector: (trigger: HTMLElement) => void;
  readonly trackLabels?: Readonly<Record<string, string>> | undefined;
}

export function PlayerTrackShowcase({
  activeTrackKey,
  artworkUrl,
  currentItem,
  currentTrack,
  eventTitle,
  onClearPin,
  onOpenPieceTrackSelector,
  trackLabels,
}: PlayerTrackShowcaseProps) {
  return (
    <div className="public-player__showcase">
      <PlayerArtwork artworkUrl={artworkUrl} eventTitle={eventTitle} />
      {currentItem && currentTrack ? (
        <PlayerTrackMetadata
          activeTrackKey={activeTrackKey}
          currentTrack={currentTrack}
          item={currentItem}
          onClearPin={currentTrack.pinned ? onClearPin : undefined}
          onOpenPieceTrackSelector={onOpenPieceTrackSelector}
          trackLabels={trackLabels}
        />
      ) : null}
    </div>
  );
}

interface PlayerPlaybackControlsProps {
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

export function PlayerPlaybackControls({
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

export function PlayerSecondaryControlsWrapper({
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

export function PlayerEmptyState({
  activeTrackKey,
  allTrackKeys,
  onSelectTrackKey,
  trackLabels,
}: {
  readonly activeTrackKey: string;
  readonly allTrackKeys: readonly string[];
  readonly onSelectTrackKey: (key: string) => void;
  readonly trackLabels?: Record<string, string> | undefined;
}) {
  return (
    <div className="public-player__container">
      <PlayerPartSelector
        activeTrackKey={activeTrackKey}
        onSelectTrackKey={onSelectTrackKey}
        trackKeys={allTrackKeys}
        trackLabels={trackLabels}
      />
      <p className="public-player__empty" role="status">
        No practice tracks are available for this set list yet.
      </p>
    </div>
  );
}
