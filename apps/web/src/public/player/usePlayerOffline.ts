import { useEffect, useState } from "react";

import { resolveTrack } from "./format";
import type { PlayerPlaylistItem } from "./types";

/**
 * Resolves the cached URL for one track, keyed by file so track switches never flash a stale
 * copy. State updates happen only in async continuations, never synchronously in the effect.
 */
export function useOfflineAudioUrl(
  resolveOfflineUrl: (fileId: string) => Promise<string | null>,
  fileId: string | undefined,
): string | null {
  const [urls, setUrls] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    if (!fileId || urls[fileId]) return;
    let cancelled = false;
    void resolveOfflineUrl(fileId).then((url) => {
      if (cancelled || !url) return;
      setUrls((current) => (current[fileId] ? current : { ...current, [fileId]: url }));
    });
    return () => {
      cancelled = true;
    };
  }, [fileId, resolveOfflineUrl, urls]);

  return fileId ? (urls[fileId] ?? null) : null;
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
