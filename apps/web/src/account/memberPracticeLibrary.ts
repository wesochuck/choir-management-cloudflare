import type { OrganizationEvent, SingerLearningTrackPiece } from "@choir/contracts";

import {
  getSectionCandidates,
  isFullMixKey,
  normalizeKey,
  type PlayerPlaylistItem,
} from "../public/player";

export function pieceIdsForEvent(event: OrganizationEvent): ReadonlySet<string> {
  return new Set(event.setList.flatMap((item) => (item.pieceId ? [item.pieceId] : [])));
}

export function pieceMatches(piece: SingerLearningTrackPiece, pieceId: string): boolean {
  return piece.id === pieceId || piece.parentId === pieceId;
}

export function isPiecePlayableForPart(
  piece: SingerLearningTrackPiece,
  rosterPart?: string | null,
): boolean {
  const keys = Object.keys(piece.trackFileIds);
  if (keys.length === 0) return false;
  if (!rosterPart?.trim()) return true;

  const requestedNorm = normalizeKey(rosterPart);
  // 1. Exact match or normalized match
  if (keys.some((k) => k === rosterPart || normalizeKey(k) === requestedNorm)) {
    return true;
  }

  // 2. Section candidates match
  const { isSectionRequest, pureSectionKeys } = getSectionCandidates(rosterPart);
  if (pureSectionKeys.length > 0) {
    if (keys.some((k) => pureSectionKeys.includes(normalizeKey(k)))) {
      return true;
    }
    if (isSectionRequest) {
      const match = keys.some((k) => {
        const { pureSectionKeys: partSectionKeys } = getSectionCandidates(k);
        return partSectionKeys.some((candidate) => pureSectionKeys.includes(candidate));
      });
      if (match) return true;
    }
  }

  // 3. Fallback to full-mix / tutti / all-parts
  if (keys.some((k) => isFullMixKey(k))) {
    return true;
  }

  return false;
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
