import { Dialog } from "@choir/ui";
import {
  groupPracticeTrackFiles,
  rankCandidatePiecesForGroup,
  resolvePracticeTrackAssignments,
  splitFileToNewTrackImportGroup,
  type TrackImportGroup,
} from "@choir/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchBulkPracticeTracks } from "../../../../api/music";
import { StepConfirmUpload } from "./StepConfirmUpload";
import { StepResults } from "./StepResults";
import { StepReviewMatches } from "./StepReviewMatches";
import { StepScopeAndFiles } from "./StepScopeAndFiles";
import {
  areAllReviewGroupsResolved,
  getReviewGroupState,
  getReviewMappingKey,
  getValidTrackPartKeys,
} from "./reviewState";
import type {
  BulkPracticeTrackImportDialogProps,
  GroupFileAssignment,
  GroupReviewItem,
  InspectedTrackFile,
  TrackImportScope,
  TrackImportStep,
} from "./types";
import { WizardStepper } from "./WizardStepper";

function buildReviewGroups(
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
        durationSeconds: f.durationSeconds,
        file: original?.file ?? new File([], f.fileName),
        fileName: f.fileName,
        partKey: f.detectedPartKey,
      };
    });

    return {
      averageDurationSeconds: group.averageDurationSeconds,
      candidates: match.candidatePieces,
      evidence: match.suggestedPiece?.evidence ?? [],
      ...resolvePracticeTrackAssignments(files, selectedPieceId),
      groupId: group.groupId,
      inferredTitle: group.inferredTitle,
      selectedPieceId,
      sequenceNumber: group.sequenceNumber,
    };
  });
}

export function BulkPracticeTrackImportDialog({
  events,
  onClose,
  onOpenPiece,
  onTracksAttached,
  open,
  pieces,
  roster,
}: BulkPracticeTrackImportDialogProps) {
  const [step, setStep] = useState<TrackImportStep>("scope_files");
  const [scope, setScope] = useState<TrackImportScope>("set_list");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(() => {
    const perf = events.find((e) => e.type === "Performance" || e.setList.length > 0);
    return perf?.id ?? null;
  });
  const [files, setFiles] = useState<readonly InspectedTrackFile[]>([]);
  const [inspecting] = useState(false);
  const [domainGroups, setDomainGroups] = useState<readonly TrackImportGroup[]>([]);
  const [groups, setGroups] = useState<readonly GroupReviewItem[]>([]);
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const matchController = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) {
      matchController.current?.abort();
    }
    return () => {
      matchController.current?.abort();
    };
  }, [open]);
  const [results, setResults] = useState<Parameters<typeof StepResults>[0]["results"]>([]);
  const [summary, setSummary] = useState({
    attached: 0,
    conflict: 0,
    failed: 0,
    skipped: 0,
  });

  const selectedEvent = events.find((e) => e.id === selectedEventId);
  const performancePieceIds = useMemo(
    () =>
      scope === "set_list" && selectedEvent?.setList
        ? selectedEvent.setList
            .map((item) => item.pieceId)
            .filter((id): id is string => Boolean(id))
        : [],
    [scope, selectedEvent],
  );

  const fileLookup = useMemo(() => new Map(files.map((f) => [f.clientFileId, f])), [files]);
  const pieceLookup = useMemo(() => new Map(pieces.map((piece) => [piece.id, piece])), [pieces]);
  const validPartKeys = useMemo(() => getValidTrackPartKeys(roster), [roster]);

  const handleAiMatch = async () => {
    if (matching) return;
    const scopedIds = new Set(performancePieceIds);
    const candidates =
      scope === "set_list" ? pieces.filter((piece) => scopedIds.has(piece.id)) : pieces;
    if (candidates.length === 0) {
      setMatchError(
        "Choose a performance with catalog pieces, or match against the entire Music Library.",
      );
      return;
    }
    if (
      candidates.length > 200 ||
      groups.length > 50 ||
      groups.some((group) => group.files.length > 50)
    ) {
      setMatchError(
        "AI matching supports up to 200 candidate pieces, 50 song sets, and 50 files per song set. Select a smaller set list or fewer files, or continue with manual matching.",
      );
      return;
    }
    const controller = new AbortController();
    matchController.current = controller;
    setMatching(true);
    setMatchError(null);
    try {
      const response = await matchBulkPracticeTracks(
        {
          candidates: candidates.map((piece) => ({
            arranger: piece.arranger,
            composer: piece.composer,
            durationSeconds: piece.durationSeconds,
            occupiedPartKeys: Object.keys(piece.trackFileIds),
            pieceId: piece.id,
            title: piece.title,
          })),
          groups: groups.map((group) => ({
            detectedParts: group.files.flatMap((file) => (file.partKey ? [file.partKey] : [])),
            durationSeconds: group.averageDurationSeconds,
            fileNames: group.files.map((file) => file.fileName),
            groupId: group.groupId,
            inferredTitle: group.inferredTitle,
            ...(group.sequenceNumber ? { sequenceNumber: group.sequenceNumber } : {}),
          })),
          ...(scope === "set_list" && selectedEvent
            ? { performanceTitle: selectedEvent.title }
            : {}),
          useAi: true,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const allowedIds = new Set(candidates.map((piece) => piece.id));
      const suggestions = new Map(
        response.suggestions.map((suggestion) => [suggestion.groupId, suggestion]),
      );
      setGroups((current) =>
        current.map((group) => {
          const suggestion = suggestions.get(group.groupId);
          if (
            !suggestion ||
            (suggestion.suggestedPieceId && !allowedIds.has(suggestion.suggestedPieceId))
          )
            return group;
          return {
            ...group,
            aiSuggestion: suggestion,
            ...resolvePracticeTrackAssignments(group.files, suggestion.suggestedPieceId),
            selectedPieceId: suggestion.suggestedPieceId,
            reviewedMappingKey: null,
          };
        }),
      );
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        setMatchError(
          error instanceof Error
            ? error.message
            : "AI matching failed. Continue with manual matching or try again.",
        );
    } finally {
      if (matchController.current === controller) setMatching(false);
    }
  };

  const handleAdvanceToReview = useCallback(() => {
    const rawDomainGroups = groupPracticeTrackFiles(files);
    setDomainGroups(rawDomainGroups);
    const reviewItems = buildReviewGroups(rawDomainGroups, pieces, performancePieceIds, fileLookup);
    setGroups(reviewItems);
    setMatchError(null);
    setStep("review");
  }, [fileLookup, files, performancePieceIds, pieces]);

  const handleGroupPieceChanged = useCallback((groupId: string, pieceId: string | null) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.groupId !== groupId) return g;
        if (g.selectedPieceId === pieceId) return g;
        return {
          ...g,
          aiSuggestion: undefined,
          ...resolvePracticeTrackAssignments(g.files, pieceId),
          selectedPieceId: pieceId,
          reviewedMappingKey: null,
        };
      }),
    );
  }, []);

  const handlePartChanged = useCallback(
    (groupId: string, clientFileId: string, partKey: string | null) => {
      setGroups((prev) =>
        prev.map((group) => {
          if (group.groupId !== groupId) return group;
          const updatedFiles = group.files.map((file) =>
            file.clientFileId === clientFileId
              ? { ...file, excluded: false, partKey, partSelectionChanged: true }
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
    [],
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
                ? { ...file, excluded, partSelectionChanged: true }
                : file,
            ),
            reviewedMappingKey: null,
          };
        }),
      );
    },
    [],
  );

  const handleGroupSkipToggled = useCallback((groupId: string) => {
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
  }, []);

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
    [pieceLookup, validPartKeys],
  );

  const handleSplitFile = useCallback(
    (clientFileId: string) => {
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
            durationSeconds: file.durationSeconds,
            file: original?.file ?? new File([], file.fileName),
            fileName: file.fileName,
            partKey: file.detectedPartKey,
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
          groupSkipped: false,
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
    [domainGroups, fileLookup, groups, performancePieceIds, pieces],
  );

  const handleUploadComplete = useCallback(
    (attachResults: typeof results, attachSummary: typeof summary) => {
      setResults(attachResults);
      setSummary(attachSummary);
      setStep("results");
    },
    [],
  );

  const handleFinish = useCallback(() => {
    onTracksAttached();
    onClose();
  }, [onClose, onTracksAttached]);

  const isDirty = files.length > 0 && step !== "results";

  return (
    <Dialog
      className="dialog--responsive dialog--bulk-track-import"
      description="Upload multiple practice recordings with automatic voice part and piece matching."
      dirty={isDirty}
      open={open}
      title="Bulk upload practice tracks"
      onClose={onClose}
    >
      <WizardStepper currentStep={step} />

      <div className="track-import-content-container">
        {step === "scope_files" ? (
          <StepScopeAndFiles
            events={events}
            files={files}
            inspecting={inspecting}
            roster={roster}
            scope={scope}
            selectedEventId={selectedEventId}
            onFilesChanged={setFiles}
            onNext={handleAdvanceToReview}
            onScopeChanged={setScope}
            onSelectedEventChanged={setSelectedEventId}
          />
        ) : null}

        {step === "review" ? (
          <StepReviewMatches
            matching={matching}
            matchError={matchError}
            onAiMatch={() => {
              void handleAiMatch();
            }}
            groups={groups}
            onFileExclusionChanged={handleFileExclusionChanged}
            onGroupSkipToggled={handleGroupSkipToggled}
            onMarkGroupReviewed={handleMarkGroupReviewed}
            performancePieceIds={performancePieceIds}
            pieces={pieces}
            roster={roster}
            validPartKeys={validPartKeys}
            onBack={() => {
              setStep("scope_files");
            }}
            onGroupPieceChanged={handleGroupPieceChanged}
            onNext={() => {
              if (areAllReviewGroupsResolved(groups, pieceLookup, validPartKeys)) {
                setStep("upload");
              }
            }}
            onPartChanged={handlePartChanged}
            onSplitFile={handleSplitFile}
          />
        ) : null}

        {step === "upload" ? (
          <StepConfirmUpload
            groups={groups}
            pieces={pieces}
            roster={roster}
            onBack={() => {
              setStep("review");
            }}
            onComplete={handleUploadComplete}
          />
        ) : null}

        {step === "results" ? (
          <StepResults
            onOpenPiece={onOpenPiece}
            pieces={pieces}
            results={results}
            summary={summary}
            onFinish={handleFinish}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
