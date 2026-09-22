import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Sheet } from "@choir/ui";

import { displayTrackName, sortVoiceParts } from "../../playerVoiceParts";

export function PlayerPartSelector({
  activeTrackKey,
  defaultOpen = false,
  onSelectTrackKey,
  trackKeys,
  trackLabels,
  voicePartKeys,
}: {
  readonly activeTrackKey: string;
  readonly defaultOpen?: boolean;
  readonly onSelectTrackKey: (key: string) => void;
  readonly trackKeys: readonly string[];
  readonly trackLabels?: Readonly<Record<string, string>> | undefined;
  readonly voicePartKeys?: readonly string[] | undefined;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedOptionRef = useRef<HTMLButtonElement | null>(null);
  const optionsListRef = useRef<HTMLDivElement | null>(null);

  const allKeys = useMemo(() => {
    const combined = new Set([
      ...(activeTrackKey ? [activeTrackKey] : []),
      ...trackKeys,
      ...(voicePartKeys ?? []),
    ]);
    return sortVoiceParts([...combined]);
  }, [activeTrackKey, trackKeys, voicePartKeys]);

  useEffect(() => {
    if (isOpen) {
      selectedOptionRef.current?.focus();
    }
  }, [isOpen]);

  const handleRadiogroupKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!optionsListRef.current) return;
    const radios = Array.from(
      optionsListRef.current.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
    if (radios.length === 0) return;

    const currentIndex = radios.findIndex((radio) => radio === document.activeElement);
    if (currentIndex === -1) return;

    let targetIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      targetIndex = (currentIndex + 1) % radios.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      targetIndex = (currentIndex - 1 + radios.length) % radios.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = radios.length - 1;
    }

    if (targetIndex !== null) {
      event.preventDefault();
      const targetRadio = radios[targetIndex];
      const targetKey = allKeys[targetIndex];
      if (targetRadio && targetKey) {
        targetRadio.focus();
        onSelectTrackKey(targetKey);
      }
    }
  };

  return (
    <div className="public-player__part-selector-container">
      {/* Mobile Native Picker (< 48rem) */}
      <label className="public-player__part-picker-mobile" htmlFor="mobile-voice-part-select">
        <span className="public-player__part-picker-lead">
          <svg
            aria-hidden="true"
            className="public-player__part-picker-icon"
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
          <span className="public-player__part-picker-label">Voice Part</span>
        </span>
        <span className="public-player__part-picker-value">
          <span>{displayTrackName(activeTrackKey, trackLabels)}</span>
          <svg
            aria-hidden="true"
            className="public-player__part-picker-chevron"
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
        <select
          aria-label="Voice Part"
          className="public-player__part-picker-select"
          id="mobile-voice-part-select"
          onChange={(event) => {
            onSelectTrackKey(event.target.value);
          }}
          value={activeTrackKey}
        >
          {allKeys.map((key) => (
            <option key={key} value={key}>
              {displayTrackName(key, trackLabels)}
            </option>
          ))}
        </select>
      </label>

      {/* Desktop Custom Trigger + Sheet (>= 48rem) */}
      <div className="public-player__part-selector-desktop">
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
            <span>{displayTrackName(activeTrackKey, trackLabels)}</span>
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

        <Sheet
          onClose={() => {
            setIsOpen(false);
          }}
          open={isOpen}
          restoreFocusRef={triggerRef}
          title="Choose Voice Part"
        >
          <div className="public-player__sheet-container">
            <div className="public-player__sheet-header">
              <p className="public-player__sheet-title">Choose Voice Part</p>
            </div>
            <div
              aria-label="Choose Voice Part"
              className="public-player__part-options"
              onKeyDown={handleRadiogroupKeyDown}
              ref={optionsListRef}
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
                    }}
                    ref={isSelected ? selectedOptionRef : undefined}
                    role="radio"
                    tabIndex={
                      isSelected || (!allKeys.includes(activeTrackKey) && key === allKeys[0])
                        ? 0
                        : -1
                    }
                    type="button"
                  >
                    <span aria-hidden="true" className="public-player__part-option-radio">
                      {isSelected ? (
                        <span className="public-player__part-option-radio-dot" />
                      ) : null}
                    </span>
                    <span className="public-player__part-option-label">
                      {displayTrackName(key, trackLabels)}
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
        </Sheet>
      </div>
    </div>
  );
}
