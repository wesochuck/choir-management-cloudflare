import type { OrganizationMusicPiece, OrganizationRosterConfiguration } from "@choir/contracts";
import { rankCandidatePiecesForGroup, recalculateTrackImportGroup } from "@choir/domain";
import type { DestinationPieceOption } from "./DestinationPiecePicker";
import { getReviewGroupState, type ReviewGroupStatus } from "./reviewState";
import type { GroupReviewItem } from "./types";

export type ReviewView = "guided" | "overview";
export type ReviewFilter = "all" | "to_review" | "conflicts" | "reviewed" | "skipped";
export type ReviewState = ReturnType<typeof getReviewGroupState>;

export interface ReviewQueueRow {
  readonly group: GroupReviewItem;
  readonly ordinal: number;
  readonly state: ReviewState;
  readonly voicePartSortKey: string;
}

export const FILTERS: readonly { readonly id: ReviewFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "to_review", label: "To review" },
  { id: "conflicts", label: "Conflicts" },
  { id: "reviewed", label: "Reviewed" },
  { id: "skipped", label: "Skipped" },
];

export function statusClass(status: ReviewGroupStatus): string {
  return `track-import-review-status track-import-review-status--${status}`;
}

export function formatDuration(seconds: number | null): string {
  if (typeof seconds !== "number" || seconds <= 0) return "Duration unavailable";
  const mins = Math.floor(seconds / 60);
  const remSecs = String(seconds % 60).padStart(2, "0");
  return `${String(mins)}:${remSecs}`;
}

export function voicePartLabel(
  partKey: string | null,
  roster: OrganizationRosterConfiguration | null,
): string {
  if (!partKey) return "Part needed";
  if (partKey === "tutti") return "Tutti";
  if (partKey === "accompaniment") return "Accompaniment";
  return (
    roster?.sections.find((section) => section.code === partKey)?.name ??
    roster?.voiceParts.find((part) => part.label === partKey)?.fullName ??
    partKey
  );
}

export function reviewFileLabel(
  status: "needs_review" | "conflict" | "ready" | "excluded",
  excluded: boolean,
  duplicatePart: boolean,
  occupied: boolean,
  partKey: string | null,
): string {
  if (excluded) return "Excluded";
  if (duplicatePart) return "Duplicate part conflict";
  if (occupied) return "Occupied slot conflict";
  if (status === "ready") return "Ready to upload";
  return partKey ? "Needs review" : "Part needed";
}

export function reviewFileBadgeStatus(
  status: "needs_review" | "conflict" | "ready" | "excluded",
): ReviewGroupStatus {
  if (status === "conflict") return "conflict";
  if (status === "ready") return "reviewed";
  if (status === "excluded") return "skipped";
  return "needs_review";
}

function queueRowMatchesFilter(status: ReviewGroupStatus, filter: ReviewFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "to_review":
      return status === "needs_review";
    case "conflicts":
      return status === "conflict";
    case "reviewed":
      return status === "reviewed";
    case "skipped":
      return status === "skipped";
  }
}

function queueRowMatchesSearch(
  group: GroupReviewItem,
  terms: readonly string[],
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
): boolean {
  if (terms.length === 0) return true;
  const piece = group.selectedPieceId ? pieceMap.get(group.selectedPieceId) : undefined;
  const searchable = [
    group.inferredTitle,
    piece?.title ?? "",
    piece?.composer ?? "",
    piece?.arranger ?? "",
    ...group.files.map((file) => file.fileName),
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => searchable.includes(term));
}

export function filterReviewQueueRows(
  rows: readonly ReviewQueueRow[],
  filter: ReviewFilter,
  search: string,
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
): readonly ReviewQueueRow[] {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(
    ({ group, state }) =>
      queueRowMatchesFilter(state.groupStatus, filter) &&
      queueRowMatchesSearch(group, terms, pieceMap),
  );
}

export function buildQueueRows(
  groups: readonly GroupReviewItem[],
  groupStates: ReadonlyMap<string, ReviewState>,
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
  validPartKeys: ReadonlySet<string>,
  roster: OrganizationRosterConfiguration | null,
): readonly ReviewQueueRow[] {
  return groups.map((group, index) => ({
    group,
    ordinal: index + 1,
    state: groupStates.get(group.groupId) ?? getReviewGroupState(group, pieceMap, validPartKeys),
    voicePartSortKey: group.files.map((file) => voicePartLabel(file.partKey, roster)).join(", "),
  }));
}

export function summarizeReviewGroups(
  groups: readonly GroupReviewItem[],
  groupStates: ReadonlyMap<string, ReviewState>,
) {
  let totalFiles = 0;
  let blockingConflicts = 0;
  let reviewedGroups = 0;
  let skippedGroups = 0;
  let resolvedGroups = 0;
  for (const group of groups) {
    const state = groupStates.get(group.groupId);
    totalFiles += group.files.length;
    blockingConflicts += state?.blockingConflictCount ?? 0;
    if (state?.groupStatus === "reviewed") reviewedGroups += 1;
    if (state?.groupStatus === "skipped") skippedGroups += 1;
    if (state?.groupStatus === "reviewed" || state?.groupStatus === "skipped") resolvedGroups += 1;
  }
  return { blockingConflicts, resolvedGroups, reviewedGroups, skippedGroups, totalFiles };
}

export function buildDestinationOptions(
  groups: readonly GroupReviewItem[],
  selectedGroupId: string,
  performancePieceIds: readonly string[],
  pieces: readonly OrganizationMusicPiece[],
): readonly DestinationPieceOption[] {
  const active = groups.find((group) => group.groupId === selectedGroupId) ?? groups[0];
  const candidateRank = new Map(
    (active?.candidates ?? []).map((candidate, index) => [candidate.piece.id, index]),
  );
  const setListRank = new Map(performancePieceIds.map((pieceId, index) => [pieceId, index]));
  return pieces
    .map((piece) => ({
      arranger: piece.arranger,
      composer: piece.composer,
      id: piece.id,
      occupiedParts: Object.keys(piece.trackFileIds),
      searchText: `${piece.title} ${piece.composer} ${piece.arranger}`.toLowerCase(),
      title: piece.title,
      trackCount: Object.keys(piece.trackFileIds).length,
    }))
    .sort((left, right) => {
      const leftSetListRank = setListRank.get(left.id);
      const rightSetListRank = setListRank.get(right.id);
      if (leftSetListRank !== undefined && rightSetListRank !== undefined) {
        return leftSetListRank - rightSetListRank;
      }
      if (leftSetListRank !== undefined) return -1;
      if (rightSetListRank !== undefined) return 1;
      const leftCandidateRank = candidateRank.get(left.id);
      const rightCandidateRank = candidateRank.get(right.id);
      if (leftCandidateRank !== undefined && rightCandidateRank !== undefined) {
        return leftCandidateRank - rightCandidateRank;
      }
      if (leftCandidateRank !== undefined) return -1;
      if (rightCandidateRank !== undefined) return 1;
      return left.title.localeCompare(right.title);
    });
}

export function getNextUnresolvedGroup(
  groups: readonly GroupReviewItem[],
  activeGroup: GroupReviewItem | undefined,
  groupStates: ReadonlyMap<string, ReviewState>,
): GroupReviewItem | undefined {
  if (!activeGroup) return undefined;
  const currentIndex = groups.findIndex((group) => group.groupId === activeGroup.groupId);
  for (let offset = 1; offset < groups.length; offset += 1) {
    const candidate = groups[(currentIndex + offset + groups.length) % groups.length];
    if (!candidate) continue;
    const status = groupStates.get(candidate.groupId)?.groupStatus;
    if (status !== "reviewed" && status !== "skipped") return candidate;
  }
  return undefined;
}

export function getActiveGroup(
  groups: readonly GroupReviewItem[],
  selectedGroupId: string,
): GroupReviewItem | undefined {
  return groups.find((group) => group.groupId === selectedGroupId) ?? groups[0];
}

export function getActiveGroupState(
  group: GroupReviewItem | undefined,
  groupStates: ReadonlyMap<string, ReviewState>,
): ReviewState | undefined {
  return group ? groupStates.get(group.groupId) : undefined;
}

export function getSelectedPiece(
  group: GroupReviewItem | undefined,
  pieceMap: ReadonlyMap<string, OrganizationMusicPiece>,
): OrganizationMusicPiece | undefined {
  return group?.selectedPieceId ? pieceMap.get(group.selectedPieceId) : undefined;
}

export function getActiveFileStateMap(state: ReviewState | undefined) {
  return new Map((state?.files ?? []).map((file) => [file.clientFileId, file]));
}

export function getGroupFileMap(group: GroupReviewItem | undefined) {
  return new Map((group?.files ?? []).map((file) => [file.clientFileId, file]));
}

export function getOptionalGroupConflictAnalysis(
  group: GroupReviewItem | undefined,
  state: ReviewState | undefined,
) {
  if (!group || !state) return undefined;
  return getGroupConflictAnalysis(group, state);
}

export function buildPartOptions(roster: OrganizationRosterConfiguration | null) {
  const options: { key: string; label: string }[] = [{ key: "tutti", label: "Tutti" }];
  const seen = new Set(["tutti", "accompaniment"]);
  for (const section of roster?.sections ?? []) {
    if (seen.has(section.code)) continue;
    options.push({ key: section.code, label: `${section.name} (${section.code}) — section` });
    seen.add(section.code);
  }
  for (const voicePart of roster?.voiceParts ?? []) {
    if (seen.has(voicePart.label)) continue;
    options.push({ key: voicePart.label, label: voicePart.fullName });
    seen.add(voicePart.label);
  }
  options.push({ key: "accompaniment", label: "Accompaniment" });
  return options;
}

export function getAdjacentGroupId(
  groups: readonly GroupReviewItem[],
  activeGroup: GroupReviewItem | undefined,
  direction: -1 | 1,
): string {
  if (!activeGroup) return "";
  const currentIndex = groups.findIndex((group) => group.groupId === activeGroup.groupId);
  const nextIndex = (currentIndex + direction + groups.length) % groups.length;
  return groups[nextIndex]?.groupId ?? "";
}

export function selectNextGroup(
  group: GroupReviewItem | undefined,
  setSelectedGroupId: (groupId: string) => void,
): void {
  if (group) setSelectedGroupId(group.groupId);
}

export function markReviewGroupAndAdvance(
  group: GroupReviewItem | undefined,
  state: ReviewState | undefined,
  onMarkGroupReviewed: (groupId: string) => void,
  onAdvance: () => void,
): void {
  if (!group || !state?.isEligibleForReview) return;
  onMarkGroupReviewed(group.groupId);
  onAdvance();
}

function getGroupConflictAnalysis(group: GroupReviewItem, state: ReviewState) {
  const filesById = new Map(group.files.map((file) => [file.clientFileId, file]));
  const conflicts = state.files.filter((file) => file.status === "conflict");
  const partCounts = new Map<string, number>();
  for (const file of group.files) {
    if (!file.excluded && file.partKey) {
      partCounts.set(file.partKey, (partCounts.get(file.partKey) ?? 0) + 1);
    }
  }
  const duplicatePartKeys = new Set<string>();
  for (const conflict of conflicts) {
    const file = filesById.get(conflict.clientFileId);
    if (file?.partKey && (partCounts.get(file.partKey) ?? 0) > 1) {
      duplicatePartKeys.add(file.partKey);
    }
  }
  return {
    conflicts,
    duplicateConflict: conflicts.some((file) => file.conflictReason?.includes("Duplicate")),
    duplicatePartKeys,
    filesById,
    occupiedConflict: conflicts.some((file) =>
      file.conflictReason?.includes("already has a recording"),
    ),
  };
}

export function getGroupEvidence(
  group: GroupReviewItem | undefined,
  pieces: readonly OrganizationMusicPiece[],
  performancePieceIds: readonly string[],
): readonly string[] {
  if (!group?.selectedPieceId) return [];

  // 1. Deterministic evidence for the selected piece
  const currentGroup = recalculateTrackImportGroup({
    ...group,
    files: group.files
      .filter((file) => !file.excluded)
      .map((file) => ({
        ...file,
        metadata: file.metadata ?? null,
        detectedPartKey: file.partKey,
        detectedPartLabel: null,
        inferredTitle: group.inferredTitle,
        sequenceNumber: group.sequenceNumber,
      })),
  });
  const candidate = rankCandidatePiecesForGroup(
    currentGroup,
    pieces.filter((piece) => piece.id === group.selectedPieceId),
    performancePieceIds,
  ).candidatePieces[0];
  const evidenceList: string[] = candidate ? [...candidate.evidence] : [];

  // 2. Separate AI estimate if AI suggestion matches the currently selected piece
  const aiMatchesSelection =
    group.aiSuggestion?.suggestedPieceId === group.selectedPieceId ||
    group.aiSuggestion?.topCandidates?.some((c) => c.pieceId === group.selectedPieceId);

  if (aiMatchesSelection && group.aiSuggestion) {
    const top = group.aiSuggestion.topCandidates?.find((c) => c.pieceId === group.selectedPieceId);
    if (top && typeof top.probability === "number") {
      evidenceList.push(
        `AI estimate (~${String(Math.round(top.probability * 100))}% model estimate; not calibrated accuracy)`,
      );
    } else if (group.aiSuggestion.rationale) {
      evidenceList.push(group.aiSuggestion.rationale);
    }
  }

  return evidenceList;
}
