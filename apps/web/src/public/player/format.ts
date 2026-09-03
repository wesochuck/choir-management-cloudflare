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

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function isFullMixKey(key: string): boolean {
  const norm = normalizeKey(key);
  return (
    norm === "tutti" ||
    norm === "choirmix" ||
    norm === "fullmix" ||
    norm === "all" ||
    norm === "ensemble"
  );
}

function getSectionCandidates(requestedKey: string): {
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

  // 1. Play part recording if available (exact or normalized match)
  const exactMatch = entries.find(([k]) => k === requestedKey);
  if (exactMatch) {
    return { fallback: false, fileId: exactMatch[1], key: exactMatch[0] };
  }
  const normMatch = entries.find(([k]) => normalizeKey(k) === requestedNorm);
  if (normMatch) {
    return { fallback: false, fileId: normMatch[1], key: normMatch[0] };
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
