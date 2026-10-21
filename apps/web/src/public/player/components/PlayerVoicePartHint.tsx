import { getVoicePartHintCopy } from "../voicePartHint";

/**
 * Voice-part selector nudge (issue #279).
 *
 * A non-interactive "Choose yours" pointer plus one inline hint row with a
 * dismiss button, rendered directly around the *existing* part selector.
 * Nothing here changes playback or selection; the selector remains the only
 * way into the picker.
 */
export function PlayerVoicePartHintPointer({
  isSectionTerminology,
}: {
  readonly isSectionTerminology: boolean;
}) {
  const copy = getVoicePartHintCopy(isSectionTerminology);
  return (
    <p aria-hidden="true" className="public-player__part-hint-pointer">
      <span>{copy.pointer}</span>
      <span aria-hidden="true" className="public-player__part-hint-pointer-arrow">
        &#8601;
      </span>
    </p>
  );
}

export function PlayerVoicePartHintRow({
  hintTextId,
  isSectionTerminology,
  onDismiss,
}: {
  readonly hintTextId: string;
  readonly isSectionTerminology: boolean;
  readonly onDismiss: () => void;
}) {
  const copy = getVoicePartHintCopy(isSectionTerminology);
  return (
    <div className="public-player__part-hint">
      <svg
        aria-hidden="true"
        className="public-player__part-hint-icon"
        fill="none"
        height="16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="16"
      >
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z" />
      </svg>
      <p className="public-player__part-hint-text" id={hintTextId}>
        {copy.hint}
      </p>
      <button
        aria-label={copy.dismissLabel}
        className="public-player__part-hint-dismiss"
        onClick={onDismiss}
        type="button"
      >
        <span aria-hidden="true">&#215;</span>
      </button>
    </div>
  );
}
