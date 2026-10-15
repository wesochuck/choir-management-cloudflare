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
        "Clef Flash supports up to 200 candidate pieces, 50 song sets, and 50 files per song set. Select a smaller set list or fewer files, or continue with manual matching.",
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
          };
        }),
      );
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        setMatchError(
          error instanceof Error
            ? error.message
            : "Clef Flash matching failed. Continue with manual matching or try again.",
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
        return {
          ...g,
          aiSuggestion: undefined,
          ...resolvePracticeTrackAssignments(g.files, pieceId),
          selectedPieceId: pieceId,
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
              ? { ...file, partKey, partSelectionChanged: true }
              : file,
          );
          return {
            ...group,
            ...resolvePracticeTrackAssignments(updatedFiles, group.selectedPieceId),
          };
        }),
      );
    },
    [],
  );

  const handleSplitFile = useCallback(
    (clientFileId: string) => {
      const updatedDomainGroups = splitFileToNewTrackImportGroup(domainGroups, clientFileId);
      setDomainGroups(updatedDomainGroups);
      setGroups(buildReviewGroups(updatedDomainGroups, pieces, performancePieceIds, fileLookup));
    },
    [domainGroups, fileLookup, performancePieceIds, pieces],
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
            performancePieceIds={performancePieceIds}
            pieces={pieces}
            roster={roster}
            onBack={() => {
              setStep("scope_files");
            }}
            onGroupPieceChanged={handleGroupPieceChanged}
            onNext={() => {
              setStep("upload");
            }}
            onPartChanged={handlePartChanged}
            onSplitFile={handleSplitFile}
          />
        ) : null}

        {step === "upload" ? (
          <StepConfirmUpload
            groups={groups}
            pieces={pieces}
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
