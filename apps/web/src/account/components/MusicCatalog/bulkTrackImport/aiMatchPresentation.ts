import type { DestinationPieceOption, SuggestedPieceAlternative } from "./DestinationPiecePicker";
import type { GroupReviewItem } from "./types";

export type AiMatchOutcome = "suggested" | "alternatives" | "kept" | "no_match";

// Presentation requires both a plausible estimate and independent local evidence.
// Keep the complete distribution in the response; weak options are not recommendations.
const MIN_VISIBLE_ALTERNATIVE_PROBABILITY = 0.25;

export function presentAiMatch(
  group: GroupReviewItem,
  options: readonly DestinationPieceOption[],
): {
  readonly alternatives: readonly SuggestedPieceAlternative[];
  readonly outcome: AiMatchOutcome | undefined;
} {
  const suggestion = group.aiSuggestion;
  if (!suggestion) return { alternatives: [], outcome: undefined };
  const optionById = new Map(options.map((option) => [option.id, option]));
  const supportedIds = new Set(group.candidates.map((candidate) => candidate.piece.id));
  const topProbability = suggestion.topCandidates?.[0]?.probability ?? 0;
  const nonePreferred = (suggestion.noneProbability ?? 0) >= topProbability;
  const alternatives: SuggestedPieceAlternative[] = [];
  for (const candidate of suggestion.topCandidates ?? []) {
    const option = optionById.get(candidate.pieceId);
    if (
      !option ||
      nonePreferred ||
      !supportedIds.has(candidate.pieceId) ||
      candidate.probability < MIN_VISIBLE_ALTERNATIVE_PROBABILITY ||
      candidate.pieceId === group.selectedPieceId
    )
      continue;
    alternatives.push({
      pieceId: option.id,
      title: option.title,
      composer: option.composer,
      arranger: option.arranger,
      probability: candidate.probability,
    });
  }
  return { alternatives, outcome: outcomeForGroup(group, alternatives.length > 0) };
}

function outcomeForGroup(group: GroupReviewItem, hasAlternatives: boolean): AiMatchOutcome {
  if (hasAlternatives) return "alternatives";
  if (
    group.destinationProvenance === "ai" &&
    group.aiSuggestion?.suggestedPieceId === group.selectedPieceId
  )
    return "suggested";
  return group.selectedPieceId ? "kept" : "no_match";
}
