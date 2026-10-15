import type { OrganizationEvent, SingerEvent, SingerLearningTrackPiece } from "@choir/contracts";

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
    type: "song",
  }));
}

export function getApprovedPerformanceSetLists(
  events: readonly SingerEvent[],
  now = new Date(),
): ApprovedSetListOption[] {
  const approved = events.filter(
    (event) => event.practice.sourceEventId !== null && event.setList.length > 0,
  );

  // Deduplicate rehearsals inheriting parent performance program
  const canonicalMap = new Map<string, SingerEvent>();
  for (const event of approved) {
    const key = event.practice.sourceEventId ?? event.id;
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
    eventId: event.practice.sourceEventId ?? event.id,
    publicGraphicFileId: event.publicGraphicFileId ?? null,
    setList: event.setList,
    startsAt: event.startsAt,
    title: event.title,
  }));
}

function mapSetListItem(
  item: OrganizationSetListItem,
  pieceMap: Map<string, SingerLearningTrackPiece>,
  parentMovementsMap: Map<string, SingerLearningTrackPiece[]>,
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
  if (directMatch) {
    return [
      {
        arranger: directMatch.arranger,
        composer: directMatch.composer.trim() ? directMatch.composer : (item.composer ?? null),
        durationSeconds: directMatch.durationSeconds,
        isFeaturedNumber: item.isFeaturedNumber,
        notes: item.notes,
        pieceId: directMatch.id,
        title: item.title || directMatch.title,
        trackFileIds: directMatch.trackFileIds,
        type: "song",
      },
    ];
  }

  const movements = parentMovementsMap.get(item.pieceId);
  if (movements && movements.length > 0) {
    return movements.map((movement) => ({
      arranger: movement.arranger,
      composer: movement.composer.trim() ? movement.composer : (item.composer ?? null),
      durationSeconds: movement.durationSeconds,
      isFeaturedNumber: item.isFeaturedNumber,
      notes: item.notes,
      pieceId: movement.id,
      title: movement.title,
      trackFileIds: movement.trackFileIds,
      type: "song",
    }));
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

  return setList.flatMap((item) => mapSetListItem(item, pieceMap, parentMovementsMap));
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
