import { getPublicPlayerDetails, getPublicPlayerPlaylist } from "../../api";
import { getCachedPlayerMetadata, saveCachedPlayerMetadata } from "../../offline/mediaStore";
import { isPlayerDetails, isPlayerPlaylistItem, isRecord } from "./guards";
import type { PlayerDetails, PlayerPlaylistItem } from "./types";

function normalizePlaylistItem(item: {
  readonly title: string;
  readonly arranger?: unknown;
  readonly composer?: unknown;
  readonly durationSeconds?: unknown;
  readonly isFeaturedNumber?: unknown;
  readonly notes?: unknown;
  readonly pieceId?: unknown;
  readonly trackFileIds?: unknown;
}): PlayerPlaylistItem {
  const trackFileIds: Record<string, string> = {};
  if (isRecord(item.trackFileIds)) {
    for (const [key, value] of Object.entries(item.trackFileIds)) {
      if (typeof value === "string") {
        trackFileIds[key] = value;
      }
    }
  }
  return {
    arranger: typeof item.arranger === "string" ? item.arranger : undefined,
    composer: typeof item.composer === "string" ? item.composer : undefined,
    durationSeconds: typeof item.durationSeconds === "number" ? item.durationSeconds : undefined,
    isFeaturedNumber:
      typeof item.isFeaturedNumber === "boolean" ? item.isFeaturedNumber : undefined,
    notes: typeof item.notes === "string" ? item.notes : undefined,
    pieceId: typeof item.pieceId === "string" ? item.pieceId : undefined,
    title: item.title,
    trackFileIds,
  };
}

function parsePlayerDetails(data: unknown): PlayerDetails {
  if (!isPlayerDetails(data)) throw new Error("invalid_response");
  return {
    eventArtworkFileId:
      typeof data.eventArtworkFileId === "string" ? data.eventArtworkFileId : null,
    eventId: data.eventId,
    eventTitle: data.eventTitle,
    eventStartsAt: data.eventStartsAt,
    items: data.items.map(normalizePlaylistItem),
    organizationName: typeof data.organizationName === "string" ? data.organizationName : undefined,
    performerLabel: typeof data.performerLabel === "string" ? data.performerLabel : "Performer",
    profileName: typeof data.profileName === "string" ? data.profileName : undefined,
  };
}

function parsePublicPlaylistDetails(data: unknown): PlayerDetails {
  if (!isRecord(data) || !isRecord(data.event) || !Array.isArray(data.pieces)) {
    throw new Error("invalid_response");
  }
  const { event } = data;
  if (
    typeof event.id !== "string" ||
    typeof event.title !== "string" ||
    typeof event.date !== "string" ||
    !data.pieces.every(isPlayerPlaylistItem)
  ) {
    throw new Error("invalid_response");
  }
  return {
    eventArtworkFileId: typeof event.artworkFileId === "string" ? event.artworkFileId : null,
    eventId: event.id,
    eventTitle: event.title,
    eventStartsAt: event.date,
    items: data.pieces.map(normalizePlaylistItem),
    organizationName: typeof data.organizationName === "string" ? data.organizationName : undefined,
    performerLabel: typeof data.performerLabel === "string" ? data.performerLabel : "Performer",
  };
}

async function loadCachedMetadata(
  scope: string,
  key: string,
  parseCachedDetails: (data: unknown) => PlayerDetails,
): Promise<PlayerDetails | null> {
  if (!scope) return null;
  try {
    const cached = await getCachedPlayerMetadata(scope, key);
    if (!cached) return null;
    return parseCachedDetails(cached);
  } catch (error: unknown) {
    console.debug("Failed to read cached player metadata:", error);
    return null;
  }
}

function classifyPlayerError(error: unknown): Error {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return new Error("offline", { cause: error });
  }
  return error instanceof Error && error.message === "invalid_response"
    ? error
    : new Error("not_found", { cause: error });
}

export async function fetchPlayerDetails(token: string): Promise<PlayerDetails> {
  const scope = typeof window === "undefined" ? "" : window.location.host;
  if (typeof navigator !== "undefined" && !navigator.onLine && scope) {
    const cached = await loadCachedMetadata(scope, `details:${token}`, parsePlayerDetails);
    if (cached) return cached;
    throw new Error("offline");
  }

  try {
    const data = await getPublicPlayerDetails(token);
    const details = parsePlayerDetails(data);
    if (scope) {
      try {
        await saveCachedPlayerMetadata(scope, `details:${token}`, details);
      } catch (error: unknown) {
        console.debug("Failed to cache player metadata:", error);
      }
    }
    return details;
  } catch (error) {
    const cached = await loadCachedMetadata(scope, `details:${token}`, parsePlayerDetails);
    if (cached) return cached;
    throw classifyPlayerError(error);
  }
}

export async function fetchPublicPlayerPlaylist(token: string): Promise<PlayerDetails> {
  const scope = typeof window === "undefined" ? "" : window.location.host;
  // In both event details and playlist modes, metadata is saved to IndexedDB in normalized
  // PlayerDetails shape, so parsePlayerDetails validates cached records for both.
  if (typeof navigator !== "undefined" && !navigator.onLine && scope) {
    const cached = await loadCachedMetadata(scope, `playlist:${token}`, parsePlayerDetails);
    if (cached) return cached;
    throw new Error("offline");
  }

  try {
    const data = await getPublicPlayerPlaylist(token);
    const details = parsePublicPlaylistDetails(data);
    if (scope) {
      try {
        await saveCachedPlayerMetadata(scope, `playlist:${token}`, details);
      } catch (error: unknown) {
        console.debug("Failed to cache player playlist metadata:", error);
      }
    }
    return details;
  } catch (error) {
    const cached = await loadCachedMetadata(scope, `playlist:${token}`, parsePlayerDetails);
    if (cached) return cached;
    throw classifyPlayerError(error);
  }
}
