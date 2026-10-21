import type { OrganizationEvent, SingerEvent, SingerLearningTrackPiece } from "@choir/contracts";
import { sortMusicMovements } from "@choir/domain";

import { resolveTrack, type PlayerPlaylistItem } from "../public/player";

export type OrganizationSetListItem = SingerEvent["setList"][number];

export interface ApprovedSetListOption {
  readonly eventId: string;
  readonly publicGraphicFileId: string | null;
  readonly setList: readonly OrganizationSetListItem[];
  readonly startsAt: string;
  readonly title: string;
}

export function pieceIdsForEvent(event: OrganizationEvent | SingerEvent): ReadonlySet<string> {
  return new Set(event.setList.flatMap((item) => (item.pieceId ? [item.pieceId] : [])));
}

export function pieceMatches(piece: SingerLearningTrackPiece, pieceId: string): boolean {
  return piece.id === pieceId || piece.parentId === pieceId;
}

export function isPiecePlayableForPart(
  piece: SingerLearningTrackPiece,
  rosterPart?: string | null,
): boolean {
  return (
    resolveTrack(
      {
        arranger: piece.arranger,
        composer: piece.composer,
        durationSeconds: piece.durationSeconds,
        pieceId: piece.id,
        title: piece.title,
        trackFileIds: piece.trackFileIds,
        loudnessByFileId: piece.loudnessByFileId,
      },
      rosterPart ?? "",
    ) !== null
  );
}

export function singerPiecesToPlaylistItems(
  pieces: readonly SingerLearningTrackPiece[],
): PlayerPlaylistItem[] {
  return pieces.map((piece) => ({
    arranger: piece.arranger,
    composer: piece.composer,
    durationSeconds: piece.durationSeconds,
    pieceId: piece.id,
    title: piece.title,
    trackFileIds: piece.trackFileIds,
    loudnessByFileId: piece.loudnessByFileId,
    type: "song",
  }));
}

export type SelectableEvent = SingerEvent | OrganizationEvent;

export function isApprovedSetListEvent(event: SelectableEvent): boolean {
  if (event.setList.length === 0) return false;
  if ("practice" in event) {
    return event.practice.sourceEventId !== null;
  }
  if ("setListApproved" in event) {
    return event.setListApproved;
  }
  return false;
}

export function resolveEventCanonicalId(event: SelectableEvent): string {
  if ("practice" in event && event.practice.sourceEventId) {
    return event.practice.sourceEventId;
  }
  if ("parentPerformanceId" in event && event.parentPerformanceId) {
    return event.parentPerformanceId;
  }
  return event.id;
}

export function getApprovedPerformanceSetLists(
  events: readonly SelectableEvent[],
  now = new Date(),
): ApprovedSetListOption[] {
  const approved = events.filter(isApprovedSetListEvent);

  // Deduplicate rehearsals inheriting parent performance program
  const canonicalMap = new Map<string, SelectableEvent>();
  for (const event of approved) {
    const key = resolveEventCanonicalId(event);
    const existing = canonicalMap.get(key);
    if (!existing) {
      canonicalMap.set(key, event);
    } else if (existing.type !== "Performance" && event.type === "Performance") {
      canonicalMap.set(key, event);
    } else if (existing.id !== key && event.id === key) {
      canonicalMap.set(key, event);
    }
  }

  const nowMs = now.getTime();
  const sorted = Array.from(canonicalMap.values()).sort((a, b) => {
    const aTime = new Date(a.startsAt).getTime();
    const bTime = new Date(b.startsAt).getTime();
    const aUpcoming = aTime >= nowMs;
    const bUpcoming = bTime >= nowMs;
    if (aUpcoming && !bUpcoming) return -1;
    if (!aUpcoming && bUpcoming) return 1;
    if (aUpcoming) {
      return aTime - bTime;
    }
    return bTime - aTime;
  });

  return sorted.map((event) => ({
    eventId: resolveEventCanonicalId(event),
    publicGraphicFileId: event.publicGraphicFileId ?? null,
    setList: event.setList,
    startsAt: event.startsAt,
    title: event.title,
  }));
}

function nonEmptyString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? (value ?? undefined) : undefined;
}

function pieceToSetListPlaylistItem(
  piece: SingerLearningTrackPiece,
  parentPiece: SingerLearningTrackPiece | undefined,
  item: OrganizationSetListItem,
  titleOverride?: string,
): PlayerPlaylistItem {
  const arranger = nonEmptyString(piece.arranger) ?? nonEmptyString(parentPiece?.arranger) ?? "";
  const composer =
    nonEmptyString(piece.composer) ??
    nonEmptyString(parentPiece?.composer) ??
    nonEmptyString(item.composer) ??
    null;
  return {
    arranger,
    composer,
    durationSeconds: piece.durationSeconds,
    isFeaturedNumber: item.isFeaturedNumber,
    notes: item.notes,
    pieceId: piece.id,
    title: titleOverride ?? piece.title,
    trackFileIds: piece.trackFileIds,
    loudnessByFileId: piece.loudnessByFileId,
    type: "song",
  };
}

function mapSetListItem(
  item: OrganizationSetListItem,
  pieceMap: Map<string, SingerLearningTrackPiece>,
  parentMovementsMap: Map<string, SingerLearningTrackPiece[]>,
  setListPieceIds: ReadonlySet<string>,
): PlayerPlaylistItem[] {
  if (!item.pieceId) {
    return [
      {
        composer: item.composer ?? null,
        cueInstruction: item.cueInstruction,
        isFeaturedNumber: item.isFeaturedNumber,
        notes: item.notes,
        title: item.title,
        trackFileIds: {},
        type: item.type === "song" ? "song" : "intermission",
      },
    ];
  }

  const directMatch = pieceMap.get(item.pieceId);
  const movements = parentMovementsMap.get(item.pieceId);
  const hasDirectTracks =
    directMatch !== undefined && Object.keys(directMatch.trackFileIds).length > 0;

  if (movements && movements.length > 0 && !hasDirectTracks) {
    if (movements.some((m) => setListPieceIds.has(m.id))) {
      return [];
    }
    return sortMusicMovements(movements, directMatch?.movementOrder).map((movement) =>
      pieceToSetListPlaylistItem(movement, directMatch, item),
    );
  }

  if (directMatch) {
    const parentMatch = directMatch.parentId ? pieceMap.get(directMatch.parentId) : undefined;
    return [pieceToSetListPlaylistItem(directMatch, parentMatch, item, item.title || undefined)];
  }

  return [
    {
      composer: item.composer ?? null,
      isFeaturedNumber: item.isFeaturedNumber,
      notes: item.notes,
      pieceId: item.pieceId,
      title: item.title,
      trackFileIds: {},
      type: "song",
    },
  ];
}

export function mapSetListToPlaylistItems(
  setList: readonly OrganizationSetListItem[],
  pieces: readonly SingerLearningTrackPiece[],
): PlayerPlaylistItem[] {
  const pieceMap = new Map<string, SingerLearningTrackPiece>();
  const parentMovementsMap = new Map<string, SingerLearningTrackPiece[]>();

  for (const piece of pieces) {
    pieceMap.set(piece.id, piece);
    if (piece.parentId) {
      const list = parentMovementsMap.get(piece.parentId);
      if (list) {
        list.push(piece);
      } else {
        parentMovementsMap.set(piece.parentId, [piece]);
      }
    }
  }

  const setListPieceIds = new Set(setList.flatMap((item) => (item.pieceId ? [item.pieceId] : [])));

  return setList.flatMap((item) =>
    mapSetListItem(item, pieceMap, parentMovementsMap, setListPieceIds),
  );
}

export function filterLibraryPieces(
  pieces: readonly SingerLearningTrackPiece[],
  query: string,
  focusedPieceIds: ReadonlySet<string> | null,
  pieceId: string | null,
  playableOnly = false,
  rosterPart?: string | null,
): SingerLearningTrackPiece[] {
  const normalized = query.trim().toLocaleLowerCase();
  return pieces.filter((piece) => {
    if (playableOnly && !isPiecePlayableForPart(piece, rosterPart)) return false;
    if (pieceId && !pieceMatches(piece, pieceId)) return false;
    if (
      focusedPieceIds &&
      focusedPieceIds.size > 0 &&
      ![...focusedPieceIds].some((id) => pieceMatches(piece, id))
    ) {
      return false;
    }
    return (
      !normalized ||
      `${piece.title} ${piece.composer} ${piece.arranger}`.toLocaleLowerCase().includes(normalized)
    );
  });
}

export function filterPlaylistItems(
  items: readonly PlayerPlaylistItem[],
  query: string,
  playableOnly: boolean,
  activeTrackKey: string,
): PlayerPlaylistItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (playableOnly && resolveTrack(item, activeTrackKey) === null) {
      return false;
    }
    return (
      !normalized ||
      `${item.title} ${item.composer ?? ""} ${item.arranger ?? ""}`
        .toLocaleLowerCase()
        .includes(normalized)
    );
  });
}
