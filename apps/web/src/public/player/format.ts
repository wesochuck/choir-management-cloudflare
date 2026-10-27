import { sortVoiceParts } from "../playerVoiceParts";
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

export function canonicalPartKey(key: string): string {
  const norm = normalizeKey(key);
  return norm
    .replace(/^soprano(\d*)$/, "s$1")
    .replace(/^alto(\d*)$/, "a$1")
    .replace(/^tenor(\d*)$/, "t$1")
    .replace(/^bass(\d*)$/, "b$1")
    .replace(/^baritone(\d*)$/, "bar$1")
    .replace(/^mezzosoprano(\d*)$/, "ms$1")
    .replace(/^mezzo(\d*)$/, "ms$1");
}

/**
 * Matches a requested part (for example a roster voice part such as "Tenor 2" or "T2")
 * against the track keys actually present, using label matching, exact/normalized matching,
 * and canonical part abbreviations. Returns null when nothing matches so callers fall back
 * to their default key or section-level track fallback.
 */
export function resolveTrackKey(
  trackKeys: readonly string[],
  requestedKey: string,
  trackLabels?: Readonly<Record<string, string>>,
): string | null {
  if (trackKeys.includes(requestedKey)) return requestedKey;
  const requestedNorm = normalizeKey(requestedKey);

  // Exact or normalized match
  const normMatch = trackKeys.find((key) => normalizeKey(key) === requestedNorm);
  if (normMatch) return normMatch;

  // Track label match (configured full names)
  if (trackLabels) {
    const labelMatch = trackKeys.find((key) => {
      const label = trackLabels[key];
      return label && normalizeKey(label) === requestedNorm;
    });
    if (labelMatch) return labelMatch;
  }

  // Canonical voice part match (e.g. "Tenor 2" <-> "t2", "Soprano 1" <-> "s1")
  const requestedCanonical = canonicalPartKey(requestedKey);
  const canonicalMatch = trackKeys.find((key) => canonicalPartKey(key) === requestedCanonical);
  if (canonicalMatch) return canonicalMatch;

  return null;
}

export function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function isFullMixKey(key: string): boolean {
  const norm = normalizeKey(key);
  return (
    norm === "tutti" ||
    norm === "choirmix" ||
    norm === "fullmix" ||
    norm === "all" ||
    norm === "ensemble"
  );
}

export function getSectionCandidates(requestedKey: string): {
  readonly isSectionRequest: boolean;
  readonly pureSectionKeys: string[];
} {
  const norm = normalizeKey(requestedKey);
  if (isFullMixKey(norm)) {
    return { isSectionRequest: false, pureSectionKeys: [] };
  }

  // Soprano
  if (/^(soprano|sop|s)(\d+)?$/.test(norm)) {
    const isSection = /^(soprano|sop|s)$/.test(norm);
    return { isSectionRequest: isSection, pureSectionKeys: ["s", "soprano", "sopranos"] };
  }
  // Alto
  if (/^(alto|alt|a)(\d+)?$/.test(norm)) {
    const isSection = /^(alto|alt|a)$/.test(norm);
    return { isSectionRequest: isSection, pureSectionKeys: ["a", "alto", "altos"] };
  }
  // Tenor
  if (/^(tenor|ten|t)(\d+)?$/.test(norm)) {
    const isSection = /^(tenor|ten|t)$/.test(norm);
    return { isSectionRequest: isSection, pureSectionKeys: ["t", "tenor", "tenors"] };
  }
  // Baritone / Bass
  if (/^(baritone|bar)(\d+)?$/.test(norm)) {
    const isSection = /^(baritone|bar)$/.test(norm);
    return {
      isSectionRequest: isSection,
      pureSectionKeys: ["baritone", "b", "bass", "basses", "baritones"],
    };
  }
  if (/^(bass|bas|b)(\d+)?$/.test(norm)) {
    const isSection = /^(bass|bas|b)$/.test(norm);
    return {
      isSectionRequest: isSection,
      pureSectionKeys: ["b", "bass", "basses", "baritone", "baritones"],
    };
  }
  // Mezzo-soprano
  if (/^(mezzosoprano|mezzo|ms|m)(\d+)?$/.test(norm)) {
    const isSection = /^(mezzosoprano|mezzo|ms|m)$/.test(norm);
    return { isSectionRequest: isSection, pureSectionKeys: ["m", "ms", "mezzo", "mezzosoprano"] };
  }

  // Generic prefix matching, e.g. "h1" -> "h", "voice2" -> "voice"
  const match = /^([a-z]+)(\d+)$/.exec(norm);
  if (match?.[1]) {
    return { isSectionRequest: false, pureSectionKeys: [match[1]] };
  }

  return { isSectionRequest: true, pureSectionKeys: [norm] };
}

export function resolveTrack(item: PlayerPlaylistItem, requestedKey: string): ResolvedTrack | null {
  const entries = Object.entries(item.trackFileIds).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].trim().length > 0,
  );
  if (entries.length === 0) return null;

  const requestedNorm = normalizeKey(requestedKey);

  // 1. Play part recording if available (exact, normalized, or canonical part match)
  const exactMatch = entries.find(([k]) => k === requestedKey);
  if (exactMatch) {
    return { fallback: false, fileId: exactMatch[1], key: exactMatch[0] };
  }
  const normMatch = entries.find(([k]) => normalizeKey(k) === requestedNorm);
  if (normMatch) {
    return { fallback: false, fileId: normMatch[1], key: normMatch[0] };
  }
  const requestedCanonical = canonicalPartKey(requestedKey);
  const canonicalMatch = entries.find(([k]) => canonicalPartKey(k) === requestedCanonical);
  if (canonicalMatch) {
    return { fallback: false, fileId: canonicalMatch[1], key: canonicalMatch[0] };
  }

  // 2. Play section recording track if available
  const { isSectionRequest, pureSectionKeys } = getSectionCandidates(requestedKey);
  for (const candidate of pureSectionKeys) {
    const sectionMatch = entries.find(([k]) => normalizeKey(k) === candidate);
    if (sectionMatch) {
      return { fallback: true, fileId: sectionMatch[1], key: sectionMatch[0] };
    }
  }

  // If the user requested a whole section (e.g. "S") and no pure section track was found,
  // check if any track within that section exists (e.g. "S1", "S2") before falling back to full mix.
  if (isSectionRequest) {
    const sectionPartMatch = entries.find(([k]) => {
      const { pureSectionKeys: partSectionKeys } = getSectionCandidates(k);
      return partSectionKeys.some((candidate) => pureSectionKeys.includes(candidate));
    });
    if (sectionPartMatch) {
      return { fallback: true, fileId: sectionPartMatch[1], key: sectionPartMatch[0] };
    }
  }

  // 3. Play full mix track if available
  const fullMixMatch = entries.find(([k]) => isFullMixKey(k));
  if (fullMixMatch) {
    return {
      fallback: !isFullMixKey(requestedKey),
      fileId: fullMixMatch[1],
      key: fullMixMatch[0],
    };
  }

  // 4. Play ANY file associated with the track
  const sortedEntries = [...entries].sort(([a], [b]) => {
    const order = sortVoiceParts([a, b]);
    return order[0] === a ? -1 : 1;
  });
  const anyMatch = sortedEntries[0];
  if (anyMatch) {
    return {
      fallback: true,
      fileId: anyMatch[1],
      key: anyMatch[0],
    };
  }

  return null;
}

export function resolveEffectiveTrack(
  item: PlayerPlaylistItem,
  globalTrackKey: string,
  pinnedTrackKey?: string | null,
): ResolvedTrack | null {
  const entries = Object.entries(item.trackFileIds).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].trim().length > 0,
  );

  if (pinnedTrackKey) {
    const pinnedKey = resolveTrackKey(
      entries.map(([key]) => key),
      pinnedTrackKey,
    );
    const pinnedEntry = entries.find(([key]) => key === pinnedKey);
    if (pinnedEntry) {
      return {
        fallback: false,
        fileId: pinnedEntry[1],
        key: pinnedEntry[0],
        pinned: true,
      };
    }
  }

  const fallbackTrack = resolveTrack(item, globalTrackKey);
  return fallbackTrack ? { ...fallbackTrack, pinned: false } : null;
}

const PINNED_PIECE_TRACKS_STORAGE_KEY = "choir.pinned-piece-tracks:v1";
export const MAX_PINNED_PIECE_TRACKS = 200;

function getPinnedTracksStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function limitPinnedPieceTracks(
  entries: readonly (readonly [string, string])[],
): Record<string, string> {
  return Object.fromEntries(entries.slice(-MAX_PINNED_PIECE_TRACKS));
}

function parsePinnedPieceTracks(stored: string | null): Record<string, string> {
  if (!stored) return {};
  const parsed: unknown = JSON.parse(stored);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const entries = Object.entries(parsed).filter(
    (entry): entry is [string, string] =>
      entry[0].trim().length > 0 && typeof entry[1] === "string" && entry[1].trim().length > 0,
  );
  return limitPinnedPieceTracks(entries);
}

export function readPinnedPieceTracks(): Record<string, string> {
  try {
    const storage = getPinnedTracksStorage();
    return parsePinnedPieceTracks(storage?.getItem(PINNED_PIECE_TRACKS_STORAGE_KEY) ?? null);
  } catch {
    return {};
  }
}

export function writePinnedPieceTrack(pieceId: string, trackKey: string): void {
  const normalizedPieceId = pieceId.trim();
  const normalizedTrackKey = trackKey.trim();
  if (!normalizedPieceId || !normalizedTrackKey) return;
  try {
    const storage = getPinnedTracksStorage();
    if (!storage) return;
    const existing = parsePinnedPieceTracks(storage.getItem(PINNED_PIECE_TRACKS_STORAGE_KEY));
    const entries = Object.entries(existing).filter(
      ([existingPieceId]) => existingPieceId !== normalizedPieceId,
    );
    entries.push([normalizedPieceId, normalizedTrackKey]);
    storage.setItem(
      PINNED_PIECE_TRACKS_STORAGE_KEY,
      JSON.stringify(limitPinnedPieceTracks(entries)),
    );
  } catch {
    // Private-mode storage failures must not break playback.
  }
}

export function clearPinnedPieceTrack(pieceId: string): void {
  const normalizedPieceId = pieceId.trim();
  if (!normalizedPieceId) return;
  try {
    const storage = getPinnedTracksStorage();
    if (!storage) return;
    const stored = storage.getItem(PINNED_PIECE_TRACKS_STORAGE_KEY);
    if (!stored) return;
    const existing = parsePinnedPieceTracks(stored);
    if (!Object.hasOwn(existing, normalizedPieceId)) return;
    const entries = Object.entries(existing).filter(
      ([existingPieceId]) => existingPieceId !== normalizedPieceId,
    );
    if (entries.length === 0) {
      storage.removeItem(PINNED_PIECE_TRACKS_STORAGE_KEY);
    } else {
      storage.setItem(PINNED_PIECE_TRACKS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    }
  } catch {
    // Private-mode storage failures must not break playback.
  }
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
