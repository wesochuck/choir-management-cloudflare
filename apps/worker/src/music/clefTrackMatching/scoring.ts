import type {
  FilePartAlternative,
  FilePartSuggestion,
  MusicTrackImportGroupRepairSuggestion,
  MusicTrackImportGroupSuggestion,
  MusicTrackImportMatchCandidate,
  MusicTrackImportStage,
  MusicTrackImportStageStatus,
  RankedPieceSuggestion,
} from "@choir/contracts";
import { z } from "zod";

export const CLEF_TRACK_MATCH_MODEL = "@cf/cloudflare/clef-flash";

export const AI_MATCH_PRESELECT_MIN_PROBABILITY = 0.7;
export const AI_MATCH_PRESELECT_MIN_MARGIN = 0.2;
export const AI_MATCH_AMBIGUOUS_MAX_MARGIN = 0.15;
export const AI_MATCH_AMBIGUOUS_MIN_PROBABILITY = 0.25;
export const AI_MAX_TOP_CANDIDATES = 3;
export const AI_MAX_QUESTIONS_PER_REQUEST = 64;
export const AI_MAX_PAYLOAD_BYTES = 20_000;
export const AI_CONCURRENCY_LIMIT = 2;
export const AI_OVERALL_TIMEOUT_MS = 25_000;

const probabilitySchema = z.number().min(0).max(1);

export const responseSchema = z.object({
  answers: z.record(
    z.string(),
    z.object({
      choice: z.string(),
      confidence: probabilitySchema,
      probabilities: z.record(z.string(), probabilitySchema),
      type: z.literal("choice"),
    }),
  ),
});

export type ClefAnswer = z.infer<typeof responseSchema>["answers"][string];

export class TrackMatchingError extends Error {
  constructor(
    readonly code: "validation_failed" | "service_unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type ClefTrackMatchResult = MusicTrackImportGroupSuggestion[] & {
  completedFileIds?: string[] | undefined;
  completedGroupIds?: string[] | undefined;
  failedCount?: number | undefined;
  groupRepairSuggestions?: MusicTrackImportGroupRepairSuggestion[] | undefined;
  reason?: string | undefined;
  stage?: MusicTrackImportStage | undefined;
  stageStatus?: MusicTrackImportStageStatus | undefined;
  suggestions?: MusicTrackImportGroupSuggestion[] | undefined;
  unansweredCount?: number | undefined;
};

export interface PieceQuestionAnswer {
  readonly confidence: "high" | "medium" | "low" | "none";
  readonly noneProbability: number;
  readonly rationale: string;
  readonly suggestedPieceId: string | null;
  readonly topCandidates: readonly RankedPieceSuggestion[];
}

export function computeChoiceProbabilityAndMargin(
  probabilities: Readonly<Record<string, number>>,
  choice: string,
): { isConfident: boolean; margin: number; prob: number } {
  const prob = probabilities[choice] ?? 0;
  const sortedProbs = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const secondProb = sortedProbs[1]?.[1] ?? 0;
  const margin = prob - secondProb;
  const isConfident =
    prob >= AI_MATCH_PRESELECT_MIN_PROBABILITY && margin >= AI_MATCH_PRESELECT_MIN_MARGIN;
  return { isConfident, margin, prob };
}

function validatePieceAnswer(
  answer: ClefAnswer | undefined,
  candidates: Readonly<Record<string, MusicTrackImportMatchCandidate>>,
): [string, number][] {
  if (!answer || (answer.choice !== "none" && !Object.hasOwn(candidates, answer.choice))) {
    throw new Error("Invalid Clef choice.");
  }
  const entries = Object.entries(answer.probabilities);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (
    answer.probabilities.none === undefined ||
    Math.abs(total - 1) > 0.01 ||
    answer.probabilities[answer.choice] === undefined ||
    entries.some(([, p]) => p > (answer.probabilities[answer.choice] ?? -1)) ||
    entries.some(([id]) => id !== "none" && !Object.hasOwn(candidates, id))
  ) {
    throw new Error("Invalid Clef probability distribution.");
  }

  return entries
    .filter(([id]) => id !== "none" && Object.hasOwn(candidates, id))
    .sort((a, b) => b[1] - a[1]);
}

function extractTopCandidates(
  candidateEntries: readonly [string, number][],
  candidates: Readonly<Record<string, MusicTrackImportMatchCandidate>>,
): RankedPieceSuggestion[] {
  return candidateEntries
    .slice(0, AI_MAX_TOP_CANDIDATES)
    .map(([id, prob]) => {
      const candidate = candidates[id];
      if (!candidate) return null;
      return {
        pieceId: candidate.pieceId,
        probability: prob,
      };
    })
    .filter((c): c is RankedPieceSuggestion => c !== null);
}

function checkAmbiguousArrangements(
  top: [string, number] | undefined,
  second: [string, number] | undefined,
  topProb: number,
  secondProb: number,
  topCandidates: readonly RankedPieceSuggestion[],
): PieceQuestionAnswer | null {
  if (
    top &&
    second &&
    topProb >= AI_MATCH_AMBIGUOUS_MIN_PROBABILITY &&
    topProb - secondProb <= AI_MATCH_AMBIGUOUS_MAX_MARGIN
  ) {
    return {
      confidence: "none",
      noneProbability: 0,
      rationale: "AI found close arrangements. Select the intended piece.",
      suggestedPieceId: null,
      topCandidates,
    };
  }
  return null;
}

function checkWinningCandidate(
  top: [string, number] | undefined,
  topProb: number,
  secondProb: number,
  noneProb: number,
  answerConfidence: number,
  candidate: MusicTrackImportMatchCandidate | undefined,
  topCandidates: readonly RankedPieceSuggestion[],
): PieceQuestionAnswer | null {
  if (
    top &&
    topProb >= AI_MATCH_PRESELECT_MIN_PROBABILITY &&
    topProb - secondProb >= AI_MATCH_PRESELECT_MIN_MARGIN &&
    topProb > noneProb
  ) {
    const confScore = Math.min(answerConfidence, topProb);
    const confidence = confScore >= 0.85 ? "high" : confScore >= 0.7 ? "medium" : "low";
    return {
      confidence,
      noneProbability: 0,
      rationale: `AI metadata suggestion (${String(Math.round(confScore * 100))}% model estimate). Review before uploading.`,
      suggestedPieceId: candidate?.pieceId ?? null,
      topCandidates,
    };
  }
  return null;
}

export function buildPieceSuggestion(
  answer: ClefAnswer | undefined,
  candidates: Readonly<Record<string, MusicTrackImportMatchCandidate>>,
): PieceQuestionAnswer {
  if (!answer) {
    throw new Error("Invalid Clef choice.");
  }
  const candidateEntries = validatePieceAnswer(answer, candidates);
  const topCandidates = extractTopCandidates(candidateEntries, candidates);

  const top = candidateEntries[0];
  const second = candidateEntries[1];
  const noneProb = answer.probabilities.none ?? 0;
  const topProb = top ? top[1] : 0;
  const secondProb = second ? second[1] : 0;

  const ambiguous = checkAmbiguousArrangements(top, second, topProb, secondProb, topCandidates);
  if (ambiguous && topProb > noneProb) return { ...ambiguous, noneProbability: noneProb };

  const candidate = top ? candidates[top[0]] : undefined;
  const winning = checkWinningCandidate(
    top,
    topProb,
    secondProb,
    noneProb,
    answer.confidence,
    candidate,
    topCandidates,
  );
  if (winning) return { ...winning, noneProbability: noneProb };

  return {
    confidence: "none",
    noneProbability: noneProb,
    rationale: "AI found no confident match. Choose a piece manually.",
    suggestedPieceId: null,
    topCandidates,
  };
}

function validatePartAnswer(
  answer: ClefAnswer | undefined,
  allowedPartKeys: ReadonlySet<string>,
): { choice: string; entries: [string, number][]; probability: number } {
  if (!answer) throw new Error("Missing part answer.");
  const choice = answer.choice;
  if (choice !== "none" && !allowedPartKeys.has(choice)) {
    throw new Error("Invalid Clef part choice.");
  }
  const entries = Object.entries(answer.probabilities);
  if (
    answer.probabilities.none === undefined ||
    entries.some(([key]) => key !== "none" && !allowedPartKeys.has(key)) ||
    Math.abs(entries.reduce((sum, [, p]) => sum + p, 0) - 1) > 0.01 ||
    entries.some(([, p]) => p > (answer.probabilities[choice] ?? -1))
  ) {
    throw new Error("Invalid part probability distribution.");
  }
  const probability = answer.probabilities[choice];
  if (typeof probability !== "number") {
    throw new Error("Missing Clef part probability.");
  }
  return { choice, entries, probability };
}

function resolvePartSuggestionReason(
  isConflict: boolean | undefined,
  originalPartKey: string | null | undefined,
  suggestedPartKey: string | null,
): "missing" | "conflict" | "correction" | undefined {
  if (isConflict) return "conflict";
  if (!originalPartKey) return "missing";
  if (suggestedPartKey && suggestedPartKey !== originalPartKey) return "correction";
  return undefined;
}

export function buildFilePartSuggestion(
  answer: ClefAnswer | undefined,
  clientFileId: string,
  allowedPartKeys: ReadonlySet<string>,
  originalPartKey?: string | null,
  isConflict?: boolean,
  isPartReview = false,
): FilePartSuggestion | null {
  const { choice, entries, probability } = validatePartAnswer(answer, allowedPartKeys);
  const suggestedPartKey = choice === "none" ? null : choice;

  if (!isPartReview) {
    return {
      clientFileId,
      probability,
      suggestedPartKey,
    };
  }

  const sortedAlternatives: FilePartAlternative[] = entries
    .filter(([key]) => key !== choice && key !== "none")
    .sort((a, b) => b[1] - a[1])
    .filter(([, prob]) => prob >= 0.15)
    .slice(0, 3)
    .map(([key, prob]) => ({
      partKey: key,
      probability: prob,
    }));

  const reason = resolvePartSuggestionReason(isConflict, originalPartKey, suggestedPartKey);
  const evidence = `AI classified based on metadata (${String(Math.round(probability * 100))}% confidence).`;

  return {
    alternatives: sortedAlternatives.length > 0 ? sortedAlternatives : undefined,
    clientFileId,
    evidence,
    probability,
    reason,
    suggestedPartKey,
  };
}

export function buildCandidateCriteria(
  candidates: Readonly<Record<string, MusicTrackImportMatchCandidate>>,
): Record<string, string> {
  const criteria: Record<string, string> = {
    none: "No candidate fits, or the evidence is insufficient.",
  };
  for (const [id, c] of Object.entries(candidates)) {
    const parts = [c.title.slice(0, 160)];
    if (c.composer) parts.push(`comp: ${c.composer.slice(0, 100)}`);
    if (c.arranger) parts.push(`arr: ${c.arranger.slice(0, 100)}`);
    if (typeof c.durationSeconds === "number" && c.durationSeconds > 0) {
      const mins = Math.floor(c.durationSeconds / 60);
      const secs = String(c.durationSeconds % 60).padStart(2, "0");
      parts.push(`dur: ${String(mins)}:${secs}`);
    }
    if (c.occupiedPartKeys.length > 0) {
      parts.push(`occupied: ${c.occupiedPartKeys.slice(0, 30).join(",").slice(0, 300)}`);
    }
    criteria[id] = parts.join(" · ");
  }
  return criteria;
}
