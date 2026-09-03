import { getPublicPlayerDetails, getPublicPlayerPlaylist } from "../../api";
import { isPlayerDetails, isPlayerPlaylistItem, isRecord, isStringRecord } from "./guards";
import type { PlayerDetails } from "./types";

export async function fetchPlayerDetails(token: string): Promise<PlayerDetails> {
  try {
    const data = await getPublicPlayerDetails(token);
    if (!isPlayerDetails(data)) throw new Error("invalid_response");
    return {
      eventArtworkFileId:
        typeof data.eventArtworkFileId === "string" ? data.eventArtworkFileId : null,
      eventId: data.eventId,
      eventTitle: data.eventTitle,
      eventStartsAt: data.eventStartsAt,
      items: data.items.map((item) => ({
        arranger: typeof item.arranger === "string" ? item.arranger : undefined,
        composer: typeof item.composer === "string" ? item.composer : undefined,
        durationSeconds:
          typeof item.durationSeconds === "number" ? item.durationSeconds : undefined,
        isFeaturedNumber:
          typeof item.isFeaturedNumber === "boolean" ? item.isFeaturedNumber : undefined,
        notes: typeof item.notes === "string" ? item.notes : undefined,
        pieceId: typeof item.pieceId === "string" ? item.pieceId : undefined,
        title: item.title,
        trackFileIds: isStringRecord(item.trackFileIds) ? item.trackFileIds : {},
      })),
      organizationName:
        typeof data.organizationName === "string" ? data.organizationName : undefined,
      performerLabel: typeof data.performerLabel === "string" ? data.performerLabel : "Performer",
      profileName: typeof data.profileName === "string" ? data.profileName : undefined,
    };
  } catch {
    throw new Error("not_found");
  }
}

export async function fetchPublicPlayerPlaylist(token: string): Promise<PlayerDetails> {
  try {
    const data = await getPublicPlayerPlaylist(token);
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
      items: data.pieces.map((item) => ({
        arranger: typeof item.arranger === "string" ? item.arranger : undefined,
        composer: typeof item.composer === "string" ? item.composer : undefined,
        durationSeconds:
          typeof item.durationSeconds === "number" ? item.durationSeconds : undefined,
        isFeaturedNumber:
          typeof item.isFeaturedNumber === "boolean" ? item.isFeaturedNumber : undefined,
        notes: typeof item.notes === "string" ? item.notes : undefined,
        pieceId: typeof item.pieceId === "string" ? item.pieceId : undefined,
        title: item.title,
        trackFileIds: isStringRecord(item.trackFileIds) ? item.trackFileIds : {},
      })),
      organizationName:
        typeof data.organizationName === "string" ? data.organizationName : undefined,
      performerLabel: typeof data.performerLabel === "string" ? data.performerLabel : "Performer",
    };
  } catch {
    throw new Error("not_found");
  }
}
