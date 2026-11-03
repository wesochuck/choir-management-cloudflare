import { normalizeTitleStem, titleTokenOverlap } from "./grouping";
import type {
  GroupCandidateMatch,
  LibraryPieceOption,
  OrderedSetListItem,
  ParsedTrackFile,
  RankedPieceCandidate,
  TrackImportGroup,
} from "./types";

function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const curr = [i];
    for (let j = 1; j <= n; j += 1) {
      const prevCost = prev[j - 1] ?? 0;
      const deleteCost = (prev[j] ?? 0) + 1;
      const insertCost = (curr[j - 1] ?? 0) + 1;
      const matchCost = prevCost + (s1[i - 1] === s2[j - 1] ? 0 : 1);
      curr.push(Math.min(deleteCost, insertCost, matchCost));
    }
    prev = curr;
  }
  return prev[n] ?? 0;
}

function scoreTitleMatch(
  normGroup: string,
  normPiece: string,
  pieceTitle: string,
): { evidenceItem: string | null; score: number } {
  if (normGroup.length > 0 && normGroup === normPiece) {
    return { evidenceItem: `Exact title match: "${pieceTitle}"`, score: 50 };
  }
  const tokenOverlap = titleTokenOverlap(normGroup, normPiece);
  if (tokenOverlap >= 0.5) {
    return { evidenceItem: `Title match: "${pieceTitle}"`, score: Math.round(tokenOverlap * 40) };
  }
  const maxLen = Math.max(normGroup.length, normPiece.length);
  if (maxLen > 0) {
    const dist = levenshteinDistance(normGroup, normPiece);
    const ratio = 1 - dist / maxLen;
    if (ratio >= 0.7) {
      return { evidenceItem: `Fuzzy title match: "${pieceTitle}"`, score: Math.round(ratio * 30) };
    }
  }
  return { evidenceItem: null, score: 0 };
}

function scoreDurationMatch(
  pieceDuration: number | null | undefined,
  avgDuration: number | null,
): { evidenceItem: string | null; score: number } {
  if (typeof pieceDuration !== "number" || pieceDuration <= 0 || avgDuration === null) {
    return { evidenceItem: null, score: 0 };
  }
  const diff = Math.abs(pieceDuration - avgDuration);
  if (diff <= 3) {
    const mins = Math.floor(avgDuration / 60);
    const secs = String(avgDuration % 60).padStart(2, "0");
    return { evidenceItem: `Duration match: ${String(mins)}:${secs}`, score: 25 };
  }
  if (diff <= 6) {
    return { evidenceItem: null, score: 15 };
  }
  return { evidenceItem: null, score: 0 };
}

function detectSlotConflicts(
  piece: LibraryPieceOption,
  files: readonly ParsedTrackFile[],
): string[] {
  const conflicts: string[] = [];
  if (piece.trackFileIds) {
    for (const file of files) {
      if (file.detectedPartKey && piece.trackFileIds[file.detectedPartKey]) {
        conflicts.push(file.detectedPartKey);
      }
    }
  }
  return conflicts;
}

function hasComplementaryParts(group: TrackImportGroup): boolean {
  return (
    group.files.length >= 2 &&
    !group.hasDuplicatePart &&
    group.files.every((file) => Boolean(file.detectedPartKey))
  );
}

function findBestTitleMatch(group: TrackImportGroup, piece: LibraryPieceOption) {
  const pieceStem = normalizeTitleStem(piece.title);
  let best = scoreTitleMatch(normalizeTitleStem(group.inferredTitle), pieceStem, piece.title);

  for (const file of group.files) {
    if (file.metadata?.title) {
      const match = scoreTitleMatch(
        normalizeTitleStem(file.metadata.title),
        pieceStem,
        piece.title,
      );
      if (match.score > best.score) {
        best = match;
      }
    }
  }
  return best;
}

function evaluateComposerMatch(
  piece: LibraryPieceOption,
  group: TrackImportGroup,
): { evidence?: string; score: number } {
  if (!piece.composer) return { score: 0 };
  const normPieceComposer = normalizeTitleStem(piece.composer);
  if (normPieceComposer.length === 0) return { score: 0 };

  for (const file of group.files) {
    if (file.metadata?.composer) {
      const normFileComposer = normalizeTitleStem(file.metadata.composer);
      if (normFileComposer.length > 0 && normFileComposer === normPieceComposer) {
        return {
          evidence: `Composer match: "${piece.composer}"`,
          score: 20,
        };
      }
      const overlap = titleTokenOverlap(normFileComposer, normPieceComposer);
      if (overlap >= 0.5) {
        return {
          evidence: `Composer match: "${piece.composer}"`,
          score: 15,
        };
      }
    }
  }
  return { score: 0 };
}

function isOrderedSetListItemArray(
  context: readonly string[] | readonly OrderedSetListItem[],
): context is readonly OrderedSetListItem[] {
  return context.length > 0 && typeof context[0] === "object";
}

function evaluateSequenceMatch(
  group: TrackImportGroup,
  piece: LibraryPieceOption,
  performanceSetListContext?: readonly string[] | readonly OrderedSetListItem[],
): { evidence?: string; score: number } {
  if (!performanceSetListContext || !group.sequenceNumber) return { score: 0 };
  const seqNum = Number.parseInt(group.sequenceNumber, 10);
  if (Number.isNaN(seqNum) || seqNum < 1) return { score: 0 };

  if (isOrderedSetListItemArray(performanceSetListContext)) {
    const matched = performanceSetListContext.find(
      (item) => item.position === seqNum && item.pieceId === piece.id,
    );
    if (matched) {
      return {
        evidence: `Shared sequence number #${group.sequenceNumber}`,
        score: 25,
      };
    }
    return { score: 0 };
  }

  const pieceIds = performanceSetListContext;
  const seqIndex = seqNum - 1;
  if (seqIndex >= 0 && pieceIds[seqIndex] === piece.id) {
    return {
      evidence: `Shared sequence number #${group.sequenceNumber}`,
      score: 25,
    };
  }
  return { score: 0 };
}

function scoreCandidatePiece(
  piece: LibraryPieceOption,
  group: TrackImportGroup,
  performanceSetListContext?: readonly string[] | readonly OrderedSetListItem[],
): { conflicts: string[]; evidence: string[]; score: number } {
  let score = 0;
  const evidence: string[] = [];

  // 1. Set list association
  const inSetList =
    performanceSetListContext && performanceSetListContext.length > 0
      ? isOrderedSetListItemArray(performanceSetListContext)
        ? performanceSetListContext.some((item) => item.pieceId === piece.id)
        : performanceSetListContext.includes(piece.id)
      : false;
  if (inSetList) {
    score += 35;
    evidence.push("Linked to selected set list");
  }

  // 2. Title similarity
  const bestTitleResult = findBestTitleMatch(group, piece);
  score += bestTitleResult.score;
  if (bestTitleResult.evidenceItem) {
    evidence.push(bestTitleResult.evidenceItem);
  }

  // Title or a known set-list position must identify the piece. Timing, empty
  // slots, and group composition cannot identify an otherwise unrelated song.
  const seqResult = evaluateSequenceMatch(group, piece, performanceSetListContext);
  const sequenceMatches = seqResult.score > 0;
  if (bestTitleResult.score === 0 && !sequenceMatches) {
    return { conflicts: detectSlotConflicts(piece, group.files), evidence: [], score: 0 };
  }

  // Composer matching from ID3 (artist is NOT treated as composer)
  const composerResult = evaluateComposerMatch(piece, group);
  score += composerResult.score;
  if (composerResult.evidence) {
    evidence.push(composerResult.evidence);
  }

  // 3. Duration match
  const durResult = scoreDurationMatch(piece.durationSeconds, group.averageDurationSeconds);
  score += durResult.score;
  if (durResult.evidenceItem) {
    evidence.push(durResult.evidenceItem);
  }

  // 4. Complementary voice parts
  if (hasComplementaryParts(group)) {
    score += 10;
    evidence.push("Complementary voice parts");
  }

  // 5. Sequence number matching if set list provided
  score += seqResult.score;
  if (seqResult.evidence) {
    evidence.push(seqResult.evidence);
  }

  // 7. Check for slot conflicts
  const conflicts = detectSlotConflicts(piece, group.files);

  return { conflicts, evidence, score };
}

export function rankCandidatePiecesForGroup(
  group: TrackImportGroup,
  pieces: readonly LibraryPieceOption[],
  performanceSetListContext?: readonly string[] | readonly OrderedSetListItem[],
): GroupCandidateMatch {
  const candidates: RankedPieceCandidate[] = [];

  for (const piece of pieces) {
    const { conflicts, evidence, score } = scoreCandidatePiece(
      piece,
      group,
      performanceSetListContext,
    );

    if (score > 0) {
      const confidence: RankedPieceCandidate["confidence"] =
        score >= 60 ? "high" : score >= 35 ? "medium" : "low";

      candidates.push({
        confidence,
        conflicts: Array.from(new Set(conflicts)),
        evidence,
        piece,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return {
    candidatePieces: candidates,
    groupId: group.groupId,
    // A tie needs a human decision, never an arbitrary library-order choice.
    suggestedPiece:
      candidates[0] && candidates[0].score !== candidates[1]?.score ? candidates[0] : null,
  };
}

export function shortlistCandidatePiecesForGroup(
  group: TrackImportGroup,
  pieces: readonly LibraryPieceOption[],
  limit = 20,
  performanceSetListContext?: readonly string[] | readonly OrderedSetListItem[],
): LibraryPieceOption[] {
  const ranked = rankCandidatePiecesForGroup(group, pieces, performanceSetListContext);
  const positive = ranked.candidatePieces
    .filter((candidate) => candidate.score > 0)
    .map((candidate) => candidate.piece);
  if (positive.length >= limit) {
    return positive.slice(0, limit);
  }
  const result: LibraryPieceOption[] = [...positive];
  const includedIds = new Set(result.map((p) => p.id));

  const groupTokens = new Set(
    group.inferredTitle
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2),
  );

  const fallback = pieces
    .filter((p) => !includedIds.has(p.id))
    .map((p) => {
      const pieceTokens = p.title.toLowerCase().split(/[^\p{L}\p{N}]+/u);
      let matchCount = 0;
      for (const t of pieceTokens) {
        if (groupTokens.has(t)) matchCount += 1;
      }
      return { matchCount, piece: p };
    })
    .sort((a, b) => b.matchCount - a.matchCount);

  for (const item of fallback) {
    if (result.length >= limit) break;
    result.push(item.piece);
  }

  if (result.length === 0) {
    return pieces.slice(0, Math.min(limit, 8));
  }

  return result;
}
