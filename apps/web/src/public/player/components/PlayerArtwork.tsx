import { useState } from "react";

import { displayTrackName } from "../../playerVoiceParts";
import { formatTrackKey } from "../format";
import type { PlayerPlaylistItem, ResolvedTrack } from "../types";

export function PlayerArtwork({
  artworkUrl,
  eventTitle,
}: {
  readonly artworkUrl: string | null;
  readonly eventTitle: string;
}) {
  const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(null);
  const isImageValid = Boolean(artworkUrl && failedArtworkUrl !== artworkUrl);

  return (
    <div className="public-player__artwork-container">
      {isImageValid && artworkUrl ? (
        <img
          alt={`${eventTitle} artwork`}
          className="public-player__artwork"
          onError={() => {
            setFailedArtworkUrl(artworkUrl);
          }}
          src={artworkUrl}
        />
      ) : (
        <div
          aria-hidden="true"
          className="public-player__artwork public-player__artwork--placeholder"
        >
          <svg
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}
    </div>
  );
}

function PlayerTrackBadge({
  currentTrack,
  item,
  onOpenPieceTrackSelector,
  trackLabels,
}: {
  readonly currentTrack: ResolvedTrack;
  readonly item: PlayerPlaylistItem;
  readonly onOpenPieceTrackSelector?: ((trigger: HTMLElement) => void) | undefined;
  readonly trackLabels?: Readonly<Record<string, string>> | undefined;
}) {
  const hasMultipleTracks =
    Object.values(item.trackFileIds).filter(
      (fileId) => typeof fileId === "string" && fileId.trim().length > 0,
    ).length > 1;
  const canChoosePieceTrack = Boolean(
    item.pieceId && hasMultipleTracks && onOpenPieceTrackSelector,
  );
  const className = `public-player__track-badge${currentTrack.pinned ? " public-player__track-badge--pinned" : ""}`;
  const content = (
    <>
      {currentTrack.pinned ? <span aria-hidden="true">📌 </span> : null}
      {formatTrackKey(currentTrack.key)}
    </>
  );

  if (!canChoosePieceTrack || !onOpenPieceTrackSelector) {
    return <span className={className}>{content}</span>;
  }

  return (
    <button
      aria-label={`Choose track for ${item.title}; currently ${currentTrack.pinned ? `pinned to ${displayTrackName(currentTrack.key, trackLabels)}` : displayTrackName(currentTrack.key, trackLabels)}`}
      aria-haspopup="dialog"
      className={className}
      onClick={(event) => {
        onOpenPieceTrackSelector(event.currentTarget);
      }}
      type="button"
    >
      {content}
    </button>
  );
}

function PlayerTrackStatus({
  activeTrackKey,
  currentTrack,
  onClearPin,
  trackLabels,
}: {
  readonly activeTrackKey: string;
  readonly currentTrack: ResolvedTrack;
  readonly onClearPin?: (() => void) | undefined;
  readonly trackLabels?: Readonly<Record<string, string>> | undefined;
}) {
  if (currentTrack.pinned) {
    return (
      <div
        className="notice notice--info public-player__fallback-status public-player__pinned-status"
        role="status"
      >
        <span>Pinned to {displayTrackName(currentTrack.key, trackLabels)} for this song</span>
        {onClearPin ? (
          <button className="text-button" onClick={onClearPin} type="button">
            Use {displayTrackName(activeTrackKey, trackLabels)}
          </button>
        ) : null}
      </div>
    );
  }

  if (!currentTrack.fallback) return null;
  return (
    <p className="notice notice--info public-player__fallback-status" role="status">
      {`Playing ${formatTrackKey(currentTrack.key)} — ${formatTrackKey(activeTrackKey)} track unavailable`}
    </p>
  );
}

export function PlayerTrackMetadata({
  activeTrackKey,
  currentTrack,
  item,
  onClearPin,
  onOpenPieceTrackSelector,
  trackLabels,
}: {
  readonly activeTrackKey: string;
  readonly currentTrack: ResolvedTrack;
  readonly item: PlayerPlaylistItem;
  readonly onClearPin?: (() => void) | undefined;
  readonly onOpenPieceTrackSelector?: ((trigger: HTMLElement) => void) | undefined;
  readonly trackLabels?: Readonly<Record<string, string>> | undefined;
}) {
  return (
    <div className="public-player__metadata">
      <div className="public-player__metadata-header">
        <h2 id="public-player-now-playing">{item.title}</h2>
        <PlayerTrackBadge
          currentTrack={currentTrack}
          item={item}
          onOpenPieceTrackSelector={onOpenPieceTrackSelector}
          trackLabels={trackLabels}
        />
      </div>
      {item.composer || item.arranger ? (
        <p className="public-player__artist">
          {item.composer ?? ""}
          {item.composer && item.arranger
            ? ` / arr. ${item.arranger}`
            : item.arranger
              ? `arr. ${item.arranger}`
              : ""}
        </p>
      ) : null}
      <PlayerTrackStatus
        activeTrackKey={activeTrackKey}
        currentTrack={currentTrack}
        onClearPin={onClearPin}
        trackLabels={trackLabels}
      />
    </div>
  );
}
