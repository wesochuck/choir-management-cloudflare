import { describe, expect, it } from "vitest";
import { presentAiMatch } from "./aiMatchPresentation";
import type { GroupReviewItem } from "./types";
import type { DestinationPieceOption } from "./DestinationPiecePicker";

const options: DestinationPieceOption[] = ["one", "two", "unrelated"].map((id) => ({
  id,
  title: id,
  composer: "",
  arranger: "",
  occupiedParts: [],
  trackCount: 0,
  searchText: id,
}));
const group: GroupReviewItem = {
  groupId: "song",
  inferredTitle: "Ave Maria",
  averageDurationSeconds: null,
  sequenceNumber: null,
  selectedPieceId: null,
  files: [],
  evidence: [],
  duplicatePartKeys: [],
  hasDuplicatePart: false,
  candidates: ["one", "two"].map((id) => ({
    piece: { id, title: "Ave Maria" },
    confidence: "medium",
    conflicts: [],
    evidence: ["Title match"],
    score: 50,
  })),
};
function withEstimates(probabilities: readonly number[], noneProbability: number): GroupReviewItem {
  return {
    ...group,
    aiSuggestion: {
      groupId: "song",
      confidence: "none",
      suggestedPieceId: null,
      noneProbability,
      topCandidates: probabilities.map((probability, index) => ({
        pieceId: options[index]?.id ?? "unknown",
        probability,
      })),
    },
  };
}
describe("AI match presentation", () => {
  it("does not interpret missing AI as a failed match", () => {
    expect(presentAiMatch(group, options)).toEqual({ outcome: undefined, alternatives: [] });
  });
  it("explains the reported 20%, 13%, 6% distribution without recommending guesses", () => {
    expect(presentAiMatch(withEstimates([0.2, 0.13, 0.06], 0.61), options)).toEqual({
      outcome: "no_match",
      alternatives: [],
    });
  });
  it("offers plausible close arrangements with trusted catalog labels", () => {
    const result = presentAiMatch(withEstimates([0.48, 0.42], 0.1), options);
    expect(result.outcome).toBe("alternatives");
    expect(result.alternatives.map((alt) => alt.pieceId)).toEqual(["one", "two"]);
  });
  it("hides unrelated high estimates and a stronger none outcome", () => {
    const request = withEstimates([0.3, 0.25, 0.4], 0.05);
    expect(presentAiMatch({ ...request, candidates: [] }, options).alternatives).toEqual([]);
    expect(presentAiMatch(withEstimates([0.3, 0.1], 0.6), options).outcome).toBe("no_match");
  });
  it("explains that a manual selection is kept after a weak rerun", () => {
    expect(
      presentAiMatch(
        { ...withEstimates([0.2], 0.8), selectedPieceId: "two", destinationProvenance: "manual" },
        options,
      ).outcome,
    ).toBe("kept");
  });
  it("labels a selected AI draft without repeating it as an alternative", () => {
    const draft = withEstimates([0.9, 0.05], 0.05);
    expect(
      presentAiMatch(
        {
          ...draft,
          selectedPieceId: "one",
          destinationProvenance: "ai",
          aiSuggestion: {
            ...draft.aiSuggestion,
            groupId: "song",
            confidence: "high",
            suggestedPieceId: "one",
          },
        },
        options,
      ),
    ).toEqual({ outcome: "suggested", alternatives: [] });
  });
});
