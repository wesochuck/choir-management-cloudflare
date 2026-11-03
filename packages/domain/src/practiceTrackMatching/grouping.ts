import type { ParsedTrackFile, TrackImportGroup } from "./types";

export function normalizeTitleStem(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

export function titleTokenOverlap(a: string, b: string): number {
  const tokensA = new Set(
    normalizeTitleStem(a)
      .split(" ")
      .filter((t) => t.length > 1),
  );
  const tokensB = new Set(
    normalizeTitleStem(b)
      .split(" ")
      .filter((t) => t.length > 1),
  );
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      shared += 1;
    }
  }
  return (2 * shared) / (tokensA.size + tokensB.size);
}

export function recalculateTrackImportGroup(group: {
  files: readonly ParsedTrackFile[];
  groupId: string;
  inferredTitle?: string | undefined;
  sequenceNumber?: string | null | undefined;
}): TrackImportGroup {
  const durations = group.files
    .map((f) => f.durationSeconds)
    .filter((d): d is number => typeof d === "number" && d > 0);
  const averageDurationSeconds =
    durations.length > 0
      ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
      : null;

  const partCounts = new Map<string, number>();
  for (const f of group.files) {
    if (f.detectedPartKey) {
      partCounts.set(f.detectedPartKey, (partCounts.get(f.detectedPartKey) ?? 0) + 1);
    }
  }
  const duplicatePartKeys: string[] = [];
  for (const [key, count] of partCounts.entries()) {
    if (count > 1) {
      duplicatePartKeys.push(key);
    }
  }

  let longestTitle = group.inferredTitle ?? "";
  let sequenceNumber = group.sequenceNumber ?? null;
  for (const f of group.files) {
    if (f.inferredTitle.length > longestTitle.length) {
      longestTitle = f.inferredTitle;
    }
    if (!sequenceNumber && f.sequenceNumber) {
      sequenceNumber = f.sequenceNumber;
    }
  }

  return {
    averageDurationSeconds,
    duplicatePartKeys,
    files: [...group.files],
    groupId: group.groupId,
    hasDuplicatePart: duplicatePartKeys.length > 0,
    inferredTitle: longestTitle,
    sequenceNumber,
  };
}

interface DraftGroup {
  files: ParsedTrackFile[];
  inferredTitle: string;
  sequenceNumber: string | null;
}

function fileMatchesGroup(group: DraftGroup, file: ParsedTrackFile): boolean {
  const groupDurations = group.files
    .map((f) => f.durationSeconds)
    .filter((d): d is number => typeof d === "number" && d > 0);
  const avgDuration =
    groupDurations.length > 0
      ? groupDurations.reduce((sum, d) => sum + d, 0) / groupDurations.length
      : null;

  const durationClose =
    avgDuration !== null && file.durationSeconds !== null
      ? Math.abs(file.durationSeconds - avgDuration) <= 4
      : false;

  const sequenceMatches =
    group.sequenceNumber !== null &&
    file.sequenceNumber !== null &&
    group.sequenceNumber === file.sequenceNumber;

  const overlap = titleTokenOverlap(group.inferredTitle, file.inferredTitle);
  const strongTitleMatch = overlap >= 0.4 || (overlap > 0 && durationClose);

  if (sequenceMatches && (durationClose || file.durationSeconds === null)) {
    return true;
  }
  return (
    strongTitleMatch &&
    (durationClose || file.durationSeconds === null || groupDurations.length === 0)
  );
}

export function groupPracticeTrackFiles(files: readonly ParsedTrackFile[]): TrackImportGroup[] {
  if (files.length === 0) return [];

  const groups: DraftGroup[] = [];

  for (const file of files) {
    let matchedGroup: DraftGroup | null = null;

    for (const group of groups) {
      if (fileMatchesGroup(group, file)) {
        matchedGroup = group;
        break;
      }
    }

    if (matchedGroup) {
      matchedGroup.files.push(file);
      if (!matchedGroup.sequenceNumber && file.sequenceNumber) {
        matchedGroup.sequenceNumber = file.sequenceNumber;
      }
      if (file.inferredTitle.length > matchedGroup.inferredTitle.length) {
        matchedGroup.inferredTitle = file.inferredTitle;
      }
    } else {
      groups.push({
        files: [file],
        inferredTitle: file.inferredTitle,
        sequenceNumber: file.sequenceNumber,
      });
    }
  }

  return groups.map((g, index) =>
    recalculateTrackImportGroup({
      files: g.files,
      groupId: `group-${String(index + 1)}`,
      inferredTitle: g.inferredTitle,
      sequenceNumber: g.sequenceNumber,
    }),
  );
}

export function nextUniqueGroupId(existingGroups: readonly { readonly groupId: string }[]): string {
  const existingIds = new Set(existingGroups.map((g) => g.groupId));
  let counter = 1;
  while (existingIds.has(`group-${String(counter)}`)) {
    counter += 1;
  }
  return `group-${String(counter)}`;
}

export function mergeTrackImportGroups(
  groups: readonly TrackImportGroup[],
  groupIds: readonly string[],
  targetGroupId?: string,
): TrackImportGroup[] {
  const targetId = targetGroupId ?? groupIds[0];
  if (!targetId) return [...groups];

  const filesToMerge: ParsedTrackFile[] = [];
  const remainingGroups: TrackImportGroup[] = [];

  for (const group of groups) {
    if (groupIds.includes(group.groupId)) {
      filesToMerge.push(...group.files);
    } else {
      remainingGroups.push(group);
    }
  }

  if (filesToMerge.length === 0) return [...groups];

  const mergedGroup = recalculateTrackImportGroup({
    files: filesToMerge,
    groupId: targetId,
  });

  return [...remainingGroups, mergedGroup];
}

export function splitFilesToNewTrackImportGroup(
  groups: readonly TrackImportGroup[],
  clientFileIds: readonly string[],
  newGroupId?: string,
): TrackImportGroup[] {
  const targetFileIds = new Set(clientFileIds);
  const filesToExtract: ParsedTrackFile[] = [];
  const updatedGroups = groups
    .map((group) => {
      const remaining: ParsedTrackFile[] = [];
      for (const f of group.files) {
        if (targetFileIds.has(f.clientFileId)) {
          filesToExtract.push(f);
        } else {
          remaining.push(f);
        }
      }
      return recalculateTrackImportGroup({
        ...group,
        files: remaining,
      });
    })
    .filter((g) => g.files.length > 0);

  if (filesToExtract.length === 0) return [...groups];

  const groupId = newGroupId ?? nextUniqueGroupId(updatedGroups);
  const newGroup = recalculateTrackImportGroup({
    files: filesToExtract,
    groupId,
  });

  return [...updatedGroups, newGroup];
}

export function moveFilesBetweenTrackImportGroups(
  groups: readonly TrackImportGroup[],
  clientFileIds: readonly string[],
  targetGroupId: string,
): TrackImportGroup[] {
  const targetFileIds = new Set(clientFileIds);
  const filesToMove: ParsedTrackFile[] = [];

  const updatedGroups = groups.map((group) => {
    if (group.groupId === targetGroupId) return group;
    const remaining: ParsedTrackFile[] = [];
    for (const f of group.files) {
      if (targetFileIds.has(f.clientFileId)) {
        filesToMove.push(f);
      } else {
        remaining.push(f);
      }
    }
    return recalculateTrackImportGroup({
      ...group,
      files: remaining,
    });
  });

  if (filesToMove.length === 0) return [...groups];

  return updatedGroups
    .map((group) => {
      if (group.groupId === targetGroupId) {
        return recalculateTrackImportGroup({
          ...group,
          files: [...group.files, ...filesToMove],
        });
      }
      return group;
    })
    .filter((g) => g.files.length > 0);
}

export function moveFileBetweenTrackImportGroups(
  groups: readonly TrackImportGroup[],
  clientFileId: string,
  targetGroupId: string,
): TrackImportGroup[] {
  return moveFilesBetweenTrackImportGroups(groups, [clientFileId], targetGroupId);
}

export function splitFileToNewTrackImportGroup(
  groups: readonly TrackImportGroup[],
  clientFileId: string,
  newGroupId?: string,
): TrackImportGroup[] {
  const defaultNewGroupId = newGroupId ?? `group-${String(groups.length + 1)}`;
  return splitFilesToNewTrackImportGroup(groups, [clientFileId], defaultNewGroupId);
}

export function updateFileInTrackImportGroup(
  groups: readonly TrackImportGroup[],
  clientFileId: string,
  updates: Partial<ParsedTrackFile>,
): TrackImportGroup[] {
  return groups.map((group) => {
    const containsFile = group.files.some((f) => f.clientFileId === clientFileId);
    if (!containsFile) return group;

    const updatedFiles = group.files.map((file) => {
      if (file.clientFileId !== clientFileId) return file;
      return {
        ...file,
        ...updates,
      };
    });
    return recalculateTrackImportGroup({
      ...group,
      files: updatedFiles,
    });
  });
}
