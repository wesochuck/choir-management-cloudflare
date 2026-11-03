import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Sheet } from "@choir/ui";

import { displayTrackName } from "../../playerVoiceParts";
import type { PlayerPlaylistItem } from "../types";

export type SelectionScope = "global" | "piece";
export type TrackLabels = Readonly<Record<string, string>> | undefined;

export interface ElementRef {
  current: HTMLElement | null;
}

export interface ButtonRef {
  current: HTMLButtonElement | null;
}

function getScopeTabTargetIndex(key: string, currentIndex: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return (currentIndex + 1) % count;
    case "ArrowLeft":
      return (currentIndex - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

function TrackScopeTabs({
  scope,
  scopeTabId,
  onScopeChange,
}: {
  readonly scope: SelectionScope;
  readonly scopeTabId: string;
  readonly onScopeChange: (scope: SelectionScope) => void;
}) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const currentTab = event.target instanceof HTMLButtonElement ? event.target : null;
    const currentIndex = currentTab ? tabs.indexOf(currentTab) : -1;
    if (currentIndex < 0) return;
    const targetIndex = getScopeTabTargetIndex(event.key, currentIndex, tabs.length);
    if (targetIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[targetIndex];
    nextTab?.focus();
    onScopeChange(nextTab?.dataset.scope === "piece" ? "piece" : "global");
  };

  return (
    <div
      aria-label="Track selection scope"
      className="public-player__track-scope-tabs"
      onKeyDown={handleKeyDown}
      role="tablist"
    >
      <button
        aria-controls={`${scopeTabId}-panel`}
        aria-selected={scope === "global"}
        className={scope === "global" ? "is-selected" : undefined}
        data-scope="global"
        id={`${scopeTabId}-global`}
        onClick={() => {
          onScopeChange("global");
        }}
        role="tab"
        tabIndex={scope === "global" ? 0 : -1}
        type="button"
      >
        All set list songs
      </button>
      <button
        aria-controls={`${scopeTabId}-panel`}
        aria-selected={scope === "piece"}
        className={scope === "piece" ? "is-selected" : undefined}
        data-scope="piece"
        id={`${scopeTabId}-piece`}
        onClick={() => {
          onScopeChange("piece");
        }}
        role="tab"
        tabIndex={scope === "piece" ? 0 : -1}
        type="button"
      >
        Just this song
      </button>
    </div>
  );
}

function getRadioTargetIndex(key: string, currentIndex: number, count: number): number | null {
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return (currentIndex + 1) % count;
    case "ArrowUp":
    case "ArrowLeft":
      return (currentIndex - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

function isTrackOptionSelected(
  key: string | null,
  scope: SelectionScope,
  activeTrackKey: string,
  pinnedTrackKey: string | null,
): boolean {
  if (scope === "global") return key === activeTrackKey;
  if (key === null) return pinnedTrackKey === null;
  return pinnedTrackKey === key;
}

function getTrackOptionLabel(
  key: string | null,
  activeTrackKey: string,
  trackLabels: TrackLabels,
): string {
  if (key === null) return `Use my default (${displayTrackName(activeTrackKey, trackLabels)})`;
  return displayTrackName(key, trackLabels);
}

function TrackOption({
  currentItem,
  isSelected,
  keyValue,
  label,
  onClose,
  onPinPieceTrack,
  onSelectTrackKey,
  scope,
  selectedOptionRef,
}: {
  readonly currentItem: PlayerPlaylistItem | null;
  readonly isSelected: boolean;
  readonly keyValue: string | null;
  readonly label: string;
  readonly onClose: () => void;
  readonly onPinPieceTrack?: ((pieceId: string, trackKey: string | null) => void) | undefined;
  readonly onSelectTrackKey: (key: string) => void;
  readonly scope: SelectionScope;
  readonly selectedOptionRef: ButtonRef;
}) {
  const optionKey = keyValue ?? "";
  const handleClick = () => {
    if (scope === "piece" && currentItem?.pieceId) {
      onPinPieceTrack?.(currentItem.pieceId, keyValue);
    } else if (keyValue) {
      onSelectTrackKey(keyValue);
    }
    onClose();
  };

  return (
    <button
      aria-checked={isSelected}
      className={`public-player__part-option ${isSelected ? "is-selected" : ""}`}
      data-option-key={optionKey}
      onClick={handleClick}
      ref={isSelected ? selectedOptionRef : undefined}
      role="radio"
      tabIndex={isSelected ? 0 : -1}
      type="button"
    >
      <span aria-hidden="true" className="public-player__part-option-radio">
        {isSelected ? <span className="public-player__part-option-radio-dot" /> : null}
      </span>
      <span className="public-player__part-option-label">{label}</span>
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
}

function TrackOptions({
  assignmentLabel,
  activeTrackKey,
  currentItem,
  keys,
  onClose,
  onPinPieceTrack,
  onSelectTrackKey,
  pinnedTrackKey,
  scope,
  selectedOptionRef,
  trackLabels,
}: {
  readonly assignmentLabel: string;
  readonly activeTrackKey: string;
  readonly currentItem: PlayerPlaylistItem | null;
  readonly keys: readonly (string | null)[];
  readonly onClose: () => void;
  readonly onPinPieceTrack?: ((pieceId: string, trackKey: string | null) => void) | undefined;
  readonly onSelectTrackKey: (key: string) => void;
  readonly pinnedTrackKey: string | null;
  readonly scope: SelectionScope;
  readonly selectedOptionRef: ButtonRef;
  readonly trackLabels: TrackLabels;
}) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const radios = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
    const currentIndex = radios.findIndex((radio) => radio === document.activeElement);
    const targetIndex = getRadioTargetIndex(event.key, currentIndex, radios.length);
    if (targetIndex === null || currentIndex < 0) return;

    const targetRadio = radios[targetIndex];
    if (!targetRadio) return;
    event.preventDefault();
    targetRadio.focus();
    const optionKey = targetRadio.dataset.optionKey;
    if (optionKey === undefined) return;
    if (scope === "piece" && currentItem?.pieceId) {
      onPinPieceTrack?.(currentItem.pieceId, optionKey === "" ? null : optionKey);
    } else if (optionKey) {
      onSelectTrackKey(optionKey);
    }
  };

  return (
    <div
      aria-label={
        scope === "piece" && currentItem
          ? `Choose track for ${currentItem.title}`
          : `Choose ${assignmentLabel}`
      }
      className="public-player__part-options"
      onKeyDown={handleKeyDown}
      role="radiogroup"
    >
      {keys.map((key) => (
        <TrackOption
          currentItem={currentItem}
          isSelected={isTrackOptionSelected(key, scope, activeTrackKey, pinnedTrackKey)}
          key={key ?? "default"}
          keyValue={key}
          label={getTrackOptionLabel(key, activeTrackKey, trackLabels)}
          onClose={onClose}
          onPinPieceTrack={onPinPieceTrack}
          onSelectTrackKey={onSelectTrackKey}
          scope={scope}
          selectedOptionRef={selectedOptionRef}
        />
      ))}
    </div>
  );
}

export function PlayerPartSheet({
  activeTrackKey,
  assignmentLabel,
  currentItem,
  hasPieceTracks,
  isOpen,
  keys,
  onClose,
  onPinPieceTrack,
  onScopeChange,
  onSelectTrackKey,
  pinnedTrackKey,
  restoreFocusRef,
  scope,
  scopeTabId,
  selectedOptionRef,
  trackLabels,
}: {
  readonly activeTrackKey: string;
  readonly assignmentLabel: string;
  readonly currentItem: PlayerPlaylistItem | null;
  readonly hasPieceTracks: boolean;
  readonly isOpen: boolean;
  readonly keys: readonly (string | null)[];
  readonly onClose: () => void;
  readonly onPinPieceTrack?: ((pieceId: string, trackKey: string | null) => void) | undefined;
  readonly onScopeChange: (scope: SelectionScope) => void;
  readonly onSelectTrackKey: (key: string) => void;
  readonly pinnedTrackKey: string | null;
  readonly restoreFocusRef: ElementRef;
  readonly scope: SelectionScope;
  readonly scopeTabId: string;
  readonly selectedOptionRef: ButtonRef;
  readonly trackLabels: TrackLabels;
}) {
  const close = onClose;
  return (
    <Sheet
      onClose={close}
      open={isOpen}
      restoreFocusRef={restoreFocusRef}
      title={`Choose ${assignmentLabel}`}
    >
      <div className="public-player__sheet-container">
        <div className="public-player__sheet-header">
          <p className="public-player__sheet-title">Choose {assignmentLabel}</p>
        </div>
        {hasPieceTracks ? (
          <TrackScopeTabs scope={scope} scopeTabId={scopeTabId} onScopeChange={onScopeChange} />
        ) : null}
        <div
          aria-labelledby={hasPieceTracks ? `${scopeTabId}-${scope}` : undefined}
          className="public-player__track-scope-panel"
          id={hasPieceTracks ? `${scopeTabId}-panel` : undefined}
          role={hasPieceTracks ? "tabpanel" : undefined}
        >
          <TrackOptions
            assignmentLabel={assignmentLabel}
            activeTrackKey={activeTrackKey}
            currentItem={currentItem}
            keys={keys}
            onClose={close}
            onPinPieceTrack={onPinPieceTrack}
            onSelectTrackKey={onSelectTrackKey}
            pinnedTrackKey={pinnedTrackKey}
            scope={scope}
            selectedOptionRef={selectedOptionRef}
            trackLabels={trackLabels}
          />
        </div>
      </div>
    </Sheet>
  );
}
