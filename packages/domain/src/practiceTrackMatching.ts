import type { ParsedId3Metadata } from "./id3Metadata";

export interface ConfiguredPartOption {
  readonly key: string;
  readonly label: string;
}

/** Resolves duplicate parts across files without coercing unassigned tracks to Tutti. */
export function resolvePracticeTrackAssignments<
  T extends {
    readonly partKey: string | null;
    readonly partSelectionChanged?: boolean | undefined;
  },
>(
  files: readonly T[],
  _selectedPieceId?: string | null,
): {
  duplicatePartKeys: string[];
  files: T[];
  hasDuplicatePart: boolean;
} {
  void _selectedPieceId;
  const resolvedFiles = [...files];
  const counts = new Map<string, number>();
  for (const file of resolvedFiles) {
    if (file.partKey) counts.set(file.partKey, (counts.get(file.partKey) ?? 0) + 1);
  }
  const duplicatePartKeys = [...counts].filter(([, count]) => count > 1).map(([key]) => key);
  return {
    duplicatePartKeys,
    files: resolvedFiles,
    hasDuplicatePart: duplicatePartKeys.length > 0,
  };
}

export interface ParsedTrackFile {
  readonly clientFileId: string;
  readonly detectedPartKey: string | null;
  readonly detectedPartLabel: string | null;
  readonly durationSeconds: number | null;
  readonly fileName: string;
  readonly inferredTitle: string;
  readonly metadata?: ParsedId3Metadata | null;
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

function normalizePartName(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/gu, "")
    .replace(/^(soprano|alto|tenor|baritone)s$/u, "$1")
    .replace(/^basses$/u, "bass");
}

function skipUnconfiguredPart(
  parts: readonly ConfiguredPartOption[],
  match: ConfiguredPartOption | null | undefined,
  key: string,
): boolean {
  return parts.length > 0 && !match && !["tutti", "accompaniment"].includes(key);
}

function buildPartCandidates(
  configuredParts: readonly ConfiguredPartOption[],
): { alias: string; key: string; label: string }[] {
  const candidates: { alias: string; key: string; label: string }[] = [];
  const aliases = new Set<string>();
  const defaultKeys = new Map(
    DEFAULT_PART_ALIASES.map((part) => [normalizePartName(part.alias), part.key]),
  );
  const canonicalName = (value: string) => {
    const normalized = normalizePartName(value);
    return defaultKeys.get(normalized) ?? normalized;
  };
  const configuredByKey = new Map<string, ConfiguredPartOption>();
  const configuredByName = new Map<string, ConfiguredPartOption | null>();
  for (const part of configuredParts) {
    configuredByKey.set(normalizePartName(part.key), part);
    for (const value of [part.label, part.key]) {
      const alias = value.toLowerCase();
      if (!aliases.has(alias)) {
        candidates.push({ alias, key: part.key, label: part.label });
        aliases.add(alias);
      }
      const name = canonicalName(value);
      const existing = configuredByName.get(name);
      // An ambiguous name must not silently choose one configured track slot.
      configuredByName.set(
        name,
        existing === undefined || existing?.key === part.key ? part : null,
      );
    }
  }
  for (const def of DEFAULT_PART_ALIASES) {
    if (aliases.has(def.alias)) continue;
    const configuredMatch =
      configuredByKey.get(normalizePartName(def.key)) ?? configuredByName.get(def.key);
    if (skipUnconfiguredPart(configuredParts, configuredMatch, def.key)) continue;
    candidates.push({
      alias: def.alias,
      key: configuredMatch?.key ?? def.key,
      label: configuredMatch?.label ?? def.label,
    });
    aliases.add(def.alias);
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
    const escapedAlias = candidate.alias.replaceAll(/[\\^$*+?.()|[\]{}]/gu, "\\$&");
    // Single-letter section codes need a filename edge, so articles in song titles do not match.
    const pattern =
      candidate.alias.length === 1
        ? `(?:^${escapedAlias}\\s*[-_.]|(?:^|[\\s_.-])${escapedAlias}$)`
        : `(?:^|[\\s_-])${escapedAlias}(?:[\\s_-]|$)`;
    const regex = new RegExp(pattern, "iu");
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
    const escaped = partMatchAlias.replaceAll(/[\\^$*+?.()|[\]{}]/gu, "\\$&");
    inferredTitle = inferredTitle.replaceAll(
      new RegExp(`(^|[\\s_.-])${escaped}(?=[\\s_.-]|$)`, "giu"),
      "$1 ",
    );
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

function extractSequenceNumber(baseName: string): string | null {
  const seqMatch = /(?:^|[^0-9])(\d{1,3})(?=[_\s-]|$)/u.exec(baseName);
  if (seqMatch?.[1]) {
    return seqMatch[1].padStart(2, "0");
  }
  return null;
}

function resolveInferredTitle(
  baseName: string,
  detectedAlias: string | null,
  sequenceNumber: string | null,
  metadata?: ParsedId3Metadata | null,
): { inferredTitle: string; sequenceNumber: string | null } {
  let inferredTitle = cleanInferredTitle(baseName, detectedAlias, sequenceNumber);
  const resolvedSeq = sequenceNumber;

  if (metadata?.title && metadata.title.trim().length > 0) {
    const isGeneric =
      /^(?:track|audio|take|rec|file|recording)?\s*#?\d*$/iu.test(inferredTitle) ||
      inferredTitle.length <= 2;
    if (isGeneric) {
      inferredTitle = metadata.title.trim();
    }
  }

  return { inferredTitle, sequenceNumber: resolvedSeq };
}

export function parsePracticeTrackFilename(
  fileName: string,
  configuredParts: readonly ConfiguredPartOption[] = [],
  clientFileId = fileName,
  durationSeconds: number | null = null,
  metadata?: ParsedId3Metadata | null,
): ParsedTrackFile {
  const baseName = fileName.replace(/\.[a-zA-Z0-9]+$/u, "").trim();
  const rawSeq = extractSequenceNumber(baseName);
  const partCandidates = buildPartCandidates(configuredParts);
  const unsupportedNumberedPart = /\b(soprano|alto|tenor|bass|sop|alt|ten)\s*([12])\b/iu.exec(
    baseName.replaceAll(/[_-]/gu, " "),
  );
  const detectedCandidate = detectVoicePart(baseName, partCandidates);
  const detected =
    unsupportedNumberedPart &&
    detectedCandidate &&
    !/[12]$/u.test(normalizePartName(detectedCandidate.key)) &&
    !/[12]$/u.test(normalizePartName(detectedCandidate.label))
      ? null
      : detectedCandidate;
  const { inferredTitle, sequenceNumber } = resolveInferredTitle(
    baseName,
    detected?.alias ?? null,
    rawSeq,
    metadata,
  );

  return {
    clientFileId,
    detectedPartKey: detected?.key ?? null,
    detectedPartLabel: detected?.label ?? null,
    durationSeconds,
    fileName,
    inferredTitle,
    metadata: metadata ?? null,
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

function evaluateSequenceMatch(
  group: TrackImportGroup,
  piece: LibraryPieceOption,
  performanceSetListPieceIds?: readonly string[],
): { evidence?: string; score: number } {
  if (!performanceSetListPieceIds || !group.sequenceNumber) return { score: 0 };
  const seqIndex = Number.parseInt(group.sequenceNumber, 10) - 1;
  if (seqIndex >= 0 && performanceSetListPieceIds[seqIndex] === piece.id) {
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
  const bestTitleResult = findBestTitleMatch(group, piece);
  score += bestTitleResult.score;
  if (bestTitleResult.evidenceItem) {
    evidence.push(bestTitleResult.evidenceItem);
  }

  // Title or a known set-list position must identify the piece. Timing, empty
  // slots, and group composition cannot identify an otherwise unrelated song.
  const sequenceMatches = Boolean(
    group.sequenceNumber &&
    performanceSetListPieceIds?.[Number.parseInt(group.sequenceNumber, 10) - 1] === piece.id,
  );
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
  const seqResult = evaluateSequenceMatch(group, piece, performanceSetListPieceIds);
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
    // A tie needs a human decision, never an arbitrary library-order choice.
    suggestedPiece:
      candidates[0] && candidates[0].score !== candidates[1]?.score ? candidates[0] : null,
  };
}
