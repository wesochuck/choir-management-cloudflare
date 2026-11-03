import {
  musicTrackImportMatchRequestSchema,
  type FilePartSuggestion,
  type MusicTrackImportGroupSuggestion,
  type MusicTrackImportMatchCandidate,
  type MusicTrackImportMatchRequest,
  type MusicTrackImportStageStatus,
} from "@choir/contracts";
import {
  rankCandidatePiecesForGroup,
  recalculateTrackImportGroup,
  type LibraryPieceOption,
  type TrackImportGroup,
} from "@choir/domain";
import {
  createGroupRepairBatches,
  createPartReviewBatches,
  createPieceMatchingBatches,
  parseDomainGroups,
  parseLibraryPieces,
  type BatchPlan,
  type PlannedQuestion,
} from "./batches";
import { aggregateGroupRepairResults } from "./repair";
import {
  AI_CONCURRENCY_LIMIT,
  AI_MAX_PAYLOAD_BYTES,
  AI_OVERALL_TIMEOUT_MS,
  buildCandidateCriteria,
  buildFilePartSuggestion,
  buildPieceSuggestion,
  responseSchema,
  TrackMatchingError,
  type ClefAnswer,
  type ClefTrackMatchResult,
  type PieceQuestionAnswer,
} from "./scoring";

function aggregateClefResults(
  rawResults: readonly {
    answers: Record<string, ClefAnswer>;
    questions: readonly PlannedQuestion[];
  }[],
  candidates: Record<string, MusicTrackImportMatchCandidate>,
  allowedPartKeys: ReadonlySet<string>,
  requestGroups: MusicTrackImportMatchRequest["groups"],
  domainGroups: readonly TrackImportGroup[],
  isPartReview = false,
): MusicTrackImportGroupSuggestion[] {
  const groupResults = new Map<
    string,
    {
      filePartSuggestions: FilePartSuggestion[];
      pieceSuggestion?: PieceQuestionAnswer;
    }
  >();
  for (const group of requestGroups) {
    groupResults.set(group.groupId, { filePartSuggestions: [] });
  }

  for (const { answers, questions } of rawResults) {
    for (const q of questions) {
      const answer = answers[q.questionId];
      const collector = groupResults.get(q.groupId);
      if (!collector) continue;

      if (q.kind === "piece") {
        collector.pieceSuggestion = buildPieceSuggestion(
          answer,
          Object.fromEntries(
            Object.entries(candidates).filter(
              ([id]) => !q.candidateIds || q.candidateIds.includes(id),
            ),
          ),
        );
      } else if (q.kind === "filePart" && q.clientFileId) {
        const partSuggestion = buildFilePartSuggestion(
          answer,
          q.clientFileId,
          allowedPartKeys,
          q.originalPartKey,
          q.isConflict,
          isPartReview,
        );
        if (partSuggestion) {
          collector.filePartSuggestions.push(partSuggestion);
        }
      }
    }
  }

  return requestGroups.map((group, index) => {
    const res = groupResults.get(group.groupId);
    const piece = res?.pieceSuggestion ?? {
      confidence: "none" as const,
      noneProbability: 1,
      rationale: "AI found no confident match. Choose a piece manually.",
      suggestedPieceId: null,
      topCandidates: [],
    };
    const parsedGroup =
      domainGroups[index] ??
      recalculateTrackImportGroup({
        files: [],
        groupId: group.groupId,
        inferredTitle: group.inferredTitle,
      });
    const ranked = rankCandidatePiecesForGroup(
      parsedGroup,
      Object.values(candidates).map((c) => ({ ...c, id: c.pieceId })),
    );
    const hasTitleSignal = ranked.candidatePieces.some(
      (c) => c.piece.id === piece.suggestedPieceId,
    );
    return {
      confidence: hasTitleSignal ? piece.confidence : "none",
      filePartSuggestions:
        res?.filePartSuggestions && res.filePartSuggestions.length > 0
          ? res.filePartSuggestions
          : undefined,
      groupId: group.groupId,
      noneProbability: piece.noneProbability,
      rationale:
        piece.suggestedPieceId && !hasTitleSignal
          ? "AI found insufficient title evidence. Choose a piece manually."
          : piece.rationale,
      suggestedPieceId: hasTitleSignal ? piece.suggestedPieceId : null,
      topCandidates: piece.topCandidates.length > 0 ? [...piece.topCandidates] : undefined,
    };
  });
}

interface SettlementResult {
  readonly completedAnswers: readonly {
    answers: Record<string, ClefAnswer>;
    questions: readonly PlannedQuestion[];
  }[];
  readonly completedFileIds: readonly string[];
  readonly completedGroupIds: readonly string[];
  readonly failedCount: number;
  readonly reason?: string | undefined;
  readonly stageStatus: MusicTrackImportStageStatus;
  readonly unansweredCount: number;
}

async function runBatchesWithSettlement(
  batches: readonly BatchPlan[],
  concurrencyLimit: number,
  run: (input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
): Promise<SettlementResult> {
  const completedAnswers: {
    answers: Record<string, ClefAnswer>;
    questions: readonly PlannedQuestion[];
  }[] = [];
  const completedGroupIds = new Set<string>();
  const completedFileIds = new Set<string>();
  let failedCount = 0;
  let lastError: unknown = null;

  const allQuestions = batches.flatMap((b) => b.questions);

  let batchIndex = 0;
  const workerCount = Math.min(batches.length, Math.max(1, concurrencyLimit));

  const workers = Array.from({ length: workerCount }, async () => {
    while (batchIndex < batches.length) {
      if (signal.aborted) break;
      const current = batchIndex;
      batchIndex += 1;
      const batch = batches[current];
      if (!batch) break;

      try {
        signal.throwIfAborted();
        const output = await new Promise<unknown>((resolve, reject) => {
          const abort = () => {
            reject(new Error("AI matching was cancelled.", { cause: signal.reason }));
          };
          signal.addEventListener("abort", abort, { once: true });
          run(batch.input, signal)
            .then(resolve, reject)
            .finally(() => {
              signal.removeEventListener("abort", abort);
            });
        });
        const parsed = responseSchema.parse(output);
        completedAnswers.push({ answers: parsed.answers, questions: batch.questions });
        for (const q of batch.questions) {
          if (parsed.answers[q.questionId]) {
            completedGroupIds.add(q.groupId);
            if (q.clientFileId) completedFileIds.add(q.clientFileId);
          }
        }
      } catch (err: unknown) {
        failedCount += 1;
        lastError = err;
      }
    }
  });

  await Promise.all(workers);

  const answeredQuestionIds = new Set(completedAnswers.flatMap((b) => Object.keys(b.answers)));
  const unansweredCount = allQuestions.filter((q) => !answeredQuestionIds.has(q.questionId)).length;

  let stageStatus: MusicTrackImportStageStatus = "complete";
  let reason: string | undefined;

  if (completedAnswers.length === 0 && batches.length > 0) {
    if (lastError instanceof TrackMatchingError) throw lastError;
    throw new TrackMatchingError(
      "service_unavailable",
      "AI matching is unavailable. Continue with manual matching or try again.",
      { cause: lastError },
    );
  }

  if (failedCount > 0 || unansweredCount > 0) {
    stageStatus = "partial";
    reason =
      "AI matching completed partially within the time limit. Some suggestions were preserved.";
  }

  return {
    completedAnswers,
    completedFileIds: Array.from(completedFileIds),
    completedGroupIds: Array.from(completedGroupIds),
    failedCount,
    reason,
    stageStatus,
    unansweredCount,
  };
}

function validateBatchByteLimits(batches: readonly BatchPlan[], encoder: TextEncoder): void {
  for (const batch of batches) {
    if (encoder.encode(JSON.stringify(batch.input)).byteLength > AI_MAX_PAYLOAD_BYTES) {
      throw new TrackMatchingError(
        "validation_failed",
        "Too much metadata for AI matching. Select fewer files or a smaller set list, or continue with manual matching.",
      );
    }
  }
}

async function executeGroupRepairStage(
  request: MusicTrackImportMatchRequest,
  domainGroups: readonly TrackImportGroup[],
  run: (input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
  encoder: TextEncoder,
): Promise<ClefTrackMatchResult> {
  const batches = createGroupRepairBatches(request, domainGroups);
  validateBatchByteLimits(batches, encoder);

  if (batches.length === 0) {
    const emptyResult: MusicTrackImportGroupSuggestion[] = [];
    return Object.assign(emptyResult, {
      completedFileIds: [],
      completedGroupIds: [],
      failedCount: 0,
      groupRepairSuggestions: [],
      stage: "group_repair" as const,
      stageStatus: "complete" as const,
      suggestions: emptyResult,
      unansweredCount: 0,
    });
  }

  const settlement = await runBatchesWithSettlement(batches, AI_CONCURRENCY_LIMIT, run, signal);

  const groupRepairSuggestions = aggregateGroupRepairResults(
    settlement.completedAnswers,
    domainGroups,
  );

  const emptyResult: MusicTrackImportGroupSuggestion[] = [];
  return Object.assign(emptyResult, {
    completedFileIds: [...settlement.completedFileIds],
    completedGroupIds: [...settlement.completedGroupIds],
    failedCount: settlement.failedCount,
    groupRepairSuggestions,
    reason: settlement.reason,
    stage: "group_repair" as const,
    stageStatus: settlement.stageStatus,
    suggestions: emptyResult,
    unansweredCount: settlement.unansweredCount,
  });
}

async function executePartReviewStage(
  request: MusicTrackImportMatchRequest,
  domainGroups: readonly TrackImportGroup[],
  candidates: Record<string, MusicTrackImportMatchCandidate>,
  allowedPartKeys: ReadonlySet<string>,
  partCriteria: Record<string, string>,
  run: (input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
  encoder: TextEncoder,
): Promise<ClefTrackMatchResult> {
  const batches = createPartReviewBatches(request, partCriteria, domainGroups);
  validateBatchByteLimits(batches, encoder);

  if (batches.length === 0) {
    const suggestions = aggregateClefResults(
      [],
      candidates,
      allowedPartKeys,
      request.groups,
      domainGroups,
    );
    return Object.assign(suggestions, {
      completedFileIds: [],
      completedGroupIds: [],
      failedCount: 0,
      stage: "part_review" as const,
      stageStatus: "complete" as const,
      suggestions,
      unansweredCount: 0,
    });
  }

  const settlement = await runBatchesWithSettlement(batches, AI_CONCURRENCY_LIMIT, run, signal);

  const suggestions = aggregateClefResults(
    settlement.completedAnswers,
    candidates,
    allowedPartKeys,
    request.groups,
    domainGroups,
    true,
  );

  return Object.assign(suggestions, {
    completedFileIds: [...settlement.completedFileIds],
    completedGroupIds: [...settlement.completedGroupIds],
    failedCount: settlement.failedCount,
    reason: settlement.reason,
    stage: "part_review" as const,
    stageStatus: settlement.stageStatus,
    suggestions,
    unansweredCount: settlement.unansweredCount,
  });
}

async function executePieceMatchingStage(
  request: MusicTrackImportMatchRequest,
  domainGroups: readonly TrackImportGroup[],
  candidates: Record<string, MusicTrackImportMatchCandidate>,
  criteria: Record<string, string>,
  allowedPartKeys: ReadonlySet<string>,
  partCriteria: Record<string, string>,
  configuredPartKeys: readonly string[],
  libraryPieces: readonly LibraryPieceOption[],
  run: (input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
  encoder: TextEncoder,
): Promise<ClefTrackMatchResult> {
  const includeParts = request.stage === undefined || request.stage === "piece_matching";
  const batches = createPieceMatchingBatches(
    request,
    candidates,
    domainGroups,
    criteria,
    partCriteria,
    configuredPartKeys,
    libraryPieces,
    includeParts,
  );
  validateBatchByteLimits(batches, encoder);

  const settlement = await runBatchesWithSettlement(batches, AI_CONCURRENCY_LIMIT, run, signal);

  const suggestions = aggregateClefResults(
    settlement.completedAnswers,
    candidates,
    allowedPartKeys,
    request.groups,
    domainGroups,
  );

  return Object.assign(suggestions, {
    completedFileIds: [...settlement.completedFileIds],
    completedGroupIds: [...settlement.completedGroupIds],
    failedCount: settlement.failedCount,
    reason: settlement.reason,
    stage: request.stage ?? ("piece_matching" as const),
    stageStatus: settlement.stageStatus,
    suggestions,
    unansweredCount: settlement.unansweredCount,
  });
}

export async function suggestClefTrackMatches(
  request: MusicTrackImportMatchRequest,
  run: (input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
  requestSignal?: AbortSignal,
): Promise<ClefTrackMatchResult> {
  if (!musicTrackImportMatchRequestSchema.safeParse(request).success) {
    throw new TrackMatchingError(
      "validation_failed",
      "Valid bounded matching metadata is required. Continue with manual matching.",
    );
  }
  const candidateIds = new Set(request.candidates.map((candidate) => candidate.pieceId));
  const groupIds = new Set(request.groups.map((group) => group.groupId));
  if (candidateIds.size !== request.candidates.length || groupIds.size !== request.groups.length) {
    throw new TrackMatchingError(
      "validation_failed",
      "Each candidate and song set must be unique.",
    );
  }

  const domainGroups = parseDomainGroups(request.groups);
  const libraryPieces = parseLibraryPieces(request.candidates);

  const candidates = Object.fromEntries(
    request.candidates.map((candidate, index) => [`p${String(index)}`, candidate]),
  );
  const criteria = buildCandidateCriteria(candidates);

  const configuredPartKeys = request.configuredPartKeys ?? [];
  const allowedPartKeys = new Set([...configuredPartKeys, "tutti", "accompaniment"]);

  const partCriteria: Record<string, string> = {
    accompaniment: "Accompaniment, piano, or backing track",
    none: "No voice part detected or uncertain",
    tutti: "Full mix, tutti, ensemble, all parts",
  };
  const partLabels = new Map(request.configuredParts?.map((part) => [part.key, part.label]));
  for (const key of configuredPartKeys) {
    const readable = partLabels.get(key);
    partCriteria[key] = readable
      ? `${readable} (${key})`
      : `Configured roster voice part or section: ${key}`;
  }

  const deadline = AbortSignal.timeout(AI_OVERALL_TIMEOUT_MS);
  const controller = new AbortController();
  const signal = AbortSignal.any([
    deadline,
    controller.signal,
    ...(requestSignal ? [requestSignal] : []),
  ]);

  const encoder = new TextEncoder();

  try {
    if (request.stage === "group_repair") {
      return await executeGroupRepairStage(request, domainGroups, run, signal, encoder);
    }

    if (request.stage === "part_review") {
      return await executePartReviewStage(
        request,
        domainGroups,
        candidates,
        allowedPartKeys,
        partCriteria,
        run,
        signal,
        encoder,
      );
    }

    return await executePieceMatchingStage(
      request,
      domainGroups,
      candidates,
      criteria,
      allowedPartKeys,
      partCriteria,
      configuredPartKeys,
      libraryPieces,
      run,
      signal,
      encoder,
    );
  } catch (cause: unknown) {
    controller.abort();
    if (cause instanceof TrackMatchingError) throw cause;
    throw new TrackMatchingError(
      "service_unavailable",
      "AI matching is unavailable. Continue with manual matching or try again.",
      { cause },
    );
  }
}
