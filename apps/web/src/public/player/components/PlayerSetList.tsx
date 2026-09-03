import { formatTrackKey, playerMediaUrl, resolveTrack } from "../format";
import type { PlayerPlaylistItem } from "../types";

export function PlayerSetList({
  activeTrackKey,
  currentIndex,
  items,
  onSelectItem,
  playableItems,
  token,
}: {
  readonly activeTrackKey: string;
  readonly currentIndex: number;
  readonly items: readonly PlayerPlaylistItem[];
  readonly onSelectItem: (itemIndex: number) => void;
  readonly playableItems: readonly PlayerPlaylistItem[];
  readonly token: string;
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
        Choose a track to start practicing. Part and section tracks fall back to Tutti when a
        specific recording is not available.
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
                      {track.fallback ? "Tutti fallback" : formatTrackKey(track.key)}
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
                  href={playerMediaUrl(track.fileId, token)}
                >
                  Download
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
