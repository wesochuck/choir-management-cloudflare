import type {
  MusicTrackImportGroupRepairSuggestion,
  OrganizationMusicPiece,
} from "@choir/contracts";
import {
  applyGroupRepairSuggestion,
  groupPracticeTrackFiles,
  parsePracticeTrackFilename,
  rankCandidatePiecesForGroup,
  recalculateTrackImportGroup,
  resolvePracticeTrackAssignments,
  splitFileToNewTrackImportGroup,
  type TrackImportGroup,
} from "@choir/domain";
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { buildReviewGroups } from "./aiMatching";
import { getReviewGroupState, getReviewMappingKey } from "./reviewState";
import type {
  BulkPracticeTrackImportDialogProps,
  GroupFileAssignment,
  GroupReviewItem,
  InspectedTrackFile,
  TrackImportStep,
} from "./types";

export function useReviewGroupMutations({
  domainGroups,
  fileLookup,
  files,
  groups,
  matchController,
  performancePieceIds,
  pieceLookup,
  pieces,
  setDomainGroups,
  setGroups,
  setMatchError,
  setMatching,
  setPendingGroupRepairs,
  setStep,
  validPartKeys,
}: {
  readonly domainGroups: readonly TrackImportGroup[];
  readonly fileLookup: ReadonlyMap<string, InspectedTrackFile>;
  readonly files: readonly InspectedTrackFile[];
  readonly groups: readonly GroupReviewItem[];
  readonly matchController: RefObject<AbortController | null>;
  readonly performancePieceIds: readonly string[];
  readonly pieceLookup: ReadonlyMap<string, OrganizationMusicPiece>;
  readonly pieces: BulkPracticeTrackImportDialogProps["pieces"];
  readonly setDomainGroups: Dispatch<SetStateAction<readonly TrackImportGroup[]>>;
  readonly setGroups: Dispatch<SetStateAction<readonly GroupReviewItem[]>>;
  readonly setMatchError: (error: string | null) => void;
  readonly setMatching: (matching: boolean) => void;
  readonly setPendingGroupRepairs: Dispatch<
    SetStateAction<readonly MusicTrackImportGroupRepairSuggestion[]>
  >;
  readonly setStep: (step: TrackImportStep) => void;
  readonly validPartKeys: ReadonlySet<string>;
}) {
  const handleAcceptGroupRepair = useCallback(
    (suggestion: MusicTrackImportGroupRepairSuggestion) => {
      const currentDomainGroups = groups.map((g) =>
        recalculateTrackImportGroup({
          files: g.files.map((f) => {
            const original = fileLookup.get(f.clientFileId);
            return {
              ...parsePracticeTrackFilename(
                f.fileName,
                [],
                f.clientFileId,
                f.durationSeconds,
                original?.metadata ?? null,
              ),
              detectedPartKey: f.partKey,
              inferredTitle: f.inferredTitle ?? f.fileName,
              sequenceNumber: f.sequenceNumber ?? null,
            };
          }),
          groupId: g.groupId,
          inferredTitle: g.inferredTitle,
          sequenceNumber: g.sequenceNumber,
        }),
      );

      const updatedDomainGroups = applyGroupRepairSuggestion(currentDomainGroups, suggestion);
      setDomainGroups(updatedDomainGroups);
      const reviewItems = buildReviewGroups(
        updatedDomainGroups,
        pieces,
        performancePieceIds,
        fileLookup,
      );
      setGroups(reviewItems);

      setPendingGroupRepairs((prev) =>
        prev.filter((p) => {
          if (p === suggestion) return false;
          if (suggestion.kind === "merge_groups" && p.kind === "merge_groups") {
            return !p.groupIds.some((id) => suggestion.groupIds.includes(id));
          }
          if (suggestion.kind === "split_group" && p.kind === "split_group") {
            return p.sourceGroupId !== suggestion.sourceGroupId;
          }
          return true;
        }),
      );
    },
    [
      fileLookup,
      groups,
      performancePieceIds,
      pieces,
      setDomainGroups,
      setGroups,
      setPendingGroupRepairs,
    ],
  );

  const handleDismissGroupRepair = useCallback(
    (suggestion: MusicTrackImportGroupRepairSuggestion) => {
      setPendingGroupRepairs((prev) => prev.filter((p) => p !== suggestion));
    },
    [setPendingGroupRepairs],
  );

  const handleDismissPartSuggestion = useCallback(
    (groupId: string, clientFileId: string) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.groupId !== groupId) return g;
          return {
            ...g,
            files: g.files.map((f) =>
              f.clientFileId === clientFileId
                ? {
                    ...f,
                    partAlternatives: undefined,
                    partSuggestionEvidence: undefined,
                    partSuggestionReason: undefined,
                    suggestedPartKey: undefined,
                    suggestedPartProbability: undefined,
                  }
                : f,
            ),
          };
        }),
      );
    },
    [setGroups],
  );

  const handleAdvanceToReview = useCallback(() => {
    const rawDomainGroups = groupPracticeTrackFiles(files);
    setDomainGroups(rawDomainGroups);
    const reviewItems = buildReviewGroups(rawDomainGroups, pieces, performancePieceIds, fileLookup);
    setGroups(reviewItems);
    setMatchError(null);
    setStep("review");
  }, [
    fileLookup,
    files,
    performancePieceIds,
    pieces,
    setDomainGroups,
    setGroups,
    setMatchError,
    setStep,
  ]);

  const handleGroupPieceChanged = useCallback(
    (groupId: string, pieceId: string | null) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.groupId !== groupId) return g;
          if (g.selectedPieceId === pieceId)
            return { ...g, destinationProvenance: "manual", destinationSelectionChanged: true };
          return {
            ...g,
            destinationProvenance: "manual",
            destinationSelectionChanged: true,
            ...resolvePracticeTrackAssignments(g.files, pieceId),
            selectedPieceId: pieceId,
            reviewedMappingKey: null,
          };
        }),
      );
    },
    [setGroups],
  );

  const handlePartChanged = useCallback(
    (groupId: string, clientFileId: string, partKey: string | null) => {
      setGroups((prev) =>
        prev.map((group) => {
          if (group.groupId !== groupId) return group;
          const updatedFiles = group.files.map((file) =>
            file.clientFileId === clientFileId
              ? {
                  ...file,
                  excluded: false,
                  partKey,
                  tuttiAssignmentId: undefined,
                  partProvenance: "manual" as const,
                  partSelectionChanged: true,
                }
              : file,
          );
          return {
            ...group,
            ...resolvePracticeTrackAssignments(updatedFiles, group.selectedPieceId),
            reviewedMappingKey: null,
          };
        }),
      );
    },
    [setGroups],
  );

  const handleFileExclusionChanged = useCallback(
    (groupId: string, clientFileId: string, excluded: boolean) => {
      setGroups((prev) =>
        prev.map((group) => {
          if (group.groupId !== groupId) return group;
          return {
            ...group,
            files: group.files.map((file) =>
              file.clientFileId === clientFileId
                ? { ...file, excluded, partSelectionChanged: true, tuttiAssignmentId: undefined }
                : file,
            ),
            reviewedMappingKey: null,
          };
        }),
      );
    },
    [setGroups],
  );

  const handleGroupSkipToggled = useCallback(
    (groupId: string) => {
      setGroups((prev) =>
        prev.map((group) => {
          if (group.groupId !== groupId) return group;
          if (!group.groupSkipped && group.files.every((file) => file.excluded)) {
            return {
              ...group,
              files: group.files.map((file) => ({
                ...file,
                excluded: false,
                partSelectionChanged: true,
              })),
              reviewedMappingKey: null,
            };
          }
          return {
            ...group,
            groupSkipped: group.groupSkipped !== true,
            reviewedMappingKey: null,
          };
        }),
      );
    },
    [setGroups],
  );

  const handleMarkGroupReviewed = useCallback(
    (groupId: string) => {
      setGroups((prev) =>
        prev.map((group) => {
          if (group.groupId !== groupId) return group;
          const reviewState = getReviewGroupState(group, pieceLookup, validPartKeys);
          if (!reviewState.isEligibleForReview) return group;
          return { ...group, reviewedMappingKey: getReviewMappingKey(group) };
        }),
      );
    },
    [pieceLookup, setGroups, validPartKeys],
  );

  const handleSplitFile = useCallback(
    (clientFileId: string) => {
      matchController.current?.abort();
      setMatching(false);
      const updatedDomainGroups = splitFileToNewTrackImportGroup(domainGroups, clientFileId);
      if (updatedDomainGroups === domainGroups) return null;
      const previousFileState = new Map(
        groups.flatMap((group) =>
          group.files.map((file) => [file.clientFileId, { file, group }] as const),
        ),
      );
      const sourceGroup = previousFileState.get(clientFileId)?.group;
      if (!sourceGroup) return null;
      const previousGroupsById = new Map(groups.map((group) => [group.groupId, group]));
      const updatedGroups = updatedDomainGroups.map((domainGroup) => {
        const firstPrevious = domainGroup.files[0]
          ? previousFileState.get(domainGroup.files[0].clientFileId)
          : undefined;
        const previousGroup = firstPrevious?.group ?? sourceGroup;
        const exactPreviousGroup = previousGroupsById.get(domainGroup.groupId);
        const nextFileIds = new Set(domainGroup.files.map((file) => file.clientFileId));
        const matchesPreviousMembership =
          exactPreviousGroup?.files.length === domainGroup.files.length &&
          exactPreviousGroup.files.every((file) => nextFileIds.has(file.clientFileId));
        if (exactPreviousGroup && matchesPreviousMembership) return exactPreviousGroup;

        const match = rankCandidatePiecesForGroup(domainGroup, pieces, performancePieceIds);
        const nextFiles: GroupFileAssignment[] = domainGroup.files.map((file) => {
          const previous = previousFileState.get(file.clientFileId)?.file;
          if (previous) return previous;
          const original = fileLookup.get(file.clientFileId);
          return {
            clientFileId: file.clientFileId,
            detectedPartKey: file.detectedPartKey,
            detectedPartLabel: file.detectedPartLabel,
            durationSeconds: file.durationSeconds,
            file: original?.file ?? new File([], file.fileName),
            fileName: file.fileName,
            metadata: original?.metadata ?? null,
            partKey: file.detectedPartKey,
            partProvenance: file.detectedPartKey ? ("deterministic" as const) : undefined,
          };
        });
        const resolved = resolvePracticeTrackAssignments(nextFiles, previousGroup.selectedPieceId);
        return {
          averageDurationSeconds: domainGroup.averageDurationSeconds,
          candidates: match.candidatePieces,
          evidence:
            match.candidatePieces.find(
              (candidate) => candidate.piece.id === previousGroup.selectedPieceId,
            )?.evidence ?? [],
          ...resolved,
          groupId: domainGroup.groupId,
          inferredTitle: domainGroup.inferredTitle,
          selectedPieceId: previousGroup.selectedPieceId,
          sequenceNumber: domainGroup.sequenceNumber,
          destinationSelectionChanged: true,
          destinationProvenance: "manual",
          groupSkipped: previousGroup.groupSkipped,
          reviewedMappingKey: null,
        } satisfies GroupReviewItem;
      });
      setDomainGroups(updatedDomainGroups);
      setGroups(updatedGroups);
      return (
        updatedGroups.find((group) =>
          group.files.some((file) => file.clientFileId === clientFileId),
        )?.groupId ?? null
      );
    },
    [
      domainGroups,
      fileLookup,
      groups,
      matchController,
      performancePieceIds,
      pieces,
      setDomainGroups,
      setGroups,
      setMatching,
    ],
  );

  return {
    handleAcceptGroupRepair,
    handleAdvanceToReview,
    handleDismissGroupRepair,
    handleDismissPartSuggestion,
    handleFileExclusionChanged,
    handleGroupPieceChanged,
    handleGroupSkipToggled,
    handleMarkGroupReviewed,
    handlePartChanged,
    handleSplitFile,
  };
}
