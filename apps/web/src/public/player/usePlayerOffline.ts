import { useEffect, useState } from "react";

import type { OfflineAudioLease } from "../../offline/mediaStore";
import { resolveTrack } from "./format";
import type { PlayerPlaylistItem } from "./types";

/**
 * Resolves the cached URL for one track, keyed by file so track switches never flash a stale
 * copy. Re-resolves when the known offline set grows, so a copy that lands just after the first
 * lookup (transparent auto-cache in flight) is picked up instead of streaming forever. State
 * updates happen only in async continuations, never synchronously in the effect.
 *
 * When `acquireOfflineUrl` is provided, holds an explicit `OfflineAudioLease` for the active track
 * and releases it on track replacement or component unmount, preventing URL leaks.
 */
export function useOfflineAudioUrl(
  resolveOfflineUrl: (fileId: string) => Promise<string | null>,
  fileId: string | undefined,
  offlineIds: ReadonlySet<string>,
  acquireOfflineUrl?: (fileId: string) => Promise<OfflineAudioLease | null>,
): string | null {
  const [activeUrl, setActiveUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    let leaseToRelease: OfflineAudioLease | null = null;

    if (acquireOfflineUrl) {
      void acquireOfflineUrl(fileId).then((lease) => {
        if (cancelled) {
          lease?.release();
          return;
        }
        if (lease) {
          leaseToRelease = lease;
          setActiveUrl(lease.url);
        } else {
          setActiveUrl(null);
        }
      });
    } else {
      void resolveOfflineUrl(fileId).then((url) => {
        if (cancelled) return;
        setActiveUrl(url);
      });
    }

    return () => {
      cancelled = true;
      if (leaseToRelease) {
        leaseToRelease.release();
        leaseToRelease = null;
      }
    };
  }, [acquireOfflineUrl, fileId, offlineIds, resolveOfflineUrl]);

  return activeUrl;
}

/**
 * Transparently caches the open event's tracks for the active voice part. Resolution already
 * falls back to the full mix, so the cached set is exactly part-plus-fallback per item.
 */
export function useAutoCacheOfflineCopies(
  scope: string,
  items: readonly PlayerPlaylistItem[],
  activeTrackKey: string,
  ensureOfflineCopies: (fileIds: readonly string[]) => void,
): void {
  useEffect(() => {
    if (!scope) return;
    const fileIds = new Set<string>();
    for (const item of items) {
      const track = resolveTrack(item, activeTrackKey);
      if (track) fileIds.add(track.fileId);
    }
    ensureOfflineCopies([...fileIds]);
  }, [activeTrackKey, ensureOfflineCopies, items, scope]);
}
