export interface ConfiguredPartOption {
  readonly key: string;
  readonly label: string;
}

export interface ParsedTrackFile {
  readonly clientFileId: string;
  readonly detectedPartKey: string | null;
  readonly detectedPartLabel: string | null;
  readonly durationSeconds: number | null;
  readonly fileName: string;
  readonly inferredTitle: string;
  readonly sequenceNumber: string | null;
}

export interface TrackImportGroup {
  readonly averageDurationSeconds: number | null;
  readonly duplicatePartKeys: readonly string[];
  readonly files: readonly ParsedTrackFile[];
  readonly groupId: string;
  readonly hasDuplicatePart: boolean;
  readonly inferredTitle: string;
  readonly sequenceNumber: string | null;
}

export interface LibraryPieceOption {
  readonly arranger?: string | null | undefined;
  readonly composer?: string | null | undefined;
  readonly durationSeconds?: number | null | undefined;
  readonly id: string;
  readonly parentId?: string | null | undefined;
  readonly title: string;
  readonly trackFileIds?: Record<string, string> | undefined;
}

export interface RankedPieceCandidate {
  readonly confidence: "high" | "medium" | "low" | "none";
  readonly conflicts: readonly string[];
  readonly evidence: readonly string[];
  readonly piece: LibraryPieceOption;
  readonly score: number;
}

export interface GroupCandidateMatch {
  readonly candidatePieces: readonly RankedPieceCandidate[];
  readonly groupId: string;
  readonly suggestedPiece: RankedPieceCandidate | null;
}

const DEFAULT_PART_ALIASES: readonly {
  readonly alias: string;
  readonly key: string;
  readonly label: string;
}[] = [
  // Tutti / Full Mix
  { alias: "tutti", key: "tutti", label: "Tutti" },
  { alias: "full", key: "tutti", label: "Tutti" },
  { alias: "mix", key: "tutti", label: "Tutti" },
  { alias: "all", key: "tutti", label: "Tutti" },
  { alias: "choir", key: "tutti", label: "Tutti" },
  { alias: "ensemble", key: "tutti", label: "Tutti" },

  // Soprano
  { alias: "soprano 1", key: "soprano1", label: "Soprano 1" },
  { alias: "soprano1", key: "soprano1", label: "Soprano 1" },
  { alias: "sop 1", key: "soprano1", label: "Soprano 1" },
  { alias: "s1", key: "soprano1", label: "Soprano 1" },
  { alias: "soprano 2", key: "soprano2", label: "Soprano 2" },
  { alias: "soprano2", key: "soprano2", label: "Soprano 2" },
  { alias: "sop 2", key: "soprano2", label: "Soprano 2" },
  { alias: "s2", key: "soprano2", label: "Soprano 2" },
  { alias: "soprano", key: "soprano", label: "Soprano" },
  { alias: "sop", key: "soprano", label: "Soprano" },

  // Alto
  { alias: "alto 1", key: "alto1", label: "Alto 1" },
  { alias: "alto1", key: "alto1", label: "Alto 1" },
  { alias: "alt 1", key: "alto1", label: "Alto 1" },
  { alias: "a1", key: "alto1", label: "Alto 1" },
  { alias: "alto 2", key: "alto2", label: "Alto 2" },
  { alias: "alto2", key: "alto2", label: "Alto 2" },
  { alias: "alt 2", key: "alto2", label: "Alto 2" },
  { alias: "a2", key: "alto2", label: "Alto 2" },
  { alias: "contralto", key: "alto", label: "Alto" },
  { alias: "alto", key: "alto", label: "Alto" },
  { alias: "alt", key: "alto", label: "Alto" },

  // Tenor
  { alias: "tenor 1", key: "tenor1", label: "Tenor 1" },
  { alias: "tenor1", key: "tenor1", label: "Tenor 1" },
  { alias: "ten 1", key: "tenor1", label: "Tenor 1" },
  { alias: "t1", key: "tenor1", label: "Tenor 1" },
  { alias: "tenor 2", key: "tenor2", label: "Tenor 2" },
  { alias: "tenor2", key: "tenor2", label: "Tenor 2" },
  { alias: "ten 2", key: "tenor2", label: "Tenor 2" },
  { alias: "t2", key: "tenor2", label: "Tenor 2" },
  { alias: "tenor", key: "tenor", label: "Tenor" },
  { alias: "ten", key: "tenor", label: "Tenor" },

  // Baritone
  { alias: "baritone", key: "baritone", label: "Baritone" },
  { alias: "barit", key: "baritone", label: "Baritone" },
  { alias: "bari", key: "baritone", label: "Baritone" },
  { alias: "bar", key: "baritone", label: "Baritone" },

  // Bass
  { alias: "bass 1", key: "bass1", label: "Bass 1" },
  { alias: "bass1", key: "bass1", label: "Bass 1" },
  { alias: "b1", key: "bass1", label: "Bass 1" },
  { alias: "bass 2", key: "bass2", label: "Bass 2" },
  { alias: "bass2", key: "bass2", label: "Bass 2" },
  { alias: "b2", key: "bass2", label: "Bass 2" },
  { alias: "bass", key: "bass", label: "Bass" },
  { alias: "bas", key: "bass", label: "Bass" },

  // Accompaniment
  { alias: "accompaniment", key: "accompaniment", label: "Accompaniment" },
  { alias: "accomp", key: "accompaniment", label: "Accompaniment" },
  { alias: "acc", key: "accompaniment", label: "Accompaniment" },
  { alias: "piano", key: "accompaniment", label: "Accompaniment" },
  { alias: "instrumental", key: "accompaniment", label: "Accompaniment" },
];

function buildPartCandidates(
  configuredParts: readonly ConfiguredPartOption[],
): { alias: string; key: string; label: string }[] {
  const candidates: { alias: string; key: string; label: string }[] = [];
  for (const part of configuredParts) {
    candidates.push({
      alias: part.label.toLowerCase(),
      key: part.key,
      label: part.label,
    });
    candidates.push({
      alias: part.key.toLowerCase(),
      key: part.key,
      label: part.label,
    });
  }
  for (const def of DEFAULT_PART_ALIASES) {
    if (!candidates.some((c) => c.alias === def.alias)) {
      const configuredMatch = configuredParts.find(
        (cp) => cp.key.toLowerCase() === def.key.toLowerCase(),
      );
      candidates.push({
        alias: def.alias,
        key: configuredMatch?.key ?? def.key,
        label: configuredMatch?.label ?? def.label,
      });
    }
  }
  candidates.sort((a, b) => b.alias.length - a.alias.length);
  return candidates;
}

function detectVoicePart(
  baseName: string,
  candidates: readonly { alias: string; key: string; label: string }[],
): { alias: string; key: string; label: string } | null {
  const normalizedForSearch = baseName.toLowerCase().replaceAll(/[-_.]/gu, " ");
  for (const candidate of candidates) {
    const escapedAlias = candidate.alias.replaceAll(/[-/\\^$*+?.()|[\]{}]/gu, "\\$&");
    const regex = new RegExp(`(?:^|[\\s_-])${escapedAlias}(?:[\\s_-]|$)`, "iu");
    if (regex.test(baseName) || regex.test(normalizedForSearch)) {
      return candidate;
    }
  }
  return null;
}

function cleanInferredTitle(
  baseName: string,
  partMatchAlias: string | null,
  sequenceNumber: string | null,
): string {
  let inferredTitle = baseName;
  if (partMatchAlias) {
    const escaped = partMatchAlias.replaceAll(/[-/\\^$*+?.()|[\]{}]/gu, "\\$&");
    inferredTitle = inferredTitle.replaceAll(new RegExp(escaped, "giu"), " ");
  }
  if (sequenceNumber) {
    const numStr = String(Number.parseInt(sequenceNumber, 10));
    inferredTitle = inferredTitle.replaceAll(
      new RegExp(`(?:^|\\b)(?:track[\\s_-]*)?#?0*${numStr}(?:[\\s_-]|$)`, "giu"),
      " ",
    );
  }
  inferredTitle = inferredTitle
    .replaceAll(/\b(?:v\d+|final|master|mix|demo|rec|audio|choir|take\s*\d+)\b/giu, " ")
    .replaceAll(/[-_.]/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();

  return inferredTitle.length > 0 ? inferredTitle : baseName;
}

export function parsePracticeTrackFilename(
  fileName: string,
  configuredParts: readonly ConfiguredPartOption[] = [],
  clientFileId = fileName,
  durationSeconds: number | null = null,
): ParsedTrackFile {
  const baseName = fileName.replace(/\.[a-zA-Z0-9]+$/u, "").trim();

  let sequenceNumber: string | null = null;
  const seqMatch = /(?:^|[^0-9])(\d{1,3})(?=[_\s-]|$)/u.exec(baseName);
  if (seqMatch?.[1]) {
    sequenceNumber = seqMatch[1].padStart(2, "0");
  }

  const partCandidates = buildPartCandidates(configuredParts);
  const detected = detectVoicePart(baseName, partCandidates);
  const inferredTitle = cleanInferredTitle(baseName, detected?.alias ?? null, sequenceNumber);

  return {
    clientFileId,
    detectedPartKey: detected?.key ?? null,
    detectedPartLabel: detected?.label ?? null,
    durationSeconds,
    fileName,
    inferredTitle,
    sequenceNumber,
  };
}

function normalizeTitleStem(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function titleTokenOverlap(a: string, b: string): number {
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
  inferredTitle?: string;
  sequenceNumber?: string | null;
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

export function moveFileBetweenTrackImportGroups(
  groups: readonly TrackImportGroup[],
  clientFileId: string,
  targetGroupId: string,
): TrackImportGroup[] {
  let fileToMove: ParsedTrackFile | null = null;
  for (const group of groups) {
    const found = group.files.find((f) => f.clientFileId === clientFileId);
    if (found) {
      fileToMove = found;
      break;
    }
  }
  if (!fileToMove) return [...groups];

  const targetFile = fileToMove;
  const updated = groups.map((group) => {
    const remainingFiles = group.files.filter((f) => f.clientFileId !== clientFileId);
    if (group.groupId === targetGroupId) {
      return recalculateTrackImportGroup({
        ...group,
        files: [...remainingFiles, targetFile],
      });
    }
    return recalculateTrackImportGroup({
      ...group,
      files: remainingFiles,
    });
  });

  return updated.filter((g) => g.files.length > 0);
}

export function splitFileToNewTrackImportGroup(
  groups: readonly TrackImportGroup[],
  clientFileId: string,
  newGroupId?: string,
): TrackImportGroup[] {
  let fileToSplit: ParsedTrackFile | null = null;
  for (const group of groups) {
    const found = group.files.find((f) => f.clientFileId === clientFileId);
    if (found) {
      fileToSplit = found;
      break;
    }
  }
  if (!fileToSplit) return [...groups];

  const targetFile = fileToSplit;
  const remainingGroups = groups
    .map((g) =>
      recalculateTrackImportGroup({
        ...g,
        files: g.files.filter((f) => f.clientFileId !== clientFileId),
      }),
    )
    .filter((g) => g.files.length > 0);

  const groupId = newGroupId ?? `group-${String(groups.length + 1)}`;
  const newGroup = recalculateTrackImportGroup({
    files: [targetFile],
    groupId,
    inferredTitle: targetFile.inferredTitle,
    sequenceNumber: targetFile.sequenceNumber,
  });

  return [...remainingGroups, newGroup];
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
  if (normGroup === normPiece) {
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

function scoreCandidatePiece(
  piece: LibraryPieceOption,
  group: TrackImportGroup,
  performanceSetListPieceIds?: readonly string[],
): { conflicts: string[]; evidence: string[]; score: number } {
  let score = 0;
  const evidence: string[] = [];

  // 1. Set list association
  const inSetList = performanceSetListPieceIds?.includes(piece.id) ?? false;
  if (inSetList) {
    score += 35;
    evidence.push("Linked to selected set list");
  }

  // 2. Title similarity
  const titleResult = scoreTitleMatch(
    normalizeTitleStem(group.inferredTitle),
    normalizeTitleStem(piece.title),
    piece.title,
  );
  score += titleResult.score;
  if (titleResult.evidenceItem) {
    evidence.push(titleResult.evidenceItem);
  }

  // 3. Duration match
  const durResult = scoreDurationMatch(piece.durationSeconds, group.averageDurationSeconds);
  score += durResult.score;
  if (durResult.evidenceItem) {
    evidence.push(durResult.evidenceItem);
  }

  // 4. Complementary voice parts
  if (group.files.length >= 2 && !group.hasDuplicatePart) {
    score += 10;
    evidence.push("Complementary voice parts");
  }

  // 5. Sequence number matching if set list provided
  if (performanceSetListPieceIds && group.sequenceNumber) {
    const seqIndex = Number.parseInt(group.sequenceNumber, 10) - 1;
    if (seqIndex >= 0 && performanceSetListPieceIds[seqIndex] === piece.id) {
      score += 25;
      evidence.push(`Shared sequence number #${group.sequenceNumber}`);
    }
  }

  // 6. Unrecorded bonus (populating empty pieces)
  const existingTrackCount = Object.keys(piece.trackFileIds ?? {}).length;
  if (existingTrackCount === 0) {
    score += 10;
  }

  // 7. Check for slot conflicts
  const conflicts = detectSlotConflicts(piece, group.files);

  return { conflicts, evidence, score };
}

export function rankCandidatePiecesForGroup(
  group: TrackImportGroup,
  pieces: readonly LibraryPieceOption[],
  performanceSetListPieceIds?: readonly string[],
): GroupCandidateMatch {
  const candidates: RankedPieceCandidate[] = [];

  for (const piece of pieces) {
    const { conflicts, evidence, score } = scoreCandidatePiece(
      piece,
      group,
      performanceSetListPieceIds,
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
    suggestedPiece: candidates[0] ?? null,
  };
}
