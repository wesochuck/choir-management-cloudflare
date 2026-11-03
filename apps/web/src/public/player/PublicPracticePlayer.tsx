import { useMemo, useRef, useState } from "react";
import { Sheet } from "@choir/ui";

import { useOfflineCopies } from "../../offline/useOfflineCopies";
import { PlayerPartSelector } from "./components/PlayerPartSelector";
import { PlayerRehearsalOptions } from "./components/PlayerRehearsalOptions";
import { PlayerSetList } from "./components/PlayerSetList";
import {
  PlayerAudio,
  PlayerEmptyState,
  PlayerPlaybackControls,
  PlayerSecondaryControlsWrapper,
  PlayerTrackShowcase,
} from "./components/PlayerTransportControls";
import { availableTrackKeys } from "./format";
import type { PracticeTrackSource } from "./source";
import {
  clearPinForItem,
  computeActiveTrackKey,
  getPlayerMetadata,
  pinnedTrackForItem,
  resolvePlayerItemTrack,
  resolveSelectedTrackKey,
  usePersistedTrackKeyOverride,
  usePieceSelectorLaunch,
  usePinnedPieceTrackState,
} from "./trackSelection";
import type { PlayerDetails } from "./types";
import { useAutoCacheOfflineCopies } from "./usePlayerOffline";
import { usePlayerTransport } from "./usePlayerTransport";
import type { RosterPartResolution } from "./useRosterPart";
import { useVoicePartNudge } from "./voicePartHint";

export function PublicPracticePlayer({
  details,
  initialPieceId,
  initialTrackKey,
  onTrackKeyChange,
  rosterProfile,
  source,
}: {
  readonly details: PlayerDetails;
  readonly initialPieceId?: string | undefined;
  readonly initialTrackKey?: string | undefined;
  readonly onTrackKeyChange?: ((key: string) => void) | undefined;
  readonly rosterProfile?: RosterPartResolution | undefined;
  readonly source: PracticeTrackSource;
}) {
  const queueButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);

  const [showGuide, setShowGuide] = useState(true);
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingOfflineIds, setPendingOfflineIds] = useState<ReadonlySet<string>>(new Set());
  const [saveError, setSaveError] = useState(false);
  const { pinPieceTrack, pinnedTracksByPieceId } = usePinnedPieceTrackState();
  const {
    openPieceSelector: requestCurrentPieceTrackSelector,
    request: openPieceSelectorRequest,
    restoreFocusElement: pieceSelectorRestoreFocusElement,
  } = usePieceSelectorLaunch();

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
  const persistedOverrideKey = usePersistedTrackKeyOverride(
    allTrackKeys,
    details.trackLabels,
    rosterProfile,
  );
  const [userOverrideTrackKey, setUserOverrideTrackKey] = useState<string | null>(null);

  const selectedTrackKey = useMemo(
    () =>
      resolveSelectedTrackKey(
        userOverrideTrackKey ?? persistedOverrideKey,
        initialTrackKey,
        allTrackKeys,
        details.trackLabels,
      ),
    [
      allTrackKeys,
      details.trackLabels,
      initialTrackKey,
      persistedOverrideKey,
      userOverrideTrackKey,
    ],
  );

  const activeTrackKey = useMemo(
    () => computeActiveTrackKey(selectedTrackKey, allTrackKeys, Boolean(initialTrackKey)),
    [allTrackKeys, initialTrackKey, selectedTrackKey],
  );
  const playableItems = useMemo(
    () =>
      details.items.filter(
        (item) => resolvePlayerItemTrack(item, activeTrackKey, pinnedTracksByPieceId) !== null,
      ),
    [activeTrackKey, details.items, pinnedTracksByPieceId],
  );

  const eventArtworkUrl = details.eventArtworkFileId
    ? source.artworkUrl(details.eventArtworkFileId)
    : null;

  // Voice-part nudge (issue #279): explicit selector engagement is tracked
  // separately from playback-driven overrides; playback itself never counts.
  const { dismissVoicePartHint, markSelectorEngaged, showVoicePartHint } = useVoicePartNudge({
    playerReady: playableItems.length > 0,
    rosterProfile,
    trackKeys: allTrackKeys,
  });

  const {
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
  } = usePlayerTransport({
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
  });

  useAutoCacheOfflineCopies(
    scope,
    details.items,
    activeTrackKey,
    ensureOfflineCopies,
    currentTrack?.fileId,
    pinnedTracksByPieceId,
  );

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

  const { currentTrackFileId, hasTrack, isSetList, setListHeading } = getPlayerMetadata(
    currentItem,
    currentTrack,
    details.eventId,
  );

  if (details.items.length === 0) {
    return (
      <PlayerEmptyState
        activeTrackKey={activeTrackKey}
        allTrackKeys={allTrackKeys}
        onSelectTrackKey={selectTrackKey}
        trackLabels={details.trackLabels}
      />
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
        currentTimeRef={currentTimeRef}
        duration={duration}
        handleAudioError={handleAudioError}
        handleEnded={handleEnded}
        handleStalled={handleStalled}
        isReloadingRef={isReloadingRef}
        playCurrent={playCurrent}
        playing={playing}
        resumeTimeRef={resumeTimeRef}
        retryCountRef={retryCountRef}
        setCurrentTime={setCurrentTime}
        setDuration={setDuration}
        setPlaying={setPlaying}
        startAt={startAt}
        wantPlayingRef={wantPlayingRef}
      />

      {/* Main Player Column */}
      <div className="public-player__main-column">
        <section
          aria-labelledby="public-player-now-playing"
          className="public-player__now-playing-card"
        >
          <PlayerTrackShowcase
            activeTrackKey={activeTrackKey}
            artworkUrl={eventArtworkUrl}
            currentItem={currentItem}
            currentTrack={currentTrack}
            eventTitle={details.eventTitle}
            onClearPin={() => {
              clearPinForItem(currentItem, pinPieceTrack);
            }}
            onOpenPieceTrackSelector={requestCurrentPieceTrackSelector}
            trackLabels={details.trackLabels}
          />

          <div className="public-player__control-stack">
            <PlayerPlaybackControls
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
              key={openPieceSelectorRequest}
              activeTrackKey={activeTrackKey}
              defaultOpen={openPieceSelectorRequest > 0}
              defaultSelectionScope="piece"
              initialRestoreFocusElement={pieceSelectorRestoreFocusElement}
              onDismissHint={dismissVoicePartHint}
              onEngage={markSelectorEngaged}
              onPinPieceTrack={pinPieceTrack}
              onSelectTrackKey={selectTrackKey}
              currentItem={currentItem}
              pinnedTrackKey={pinnedTrackForItem(currentItem, pinnedTracksByPieceId)}
              showVoicePartHint={showVoicePartHint}
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
          </div>
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
          onPinPieceTrack={pinPieceTrack}
          onSelectItem={(itemIndex) => {
            selectItem(itemIndex);
          }}
          online={online}
          pendingOfflineIds={pendingOfflineIds}
          playableItems={playableItems}
          source={source}
          pinnedTracksByPieceId={pinnedTracksByPieceId}
          trackLabels={details.trackLabels}
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
            onPinPieceTrack={pinPieceTrack}
            onSelectItem={(itemIndex) => {
              selectItem(itemIndex);
              setQueueOpen(false);
            }}
            online={online}
            pendingOfflineIds={pendingOfflineIds}
            playableItems={playableItems}
            presentation="mobile-picker"
            source={source}
            pinnedTracksByPieceId={pinnedTracksByPieceId}
            trackLabels={details.trackLabels}
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
