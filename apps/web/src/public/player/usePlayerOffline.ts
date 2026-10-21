import { useEffect, useState } from "react";

import type { OfflineAudioLease } from "../../offline/mediaStore";
import { resolveTrack } from "./format";
import type { PlayerPlaylistItem } from "./types";

/**
 * Resolves the cached URL for one track, keyed by file so track switches never flash a stale
 * copy. Re-resolves when this file becomes available offline, so a copy that lands just after the first
 * lookup (transparent auto-cache in flight) is picked up instead of streaming forever. State
 * updates happen only in async continuations, never synchronously in the effect.
 *
 * When `acquireOfflineUrl` is provided, holds an explicit `OfflineAudioLease` for the active track
 * and releases it on track replacement or component unmount, preventing URL leaks.
 */
export function useOfflineAudio(
  resolveOfflineUrl: (fileId: string) => Promise<string | null>,
  fileId: string | undefined,
  offlineIds: ReadonlySet<string>,
  acquireOfflineUrl?: (fileId: string) => Promise<OfflineAudioLease | null>,
): { readonly url: string | null; readonly contentVersion: string | null } {
  const [resolved, setResolved] = useState<{
    readonly fileId: string;
    readonly contentVersion?: string | null | undefined;
    readonly resolver: typeof resolveOfflineUrl;
    readonly acquirer: typeof acquireOfflineUrl;
    readonly url: string | null;
  } | null>(null);
  const isAvailable = fileId !== undefined && offlineIds.has(fileId);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    let leaseToRelease: OfflineAudioLease | null = null;

    if (acquireOfflineUrl) {
      void acquireOfflineUrl(fileId).then(
        (lease) => {
          if (cancelled) {
            lease?.release();
            return;
          }
          if (lease) {
            leaseToRelease = lease;
            setResolved({
              fileId,
              resolver: resolveOfflineUrl,
              acquirer: acquireOfflineUrl,
              url: lease.url,
              contentVersion: lease.contentVersion,
            });
          } else {
            setResolved({
              fileId,
              resolver: resolveOfflineUrl,
              acquirer: acquireOfflineUrl,
              url: null,
            });
          }
        },
        () => {
          // Storage may be unavailable (private mode); streaming still works online.
        },
      );
    } else {
      void resolveOfflineUrl(fileId).then(
        (url) => {
          if (cancelled) return;
          setResolved({ fileId, resolver: resolveOfflineUrl, acquirer: acquireOfflineUrl, url });
        },
        () => {
          // Storage may be unavailable (private mode); streaming still works online.
        },
      );
    }

    return () => {
      cancelled = true;
      if (leaseToRelease) {
        leaseToRelease.release();
        leaseToRelease = null;
      }
    };
  }, [acquireOfflineUrl, fileId, isAvailable, resolveOfflineUrl]);

  return resolved !== null &&
    resolved.fileId === fileId &&
    resolved.resolver === resolveOfflineUrl &&
    resolved.acquirer === acquireOfflineUrl
    ? { url: resolved.url, contentVersion: resolved.contentVersion ?? null }
    : { url: null, contentVersion: null };
}

/** Compatibility helper for callers that only need the playable URL. */
export function useOfflineAudioUrl(
  resolveOfflineUrl: (fileId: string) => Promise<string | null>,
  fileId: string | undefined,
  offlineIds: ReadonlySet<string>,
  acquireOfflineUrl?: (fileId: string) => Promise<OfflineAudioLease | null>,
): string | null {
  return useOfflineAudio(resolveOfflineUrl, fileId, offlineIds, acquireOfflineUrl).url;
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
  priorityFileId?: string,
): void {
  useEffect(() => {
    if (!scope) return;
    const fileIds = new Set<string>();
    if (priorityFileId) {
      fileIds.add(priorityFileId);
    }
    for (const item of items) {
      const track = resolveTrack(item, activeTrackKey);
      if (track) fileIds.add(track.fileId);
    }
    ensureOfflineCopies([...fileIds]);
  }, [activeTrackKey, ensureOfflineCopies, items, priorityFileId, scope]);
}
