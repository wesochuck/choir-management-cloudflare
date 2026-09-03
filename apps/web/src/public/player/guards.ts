import type { PlayerDetails, PlayerPlaylistItem } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

export function isNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

export function isNullableNumber(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "number";
}

export function isNullableBoolean(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "boolean";
}

export function isPlayerPlaylistItem(value: unknown): value is PlayerPlaylistItem {
  if (!isRecord(value) || typeof value.title !== "string") {
    return false;
  }
  const trackFileIds = value.trackFileIds ?? {};
  if (!isStringRecord(trackFileIds)) {
    return false;
  }
  return (
    isNullableString(value.arranger) &&
    isNullableString(value.composer) &&
    isNullableNumber(value.durationSeconds) &&
    isNullableBoolean(value.isFeaturedNumber) &&
    isNullableString(value.notes) &&
    isNullableString(value.pieceId)
  );
}

export function isPlayerDetails(value: unknown): value is PlayerDetails {
  return (
    isRecord(value) &&
    isNullableString(value.eventArtworkFileId) &&
    typeof value.eventId === "string" &&
    typeof value.eventTitle === "string" &&
    typeof value.eventStartsAt === "string" &&
    Array.isArray(value.items) &&
    value.items.every(isPlayerPlaylistItem) &&
    isNullableString(value.organizationName) &&
    isNullableString(value.performerLabel) &&
    isNullableString(value.profileName)
  );
}
