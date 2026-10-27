import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { displayTrackName, sortVoiceParts } from "../../playerVoiceParts";
import { formatTrackKey, resolveEffectiveTrack } from "../format";
import type { PracticeTrackSource } from "../source";
import type { PlayerPlaylistItem, ResolvedTrack } from "../types";

function PlayerSetListActions({
  item,
  mobilePicker,
  offlineIds,
  onRemoveOfflineCopy,
  onSaveOfflineCopy,
  online,
  pendingOfflineIds,
  source,
  track,
}: {
  readonly item: PlayerPlaylistItem;
  readonly mobilePicker: boolean;
  readonly offlineIds: ReadonlySet<string>;
  readonly onRemoveOfflineCopy: (fileId: string) => void;
  readonly onSaveOfflineCopy: (fileId: string) => void;
  readonly online: boolean;
  readonly pendingOfflineIds: ReadonlySet<string>;
  readonly source: PracticeTrackSource;
  readonly track: ResolvedTrack;
}) {
  return (
    <div
      className={`public-player__set-list-actions${mobilePicker ? " public-player__set-list-actions--mobile-picker" : ""}`}
    >
      <a
        aria-label={`Download ${item.title}`}
        className="button button--secondary button--small public-player__download-btn"
        download
        href={source.mediaUrl(track.fileId)}
      >
        Download
      </a>
      {offlineIds.has(track.fileId) ? (
        <span className="public-player__offline-row">
          <span className="public-player__offline-pill">Saved offline</span>
          <button
            className="text-button"
            onClick={() => {
              onRemoveOfflineCopy(track.fileId);
            }}
            type="button"
          >
            Remove
          </button>
        </span>
      ) : pendingOfflineIds.has(track.fileId) ? (
        <span className="public-player__offline-pill" role="status">
          Saving…
        </span>
      ) : online ? (
        <button
          className="text-button"
          onClick={() => {
            onSaveOfflineCopy(track.fileId);
          }}
          type="button"
        >
          Save offline
        </button>
      ) : null}
    </div>
  );
}

function PlayerPieceTrackPicker({
  activeTrackKey,
  availableKeys,
  item,
  onPinPieceTrack,
  track,
  trackLabels,
}: {
  readonly activeTrackKey: string;
  readonly availableKeys: readonly string[];
  readonly item: PlayerPlaylistItem;
  readonly onPinPieceTrack: (pieceId: string, trackKey: string | null) => void;
  readonly track: ResolvedTrack;
  readonly trackLabels?: Readonly<Record<string, string>> | undefined;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionsId = useId();
  const pieceId = item.pieceId;
  if (!pieceId) return null;

  const defaultTrack = track.pinned ? resolveEffectiveTrack(item, activeTrackKey, null) : track;
  const defaultTrackLabel = defaultTrack
    ? `${formatTrackKey(defaultTrack.key)}${defaultTrack.fallback ? " fallback" : ""}`
    : displayTrackName(activeTrackKey, trackLabels);
  const trackLabel =
    track.fallback && !track.pinned
      ? `${formatTrackKey(track.key)} fallback`
      : formatTrackKey(track.key);

  const closePicker = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !isOpen) return;
    event.preventDefault();
    closePicker();
  };

  return (
    <div className="public-player__piece-track-picker" onKeyDown={handleKeyDown}>
      <button
        aria-controls={optionsId}
        aria-expanded={isOpen}
        aria-label={`${track.pinned ? `Pinned to ${displayTrackName(track.key, trackLabels)}` : `Following default, ${trackLabel}`} for ${item.title}. Choose track for this song`}
        className={`public-player__item-track public-player__piece-track-picker-trigger${track.pinned ? " public-player__item-track--pinned" : ""}`}
        onClick={() => {
          setIsOpen((open) => !open);
        }}
        ref={triggerRef}
        type="button"
      >
        {track.pinned ? <span aria-hidden="true">📌 </span> : null}
        {trackLabel}
      </button>
      <div
        aria-label={`Choose track for ${item.title}`}
        className="public-player__piece-track-picker-options"
        hidden={!isOpen}
        id={optionsId}
        role="group"
      >
        <button
          aria-pressed={!track.pinned}
          onClick={() => {
            onPinPieceTrack(pieceId, null);
            closePicker();
          }}
          type="button"
        >
          Follow default ({defaultTrackLabel})
        </button>
        {availableKeys.map((key) => (
          <button
            aria-pressed={track.pinned && track.key === key}
            key={key}
            onClick={() => {
              onPinPieceTrack(pieceId, key);
              closePicker();
            }}
            type="button"
          >
            {displayTrackName(key, trackLabels)}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlayerSetListItemStatus({
  item,
  track,
}: {
  readonly item: PlayerPlaylistItem;
  readonly track: ResolvedTrack | null;
}) {
  if (track) return null;
  if (item.type === "intermission") {
    return (
      <span className="public-player__item-track public-player__item-track--cue">Intermission</span>
    );
  }
  if (!item.pieceId && item.type !== "song") {
    return (
      <span className="public-player__item-track public-player__item-track--cue">Program cue</span>
    );
  }
  return (
    <span className="public-player__item-track public-player__item-track--unavailable">
      Unavailable
    </span>
  );
}

function PlayerSetListRowStatus({
  active,
  item,
  track,
}: {
  readonly active: boolean;
  readonly item: PlayerPlaylistItem;
  readonly track: ResolvedTrack | null;
}) {
  return (
    <span className="public-player__set-list-item-status">
      {active ? <span className="public-player__now-playing-pill">Now Playing</span> : null}
      <PlayerSetListItemStatus item={item} track={track} />
    </span>
  );
}

function PlayerSetListTrackStatus({
  activeTrackKey,
  availableKeys,
  item,
  onPinPieceTrack,
  track,
  trackLabels,
}: {
  readonly activeTrackKey: string;
  readonly availableKeys: readonly string[];
  readonly item: PlayerPlaylistItem;
  readonly onPinPieceTrack?: ((pieceId: string, trackKey: string | null) => void) | undefined;
  readonly track: ResolvedTrack | null;
  readonly trackLabels?: Readonly<Record<string, string>> | undefined;
}) {
  if (!track) return null;
  if (item.pieceId && availableKeys.length > 1 && onPinPieceTrack) {
    return (
      <PlayerPieceTrackPicker
        activeTrackKey={activeTrackKey}
        availableKeys={availableKeys}
        item={item}
        onPinPieceTrack={onPinPieceTrack}
        track={track}
        trackLabels={trackLabels}
      />
    );
  }
  const label =
    track.fallback && !track.pinned
      ? `${formatTrackKey(track.key)} fallback`
      : formatTrackKey(track.key);
  return (
    <span
      className={`public-player__item-track${track.pinned ? " public-player__item-track--pinned" : ""}`}
    >
      {track.pinned ? <span aria-hidden="true">📌 </span> : null}
      {label}
    </span>
  );
}

function PlayerSetListRow({
  activeTrackKey,
  activeRowRef,
  currentIndex,
  item,
  mobilePicker,
  offlineIds,
  onPinPieceTrack,
  onRemoveOfflineCopy,
  onSaveOfflineCopy,
  onSelectItem,
  online,
  pendingOfflineIds,
  playableItemIndices,
  pinnedTracksByPieceId,
  source,
  trackLabels,
}: {
  readonly activeTrackKey: string;
  readonly activeRowRef: { current: HTMLLIElement | null };
  readonly currentIndex: number;
  readonly item: PlayerPlaylistItem;
  readonly mobilePicker: boolean;
  readonly offlineIds: ReadonlySet<string>;
  readonly onPinPieceTrack?: ((pieceId: string, trackKey: string | null) => void) | undefined;
  readonly onRemoveOfflineCopy: (fileId: string) => void;
  readonly onSaveOfflineCopy: (fileId: string) => void;
  readonly onSelectItem: (itemIndex: number) => void;
  readonly online: boolean;
  readonly pendingOfflineIds: ReadonlySet<string>;
  readonly playableItemIndices: ReadonlyMap<PlayerPlaylistItem, number>;
  readonly pinnedTracksByPieceId: Readonly<Record<string, string>>;
  readonly source: PracticeTrackSource;
  readonly trackLabels?: Readonly<Record<string, string>> | undefined;
}) {
  const track = resolveEffectiveTrack(
    item,
    activeTrackKey,
    item.pieceId ? pinnedTracksByPieceId[item.pieceId] : undefined,
  );
  const availableKeys = sortVoiceParts(
    Object.entries(item.trackFileIds)
      .filter(([, fileId]) => typeof fileId === "string" && fileId.trim().length > 0)
      .map(([key]) => key),
  );
  const itemIndex = playableItemIndices.get(item) ?? -1;
  const active = itemIndex === currentIndex && currentIndex !== -1;

  return (
    <li className={active ? "is-active" : undefined} ref={active ? activeRowRef : undefined}>
      <button
        aria-current={active ? "true" : undefined}
        className={`public-player__set-list-item${mobilePicker ? " public-player__set-list-item--mobile-picker" : ""}`}
        disabled={track === null}
        onClick={() => {
          onSelectItem(itemIndex);
        }}
        type="button"
      >
        <span className="public-player__set-list-item-main">
          <strong>{item.title}</strong>
          {item.composer ? <small>{item.composer}</small> : null}
        </span>
        <PlayerSetListRowStatus active={active} item={item} track={track} />
      </button>
      <PlayerSetListTrackStatus
        activeTrackKey={activeTrackKey}
        availableKeys={availableKeys}
        item={item}
        onPinPieceTrack={onPinPieceTrack}
        track={track}
        trackLabels={trackLabels}
      />
      {track ? (
        <PlayerSetListActions
          item={item}
          mobilePicker={mobilePicker}
          offlineIds={offlineIds}
          onRemoveOfflineCopy={onRemoveOfflineCopy}
          onSaveOfflineCopy={onSaveOfflineCopy}
          online={online}
          pendingOfflineIds={pendingOfflineIds}
          source={source}
          track={track}
        />
      ) : null}
    </li>
  );
}

export function PlayerSetList({
  activeTrackKey,
  autoRevealActive = false,
  currentIndex,
  isSetList = true,
  items,
  offlineIds,
  onRemoveOfflineCopy,
  onSaveOfflineCopy,
  onPinPieceTrack,
  onSelectItem,
  online,
  pendingOfflineIds,
  playableItems,
  presentation = "card",
  source,
  pinnedTracksByPieceId = {},
  trackLabels,
}: {
  readonly activeTrackKey: string;
  readonly autoRevealActive?: boolean;
  readonly currentIndex: number;
  readonly isSetList?: boolean;
  readonly items: readonly PlayerPlaylistItem[];
  readonly offlineIds: ReadonlySet<string>;
  readonly onRemoveOfflineCopy: (fileId: string) => void;
  readonly onSaveOfflineCopy: (fileId: string) => void;
  readonly onPinPieceTrack?: ((pieceId: string, trackKey: string | null) => void) | undefined;
  readonly onSelectItem: (itemIndex: number) => void;
  readonly online: boolean;
  readonly pendingOfflineIds: ReadonlySet<string>;
  readonly playableItems: readonly PlayerPlaylistItem[];
  readonly presentation?: "card" | "mobile-picker";
  readonly source: PracticeTrackSource;
  readonly pinnedTracksByPieceId?: Readonly<Record<string, string>> | undefined;
  readonly trackLabels?: Readonly<Record<string, string>> | undefined;
}) {
  const activeRowRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (presentation !== "mobile-picker" || !autoRevealActive) return;
    const activeRow = activeRowRef.current;
    if (activeRow && typeof activeRow.scrollIntoView === "function") {
      activeRow.scrollIntoView({ block: "nearest" });
    }
  }, [autoRevealActive, currentIndex, presentation]);

  const mobilePicker = presentation === "mobile-picker";
  const playableItemIndices = new Map<PlayerPlaylistItem, number>();
  playableItems.forEach((item, index) => {
    if (!playableItemIndices.has(item)) playableItemIndices.set(item, index);
  });

  return (
    <section
      aria-label={mobilePicker ? (isSetList ? "Set List tracks" : "Library tracks") : undefined}
      aria-labelledby={mobilePicker ? undefined : "public-player-set-list"}
      className={`public-player__set-list${mobilePicker ? " public-player__set-list--mobile-picker" : ""}`}
    >
      {mobilePicker ? null : (
        <>
          <div className="public-player__set-list-heading">
            <div>
              <h2 id="public-player-set-list">{isSetList ? "Set List" : "Library tracks"}</h2>
              <p>
                {String(items.length)} {isSetList ? "tracks in program order" : "tracks"}
              </p>
            </div>
          </div>
          <p className="public-player__set-list-help">
            {isSetList
              ? "Choose a track to start practicing. Part and section tracks fall back to an available recording when a specific track is not available."
              : "Choose a track from the library. Tracks fall back to an available recording when your assigned part is not recorded."}
          </p>
        </>
      )}
      <ol
        className={`public-player__queue-list${mobilePicker ? " public-player__queue-list--mobile-picker" : ""}`}
      >
        {items.map((item, index) => (
          <PlayerSetListRow
            activeTrackKey={activeTrackKey}
            activeRowRef={activeRowRef}
            currentIndex={currentIndex}
            item={item}
            key={`${item.pieceId ?? item.title}-${String(index)}`}
            mobilePicker={mobilePicker}
            offlineIds={offlineIds}
            onPinPieceTrack={onPinPieceTrack}
            onRemoveOfflineCopy={onRemoveOfflineCopy}
            onSaveOfflineCopy={onSaveOfflineCopy}
            onSelectItem={onSelectItem}
            online={online}
            pendingOfflineIds={pendingOfflineIds}
            playableItemIndices={playableItemIndices}
            pinnedTracksByPieceId={pinnedTracksByPieceId}
            source={source}
            trackLabels={trackLabels}
          />
        ))}
      </ol>
    </section>
  );
}
