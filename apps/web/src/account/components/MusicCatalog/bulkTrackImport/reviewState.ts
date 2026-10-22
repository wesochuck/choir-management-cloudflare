import type { OrganizationMusicPiece, OrganizationRosterConfiguration } from "@choir/contracts";
import type { GroupReviewItem } from "./types";

export type ReviewGroupStatus = "needs_review" | "conflict" | "reviewed" | "skipped";
export type ReviewFileStatus = "needs_review" | "conflict" | "ready" | "excluded";

export interface ReviewFileState {
  readonly clientFileId: string;
  readonly conflictReason: string | null;
  readonly status: ReviewFileStatus;
}

export interface ReviewGroupState {
  readonly blockingConflictCount: number;
  readonly excludedFileCount: number;
  readonly files: readonly ReviewFileState[];
  readonly groupStatus: ReviewGroupStatus;
  readonly isEligibleForReview: boolean;
  readonly uploadableFileCount: number;
}

export function getValidTrackPartKeys(
  roster: OrganizationRosterConfiguration | null,
): ReadonlySet<string> {
  return new Set([
    "tutti",
    "accompaniment",
    ...(roster?.sections.map((section) => section.code) ?? []),
    ...(roster?.voiceParts.map((part) => part.label) ?? []),
  ]);
}

export function getReviewMappingKey(group: GroupReviewItem): string {
  const fileMappings = group.files
    .map((file) => ({
      clientFileId: file.clientFileId,
      excluded: file.excluded === true,
      partKey: file.partKey,
    }))
    .sort((left, right) => left.clientFileId.localeCompare(right.clientFileId));

  return JSON.stringify({
    files: fileMappings,
    groupId: group.groupId,
    groupSkipped: group.groupSkipped === true,
    selectedPieceId: group.selectedPieceId,
  });
}

export function getReviewGroupState(
  group: GroupReviewItem,
  piecesById: ReadonlyMap<string, OrganizationMusicPiece>,
  validPartKeys: ReadonlySet<string>,
): ReviewGroupState {
  const piece = group.selectedPieceId ? piecesById.get(group.selectedPieceId) : undefined;
  const activePartCounts = new Map<string, number>();
  for (const file of group.files) {
    if (!file.excluded && file.partKey) {
      activePartCounts.set(file.partKey, (activePartCounts.get(file.partKey) ?? 0) + 1);
    }
  }

  let excludedFileCount = 0;
  let uploadableFileCount = 0;
  let blockingConflictCount = 0;
  let hasNeedsReview = false;

  const files: ReviewFileState[] = group.files.map((file) => {
    if (group.groupSkipped || file.excluded) {
      excludedFileCount += 1;
      return { clientFileId: file.clientFileId, conflictReason: null, status: "excluded" };
    }

    if (!file.partKey || !validPartKeys.has(file.partKey)) {
      hasNeedsReview = true;
      return {
        clientFileId: file.clientFileId,
        conflictReason: null,
        status: "needs_review",
      };
    }

    const hasDuplicatePart = (activePartCounts.get(file.partKey) ?? 0) > 1;
    if (!piece) {
      if (hasDuplicatePart) {
        blockingConflictCount += 1;
        return {
          clientFileId: file.clientFileId,
          conflictReason: `Duplicate ${file.partKey} assignments in this song group`,
          status: "conflict",
        };
      }
      hasNeedsReview = true;
      return {
        clientFileId: file.clientFileId,
        conflictReason: null,
        status: "needs_review",
      };
    }

    const reasons: string[] = [];
    if (hasDuplicatePart) {
      reasons.push(`Duplicate ${file.partKey} assignments in this song group`);
      blockingConflictCount += 1;
    }
    if (piece.trackFileIds[file.partKey]) {
      reasons.push(`${file.partKey} already has a recording on ${piece.title}`);
      blockingConflictCount += 1;
    }
    if (reasons.length > 0) {
      return {
        clientFileId: file.clientFileId,
        conflictReason: reasons.join("; "),
        status: "conflict",
      };
    }

    uploadableFileCount += 1;
    return { clientFileId: file.clientFileId, conflictReason: null, status: "ready" };
  });

  if (group.groupSkipped || group.files.length === 0 || excludedFileCount === group.files.length) {
    return {
      blockingConflictCount: 0,
      excludedFileCount,
      files,
      groupStatus: "skipped",
      isEligibleForReview: false,
      uploadableFileCount: 0,
    };
  }

  const isEligibleForReview = blockingConflictCount === 0 && !hasNeedsReview;
  const isReviewed = isEligibleForReview && group.reviewedMappingKey === getReviewMappingKey(group);

  return {
    blockingConflictCount,
    excludedFileCount,
    files,
    groupStatus: blockingConflictCount > 0 ? "conflict" : isReviewed ? "reviewed" : "needs_review",
    isEligibleForReview,
    uploadableFileCount,
  };
}

export function areAllReviewGroupsResolved(
  groups: readonly GroupReviewItem[],
  piecesById: ReadonlyMap<string, OrganizationMusicPiece>,
  validPartKeys: ReadonlySet<string>,
): boolean {
  return groups.every((group) => {
    const status = getReviewGroupState(group, piecesById, validPartKeys).groupStatus;
    return status === "reviewed" || status === "skipped";
  });
}

export function getReviewStatusLabel(state: ReviewGroupState, hasDestination: boolean): string {
  if (state.groupStatus === "reviewed") return "Reviewed";
  if (state.groupStatus === "skipped") return "Skipped";
  if (state.groupStatus === "conflict") return "Conflict";
  if (!hasDestination) return "Needs piece";
  return state.isEligibleForReview ? "Ready to review" : "Needs voice part";
}

export function getReviewNextAction(
  state: ReviewGroupState,
  hasDestination: boolean,
): "piece" | "part" | "conflict" | "review" | "next" {
  if (state.groupStatus === "reviewed" || state.groupStatus === "skipped") return "next";
  if (!hasDestination) return "piece";
  if (state.groupStatus === "conflict") return "conflict";
  return state.isEligibleForReview ? "review" : "part";
}
