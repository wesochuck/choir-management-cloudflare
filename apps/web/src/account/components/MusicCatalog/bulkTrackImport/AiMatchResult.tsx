import type { AiMatchOutcome } from "./aiMatchPresentation";
import type { SuggestedPieceAlternative } from "./DestinationPiecePicker";

const OUTCOMES: Record<AiMatchOutcome, { readonly title: string; readonly instruction: string }> = {
  no_match: {
    title: "AI couldn’t find a reliable match",
    instruction:
      "Search the Music Library to choose a destination. The recording may be missing from the selected set list or library.",
  },
  suggested: {
    title: "AI suggested this destination",
    instruction:
      "Check the piece and each file’s voice part, then mark this group reviewed. Nothing uploads until you confirm.",
  },
  kept: {
    title: "Your current destination is kept",
    instruction:
      "AI found no convincing alternative. Check your selection and the voice parts before marking this group reviewed.",
  },
  alternatives: {
    title: "Possible destinations",
    instruction:
      "AI found possible matches, but you need to choose. Compare the title and credits, or search the Music Library.",
  },
};

export function AiMatchResult({
  outcome,
  alternatives,
  disabled,
  onSelect,
}: {
  readonly outcome: AiMatchOutcome;
  readonly alternatives: readonly SuggestedPieceAlternative[];
  readonly disabled: boolean;
  readonly onSelect: (pieceId: string | null) => void;
}) {
  const message = OUTCOMES[outcome];
  return (
    <section aria-label="AI matching result" className="track-import-ai-result" role="status">
      <h4>{message.title}</h4>
      <p>{message.instruction}</p>
      {alternatives.length > 0 ? (
        <ul className="track-import-ai-result__options" aria-label="Possible AI destinations">
          {alternatives.map((alt) => (
            <li key={alt.pieceId}>
              <div className="track-import-ai-result__copy">
                <strong>{alt.title}</strong>
                <span>
                  {[alt.composer, alt.arranger ? `arr. ${alt.arranger}` : ""]
                    .filter(Boolean)
                    .join(" · ") || "Composer and arranger not listed"}
                </span>
              </div>
              <button
                className="button button--secondary"
                disabled={disabled}
                type="button"
                aria-label={`Select destination: ${alt.title}${alt.arranger ? `, arranged by ${alt.arranger}` : ""}`}
                onClick={() => {
                  onSelect(alt.pieceId);
                }}
              >
                Select destination
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
