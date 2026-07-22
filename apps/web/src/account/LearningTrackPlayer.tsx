import type { SingerLearningTrackPiece } from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";

import { AuthApiError, listSingerLearningTracks } from "../auth/api";
import {
  listOfflineAudioIds,
  offlineAudioUrl,
  removeOfflineAudio,
  saveOfflineAudio,
} from "../offline/mediaStore";

interface LearningTrack {
  readonly fileId: string;
  readonly key: string;
  readonly parentTitle: string | null;
  readonly piece: SingerLearningTrackPiece;
}

function tracksFrom(pieces: readonly SingerLearningTrackPiece[]): LearningTrack[] {
  const titles = new Map(pieces.map(({ id, title }) => [id, title]));
  return pieces.flatMap((piece) =>
    Object.entries(piece.trackFileIds).map(([key, fileId]) => ({
      fileId,
      key,
      parentTitle: piece.parentId ? (titles.get(piece.parentId) ?? null) : null,
      piece,
    })),
  );
}

function trackLabel(key: string): string {
  return key === "tutti" ? "Tutti / full mix" : key;
}

export function LearningTrackPlayer({ enabled }: { readonly enabled: boolean }) {
  const [pieces, setPieces] = useState<readonly SingerLearningTrackPiece[]>([]);
  const [offlineIds, setOfflineIds] = useState<ReadonlySet<string>>(new Set());
  const [offlineUrls, setOfflineUrls] = useState<Readonly<Record<string, string>>>({});
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = window.location.host;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    listSingerLearningTracks(controller.signal)
      .then(async (catalog) => {
        const tracks = tracksFrom(catalog);
        const downloaded = await listOfflineAudioIds(scope).catch(() => new Set<string>());
        const urls = Object.fromEntries(
          (
            await Promise.all(
              tracks
                .filter(({ fileId }) => downloaded.has(fileId))
                .map(async ({ fileId }) => [fileId, await offlineAudioUrl(scope, fileId)] as const),
            )
          ).flatMap(([fileId, url]) => (url ? [[fileId, url] as const] : [])),
        );
        setPieces(catalog);
        setOfflineIds(downloaded);
        setOfflineUrls(urls);
        setLoaded(true);
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(
            caught instanceof AuthApiError
              ? caught.message
              : "The Organization practice library could not be loaded.",
          );
          setLoaded(true);
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled, scope]);

  const tracks = useMemo(() => tracksFrom(pieces), [pieces]);

  async function save(track: LearningTrack): Promise<void> {
    setBusyFileId(track.fileId);
    setError(null);
    try {
      await saveOfflineAudio(scope, track.fileId, `/api/organization/files/${track.fileId}`);
      const url = await offlineAudioUrl(scope, track.fileId);
      setOfflineIds((current) => new Set([...current, track.fileId]));
      if (url) setOfflineUrls((current) => ({ ...current, [track.fileId]: url }));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The track could not be saved offline.");
    } finally {
      setBusyFileId(null);
    }
  }

  async function remove(track: LearningTrack): Promise<void> {
    setBusyFileId(track.fileId);
    setError(null);
    try {
      await removeOfflineAudio(scope, track.fileId);
      setOfflineIds((current) => new Set([...current].filter((id) => id !== track.fileId)));
      setOfflineUrls((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => id !== track.fileId)),
      );
    } catch {
      setError("The offline copy could not be removed.");
    } finally {
      setBusyFileId(null);
    }
  }

  if (!enabled) return null;

  return (
    <section className="account-section" aria-labelledby="practice-library-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Practice</p>
        <h2 id="practice-library-title">Learning tracks</h2>
        <p className="section-description">
          Play private Organization audio or save individual tracks in this browser for practice
          while the app remains open without a connection.
        </p>
      </div>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {!loaded ? <p>Loading learning tracks…</p> : null}
      {loaded && tracks.length === 0 ? (
        <p className="empty-state">No private learning tracks are available yet.</p>
      ) : (
        <ul className="learning-track-list">
          {tracks.map((track) => {
            const saved = offlineIds.has(track.fileId);
            const source = offlineUrls[track.fileId] ?? `/api/organization/files/${track.fileId}`;
            return (
              <li key={`${track.piece.id}-${track.key}`}>
                <div className="learning-track-heading">
                  <div>
                    <h3>{track.piece.title}</h3>
                    {track.parentTitle ? <p>{track.parentTitle}</p> : null}
                    <p>
                      {trackLabel(track.key)}
                      {track.piece.composer ? ` · ${track.piece.composer}` : ""}
                    </p>
                  </div>
                  {saved ? <span className="status-pill">Saved offline</span> : null}
                </div>
                <audio controls preload="metadata" src={source}>
                  <track kind="captions" />
                </audio>
                <div className="button-row">
                  <a download href={`/api/organization/files/${track.fileId}`}>
                    Download file
                  </a>
                  <button
                    className="button button--secondary"
                    disabled={busyFileId !== null}
                    type="button"
                    onClick={() => void (saved ? remove(track) : save(track))}
                  >
                    {busyFileId === track.fileId
                      ? "Working…"
                      : saved
                        ? "Remove offline copy"
                        : "Save for offline practice"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
