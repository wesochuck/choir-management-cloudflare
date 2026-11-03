import { useTuttiSuggestions } from "./useTuttiSuggestions";
import { Dialog } from "@choir/ui";
import {
  groupPracticeTrackFiles,
  parsePracticeTrackFilename,
  resolvePracticeTrackAssignments,
  type TrackImportGroup,
} from "@choir/domain";
import type { MusicTrackImportGroupRepairSuggestion } from "@choir/contracts";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  discardMusicTrackImportSession,
  getMusicTrackImportSession,
} from "../../../../api/musicTrackImport";
import { extractAudioDuration } from "../../../audioDuration";
import {
  buildMatchRequestGroup,
  buildReviewGroups,
  runGroupRepairStep,
  runPieceMatchingStep,
} from "./aiMatching";
import { StepConfirmUpload } from "./StepConfirmUpload";
import { StepResults } from "./StepResults";
import { StepReviewMatches } from "./StepReviewMatches";
import { StepScopeAndFiles } from "./StepScopeAndFiles";
import {
  clearImportSessionContext,
  matchReselectedFiles,
  readImportSessionContext,
  verifyReselectedDigests,
  type ImportSessionContext,
} from "./importSessionStorage";
import {
  areAllReviewGroupsResolved,
  getReviewGroupState,
  getReviewMappingKey,
  getValidTrackPartKeys,
} from "./reviewState";
import type {
  BulkPracticeTrackImportDialogProps,
  GroupReviewItem,
  InspectedTrackFile,
  TrackImportScope,
  TrackImportStep,
} from "./types";
import { useImportSession, type ImportRunResult } from "./useImportSession";
import { useReviewGroupMutations } from "./useReviewGroupMutations";
import { WizardStepper } from "./WizardStepper";

function ResumeImportBanner({
  context,
  onDiscard,
  onResume,
  resuming,
  resumeError,
}: {
  readonly context: ImportSessionContext;
  readonly onDiscard: () => void;
  readonly onResume: (files: readonly File[]) => void;
  readonly resuming: boolean;
  readonly resumeError: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputId = useId();
  return (
    <section className="notice track-import-resume-banner" aria-label="Resume saved import">
      <h4>Resume the saved import?</h4>
      <p>
        {String(context.manifest.length)} verified tracks are staged in a recoverable import
        session. Reselect the exact files to continue — uploads that already finished are reused and
        never sent again.
      </p>
      <ul>
        {context.manifest.map((row) => (
          <li key={row.clientFileId}>{row.fileName}</li>
        ))}
      </ul>
      {resumeError ? (
        <div className="notice notice--error" role="alert">
          {resumeError}
        </div>
      ) : null}
      <div
        className={dragOver ? "track-import-dropzone dragging" : "track-import-dropzone"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => {
          setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          onResume(Array.from(event.dataTransfer.files));
        }}
      >
        <p>Drop the original MP3s here or browse files</p>
        <input
          accept=".mp3,audio/mpeg"
          disabled={resuming}
          id={fileInputId}
          multiple
          type="file"
          onChange={(event) => {
            onResume(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
      <div className="track-import-actions__buttons">
        <button
          className="button button--secondary"
          disabled={resuming}
          type="button"
          onClick={onDiscard}
        >
          Discard saved import
        </button>
      </div>
    </section>
  );
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
  const [pendingGroupRepairs, setPendingGroupRepairs] = useState<
    readonly MusicTrackImportGroupRepairSuggestion[]
  >([]);
  const tuttiActions = useTuttiSuggestions(groups, setGroups);
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
  const [summary, setSummary] = useState({
    attached: 0,
    conflict: 0,
    failed: 0,
    skipped: 0,
  });
  const importSession = useImportSession();
  const [resumeOffer, setResumeOffer] = useState<ImportSessionContext | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  const configuredParts = useMemo(
    () => [
      ...(roster?.voiceParts ?? []).map((part) => ({ key: part.label, label: part.fullName })),
      ...(roster?.sections ?? []).map((section) => ({ key: section.code, label: section.name })),
    ],
    [roster],
  );

  // Every close resets the wizard; a saved server session offers a resume
  // path on the next open. All close paths funnel through handleClose so a
  // confirmed close never leaks run state into the next open.
  const resetWizard = useCallback(() => {
    setStep("scope_files");
    matchController.current?.abort();
    setMatching(false);
    setScope("set_list");
    setFiles([]);
    setDomainGroups([]);
    setGroups([]);
    setPendingGroupRepairs([]);
    setMatchError(null);
    setSummary({ attached: 0, conflict: 0, failed: 0, skipped: 0 });
    setResumeOffer(null);
    setResumeError(null);
    importSession.resetLocal();
  }, [importSession]);

  const handleClose = useCallback(() => {
    resetWizard();
    onClose();
  }, [onClose, resetWizard]);

  const handleFinish = useCallback(() => {
    onTracksAttached();
    handleClose();
  }, [handleClose, onTracksAttached]);

  // A saved server session offers a resume path when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const requestState = { cancelled: false };
    const stored = readImportSessionContext();
    if (!stored) return undefined;
    void (async () => {
      try {
        const detail = await getMusicTrackImportSession(stored.sessionId);
        if (requestState.cancelled) return;
        if (detail.state === "active" || detail.state === "partial") {
          setResumeOffer(stored);
        } else {
          clearImportSessionContext();
        }
      } catch {
        if (!requestState.cancelled) clearImportSessionContext();
      }
    })();
    return () => {
      requestState.cancelled = true;
    };
  }, [open]);

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

  const {
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
  } = useReviewGroupMutations({
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
  });

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
      candidates.length > 1000 ||
      groups.length > 200 ||
      groups.some((group) => group.files.length > 50)
    ) {
      setMatchError(
        "AI matching supports up to 1,000 candidate pieces, 200 song sets, and 50 files per song set. Select a smaller set list or fewer files, or continue with manual matching.",
      );
      return;
    }
    const controller = new AbortController();
    matchController.current = controller;
    setMatching(true);
    setMatchError(null);

    const candidatePayload = candidates.map((piece) => ({
      arranger: piece.arranger,
      composer: piece.composer,
      durationSeconds: piece.durationSeconds,
      occupiedPartKeys: Object.keys(piece.trackFileIds),
      pieceId: piece.id,
      title: piece.title,
    }));
    const configuredPartKeysList = Array.from(validPartKeys).filter(
      (k) => k !== "tutti" && k !== "accompaniment",
    );
    const performanceContext =
      scope === "set_list" && selectedEvent
        ? {
            eventTitle: selectedEvent.title,
            setList: selectedEvent.setList.map((item, idx) => ({
              pieceId: item.pieceId ?? null,
              position: idx + 1,
              title: item.title,
            })),
          }
        : undefined;
    const allowedIds = new Set(candidates.map((piece) => piece.id));

    const baseRequest = {
      candidates: candidatePayload,
      configuredParts,
      configuredPartKeys: configuredPartKeysList,
      groups: groups.map(buildMatchRequestGroup),
      performanceContext,
      performanceTitle: scope === "set_list" && selectedEvent ? selectedEvent.title : undefined,
      useAi: true,
    };

    const hasRepairCandidates = groups.length > 1 || groups.some((group) => group.files.length > 1);

    try {
      if (hasRepairCandidates) {
        await runGroupRepairStep(baseRequest, controller.signal, setPendingGroupRepairs);
        if (matchController.current !== controller) return;
      }

      await runPieceMatchingStep(
        baseRequest,
        controller.signal,
        allowedIds,
        validPartKeys,
        setGroups,
        setMatchError,
      );
    } finally {
      if (matchController.current === controller) setMatching(false);
    }
  };

  const handleUploadComplete = useCallback((result: ImportRunResult, skippedCount: number) => {
    setSummary({
      attached: result.commitSummary.attached,
      conflict: result.commitSummary.conflict,
      failed: result.commitSummary.failed,
      skipped: result.commitSummary.skipped + skippedCount,
    });
    setStep("results");
  }, []);

  const handleRetryUploads = useCallback(async () => {
    const allUploaded = await importSession.retryUploads();
    if (!allUploaded) return;
    const receipt = await importSession.retryCommit();
    if (!receipt) return;
    setSummary((current) => ({
      attached: receipt.commitSummary.attached,
      conflict: receipt.commitSummary.conflict,
      failed: receipt.commitSummary.failed,
      skipped: current.skipped,
    }));
    onTracksAttached();
  }, [importSession, onTracksAttached]);

  const handleRetryAttach = useCallback(async () => {
    const receipt = await importSession.retryCommit();
    if (!receipt) return;
    setSummary((current) => ({
      attached: receipt.commitSummary.attached,
      conflict: receipt.commitSummary.conflict,
      failed: receipt.commitSummary.failed,
      skipped: current.skipped,
    }));
    onTracksAttached();
  }, [importSession, onTracksAttached]);

  const handleDiscardImport = useCallback(async () => {
    await importSession.discardSession();
    setResumeOffer(null);
    setStep("scope_files");
  }, [importSession]);

  const handleDiscardSavedImport = useCallback(async () => {
    if (!resumeOffer) return;
    try {
      await discardMusicTrackImportSession(resumeOffer.sessionId);
    } catch {
      // The session may already be gone; clearing the local context is the
      // safe outcome either way.
    } finally {
      clearImportSessionContext();
      setResumeOffer(null);
    }
  }, [resumeOffer]);

  const handleResumeImport = useCallback(
    async (reselected: readonly File[]) => {
      if (!resumeOffer) return;
      setResuming(true);
      setResumeError(null);
      try {
        const report = matchReselectedFiles(resumeOffer.manifest, reselected);
        if (report.missing.length > 0) {
          setResumeError(
            `Still missing ${String(report.missing.length)} file${report.missing.length === 1 ? "" : "s"}: ${report.missing
              .map((row) => row.fileName)
              .join(", ")}`,
          );
          return;
        }
        const digestFailures = await verifyReselectedDigests(report.matched);
        if (digestFailures.length > 0) {
          setResumeError(
            `These files do not match the verified import bytes: ${digestFailures
              .map((failure) => failure.fileName)
              .join(", ")}`,
          );
          return;
        }
        if (report.mismatched.length > 0) {
          setResumeError(
            `These files are not part of the saved import: ${report.mismatched
              .map((entry) => entry.fileName)
              .join(", ")}`,
          );
          return;
        }
        const detail = await getMusicTrackImportSession(resumeOffer.sessionId);
        if (detail.state !== "active" && detail.state !== "partial") {
          clearImportSessionContext();
          setResumeOffer(null);
          setResumeError("The saved import is no longer resumable.");
          return;
        }
        const filesByClientId = new Map(
          report.matched.map(({ file, manifest }) => [manifest.clientFileId, file]),
        );
        const inspected: InspectedTrackFile[] = [];
        for (const row of resumeOffer.manifest) {
          const file = filesByClientId.get(row.clientFileId);
          if (!file) continue;
          let durationSeconds: number | null = row.durationSeconds;
          try {
            durationSeconds = await extractAudioDuration(file);
          } catch {
            durationSeconds = row.durationSeconds;
          }
          const parsed = parsePracticeTrackFilename(
            file.name,
            configuredParts,
            row.clientFileId,
            durationSeconds,
          );
          inspected.push({
            clientFileId: row.clientFileId,
            detectedPartKey: parsed.detectedPartKey,
            detectedPartLabel: parsed.detectedPartLabel,
            durationSeconds: parsed.durationSeconds,
            file,
            fileName: file.name,
            inferredTitle: parsed.inferredTitle,
            sequenceNumber: parsed.sequenceNumber,
          });
        }
        const pieceTitles = new Map(pieces.map((piece) => [piece.id, piece.title]));
        importSession.adoptResumedSession(detail, filesByClientId, pieceTitles);
        setFiles(inspected);
        const lookup = new Map(inspected.map((file) => [file.clientFileId, file]));
        const rebuilt = buildReviewGroups(
          groupPracticeTrackFiles(inspected),
          pieces,
          performancePieceIds,
          lookup,
        );
        const manifestById = new Map(resumeOffer.manifest.map((row) => [row.clientFileId, row]));
        const targeted = rebuilt.map((group) => {
          const firstRow = group.files
            .map((file) => manifestById.get(file.clientFileId))
            .find((row) => row !== undefined);
          if (!firstRow) return group;
          const filesWithTargets = group.files.map((file) => {
            const row = manifestById.get(file.clientFileId);
            if (!row) return { ...file, excluded: true };
            return { ...file, excluded: false, partKey: row.partKey };
          });
          const resolved = resolvePracticeTrackAssignments(filesWithTargets, firstRow.pieceId);
          const next: GroupReviewItem = {
            ...group,
            ...resolved,
            selectedPieceId: firstRow.pieceId,
          };
          const reviewState = getReviewGroupState(next, pieceLookup, validPartKeys);
          return reviewState.groupStatus === "reviewed"
            ? { ...next, reviewedMappingKey: getReviewMappingKey(next) }
            : next;
        });
        setDomainGroups(groupPracticeTrackFiles(inspected));
        setGroups(targeted);
        setResumeOffer(null);
        setStep("upload");
      } finally {
        setResuming(false);
      }
    },
    [
      configuredParts,
      importSession,
      performancePieceIds,
      pieceLookup,
      pieces,
      resumeOffer,
      validPartKeys,
    ],
  );

  const isDirty = files.length > 0 && step !== "results";

  return (
    <Dialog
      className="dialog--responsive dialog--bulk-track-import"
      description="Upload multiple practice recordings with automatic voice part and piece matching."
      dirty={isDirty}
      open={open}
      title="Bulk upload practice tracks"
      onClose={handleClose}
    >
      <WizardStepper currentStep={step} />

      <div className="track-import-content-container">
        {step === "scope_files" ? (
          <>
            {resumeOffer ? (
              <ResumeImportBanner
                context={resumeOffer}
                onDiscard={() => {
                  void handleDiscardSavedImport();
                }}
                onResume={(reselected) => {
                  void handleResumeImport(reselected);
                }}
                resuming={resuming}
                resumeError={resumeError}
              />
            ) : null}
            <StepScopeAndFiles
              events={events}
              files={files}
              inspecting={inspecting}
              roster={roster}
              scope={scope}
              selectedEventId={selectedEventId}
              onFilesChanged={setFiles}
              onNext={handleAdvanceToReview}
              onScopeChanged={(value) => {
                matchController.current?.abort();
                setScope(value);
              }}
              onSelectedEventChanged={(value) => {
                matchController.current?.abort();
                setSelectedEventId(value);
              }}
            />
          </>
        ) : null}

        {step === "review" ? (
          <StepReviewMatches
            tuttiActions={tuttiActions}
            matching={matching}
            matchError={matchError}
            pendingGroupRepairs={pendingGroupRepairs}
            onAcceptGroupRepair={handleAcceptGroupRepair}
            onDismissGroupRepair={handleDismissGroupRepair}
            onDismissPartSuggestion={handleDismissPartSuggestion}
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
            session={importSession}
            onBack={() => {
              setStep("review");
            }}
            onComplete={handleUploadComplete}
          />
        ) : null}

        {step === "results" ? (
          <StepResults
            files={importSession.files}
            summary={summary}
            pieces={pieces}
            onCloseAndResume={handleClose}
            onDiscard={handleDiscardImport}
            onFinish={handleFinish}
            onOpenPiece={onOpenPiece}
            onRetryAttach={handleRetryAttach}
            onRetryUploads={handleRetryUploads}
            onReviewConflicts={() => {
              setStep("review");
            }}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
