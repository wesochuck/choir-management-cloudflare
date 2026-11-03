import { useCallback, useMemo, useState } from "react";

import {
  clearPinnedPieceTrack,
  isFullMixKey,
  MAX_PINNED_PIECE_TRACKS,
  readPinnedPieceTracks,
  resolveEffectiveTrack,
  resolveTrack,
  resolveTrackKey,
  writePinnedPieceTrack,
} from "./format";
import type { PracticeTrackSource } from "./source";
import type { PlayerPlaylistItem, ResolvedTrack } from "./types";
import type { RosterPartResolution } from "./useRosterPart";

export function findInitialSelectedItemIndex(
  items: readonly PlayerPlaylistItem[],
  initialPieceId?: string,
  initialTrackKey?: string,
): number {
  if (!initialPieceId) return 0;
  const initialKey = initialTrackKey?.trim() ? initialTrackKey.trim() : "all";
  const initialPlayable = items.filter((item) => resolveTrack(item, initialKey) !== null);
  const found = initialPlayable.findIndex((item) => item.pieceId === initialPieceId);
  return found >= 0 ? found : 0;
}

export function resolveSelectedTrackKey(
  userOverrideTrackKey: string | null,
  initialTrackKey: string | undefined,
  allTrackKeys: readonly string[],
  trackLabels?: Record<string, string>,
): string {
  if (userOverrideTrackKey !== null) return userOverrideTrackKey;
  if (initialTrackKey) {
    return resolveTrackKey(allTrackKeys, initialTrackKey, trackLabels) ?? initialTrackKey;
  }
  return allTrackKeys[0] ?? "tutti";
}

export function computeActiveTrackKey(
  selectedTrackKey: string,
  allTrackKeys: readonly string[],
  hasInitialTrackKey: boolean,
): string {
  if (allTrackKeys.includes(selectedTrackKey) || hasInitialTrackKey) {
    return selectedTrackKey;
  }
  return allTrackKeys[0] ?? "tutti";
}

export function computeAudioSrc(
  offlineUrl: string | null,
  currentTrack: { readonly fileId: string } | null,
  source: PracticeTrackSource,
): string {
  if (offlineUrl) return offlineUrl;
  if (currentTrack) return source.mediaUrl(currentTrack.fileId);
  return "";
}

export function resolvePlayerItemTrack(
  item: PlayerPlaylistItem,
  activeTrackKey: string,
  pinnedTracksByPieceId: Readonly<Record<string, string>>,
): ResolvedTrack | null {
  const pinnedTrackKey = item.pieceId ? pinnedTracksByPieceId[item.pieceId] : null;
  return resolveEffectiveTrack(item, activeTrackKey, pinnedTrackKey);
}

export function resolveCurrentPlayerTrack(
  item: PlayerPlaylistItem | null,
  activeTrackKey: string,
  pinnedTracksByPieceId: Readonly<Record<string, string>>,
): ResolvedTrack | null {
  if (!item) return null;
  return resolvePlayerItemTrack(item, activeTrackKey, pinnedTracksByPieceId);
}

export function pinnedTrackForItem(
  item: PlayerPlaylistItem | null,
  pinnedTracksByPieceId: Readonly<Record<string, string>>,
): string | null {
  return item?.pieceId ? (pinnedTracksByPieceId[item.pieceId] ?? null) : null;
}

function updatePinnedPieceTracks(
  current: Readonly<Record<string, string>>,
  pieceId: string,
  trackKey: string | null,
): Readonly<Record<string, string>> {
  const entries = Object.entries(current).filter(
    ([existingPieceId]) => existingPieceId !== pieceId,
  );
  if (trackKey) entries.push([pieceId, trackKey]);
  return Object.fromEntries(entries.slice(-MAX_PINNED_PIECE_TRACKS));
}

export function usePinnedPieceTrackState() {
  const [pinnedTracksByPieceId, setPinnedTracksByPieceId] = useState<
    Readonly<Record<string, string>>
  >(() => readPinnedPieceTracks());
  const pinPieceTrack = useCallback((pieceId: string, trackKey: string | null) => {
    if (trackKey) writePinnedPieceTrack(pieceId, trackKey);
    else clearPinnedPieceTrack(pieceId);
    setPinnedTracksByPieceId((current) => updatePinnedPieceTracks(current, pieceId, trackKey));
  }, []);
  return { pinPieceTrack, pinnedTracksByPieceId };
}

export function usePieceSelectorLaunch() {
  const [launch, setLaunch] = useState({
    request: 0,
    restoreFocusElement: null as HTMLElement | null,
  });
  const openPieceSelector = useCallback((trigger: HTMLElement) => {
    setLaunch((current) => ({ request: current.request + 1, restoreFocusElement: trigger }));
  }, []);
  return { ...launch, openPieceSelector };
}

export function clearPinForItem(
  item: PlayerPlaylistItem | null,
  pinPieceTrack: (pieceId: string, trackKey: string | null) => void,
): void {
  if (item?.pieceId) pinPieceTrack(item.pieceId, null);
}

/**
 * Tab-scoped persistence for an explicitly chosen practice part, so the
 * choice survives refreshes and reloads even for visitors without a login
 * (who have no roster part to restore from). Session storage is
 * origin-bound, and one hostname resolves to one Organization. A roster
 * assigned part always wins over this cache; the cache only fills the gap
 * when no assigned part exists.
 */
const PERSISTED_TRACK_KEY_STORAGE_KEY = "choir.selected-part:v1";

function readPersistedTrackKey(): string | null {
  try {
    return sessionStorage.getItem(PERSISTED_TRACK_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writePersistedTrackKey(key: string): void {
  try {
    sessionStorage.setItem(PERSISTED_TRACK_KEY_STORAGE_KEY, key);
  } catch {
    // Private-mode storage failures must not break playback.
  }
}

/**
 * Tab-scoped persistence for an explicitly chosen practice part, so the
 * choice survives refreshes and reloads even for visitors without a login
 * (who have no roster part to restore from). A roster assigned part always
 * wins; the cache only fills the gap when no assigned part exists, and keys
 * that do not resolve against the current playlist fall back to the
 * default. Fresh in-session choices take precedence over the cached value.
 */
export function usePersistedTrackKeyOverride(
  allTrackKeys: readonly string[],
  trackLabels: Record<string, string> | undefined,
  rosterProfile: RosterPartResolution | undefined,
): string | null {
  const hasAssignedRosterPart =
    rosterProfile?.status === "assigned" &&
    rosterProfile.voicePart !== null &&
    !isFullMixKey(rosterProfile.voicePart);
  return useMemo(() => {
    if (hasAssignedRosterPart) return null;
    const persisted = readPersistedTrackKey();
    if (!persisted) return null;
    return resolveTrackKey(allTrackKeys, persisted, trackLabels);
  }, [allTrackKeys, hasAssignedRosterPart, trackLabels]);
}

export function getPlayerMetadata(
  currentItem: PlayerPlaylistItem | null,
  currentTrack: ResolvedTrack | null,
  eventId?: string,
) {
  const isSetList = Boolean(eventId);
  return {
    currentTrackFileId: currentTrack ? currentTrack.fileId : "",
    hasTrack: currentItem !== null && currentTrack !== null,
    isSetList,
    setListHeading: isSetList ? "Set List" : "Library tracks",
  };
}
