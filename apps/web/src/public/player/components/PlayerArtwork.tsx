import { useState } from "react";

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

export function PlayerTrackMetadata({
  activeTrackKey,
  currentTrack,
  item,
}: {
  readonly activeTrackKey: string;
  readonly currentTrack: ResolvedTrack;
  readonly item: PlayerPlaylistItem;
}) {
  return (
    <div className="public-player__metadata">
      <div className="public-player__metadata-header">
        <h2 id="public-player-now-playing">{item.title}</h2>
        <span className="public-player__track-badge">{formatTrackKey(currentTrack.key)}</span>
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
      {currentTrack.fallback ? (
        <p className="notice notice--info public-player__fallback-status" role="status">
          {`Playing ${formatTrackKey(currentTrack.key)} — ${formatTrackKey(activeTrackKey)} track unavailable`}
        </p>
      ) : null}
    </div>
  );
}
