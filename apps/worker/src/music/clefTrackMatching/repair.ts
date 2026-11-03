import type { MusicTrackImportGroupRepairSuggestion } from "@choir/contracts";
import {
  validateGroupRepairSuggestion,
  type ParsedTrackFile,
  type TrackImportGroup,
} from "@choir/domain";
import type { PlannedQuestion } from "./batches";
import { computeChoiceProbabilityAndMargin, type ClefAnswer } from "./scoring";

function evaluateMergeRepairSuggestion(
  q: PlannedQuestion,
  ans: ClefAnswer,
  domainGroups: readonly TrackImportGroup[],
): MusicTrackImportGroupRepairSuggestion | null {
  if (q.kind !== "repair_merge" || !q.groupBId) return null;
  const choice = ans.choice;
  const { isConfident, prob } = computeChoiceProbabilityAndMargin(ans.probabilities, choice);

  if (choice === "same_song" && isConfident) {
    const suggestion: MusicTrackImportGroupRepairSuggestion = {
      confidence: prob,
      evidence: `AI estimated ${String(Math.round(prob * 100))}% probability that song groups belong to the same song.`,
      groupIds: [q.groupId, q.groupBId],
      kind: "merge_groups",
    };
    if (validateGroupRepairSuggestion(suggestion, domainGroups)) {
      return suggestion;
    }
  }
  return null;
}

function partitionSplitFiles(
  files: readonly ParsedTrackFile[],
  clientFileId1: string,
  clientFileId2: string,
  f1Title?: string,
): { subset1Ids: string[]; subset2Ids: string[] } {
  const subset1Ids = [clientFileId1];
  const subset2Ids = [clientFileId2];
  for (const f of files) {
    if (f.clientFileId === clientFileId1 || f.clientFileId === clientFileId2) continue;
    if (f1Title && f.inferredTitle === f1Title) {
      subset1Ids.push(f.clientFileId);
    } else {
      subset2Ids.push(f.clientFileId);
    }
  }
  return { subset1Ids, subset2Ids };
}

function isConfidentSplitAnswer(ans: ClefAnswer): {
  isConfident: boolean;
  prob: number;
} {
  if (ans.choice !== "different_song") return { isConfident: false, prob: 0 };
  const { isConfident, prob } = computeChoiceProbabilityAndMargin(ans.probabilities, ans.choice);
  return { isConfident, prob };
}

function evaluateSplitRepairSuggestion(
  q: PlannedQuestion,
  ans: ClefAnswer,
  domainGroups: readonly TrackImportGroup[],
): MusicTrackImportGroupRepairSuggestion | null {
  if (q.kind !== "repair_split" || !q.clientFileId || !q.clientFileId2) return null;
  const { isConfident, prob } = isConfidentSplitAnswer(ans);
  if (!isConfident) return null;

  const group = domainGroups.find((g) => g.groupId === q.groupId);
  if (!group) return null;

  const f1 = group.files.find((f) => f.clientFileId === q.clientFileId);
  const f2 = group.files.find((f) => f.clientFileId === q.clientFileId2);
  const { subset1Ids, subset2Ids } = partitionSplitFiles(
    group.files,
    q.clientFileId,
    q.clientFileId2,
    f1?.inferredTitle,
  );

  const suggestion: MusicTrackImportGroupRepairSuggestion = {
    confidence: prob,
    evidence: `AI estimated ${String(Math.round(prob * 100))}% probability that files belong to different songs.`,
    fileSubsets: [
      { clientFileIds: subset1Ids, suggestedTitle: f1?.inferredTitle },
      { clientFileIds: subset2Ids, suggestedTitle: f2?.inferredTitle },
    ],
    kind: "split_group",
    sourceGroupId: q.groupId,
  };
  if (validateGroupRepairSuggestion(suggestion, domainGroups)) {
    return suggestion;
  }
  return null;
}

export function aggregateGroupRepairResults(
  rawResults: readonly {
    answers: Record<string, ClefAnswer>;
    questions: readonly PlannedQuestion[];
  }[],
  domainGroups: readonly TrackImportGroup[],
): MusicTrackImportGroupRepairSuggestion[] {
  const suggestions: MusicTrackImportGroupRepairSuggestion[] = [];

  for (const { answers, questions } of rawResults) {
    for (const q of questions) {
      const ans = answers[q.questionId];
      if (!ans) continue;

      const total = Object.values(ans.probabilities).reduce((sum, p) => sum + p, 0);
      if (Math.abs(total - 1) > 0.01) continue;

      const merge = evaluateMergeRepairSuggestion(q, ans, domainGroups);
      if (merge) {
        suggestions.push(merge);
        continue;
      }

      const split = evaluateSplitRepairSuggestion(q, ans, domainGroups);
      if (split) {
        suggestions.push(split);
      }
    }
  }

  return suggestions;
}
