import type { PlayerPlaylistItem, ResolvedTrack } from "./types";

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  });
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const wholeSeconds = Math.floor(seconds);
  return `${String(Math.floor(wholeSeconds / 60))}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

export function formatTrackKey(key: string): string {
  if (key === "tutti") return "Tutti";
  return key.toUpperCase();
}

export function availableTrackKeys(items: readonly PlayerPlaylistItem[]): string[] {
  const keys = new Set(items.flatMap((item) => Object.keys(item.trackFileIds)));
  return [...keys].sort((left, right) => {
    if (left === right) return 0;
    if (left === "tutti") return -1;
    if (right === "tutti") return 1;
    return left.localeCompare(right);
  });
}

export function resolveTrack(item: PlayerPlaylistItem, requestedKey: string): ResolvedTrack | null {
  const requestedFileId = item.trackFileIds[requestedKey];
  if (requestedFileId) {
    return { fallback: false, fileId: requestedFileId, key: requestedKey };
  }
  const tuttiFileId = item.trackFileIds.tutti;
  if (tuttiFileId) {
    return { fallback: requestedKey !== "tutti", fileId: tuttiFileId, key: "tutti" };
  }
  return null;
}

export function playerMediaUrl(fileId: string, token: string): string {
  return `/api/public/player/media/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`;
}

export function updateMediaSessionPosition(
  currentTime: number,
  duration: number,
  audio: HTMLAudioElement | null,
): void {
  if (
    "mediaSession" in navigator &&
    typeof navigator.mediaSession.setPositionState === "function" &&
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(currentTime) &&
    currentTime >= 0 &&
    currentTime <= duration
  ) {
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: audio?.playbackRate ?? 1,
        position: currentTime,
      });
    } catch {
      // Gracefully ignore position sync errors
    }
  }
}
