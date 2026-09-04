import type { OrganizationEvent, SingerLearningTrackPiece } from "@choir/contracts";

import type { PlayerPlaylistItem } from "../public/player";

export function pieceIdsForEvent(event: OrganizationEvent): ReadonlySet<string> {
  return new Set(event.setList.flatMap((item) => (item.pieceId ? [item.pieceId] : [])));
}

export function pieceMatches(piece: SingerLearningTrackPiece, pieceId: string): boolean {
  return piece.id === pieceId || piece.parentId === pieceId;
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
  }));
}

export function filterLibraryPieces(
  pieces: readonly SingerLearningTrackPiece[],
  query: string,
  focusedPieceIds: ReadonlySet<string> | null,
  pieceId: string | null,
): SingerLearningTrackPiece[] {
  const normalized = query.trim().toLocaleLowerCase();
  return pieces.filter((piece) => {
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
