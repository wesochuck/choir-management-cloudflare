import { useCallback, useEffect, useRef, useState } from "react";

import {
  listOfflineAudioIds,
  offlineAudioUrl,
  removeOfflineAudio,
  saveOfflineAudio,
  type OfflineAudioSource,
} from "./mediaStore";

export interface OfflineAudioOrigin {
  readonly kind: OfflineAudioSource;
  mediaUrl(fileId: string): string;
}

export interface UseOfflineCopiesOptions {
  readonly scope: string;
  readonly source: OfflineAudioOrigin;
}

export interface OfflineCopies {
  readonly ensureOfflineCopies: (fileIds: readonly string[]) => void;
  readonly offlineIds: ReadonlySet<string>;
  readonly online: boolean;
  readonly removeOfflineCopy: (fileId: string) => Promise<void>;
  readonly resolveOfflineUrl: (fileId: string) => Promise<string | null>;
  readonly saveOfflineCopy: (fileId: string) => Promise<void>;
}

/**
 * Offline Copies for one player instance. `scope` is empty outside the browser, which disables
 * every operation so server rendering stays pure. The server does not expose the organization ID
 * to player clients, so token-source copies record a null organization; host scoping plus
 * source-scoped purge on sign-out keep them correctly isolated.
 */
export function useOfflineCopies({ scope, source }: UseOfflineCopiesOptions): OfflineCopies {
  const [offlineIds, setOfflineIds] = useState<ReadonlySet<string>>(new Set());
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const inFlight = useRef(new Set<string>());
  const urls = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void listOfflineAudioIds(scope)
      .then((ids) => {
        if (!cancelled) setOfflineIds(ids);
      })
      .catch(() => {
        // Storage may be unavailable (private mode); streaming still works online.
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = (): void => {
      setOnline(navigator.onLine);
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const resolveOfflineUrl = useCallback(
    async (fileId: string): Promise<string | null> => {
      const cached = urls.current[fileId];
      if (cached) return cached;
      if (!scope) return null;
      const url = await offlineAudioUrl(scope, fileId);
      if (url) urls.current[fileId] = url;
      return url;
    },
    [scope],
  );

  const saveOfflineCopy = useCallback(
    async (fileId: string): Promise<void> => {
      if (!scope) throw new Error("Offline storage is unavailable.");
      await saveOfflineAudio(scope, fileId, source.mediaUrl(fileId), { source: source.kind });
      setOfflineIds(await listOfflineAudioIds(scope));
    },
    [scope, source],
  );

  const ensureOfflineCopies = useCallback(
    (fileIds: readonly string[]) => {
      if (!scope) return;
      void (async (): Promise<void> => {
        try {
          const known = new Set(await listOfflineAudioIds(scope));
          for (const fileId of fileIds) {
            if (typeof navigator !== "undefined" && !navigator.onLine) break;
            if (known.has(fileId) || inFlight.current.has(fileId)) continue;
            inFlight.current.add(fileId);
            try {
              await saveOfflineAudio(scope, fileId, source.mediaUrl(fileId), {
                source: source.kind,
              });
              known.add(fileId);
              setOfflineIds(new Set(known));
            } catch {
              // Background best-effort: a failed copy stays streamable while online.
            } finally {
              inFlight.current.delete(fileId);
            }
          }
        } catch {
          // Storage may be unavailable (private mode); streaming still works online.
        }
      })();
    },
    [scope, source],
  );

  const removeOfflineCopy = useCallback(
    async (fileId: string): Promise<void> => {
      if (!scope) return;
      await removeOfflineAudio(scope, fileId);
      urls.current = Object.fromEntries(
        Object.entries(urls.current).filter(([key]) => key !== fileId),
      );
      setOfflineIds(await listOfflineAudioIds(scope));
    },
    [scope],
  );

  return {
    ensureOfflineCopies,
    offlineIds,
    online,
    removeOfflineCopy,
    resolveOfflineUrl,
    saveOfflineCopy,
  };
}
