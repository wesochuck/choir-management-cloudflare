import { Dialog } from "@choir/ui";
import {
  groupPracticeTrackFiles,
  rankCandidatePiecesForGroup,
  splitFileToNewTrackImportGroup,
  type TrackImportGroup,
} from "@choir/domain";
import { useCallback, useMemo, useState } from "react";
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
      duplicatePartKeys: group.duplicatePartKeys,
      evidence: match.suggestedPiece?.evidence ?? [],
      files,
      groupId: group.groupId,
      hasDuplicatePart: group.hasDuplicatePart,
      inferredTitle: group.inferredTitle,
      selectedPieceId: match.suggestedPiece?.piece.id ?? null,
      sequenceNumber: group.sequenceNumber,
    };
  });
}

export function BulkPracticeTrackImportDialog({
  events,
  onClose,
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

  const handleAdvanceToReview = useCallback(() => {
    const rawDomainGroups = groupPracticeTrackFiles(files);
    setDomainGroups(rawDomainGroups);
    const reviewItems = buildReviewGroups(rawDomainGroups, pieces, performancePieceIds, fileLookup);
    setGroups(reviewItems);
    setStep("review");
  }, [fileLookup, files, performancePieceIds, pieces]);

  const handleGroupPieceChanged = useCallback((groupId: string, pieceId: string | null) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.groupId !== groupId) return g;
        return {
          ...g,
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
            file.clientFileId === clientFileId ? { ...file, partKey } : file,
          );
          const partCounts = new Map<string, number>();
          for (const f of updatedFiles) {
            if (f.partKey) {
              partCounts.set(f.partKey, (partCounts.get(f.partKey) ?? 0) + 1);
            }
          }
          const duplicatePartKeys: string[] = [];
          for (const [k, count] of partCounts.entries()) {
            if (count > 1) duplicatePartKeys.push(k);
          }
          return {
            ...group,
            duplicatePartKeys,
            files: updatedFiles,
            hasDuplicatePart: duplicatePartKeys.length > 0,
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
