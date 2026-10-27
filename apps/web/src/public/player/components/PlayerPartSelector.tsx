import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Sheet } from "@choir/ui";

import { displayTrackName, sortVoiceParts } from "../../playerVoiceParts";
import { useOrganizationTerminology } from "../../../account/organizationTerminologyContext";
import { resolveTrackKey } from "../format";
import type { PlayerPlaylistItem } from "../types";
import { PlayerVoicePartHintPointer, PlayerVoicePartHintRow } from "./PlayerVoicePartHint";

type SelectionScope = "global" | "piece";
type TrackLabels = Readonly<Record<string, string>> | undefined;

interface ElementRef {
  current: HTMLElement | null;
}

interface ButtonRef {
  current: HTMLButtonElement | null;
}

interface SelectRef {
  current: HTMLSelectElement | null;
}

function PartIcon() {
  return (
    <svg
      aria-hidden="true"
      className="public-player__part-picker-icon public-player__part-trigger-icon"
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
  );
}

function TrackSelectorValue({
  activeTrackKey,
  pinnedTrackKey,
  trackLabels,
}: {
  readonly activeTrackKey: string;
  readonly pinnedTrackKey: string | null;
  readonly trackLabels: TrackLabels;
}) {
  if (!pinnedTrackKey) return <>{displayTrackName(activeTrackKey, trackLabels)}</>;
  return (
    <>
      <span aria-hidden="true">📌 </span>
      {displayTrackName(pinnedTrackKey, trackLabels)} (Default:{" "}
      {displayTrackName(activeTrackKey, trackLabels)})
    </>
  );
}

function MobilePartPicker({
  activeTrackKey,
  allKeys,
  assignmentLabel,
  hintTextId,
  onEngage,
  onSelectTrackKey,
  pinnedTrackKey,
  selectRef,
  showVoicePartHint,
  trackLabels,
}: {
  readonly activeTrackKey: string;
  readonly allKeys: readonly string[];
  readonly assignmentLabel: string;
  readonly hintTextId: string;
  readonly onEngage?: (() => void) | undefined;
  readonly onSelectTrackKey: (key: string) => void;
  readonly pinnedTrackKey: string | null;
  readonly selectRef: SelectRef;
  readonly showVoicePartHint: boolean;
  readonly trackLabels: TrackLabels;
}) {
  return (
    <label className="public-player__part-picker-mobile" htmlFor="mobile-voice-part-select">
      <span className="public-player__part-picker-lead">
        <PartIcon />
        <span className="public-player__part-picker-label">{assignmentLabel}</span>
      </span>
      <span className="public-player__part-picker-value">
        <span>
          <TrackSelectorValue
            activeTrackKey={activeTrackKey}
            pinnedTrackKey={pinnedTrackKey}
            trackLabels={trackLabels}
          />
        </span>
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
        aria-describedby={showVoicePartHint ? hintTextId : undefined}
        aria-label={assignmentLabel}
        className="public-player__part-picker-select"
        id="mobile-voice-part-select"
        onChange={(event) => {
          onSelectTrackKey(event.target.value);
        }}
        onClick={onEngage}
        ref={selectRef}
        value={activeTrackKey}
      >
        {allKeys.map((key) => (
          <option key={key} value={key}>
            {displayTrackName(key, trackLabels)}
          </option>
        ))}
      </select>
    </label>
  );
}

function MobilePieceTrackButton({
  activeTrackKey,
  currentItem,
  onOpen,
  pinnedTrackKey,
  restoreFocusRef,
  trackLabels,
}: {
  readonly activeTrackKey: string;
  readonly currentItem: PlayerPlaylistItem;
  readonly onOpen: (scope: SelectionScope) => void;
  readonly pinnedTrackKey: string | null;
  readonly restoreFocusRef: ElementRef;
  readonly trackLabels: TrackLabels;
}) {
  return (
    <button
      aria-label={`Choose track just for ${currentItem.title}${pinnedTrackKey ? `; pinned to ${displayTrackName(pinnedTrackKey, trackLabels)}; default ${displayTrackName(activeTrackKey, trackLabels)}` : `; following default ${displayTrackName(activeTrackKey, trackLabels)}`}`}
      aria-haspopup="dialog"
      className="public-player__piece-track-mobile-trigger"
      onClick={(event) => {
        restoreFocusRef.current = event.currentTarget;
        onOpen("piece");
      }}
      type="button"
    >
      Track for this song · {displayTrackName(pinnedTrackKey ?? activeTrackKey, trackLabels)}
    </button>
  );
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

function PlayerPartSheet({
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

function DesktopPartSelector({
  activeTrackKey,
  assignmentLabel,
  currentItem,
  hasPieceTracks,
  isOpen,
  keys,
  onClose,
  onEngage,
  onOpenGlobal,
  onPinPieceTrack,
  onScopeChange,
  onSelectTrackKey,
  pinnedTrackKey,
  restoreFocusRef,
  scope,
  scopeTabId,
  selectedOptionRef,
  hintTextId,
  showVoicePartHint,
  trackLabels,
  triggerRef,
}: {
  readonly activeTrackKey: string;
  readonly assignmentLabel: string;
  readonly currentItem: PlayerPlaylistItem | null;
  readonly hasPieceTracks: boolean;
  readonly isOpen: boolean;
  readonly keys: readonly (string | null)[];
  readonly onClose: () => void;
  readonly onEngage?: (() => void) | undefined;
  readonly onOpenGlobal: () => void;
  readonly onPinPieceTrack?: ((pieceId: string, trackKey: string | null) => void) | undefined;
  readonly onScopeChange: (scope: SelectionScope) => void;
  readonly onSelectTrackKey: (key: string) => void;
  readonly pinnedTrackKey: string | null;
  readonly restoreFocusRef: ElementRef;
  readonly scope: SelectionScope;
  readonly scopeTabId: string;
  readonly selectedOptionRef: ButtonRef;
  readonly hintTextId: string;
  readonly showVoicePartHint: boolean;
  readonly trackLabels: TrackLabels;
  readonly triggerRef: ButtonRef;
}) {
  return (
    <div className="public-player__part-selector-desktop">
      <button
        aria-controls="voice-part-sheet"
        aria-describedby={showVoicePartHint ? hintTextId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="public-player__part-trigger"
        onClick={() => {
          if (isOpen) {
            onClose();
            return;
          }
          onEngage?.();
          onOpenGlobal();
        }}
        ref={triggerRef}
        type="button"
      >
        <span className="public-player__part-trigger-lead">
          <PartIcon />
          <span className="public-player__part-trigger-label">{assignmentLabel}</span>
        </span>
        <span className="public-player__part-trigger-value">
          <span>
            <TrackSelectorValue
              activeTrackKey={activeTrackKey}
              pinnedTrackKey={pinnedTrackKey}
              trackLabels={trackLabels}
            />
          </span>
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
      <PlayerPartSheet
        activeTrackKey={activeTrackKey}
        assignmentLabel={assignmentLabel}
        currentItem={currentItem}
        hasPieceTracks={hasPieceTracks}
        isOpen={isOpen}
        keys={keys}
        onClose={onClose}
        onPinPieceTrack={onPinPieceTrack}
        onScopeChange={onScopeChange}
        onSelectTrackKey={onSelectTrackKey}
        pinnedTrackKey={pinnedTrackKey}
        restoreFocusRef={restoreFocusRef}
        scope={scope}
        scopeTabId={scopeTabId}
        selectedOptionRef={selectedOptionRef}
        trackLabels={trackLabels}
      />
    </div>
  );
}

function getAssignmentLabel(partLabel: string): string {
  return partLabel === "Section" ? "Section" : "Voice Part";
}

function getAvailablePieceTrackKeys(currentItem: PlayerPlaylistItem | null): string[] {
  if (!currentItem) return [];
  const availableKeys = Object.entries(currentItem.trackFileIds)
    .filter(([, fileId]) => typeof fileId === "string" && fileId.trim().length > 0)
    .map(([key]) => key);
  return sortVoiceParts(availableKeys);
}

function hasPieceTrackChoices(
  currentItem: PlayerPlaylistItem | null,
  pieceTrackKeys: readonly string[],
  onPinPieceTrack: ((pieceId: string, trackKey: string | null) => void) | undefined,
): boolean {
  return Boolean(currentItem?.pieceId && pieceTrackKeys.length > 1 && onPinPieceTrack);
}

function resolvePinnedKey(
  pieceTrackKeys: readonly string[],
  pinnedTrackKey: string | null,
): string | null {
  if (!pinnedTrackKey) return null;
  return resolveTrackKey(pieceTrackKeys, pinnedTrackKey);
}

function getActiveSelectionScope(
  selectionScope: SelectionScope,
  hasPieceTracks: boolean,
): SelectionScope {
  return selectionScope === "piece" && hasPieceTracks ? "piece" : "global";
}

function getSelectionKeys(
  scope: SelectionScope,
  pieceTrackKeys: readonly string[],
  allKeys: readonly string[],
): (string | null)[] {
  return scope === "piece" ? [null, ...pieceTrackKeys] : [...allKeys];
}

function getAllTrackKeys(
  activeTrackKey: string,
  trackKeys: readonly string[],
  voicePartKeys: readonly string[] | undefined,
): string[] {
  const combined = new Set(trackKeys);
  if (activeTrackKey) combined.add(activeTrackKey);
  for (const key of voicePartKeys ?? []) combined.add(key);
  return sortVoiceParts([...combined]);
}

function getPartSelectorContainerClass(showVoicePartHint: boolean): string {
  return `public-player__part-selector-container${showVoicePartHint ? " public-player__part-selector-container--hinted" : ""}`;
}

function dismissVoicePartHint(
  onDismissHint: (() => void) | undefined,
  trigger: HTMLButtonElement | null,
  select: HTMLSelectElement | null,
): void {
  onDismissHint?.();
  const useDesktop =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(min-width: 48rem)").matches;
  if (useDesktop) trigger?.focus();
  else select?.focus();
}

function OptionalHintPointer({
  show,
  isSectionTerminology,
}: {
  readonly show: boolean;
  readonly isSectionTerminology: boolean;
}) {
  if (!show) return null;
  return <PlayerVoicePartHintPointer isSectionTerminology={isSectionTerminology} />;
}

function OptionalHintRow({
  hintTextId,
  isSectionTerminology,
  onDismiss,
  show,
}: {
  readonly hintTextId: string;
  readonly isSectionTerminology: boolean;
  readonly onDismiss: () => void;
  readonly show: boolean;
}) {
  if (!show) return null;
  return (
    <PlayerVoicePartHintRow
      hintTextId={hintTextId}
      isSectionTerminology={isSectionTerminology}
      onDismiss={onDismiss}
    />
  );
}

function OptionalMobilePieceTrackButton({
  activeTrackKey,
  currentItem,
  hasPieceTracks,
  onOpen,
  pinnedTrackKey,
  restoreFocusRef,
  trackLabels,
}: {
  readonly activeTrackKey: string;
  readonly currentItem: PlayerPlaylistItem | null;
  readonly hasPieceTracks: boolean;
  readonly onOpen: (scope: SelectionScope) => void;
  readonly pinnedTrackKey: string | null;
  readonly restoreFocusRef: ElementRef;
  readonly trackLabels: TrackLabels;
}) {
  if (!hasPieceTracks || !currentItem) return null;
  return (
    <MobilePieceTrackButton
      activeTrackKey={activeTrackKey}
      currentItem={currentItem}
      onOpen={onOpen}
      pinnedTrackKey={pinnedTrackKey}
      restoreFocusRef={restoreFocusRef}
      trackLabels={trackLabels}
    />
  );
}

export function PlayerPartSelector({
  defaultOpen = false,
  defaultSelectionScope = "global",
  initialRestoreFocusElement = null,
  onDismissHint,
  onEngage,
  onPinPieceTrack,
  onSelectTrackKey,
  activeTrackKey,
  currentItem = null,
  pinnedTrackKey = null,
  showVoicePartHint = false,
  trackKeys,
  trackLabels,
  voicePartKeys,
}: {
  readonly defaultOpen?: boolean;
  readonly defaultSelectionScope?: SelectionScope;
  readonly initialRestoreFocusElement?: HTMLElement | null;
  readonly onDismissHint?: (() => void) | undefined;
  readonly onEngage?: (() => void) | undefined;
  readonly onPinPieceTrack?: ((pieceId: string, trackKey: string | null) => void) | undefined;
  readonly onSelectTrackKey: (key: string) => void;
  readonly activeTrackKey: string;
  readonly currentItem?: PlayerPlaylistItem | null | undefined;
  readonly pinnedTrackKey?: string | null | undefined;
  readonly showVoicePartHint?: boolean | undefined;
  readonly trackKeys: readonly string[];
  readonly trackLabels?: Readonly<Record<string, string>> | undefined;
  readonly voicePartKeys?: readonly string[] | undefined;
}) {
  const { partLabel } = useOrganizationTerminology();
  const assignmentLabel = getAssignmentLabel(partLabel);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [selectionScope, setSelectionScope] = useState<SelectionScope>(defaultSelectionScope);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(initialRestoreFocusElement);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const selectedOptionRef = useRef<HTMLButtonElement | null>(null);
  const scopeTabId = useId();
  const hintTextId = useId();
  const pieceTrackKeys = useMemo(() => getAvailablePieceTrackKeys(currentItem), [currentItem]);
  const hasPieceTracks = hasPieceTrackChoices(currentItem, pieceTrackKeys, onPinPieceTrack);
  const resolvedPinnedKey = resolvePinnedKey(pieceTrackKeys, pinnedTrackKey);
  const allKeys = useMemo(() => {
    return getAllTrackKeys(activeTrackKey, trackKeys, voicePartKeys);
  }, [activeTrackKey, trackKeys, voicePartKeys]);
  const scope = getActiveSelectionScope(selectionScope, hasPieceTracks);
  const selectionKeys = getSelectionKeys(scope, pieceTrackKeys, allKeys);

  useEffect(() => {
    if (isOpen) selectedOptionRef.current?.focus();
  }, [isOpen]);

  const openPieceScope = (nextScope: SelectionScope) => {
    setSelectionScope(nextScope);
    setIsOpen(true);
  };
  const openGlobalScope = () => {
    restoreFocusRef.current = triggerRef.current;
    openPieceScope("global");
  };
  const closeSheet = () => {
    setIsOpen(false);
  };
  const dismissHint = () => {
    dismissVoicePartHint(onDismissHint, triggerRef.current, selectRef.current);
  };

  return (
    <div className={getPartSelectorContainerClass(showVoicePartHint)}>
      <OptionalHintPointer
        show={showVoicePartHint}
        isSectionTerminology={partLabel === "Section"}
      />
      <MobilePartPicker
        activeTrackKey={activeTrackKey}
        allKeys={allKeys}
        assignmentLabel={assignmentLabel}
        hintTextId={hintTextId}
        onEngage={onEngage}
        onSelectTrackKey={onSelectTrackKey}
        pinnedTrackKey={resolvedPinnedKey}
        selectRef={selectRef}
        showVoicePartHint={showVoicePartHint}
        trackLabels={trackLabels}
      />
      <OptionalMobilePieceTrackButton
        activeTrackKey={activeTrackKey}
        currentItem={currentItem}
        hasPieceTracks={hasPieceTracks}
        onOpen={openPieceScope}
        pinnedTrackKey={resolvedPinnedKey}
        restoreFocusRef={restoreFocusRef}
        trackLabels={trackLabels}
      />
      <DesktopPartSelector
        activeTrackKey={activeTrackKey}
        assignmentLabel={assignmentLabel}
        currentItem={currentItem}
        hasPieceTracks={hasPieceTracks}
        isOpen={isOpen}
        keys={selectionKeys}
        onClose={closeSheet}
        onEngage={onEngage}
        onOpenGlobal={openGlobalScope}
        onPinPieceTrack={onPinPieceTrack}
        onScopeChange={setSelectionScope}
        onSelectTrackKey={onSelectTrackKey}
        pinnedTrackKey={resolvedPinnedKey}
        restoreFocusRef={restoreFocusRef}
        scope={scope}
        scopeTabId={scopeTabId}
        selectedOptionRef={selectedOptionRef}
        hintTextId={hintTextId}
        showVoicePartHint={showVoicePartHint}
        trackLabels={trackLabels}
        triggerRef={triggerRef}
      />
      <OptionalHintRow
        hintTextId={hintTextId}
        isSectionTerminology={partLabel === "Section"}
        onDismiss={dismissHint}
        show={showVoicePartHint}
      />
    </div>
  );
}
