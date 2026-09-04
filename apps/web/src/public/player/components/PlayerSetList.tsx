import { formatTrackKey, resolveTrack } from "../format";
import type { PracticeTrackSource } from "../source";
import type { PlayerPlaylistItem } from "../types";

export function PlayerSetList({
  activeTrackKey,
  currentIndex,
  items,
  offlineIds,
  onRemoveOfflineCopy,
  onSaveOfflineCopy,
  onSelectItem,
  online,
  pendingOfflineIds,
  playableItems,
  source,
}: {
  readonly activeTrackKey: string;
  readonly currentIndex: number;
  readonly items: readonly PlayerPlaylistItem[];
  readonly offlineIds: ReadonlySet<string>;
  readonly onRemoveOfflineCopy: (fileId: string) => void;
  readonly onSaveOfflineCopy: (fileId: string) => void;
  readonly onSelectItem: (itemIndex: number) => void;
  readonly online: boolean;
  readonly pendingOfflineIds: ReadonlySet<string>;
  readonly playableItems: readonly PlayerPlaylistItem[];
  readonly source: PracticeTrackSource;
}) {
  return (
    <section aria-labelledby="public-player-set-list" className="public-player__set-list">
      <div className="public-player__set-list-heading">
        <div>
          <h2 id="public-player-set-list">Set List</h2>
          <p>{String(items.length)} tracks</p>
        </div>
      </div>
      <p className="public-player__set-list-help">
        Choose a track to start practicing. Part and section tracks fall back to an available
        recording when a specific track is not available.
      </p>
      <ol className="public-player__queue-list">
        {items.map((item, index) => {
          const track = resolveTrack(item, activeTrackKey);
          const itemIndex = playableItems.indexOf(item);
          const active = itemIndex === currentIndex && currentIndex !== -1;
          return (
            <li
              className={active ? "is-active" : undefined}
              key={item.pieceId ?? `${item.title}-${String(index)}`}
            >
              <button
                className="public-player__set-list-item"
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
                <span className="public-player__set-list-item-status">
                  {active ? (
                    <span className="public-player__now-playing-pill">Now Playing</span>
                  ) : null}
                  {track ? (
                    <span className="public-player__item-track">
                      {track.fallback
                        ? `${formatTrackKey(track.key)} fallback`
                        : formatTrackKey(track.key)}
                    </span>
                  ) : (
                    <span className="public-player__item-track public-player__item-track--unavailable">
                      Unavailable
                    </span>
                  )}
                </span>
              </button>
              {track ? (
                <a
                  aria-label={`Download ${item.title}`}
                  className="button button--secondary button--small public-player__download-btn"
                  download
                  href={source.mediaUrl(track.fileId)}
                >
                  Download
                </a>
              ) : null}
              {track ? (
                offlineIds.has(track.fileId) ? (
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
                ) : null
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
