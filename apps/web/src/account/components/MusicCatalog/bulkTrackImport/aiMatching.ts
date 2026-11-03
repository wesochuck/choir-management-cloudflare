import type { FilePartSuggestion, MusicTrackImportGroupRepairSuggestion } from "@choir/contracts";
import {
  rankCandidatePiecesForGroup,
  resolvePracticeTrackAssignments,
  type TrackImportGroup,
} from "@choir/domain";
import type { Dispatch, SetStateAction } from "react";
import { matchBulkPracticeTracks } from "../../../../api/music";
import type {
  BulkPracticeTrackImportDialogProps,
  GroupFileAssignment,
  GroupReviewItem,
  InspectedTrackFile,
} from "./types";

export function buildReviewGroups(
  domainGroups: readonly TrackImportGroup[],
  pieces: BulkPracticeTrackImportDialogProps["pieces"],
  performancePieceIds: readonly string[],
  fileLookup: ReadonlyMap<string, InspectedTrackFile>,
): GroupReviewItem[] {
  return domainGroups.map((group) => {
    const match = rankCandidatePiecesForGroup(group, pieces, performancePieceIds);
    const selectedPieceId = match.suggestedPiece?.piece.id ?? null;
    const files: GroupFileAssignment[] = group.files.map((f) => {
      const original = fileLookup.get(f.clientFileId);
      return {
        clientFileId: f.clientFileId,
        detectedPartKey: f.detectedPartKey,
        detectedPartLabel: f.detectedPartLabel,
        durationSeconds: f.durationSeconds,
        file: original?.file ?? new File([], f.fileName),
        fileName: f.fileName,
        inferredTitle:
          f.inferredTitle.length > 0 ? f.inferredTitle : (original?.inferredTitle ?? f.fileName),
        metadata: original?.metadata ?? null,
        partKey: f.detectedPartKey,
        partProvenance: f.detectedPartKey ? ("deterministic" as const) : undefined,
        sequenceNumber: f.sequenceNumber ?? original?.sequenceNumber ?? null,
      };
    });

    return {
      averageDurationSeconds: group.averageDurationSeconds,
      candidates: match.candidatePieces,
      destinationProvenance: selectedPieceId ? ("deterministic" as const) : undefined,
      destinationSelectionChanged: false,
      evidence: match.suggestedPiece?.evidence ?? [],
      ...resolvePracticeTrackAssignments(files, selectedPieceId),
      groupId: group.groupId,
      inferredTitle: group.inferredTitle,
      selectedPieceId,
      sequenceNumber: group.sequenceNumber,
    };
  });
}

function extractId3MetadataFields(meta: GroupFileAssignment["metadata"]) {
  if (!meta) return {};
  return {
    album: meta.album ?? undefined,
    artist: meta.artist ?? undefined,
    composer: meta.composer ?? undefined,
    title: meta.title ?? undefined,
    trackNumber: meta.trackNumber ?? undefined,
  };
}

function buildFileMetadata(file: GroupFileAssignment) {
  return {
    ...extractId3MetadataFields(file.metadata),
    clientFileId: file.clientFileId,
    currentPartKey: file.partKey ?? undefined,
    detectedPartKey: file.detectedPartKey ?? undefined,
    detectedPartLabel: file.detectedPartLabel ?? undefined,
    durationSeconds: file.durationSeconds,
    excluded: file.excluded,
    fileName: file.fileName,
    inferredTitle: file.inferredTitle ?? undefined,
    manualPart: file.partProvenance === "manual" || file.partSelectionChanged,
    sequenceNumber: file.sequenceNumber ?? undefined,
  };
}

export function buildMatchRequestGroup(group: GroupReviewItem) {
  return {
    detectedParts: group.files.flatMap((file) => (file.partKey ? [file.partKey] : [])),
    durationSeconds: group.averageDurationSeconds,
    fileMetadata: group.files.map(buildFileMetadata),
    fileNames: group.files.map((file) => file.fileName),
    groupId: group.groupId,
    inferredTitle: group.inferredTitle,
    ...(group.sequenceNumber ? { sequenceNumber: group.sequenceNumber } : {}),
  };
}

function extractFileSuggestionFields(
  file: GroupFileAssignment,
  partSuggestion: FilePartSuggestion | undefined,
) {
  return {
    partAlternatives: partSuggestion?.alternatives ?? file.partAlternatives,
    partSuggestionEvidence: partSuggestion?.evidence ?? file.partSuggestionEvidence,
    partSuggestionReason: partSuggestion?.reason ?? file.partSuggestionReason,
    suggestedPartKey: partSuggestion?.suggestedPartKey ?? file.suggestedPartKey,
    suggestedPartProbability: partSuggestion?.probability ?? file.suggestedPartProbability,
  };
}

function shouldAutoAssignPart(
  file: GroupFileAssignment,
  partSuggestion: FilePartSuggestion | undefined,
  validPartKeys: ReadonlySet<string>,
): boolean {
  if (file.partKey !== null || !partSuggestion?.suggestedPartKey) return false;
  return partSuggestion.probability >= 0.7 && validPartKeys.has(partSuggestion.suggestedPartKey);
}

function applyAiSuggestionToFile(
  file: GroupFileAssignment,
  partSuggestion: FilePartSuggestion | undefined,
  validPartKeys: ReadonlySet<string>,
): GroupFileAssignment {
  const fields = extractFileSuggestionFields(file, partSuggestion);

  if (file.partSelectionChanged || file.excluded) {
    return { ...file, ...fields };
  }

  if (shouldAutoAssignPart(file, partSuggestion, validPartKeys)) {
    return {
      ...file,
      ...fields,
      partKey: partSuggestion?.suggestedPartKey ?? null,
      partProvenance: "ai" as const,
    };
  }

  return { ...file, ...fields };
}

function applyAiSuggestionToGroup(
  group: GroupReviewItem,
  suggestion: GroupReviewItem["aiSuggestion"],
  allowedIds: ReadonlySet<string>,
  validPartKeys: ReadonlySet<string>,
): GroupReviewItem {
  if (!suggestion) return group;

  if (group.reviewedMappingKey || group.groupSkipped) {
    return {
      ...group,
      aiSuggestion: suggestion,
    };
  }

  const isManualDestination = group.destinationSelectionChanged === true;
  let nextSelectedPieceId = group.selectedPieceId;
  let nextDestinationProvenance = group.destinationProvenance;

  if (!isManualDestination) {
    if (suggestion.suggestedPieceId && allowedIds.has(suggestion.suggestedPieceId)) {
      nextSelectedPieceId = suggestion.suggestedPieceId;
      nextDestinationProvenance = "ai";
    }
  }

  const partSuggestionsByFileId = new Map(
    (suggestion.filePartSuggestions ?? []).map((s) => [s.clientFileId, s]),
  );

  const updatedFiles = group.files.map((file) =>
    applyAiSuggestionToFile(file, partSuggestionsByFileId.get(file.clientFileId), validPartKeys),
  );

  const destinationChanged = nextSelectedPieceId !== group.selectedPieceId;
  const partsChanged = updatedFiles.some((f, idx) => f.partKey !== group.files[idx]?.partKey);
  const needsInvalidation = destinationChanged || partsChanged;

  return {
    ...group,
    aiSuggestion: suggestion,
    destinationProvenance: nextDestinationProvenance,
    ...resolvePracticeTrackAssignments(updatedFiles, nextSelectedPieceId),
    selectedPieceId: nextSelectedPieceId,
    reviewedMappingKey: needsInvalidation ? null : group.reviewedMappingKey,
  };
}

export async function runGroupRepairStep(
  baseRequest: Omit<Parameters<typeof matchBulkPracticeTracks>[0], "stage">,
  signal: AbortSignal,
  onSuggestions: (repairs: MusicTrackImportGroupRepairSuggestion[]) => void,
) {
  try {
    const res = await matchBulkPracticeTracks({ ...baseRequest, stage: "group_repair" }, signal);
    if ((res.groupRepairSuggestions?.length ?? 0) > 0) {
      onSuggestions(res.groupRepairSuggestions ?? []);
    }
  } catch {
    // Tolerated partial stage failure
  }
}

export async function runPieceMatchingStep(
  baseRequest: Omit<Parameters<typeof matchBulkPracticeTracks>[0], "stage">,
  signal: AbortSignal,
  allowedIds: ReadonlySet<string>,
  validPartKeys: ReadonlySet<string>,
  setGroups: Dispatch<SetStateAction<readonly GroupReviewItem[]>>,
  setMatchError: (error: string | null) => void,
) {
  try {
    const pieceRes = await matchBulkPracticeTracks(
      { ...baseRequest, stage: "piece_matching" },
      signal,
    );
    if (pieceRes.suggestions.length > 0) {
      const suggestions = new Map(pieceRes.suggestions.map((s) => [s.groupId, s]));
      setGroups((current) =>
        current.map((group) =>
          applyAiSuggestionToGroup(
            group,
            suggestions.get(group.groupId),
            allowedIds,
            validPartKeys,
          ),
        ),
      );
    }
    if (pieceRes.stageStatus === "partial") {
      setMatchError(
        "AI piece matching completed partially within the time limit. Some songs were not matched automatically.",
      );
    }
  } catch (error: unknown) {
    setMatchError(
      error instanceof Error
        ? error.message
        : "AI piece matching failed. Continue with manual matching or try again.",
    );
  }
}
