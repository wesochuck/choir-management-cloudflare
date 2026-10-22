import { Dialog } from "@choir/ui";
import {
  groupPracticeTrackFiles,
  parsePracticeTrackFilename,
  rankCandidatePiecesForGroup,
  resolvePracticeTrackAssignments,
  splitFileToNewTrackImportGroup,
  type TrackImportGroup,
} from "@choir/domain";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { matchBulkPracticeTracks } from "../../../../api/music";
import {
  discardMusicTrackImportSession,
  getMusicTrackImportSession,
} from "../../../../api/musicTrackImport";
import { extractAudioDuration } from "../../../audioDuration";
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
  GroupFileAssignment,
  GroupReviewItem,
  InspectedTrackFile,
  TrackImportScope,
  TrackImportStep,
} from "./types";
import { useImportSession, type ImportRunResult } from "./useImportSession";
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
        detectedPartKey: f.detectedPartKey,
        detectedPartLabel: f.detectedPartLabel,
        durationSeconds: f.durationSeconds,
        file: original?.file ?? new File([], f.fileName),
        fileName: f.fileName,
        metadata: original?.metadata ?? null,
        partKey: f.detectedPartKey,
        partProvenance: f.detectedPartKey ? ("deterministic" as const) : undefined,
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

function buildFileMetadata(file: GroupFileAssignment) {
  const meta = file.metadata;
  if (!meta) {
    return {
      clientFileId: file.clientFileId,
      detectedPartKey: file.detectedPartKey ?? undefined,
      durationSeconds: file.durationSeconds,
      fileName: file.fileName,
    };
  }
  return {
    album: meta.album ?? undefined,
    artist: meta.artist ?? undefined,
    clientFileId: file.clientFileId,
    composer: meta.composer ?? undefined,
    detectedPartKey: file.detectedPartKey ?? undefined,
    durationSeconds: file.durationSeconds,
    fileName: file.fileName,
    inferredTitle: meta.title ?? undefined,
    sequenceNumber: meta.trackNumber ?? undefined,
    title: meta.title ?? undefined,
    trackNumber: meta.trackNumber ?? undefined,
  };
}

function buildMatchRequestGroup(group: GroupReviewItem) {
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

function applyAiSuggestionToFile(
  file: GroupFileAssignment,
  partSuggestion:
    { readonly probability: number; readonly suggestedPartKey: string | null } | undefined,
  validPartKeys: ReadonlySet<string>,
): GroupFileAssignment {
  const suggestedPartKey = partSuggestion?.suggestedPartKey ?? file.suggestedPartKey;
  const suggestedPartProbability = partSuggestion?.probability ?? file.suggestedPartProbability;

  if (file.partSelectionChanged || file.excluded) {
    return {
      ...file,
      suggestedPartKey,
      suggestedPartProbability,
    };
  }

  if (
    file.partKey === null &&
    partSuggestion?.suggestedPartKey &&
    partSuggestion.probability >= 0.7 &&
    validPartKeys.has(partSuggestion.suggestedPartKey)
  ) {
    return {
      ...file,
      partKey: partSuggestion.suggestedPartKey,
      partProvenance: "ai" as const,
      suggestedPartKey,
      suggestedPartProbability,
    };
  }

  return {
    ...file,
    suggestedPartKey,
    suggestedPartProbability,
  };
}

function applyAiSuggestionToGroup(
  group: GroupReviewItem,
  suggestion: GroupReviewItem["aiSuggestion"],
  allowedIds: ReadonlySet<string>,
  validPartKeys: ReadonlySet<string>,
): GroupReviewItem {
  if (!suggestion) return group;

  if (group.reviewedMappingKey) {
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
    setScope("set_list");
    setFiles([]);
    setDomainGroups([]);
    setGroups([]);
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
          configuredPartKeys: Array.from(validPartKeys).filter(
            (k) => k !== "tutti" && k !== "accompaniment",
          ),
          groups: groups.map(buildMatchRequestGroup),
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
        current.map((group) =>
          applyAiSuggestionToGroup(
            group,
            suggestions.get(group.groupId),
            allowedIds,
            validPartKeys,
          ),
        ),
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
          destinationProvenance: "manual",
          destinationSelectionChanged: true,
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
              ? {
                  ...file,
                  excluded: false,
                  partKey,
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
              onScopeChanged={setScope}
              onSelectedEventChanged={setSelectedEventId}
            />
          </>
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
