import {
  mergeTrackImportGroups,
  moveFilesBetweenTrackImportGroups,
  nextUniqueGroupId,
  recalculateTrackImportGroup,
  titleTokenOverlap,
} from "./grouping";
import type { GroupRepairAction, ParsedTrackFile, TrackImportGroup } from "./types";

function validateMergeSuggestion(
  suggestion: Extract<GroupRepairAction, { kind: "merge_groups" }>,
  groupMap: Map<string, TrackImportGroup>,
): boolean {
  if (suggestion.groupIds.length < 2) return false;
  for (const gId of suggestion.groupIds) {
    if (!groupMap.has(gId)) return false;
  }
  if (suggestion.targetGroupId && !suggestion.groupIds.includes(suggestion.targetGroupId)) {
    return false;
  }
  return true;
}

function validateSplitSuggestion(
  suggestion: Extract<GroupRepairAction, { kind: "split_group" }>,
  groupMap: Map<string, TrackImportGroup>,
  fileToGroup: Map<string, string>,
): boolean {
  const sourceGroup = groupMap.get(suggestion.sourceGroupId);
  if (!sourceGroup || suggestion.fileSubsets.length < 2) return false;
  const allFiles = new Set<string>();
  for (const subset of suggestion.fileSubsets) {
    if (subset.clientFileIds.length === 0) return false;
    for (const fId of subset.clientFileIds) {
      if (allFiles.has(fId) || fileToGroup.get(fId) !== suggestion.sourceGroupId) return false;
      allFiles.add(fId);
    }
  }
  return allFiles.size === sourceGroup.files.length;
}

function validateMoveSuggestion(
  suggestion: Extract<GroupRepairAction, { kind: "move_files" }>,
  groupMap: Map<string, TrackImportGroup>,
  fileToGroup: Map<string, string>,
): boolean {
  if (suggestion.sourceGroupId === suggestion.targetGroupId) return false;
  const sourceGroup = groupMap.get(suggestion.sourceGroupId);
  const targetGroup = groupMap.get(suggestion.targetGroupId);
  if (!sourceGroup || !targetGroup || suggestion.clientFileIds.length === 0) return false;
  if (suggestion.clientFileIds.length >= sourceGroup.files.length) return false;
  for (const fId of suggestion.clientFileIds) {
    if (fileToGroup.get(fId) !== suggestion.sourceGroupId) return false;
  }
  return true;
}

export function validateGroupRepairSuggestion(
  suggestion: GroupRepairAction,
  currentGroups: readonly TrackImportGroup[],
): boolean {
  const groupMap = new Map(currentGroups.map((g) => [g.groupId, g]));
  const fileToGroup = new Map<string, string>();
  for (const g of currentGroups) {
    for (const f of g.files) {
      fileToGroup.set(f.clientFileId, g.groupId);
    }
  }

  switch (suggestion.kind) {
    case "merge_groups":
      return validateMergeSuggestion(suggestion, groupMap);
    case "split_group":
      return validateSplitSuggestion(suggestion, groupMap, fileToGroup);
    case "move_files":
      return validateMoveSuggestion(suggestion, groupMap, fileToGroup);
  }
}

function applySplitGroupRepair(
  groups: readonly TrackImportGroup[],
  suggestion: Extract<GroupRepairAction, { kind: "split_group" }>,
): TrackImportGroup[] {
  const sourceGroup = groups.find((g) => g.groupId === suggestion.sourceGroupId);
  if (!sourceGroup) return [...groups];
  const fileMap = new Map(sourceGroup.files.map((f) => [f.clientFileId, f]));
  const otherGroups = groups.filter((g) => g.groupId !== suggestion.sourceGroupId);

  const newGroups: TrackImportGroup[] = [];
  const currentExisting = [...otherGroups];

  for (let i = 0; i < suggestion.fileSubsets.length; i += 1) {
    const subset = suggestion.fileSubsets[i];
    if (!subset) continue;
    const subsetFiles = subset.clientFileIds
      .map((id) => fileMap.get(id))
      .filter((f): f is ParsedTrackFile => f !== undefined);
    if (subsetFiles.length === 0) continue;

    const groupId = i === 0 ? suggestion.sourceGroupId : nextUniqueGroupId(currentExisting);
    const group = recalculateTrackImportGroup({
      files: subsetFiles,
      groupId,
      ...(subset.suggestedTitle ? { inferredTitle: subset.suggestedTitle } : {}),
    });
    newGroups.push(group);
    currentExisting.push(group);
  }
  return [...otherGroups, ...newGroups];
}

export function applyGroupRepairSuggestion(
  groups: readonly TrackImportGroup[],
  suggestion: GroupRepairAction,
): TrackImportGroup[] {
  if (!validateGroupRepairSuggestion(suggestion, groups)) return [...groups];

  switch (suggestion.kind) {
    case "merge_groups":
      return mergeTrackImportGroups(groups, suggestion.groupIds, suggestion.targetGroupId);
    case "split_group":
      return applySplitGroupRepair(groups, suggestion);
    case "move_files":
      return moveFilesBetweenTrackImportGroups(
        groups,
        suggestion.clientFileIds,
        suggestion.targetGroupId,
      );
  }
}

function checkSuspiciousFilePair(f1: ParsedTrackFile, f2: ParsedTrackFile): string[] {
  const reasons: string[] = [];
  if (f1.detectedPartKey && f1.detectedPartKey === f2.detectedPartKey) {
    reasons.push(`Duplicate part '${f1.detectedPartKey}' assigned in same group`);
  }

  const overlap = titleTokenOverlap(f1.inferredTitle, f2.inferredTitle);
  if (
    f1.inferredTitle.length > 3 &&
    f2.inferredTitle.length > 3 &&
    overlap < 0.25 &&
    !f1.inferredTitle.includes(f2.inferredTitle) &&
    !f2.inferredTitle.includes(f1.inferredTitle)
  ) {
    reasons.push(`Title mismatch: "${f1.inferredTitle}" vs "${f2.inferredTitle}"`);
  }

  if (
    typeof f1.durationSeconds === "number" &&
    typeof f2.durationSeconds === "number" &&
    f1.durationSeconds > 0 &&
    f2.durationSeconds > 0 &&
    Math.abs(f1.durationSeconds - f2.durationSeconds) > 20
  ) {
    reasons.push(
      `Duration mismatch: ${String(f1.durationSeconds)}s vs ${String(f2.durationSeconds)}s`,
    );
  }
  return reasons;
}

export function detectSuspiciousWithinGroupFiles(group: TrackImportGroup): {
  clientFileId1: string;
  clientFileId2: string;
  reason: string;
}[] {
  const suspicious: { clientFileId1: string; clientFileId2: string; reason: string }[] = [];
  const files = group.files;
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const f1 = files[i];
      const f2 = files[j];
      if (!f1 || !f2) continue;

      const reasons = checkSuspiciousFilePair(f1, f2);
      if (reasons.length > 0) {
        suspicious.push({
          clientFileId1: f1.clientFileId,
          clientFileId2: f2.clientFileId,
          reason: reasons.join("; "),
        });
      }
    }
  }
  return suspicious.slice(0, 5);
}

function checkDurationCompatibility(dur1: number | null, dur2: number | null): boolean {
  return typeof dur1 === "number" && typeof dur2 === "number" ? Math.abs(dur1 - dur2) <= 8 : true;
}

function evaluateCrossGroupPair(
  g1: TrackImportGroup,
  g2: TrackImportGroup,
): { reason: string; score: number } | null {
  const overlap = titleTokenOverlap(g1.inferredTitle, g2.inferredTitle);
  const durationCompatible = checkDurationCompatibility(
    g1.averageDurationSeconds,
    g2.averageDurationSeconds,
  );

  const parts1 = new Set(g1.files.flatMap((f) => (f.detectedPartKey ? [f.detectedPartKey] : [])));
  const parts2 = new Set(g2.files.flatMap((f) => (f.detectedPartKey ? [f.detectedPartKey] : [])));
  const hasPartOverlap = [...parts1].some((p) => parts2.has(p));

  let score = 0;
  let reason = "";

  if (overlap >= 0.4 && durationCompatible) {
    score += Math.round(overlap * 100);
    if (!hasPartOverlap && parts1.size > 0 && parts2.size > 0) {
      score += 20;
      reason = `Similar titles ("${g1.inferredTitle}" / "${g2.inferredTitle}") and complementary voice parts`;
    } else {
      reason = `Similar titles: "${g1.inferredTitle}" and "${g2.inferredTitle}"`;
    }
  }

  const composer1 = g1.files.find((f) => f.metadata?.composer)?.metadata?.composer;
  const composer2 = g2.files.find((f) => f.metadata?.composer)?.metadata?.composer;
  if (composer1 && composer1.toLowerCase() === composer2?.toLowerCase()) {
    score += 15;
  }

  if (score < 40) return null;
  return { reason, score };
}

export function detectCrossGroupRepairCandidates(
  groups: readonly TrackImportGroup[],
  maxPairs = 20,
): {
  groupAId: string;
  groupBId: string;
  reason: string;
}[] {
  const candidates: { groupAId: string; groupBId: string; reason: string; score: number }[] = [];

  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      const g1 = groups[i];
      const g2 = groups[j];
      if (!g1 || !g2) continue;

      const evaluated = evaluateCrossGroupPair(g1, g2);
      if (evaluated) {
        candidates.push({
          groupAId: g1.groupId,
          groupBId: g2.groupId,
          reason: evaluated.reason,
          score: evaluated.score,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxPairs).map(({ groupAId, groupBId, reason }) => ({
    groupAId,
    groupBId,
    reason,
  }));
}
