import { useEffect, useMemo, useRef, useState } from "react";

import { formatVoicePartName, sortVoiceParts } from "../../playerVoiceParts";

export function PlayerPartSelector({
  activeTrackKey,
  defaultOpen = false,
  onSelectTrackKey,
  trackKeys,
  voicePartKeys,
}: {
  readonly activeTrackKey: string;
  readonly defaultOpen?: boolean;
  readonly onSelectTrackKey: (key: string) => void;
  readonly trackKeys: readonly string[];
  readonly voicePartKeys?: readonly string[] | undefined;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedOptionRef = useRef<HTMLButtonElement | null>(null);

  const allKeys = useMemo(() => {
    const combined = new Set([...trackKeys, ...(voicePartKeys ?? [])]);
    return sortVoiceParts([...combined]);
  }, [trackKeys, voicePartKeys]);

  useEffect(() => {
    if (isOpen) {
      selectedOptionRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleClose = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="public-player__part-selector-container">
      <button
        aria-controls="voice-part-sheet"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="public-player__part-trigger"
        onClick={() => {
          setIsOpen((prev) => !prev);
        }}
        ref={triggerRef}
        type="button"
      >
        <span className="public-player__part-trigger-lead">
          <svg
            aria-hidden="true"
            className="public-player__part-trigger-icon"
            fill="none"
            height="18"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="18"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span className="public-player__part-trigger-label">Voice Part</span>
        </span>
        <span className="public-player__part-trigger-value">
          <span>{formatVoicePartName(activeTrackKey)}</span>
          <svg
            aria-hidden="true"
            className={`public-player__part-trigger-chevron ${isOpen ? "is-open" : ""}`}
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="16"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {isOpen ? (
        <div
          aria-labelledby="choose-voice-part-title"
          aria-modal="true"
          className="public-player__part-sheet-backdrop"
          id="voice-part-sheet"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleClose();
            }
          }}
          role="dialog"
        >
          <div className="public-player__part-sheet">
            <div aria-hidden="true" className="public-player__part-sheet-handle" />
            <div className="public-player__part-sheet-header">
              <h3 id="choose-voice-part-title">Choose Voice Part</h3>
              <button
                aria-label="Close voice part selector"
                className="public-player__part-sheet-close"
                onClick={handleClose}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="18"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="18"
                >
                  <line x1="18" x2="6" y1="6" y2="18" />
                  <line x1="6" x2="18" y1="6" y2="18" />
                </svg>
              </button>
            </div>
            <div
              aria-labelledby="choose-voice-part-title"
              className="public-player__part-options"
              role="radiogroup"
            >
              {allKeys.map((key) => {
                const isSelected = activeTrackKey === key;
                return (
                  <button
                    aria-checked={isSelected}
                    className={`public-player__part-option ${isSelected ? "is-selected" : ""}`}
                    key={key}
                    onClick={() => {
                      onSelectTrackKey(key);
                      setIsOpen(false);
                      triggerRef.current?.focus();
                    }}
                    ref={isSelected ? selectedOptionRef : undefined}
                    role="radio"
                    type="button"
                  >
                    <span aria-hidden="true" className="public-player__part-option-radio">
                      {isSelected ? (
                        <span className="public-player__part-option-radio-dot" />
                      ) : null}
                    </span>
                    <span className="public-player__part-option-label">
                      {formatVoicePartName(key)}
                    </span>
                    {isSelected ? (
                      <svg
                        aria-hidden="true"
                        className="public-player__part-option-check"
                        fill="none"
                        height="18"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2.5"
                        viewBox="0 0 24 24"
                        width="18"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
