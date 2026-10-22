import { useState, type Dispatch, type SetStateAction } from "react";
import type { GroupReviewItem } from "./types";
import {
  type TuttiOriginalAssignment,
  applyTuttiSuggestions,
  getTuttiCandidates,
  undoTuttiSuggestions,
} from "./tuttiSuggestions";

export function useTuttiSuggestions(
  groups: readonly GroupReviewItem[],
  setGroups: Dispatch<SetStateAction<readonly GroupReviewItem[]>>,
) {
  const [undo, setUndo] = useState<{
    readonly assignmentId: string;
    readonly originals: ReadonlyMap<string, TuttiOriginalAssignment>;
  } | null>(null);
  const candidates = getTuttiCandidates(groups);
  return {
    count: candidates.length,
    canUndo:
      undo !== null &&
      groups.some(
        (group) =>
          !group.groupSkipped &&
          !group.reviewedMappingKey &&
          group.files.some(
            (file) => !file.excluded && file.tuttiAssignmentId === undo.assignmentId,
          ),
      ),
    apply: () => {
      const originals = new Map(
        candidates.map((file) => [
          file.clientFileId,
          {
            partKey: file.partKey,
            partProvenance: file.partProvenance,
            partSelectionChanged: file.partSelectionChanged,
          },
        ]),
      );
      const assignmentId = crypto.randomUUID();
      setGroups((current) =>
        applyTuttiSuggestions(current, new Set(originals.keys()), assignmentId),
      );
      setUndo({ assignmentId, originals });
    },
    undo: () => {
      if (!undo) return;
      setGroups((current) => undoTuttiSuggestions(current, undo.originals, undo.assignmentId));
      setUndo(null);
    },
  };
}
