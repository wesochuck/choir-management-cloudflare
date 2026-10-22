import { resolvePracticeTrackAssignments } from "@choir/domain";
import type { GroupFileAssignment, GroupReviewItem } from "./types";

export type TuttiOriginalAssignment = Pick<
  GroupFileAssignment,
  "partKey" | "partProvenance" | "partSelectionChanged"
>;

export function canSuggestTutti(file: GroupFileAssignment): boolean {
  return (
    !file.excluded &&
    file.partKey === null &&
    !file.detectedPartKey &&
    !file.partSelectionChanged &&
    !file.partProvenance
  );
}

export function getTuttiCandidates(
  groups: readonly GroupReviewItem[],
): readonly GroupFileAssignment[] {
  return groups.flatMap((group) =>
    group.groupSkipped || group.reviewedMappingKey ? [] : group.files.filter(canSuggestTutti),
  );
}

export function applyTuttiSuggestions(
  groups: readonly GroupReviewItem[],
  fileIds: ReadonlySet<string>,
  assignmentId: string,
): readonly GroupReviewItem[] {
  return groups.map((group) => {
    if (group.groupSkipped || group.reviewedMappingKey) return group;
    const files = group.files.map((file) => {
      if (!fileIds.has(file.clientFileId) || !canSuggestTutti(file)) return file;
      return {
        ...file,
        partKey: "tutti",
        partProvenance: "manual" as const,
        partSelectionChanged: true,
        tuttiAssignmentId: assignmentId,
      };
    });
    return files.some((file, index) => file !== group.files[index])
      ? {
          ...group,
          ...resolvePracticeTrackAssignments(files, group.selectedPieceId),
          reviewedMappingKey: null,
        }
      : group;
  });
}

export function undoTuttiSuggestions(
  groups: readonly GroupReviewItem[],
  originals: ReadonlyMap<string, TuttiOriginalAssignment>,
  assignmentId: string,
): readonly GroupReviewItem[] {
  return groups.map((group) => {
    if (group.groupSkipped || group.reviewedMappingKey) return group;
    const files = group.files.map((file) => {
      const original = originals.get(file.clientFileId);
      if (!original || file.excluded || file.tuttiAssignmentId !== assignmentId) return file;
      return {
        ...file,
        partKey: original.partKey,
        partProvenance: original.partProvenance,
        partSelectionChanged: original.partSelectionChanged,
        tuttiAssignmentId: undefined,
      };
    });
    return files.some((file, index) => file !== group.files[index])
      ? {
          ...group,
          ...resolvePracticeTrackAssignments(files, group.selectedPieceId),
          reviewedMappingKey: null,
        }
      : group;
  });
}
