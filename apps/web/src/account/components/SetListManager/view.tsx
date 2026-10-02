import { NumberInput } from "@choir/ui";
import { formatSetListDuration, moveSetListItem } from "@choir/domain";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  displayEvent,
  effectiveSetListItemArranger,
  effectiveSetListItemComposer,
  effectiveSetListItemDuration,
  effectiveSetListItemNotes,
  formatPracticePlayerExpiration,
  groupSetListForPresentation,
  itemType,
  normalizeItems,
  printTimeOnly,
  setListBuilderCredit,
  setListItemRecordingStatus,
  setListHasLearningTrack,
  setListRecordingCoverage,
  type SetListItemRecordingStatus,
} from "./utils";
import { InlinePracticeTrackPlayer } from "../../InlinePracticeTrackPlayer";
import { SetListPrintView } from "./shared";
import type { SetListItem } from "./types";
import type { SetListManagerModel } from "./hooks";
import { CustomItemDialog } from "./dialogs/CustomItemDialog";
import { EditItemDialog } from "./dialogs/EditItemDialog";
import { PracticePlayerShareDialog } from "./dialogs/PracticePlayerShareDialog";
import { PrintPreviewDialog } from "./dialogs/PrintPreviewDialog";
import { AppLink } from "../AuthenticatedShell/navigation";

function dropBoundaryForEvent(event: DragEvent<HTMLElement>, itemIndex: number): number {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? itemIndex : itemIndex + 1;
}

function canDropAtBoundary(boundary: number, dragIndex: number | null): boolean {
  return dragIndex !== null && boundary !== dragIndex && boundary !== dragIndex + 1;
}

function dropStateForItem(
  itemIndex: number,
  dragIndex: number | null,
  dragOverBoundary: number | null,
): { readonly before: boolean; readonly after: boolean } {
  return {
    after: dragOverBoundary === itemIndex + 1 && canDropAtBoundary(itemIndex + 1, dragIndex),
    before: dragOverBoundary === itemIndex && canDropAtBoundary(itemIndex, dragIndex),
  };
}

function setListItemIsDragging(
  index: number,
  dragIndex: number | null,
  keyboardDragIndex: number | null,
): boolean {
  return dragIndex === index || keyboardDragIndex === index;
}

function SetListItemNotes({
  notes,
  showNotes,
}: {
  readonly notes: string;
  readonly showNotes: boolean;
}) {
  if (!showNotes || !notes) return null;
  return <p className="set-list-item-notes">{notes}</p>;
}

export function SetListItemSummaryText({
  arranger,
  composer,
  displayCredit,
  duration,
  isSong,
  itemNotes,
  movementCount,
  parentWorkTitle,
  recordingStatus,
}: {
  readonly arranger?: string | undefined;
  readonly composer: string | undefined;
  readonly displayCredit?: string | undefined;
  readonly duration: string | undefined;
  readonly isSong: boolean;
  readonly itemNotes: string;
  readonly movementCount?: number | undefined;
  readonly parentWorkTitle?: string | undefined;
  readonly recordingStatus: SetListItemRecordingStatus;
}) {
  const credit = isSong ? (displayCredit ?? setListBuilderCredit(composer, arranger)) : undefined;
  const parentText = parentWorkTitle ? `Movement of ${parentWorkTitle}` : undefined;
  const movementSummary =
    movementCount !== undefined
      ? `${String(movementCount)} movement${movementCount === 1 ? "" : "s"}`
      : undefined;
  const details = [parentText, movementSummary, credit, duration].filter(Boolean).join(" · ");
  const hasDetails = Boolean(details);

  return (
    <span>
      {details}
      {isSong ? (
        <span
          className={`set-list-recording-status set-list-recording-status--${recordingStatus.status}`}
        >
          {hasDetails ? " · " : ""}
          <span className="set-list-recording-status__icon" aria-hidden="true">
            {recordingStatus.status === "available" || recordingStatus.status === "multiple"
              ? "●"
              : "○"}
          </span>{" "}
          {recordingStatus.status === "available"
            ? `Recording: ${recordingStatus.track.trackLabel}`
            : recordingStatus.status === "multiple"
              ? "Multiple recordings available"
              : "No recording"}
        </span>
      ) : null}
      {!hasDetails && !isSong && (itemNotes ? "Notes added" : "No additional details")}
    </span>
  );
}

function SetListItemRowActions({
  item,
  onEdit,
  onRemove,
  recordingStatus,
}: {
  readonly item: SetListItem;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
  readonly recordingStatus: SetListItemRecordingStatus;
}) {
  return (
    <div className="button-row set-list-item-actions">
      <button className="text-button" type="button" onClick={onEdit}>
        Set list details
      </button>
      {recordingStatus.status === "available" ? (
        <InlinePracticeTrackPlayer
          fileId={recordingStatus.track.fileId}
          label={recordingStatus.track.trackLabel}
          pieceTitle={recordingStatus.track.sourcePieceTitle || item.title}
          showLabelInButton
        />
      ) : null}
      {(recordingStatus.status === "available" || recordingStatus.status === "multiple") &&
      item.pieceId ? (
        <a className="text-button" href={`/practice?pieceId=${encodeURIComponent(item.pieceId)}`}>
          Open practice
        </a>
      ) : null}
      <button className="text-button text-button--danger" type="button" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

function reorderHandleLabel(
  title: string,
  index: number,
  itemCount: number,
  keyboardDragging: boolean,
): string {
  return `${keyboardDragging ? "Reordering" : "Reorder"} ${title}, position ${String(index + 1)} of ${String(itemCount)}`;
}

function buildItemRowClassName({
  dropAfter,
  dropBefore,
  isDragging,
  isIntermission,
  isMovement,
  isParent,
  isRecentlyMoved,
}: {
  readonly dropAfter: boolean;
  readonly dropBefore: boolean;
  readonly isDragging: boolean;
  readonly isIntermission: boolean;
  readonly isMovement: boolean;
  readonly isParent: boolean;
  readonly isRecentlyMoved: boolean;
}): string {
  const classes = ["set-list-item"];
  if (isMovement) classes.push("set-list-item--movement");
  if (isParent) classes.push("set-list-item--group-parent");
  if (isDragging) classes.push("set-list-item--dragging");
  if (isIntermission) classes.push("set-list-item--intermission");
  if (dropBefore) classes.push("set-list-item--drop-before");
  if (dropAfter) classes.push("set-list-item--drop-after");
  if (isRecentlyMoved) classes.push("set-list-item--moved");
  return classes.join(" ");
}

function renderItemLeadingIndicator(isMovement: boolean, programNumber?: number) {
  if (isMovement) {
    return (
      <span aria-hidden="true" className="set-list-item-movement-indicator">
        ↳
      </span>
    );
  }
  if (programNumber !== undefined) {
    return <strong className="set-list-item-position">{String(programNumber)}.</strong>;
  }
  return null;
}

function SetListInsertZone({
  dragIndex,
  dropAfter,
  index,
  itemTitle,
  onDrop,
  onInsertCustom,
  onSetDragOverBoundary,
  programNumber,
}: {
  readonly dragIndex: number | null;
  readonly dropAfter: boolean;
  readonly index: number;
  readonly itemTitle: string;
  readonly onDrop: (boundary: number) => void;
  readonly onInsertCustom: (index: number) => void;
  readonly onSetDragOverBoundary: (boundary: number | null) => void;
  readonly programNumber?: number | undefined;
}) {
  const targetIndex = index + 1;
  const itemLabel =
    programNumber !== undefined ? `${String(programNumber)}. ${itemTitle}` : itemTitle;
  return (
    <li
      className={`set-list-insert-zone${dropAfter ? " set-list-insert-zone--drop-target" : ""}`}
      role="presentation"
      onDragOver={(event) => {
        if (dragIndex === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onSetDragOverBoundary(targetIndex);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(targetIndex);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      {dropAfter ? (
        <span className="set-list-insert-zone__drop-label" aria-hidden="true">
          Drop item here
        </span>
      ) : null}
      <button
        aria-label={`Insert custom entry after ${itemLabel}`}
        className="set-list-insert-zone__button"
        type="button"
        onClick={() => {
          onInsertCustom(targetIndex);
        }}
      >
        + Insert custom entry
      </button>
    </li>
  );
}

// eslint-disable-next-line complexity -- render composition preserves the existing screen's independent states and dialogs.
export function SetListManagerView({
  model,
  navigate,
}: {
  readonly model: SetListManagerModel;
  readonly navigate?: ((href: string) => void) | undefined;
}) {
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [expirationHintDismissed, setExpirationHintDismissed] = useState(false);
  const [dragOverBoundary, setDragOverBoundary] = useState<number | null>(null);
  const [keyboardDragIndex, setKeyboardDragIndex] = useState<number | null>(null);
  const [keyboardDragOriginItems, setKeyboardDragOriginItems] = useState<
    SetListManagerModel["items"] | null
  >(null);
  const [recentlyMovedItemId, setRecentlyMovedItemId] = useState<string | null>(null);
  const movedFlashTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (movedFlashTimerRef.current !== null) {
        window.clearTimeout(movedFlashTimerRef.current);
      }
    };
  }, []);
  const {
    addCustomItem,
    addMusicPiece,
    approved,
    busy,
    closeItemEditor,
    copyEventId,
    copyListText,
    copyMissingItems,
    customComposer,
    customDialogOpen,
    customDuration,
    customNotes,
    customTitle,
    customType,
    defaultTransitionCount,
    defaultTransitionDuration,
    defaultTransitionSeconds,
    dirty,
    dragIndex,
    editingItem,
    enabled,
    error,
    estimatedRuntime,
    filteredMusic,
    insertCustomItem,
    intermissionsDuration,
    items,
    loaded,
    markDraftDirty,
    message,
    missingDurationCustomCount,
    moveDraggedItem,
    musicQuery,
    openCustomItem,
    openItemEditor,
    copyPracticePlayerLink,
    linkStatus,
    linkStatusError,
    openPlayerQrCode,
    openPracticePlayer,
    performances,
    performerLabelPlural,
    playerAction,
    qrDialogOpen,
    qrUrl,
    renewPracticePlayerLink,
    resources,
    setQrDialogOpen,
    save,
    saveItemEdit,
    selectedEvent,
    selectedEventId,
    setApproved,
    setCopyEventId,
    setCustomComposer,
    setCustomDialogOpen,
    setCustomDuration,
    setCustomNotes,
    setCustomTitle,
    setCustomType,
    setDefaultTransitionSeconds,
    setDirty,
    setDragIndex,
    setEditingItem,
    setError,
    setItems,
    setMessage,
    setMusicQuery,
    setSelectedEventId,
    setShowNotes,
    showNotes,
    songsDuration,
    updateDefaultTransitionSeconds,
    updateDraftItems,
  } = model;
  const coverage = useMemo(
    () => setListRecordingCoverage(items, resources.music),
    [items, resources.music],
  );
  const musicById = useMemo(
    () => new Map(resources.music.map((p) => [p.id, p])),
    [resources.music],
  );
  const childCountByParentId = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of resources.music) {
      if (p.parentId) {
        map.set(p.parentId, (map.get(p.parentId) ?? 0) + 1);
      }
    }
    return map;
  }, [resources.music]);
  const presentation = useMemo(
    () => groupSetListForPresentation(items, resources.music),
    [items, resources.music],
  );
  if (!enabled) return null;
  const practicePlayerUnavailableReason = !approved
    ? "Approve this set list before opening the Practice Player."
    : !setListHasLearningTrack(items, resources.music)
      ? "Add at least one learning track to a set-list piece before opening the Practice Player."
      : undefined;

  function flashMovedItem(itemId: string): void {
    setRecentlyMovedItemId(itemId);
    if (movedFlashTimerRef.current !== null) {
      window.clearTimeout(movedFlashTimerRef.current);
    }
    movedFlashTimerRef.current = window.setTimeout(() => {
      setRecentlyMovedItemId((current) => (current === itemId ? null : current));
      movedFlashTimerRef.current = null;
    }, 900);
  }

  function moveDraggedItemWithFeedback(toIndex: number): void {
    if (dragIndex === null || dragIndex === toIndex) return;
    const moved = items[dragIndex];
    moveDraggedItem(toIndex);
    if (moved?.id) flashMovedItem(moved.id);
  }

  function dropDraggedItem(boundary: number): void {
    if (!canDropAtBoundary(boundary, dragIndex) || dragIndex === null) return;
    moveDraggedItemWithFeedback(boundary > dragIndex ? boundary - 1 : boundary);
    setDragOverBoundary(null);
  }

  function moveKeyboardItem(direction: -1 | 1): void {
    if (keyboardDragIndex === null) return;
    const moved = items[keyboardDragIndex];
    const targetIndex = keyboardDragIndex + direction;
    if (!moved || targetIndex < 0 || targetIndex >= items.length) return;
    updateDraftItems((current) => [...moveSetListItem(current, keyboardDragIndex, direction)]);
    setKeyboardDragIndex(targetIndex);
    setMessage(
      `${moved.title} moved to position ${String(targetIndex + 1)}. Use the arrow keys to continue, or press Space or Enter to drop.`,
    );
    if (moved.id) flashMovedItem(moved.id);
  }

  function cancelKeyboardReorder(): void {
    if (keyboardDragIndex === null) return;
    const moved = items[keyboardDragIndex];
    if (keyboardDragOriginItems !== null && keyboardDragOriginItems !== items) {
      updateDraftItems(() => [...keyboardDragOriginItems]);
    }
    setKeyboardDragIndex(null);
    setKeyboardDragOriginItems(null);
    setMessage(`${moved?.title ?? "Set-list item"} reordering canceled.`);
  }

  function handleKeyboardReorderKeyDown(
    index: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ): void {
    const isActive = keyboardDragIndex === index;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (keyboardDragIndex === null) {
        const item = items[index];
        if (!item) return;
        setKeyboardDragIndex(index);
        setKeyboardDragOriginItems(items);
        setMessage(
          `Picked up ${item.title}, position ${String(index + 1)} of ${String(items.length)}. Use the arrow keys to move, or press Space or Enter to drop.`,
        );
      } else if (isActive) {
        const item = items[index];
        setKeyboardDragIndex(null);
        setKeyboardDragOriginItems(null);
        setMessage(`${item?.title ?? "Set-list item"} dropped at position ${String(index + 1)}.`);
      }
      return;
    }
    if (event.key === "Escape" && isActive) {
      event.preventDefault();
      cancelKeyboardReorder();
      return;
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && isActive) {
      event.preventDefault();
      moveKeyboardItem(event.key === "ArrowUp" ? -1 : 1);
    }
  }

  function renderItemRow({
    displayCredit,
    index,
    isMovement = false,
    item,
    movementCount,
    parentTitle,
    parentWorkTitle,
    programNumber,
  }: {
    readonly displayCredit?: string | undefined;
    readonly index: number;
    readonly isMovement?: boolean;
    readonly item: SetListItem;
    readonly movementCount?: number | undefined;
    readonly parentTitle?: string | undefined;
    readonly parentWorkTitle?: string | undefined;
    readonly programNumber?: number | undefined;
  }) {
    const itemNotes = effectiveSetListItemNotes(item, resources.music);
    const dropState = dropStateForItem(index, dragIndex, dragOverBoundary);
    const keyboardDragging = keyboardDragIndex === index;
    const itemDragging = setListItemIsDragging(index, dragIndex, keyboardDragIndex);
    const recordingStatus = setListItemRecordingStatus(item, resources.music);

    const className = buildItemRowClassName({
      dropAfter: dropState.after,
      dropBefore: dropState.before,
      isDragging: itemDragging,
      isIntermission: item.type === "intermission",
      isMovement,
      isParent: movementCount !== undefined,
      isRecentlyMoved: recentlyMovedItemId === item.id,
    });
    const ariaLabel =
      isMovement && parentTitle ? `Movement: ${item.title} of ${parentTitle}` : undefined;

    return (
      <Fragment key={item.id}>
        <li
          aria-label={ariaLabel}
          className={className}
          draggable
          onClick={(event) => {
            const target = event.target;
            if (
              !(target instanceof HTMLElement) ||
              target.closest("button, a, .set-list-drag-handle")
            ) {
              return;
            }
            openItemEditor(index);
          }}
          onDragEnd={() => {
            setKeyboardDragIndex(null);
            setKeyboardDragOriginItems(null);
            setDragIndex(null);
            setDragOverBoundary(null);
          }}
          onDragOver={(event) => {
            if (dragIndex === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDragOverBoundary(dropBoundaryForEvent(event, index));
          }}
          onDragStart={() => {
            setKeyboardDragIndex(null);
            setKeyboardDragOriginItems(null);
            setDragIndex(index);
            setDragOverBoundary(null);
            setRecentlyMovedItemId(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            dropDraggedItem(dropBoundaryForEvent(event, index));
          }}
          onPointerCancel={(event) => {
            if (event.pointerType === "touch") {
              setKeyboardDragIndex(null);
              setKeyboardDragOriginItems(null);
              setDragIndex(null);
              setDragOverBoundary(null);
            }
          }}
          onPointerDown={(event) => {
            if (event.pointerType === "touch") {
              setKeyboardDragIndex(null);
              setKeyboardDragOriginItems(null);
              setDragIndex(index);
              setDragOverBoundary(null);
            }
          }}
          onPointerUp={(event) => {
            if (event.pointerType === "touch") {
              moveDraggedItemWithFeedback(index);
              setDragOverBoundary(null);
            }
          }}
        >
          <div className="set-list-item-heading">
            <div className="set-list-item-title">
              <button
                aria-describedby="set-list-keyboard-reorder-help"
                aria-label={reorderHandleLabel(item.title, index, items.length, keyboardDragging)}
                aria-pressed={keyboardDragging}
                aria-controls="set-list-items"
                className="set-list-drag-handle"
                onKeyDown={(event) => {
                  handleKeyboardReorderKeyDown(index, event);
                }}
                title="Drag to reorder, or press Space or Enter for keyboard control"
                type="button"
              >
                <span aria-hidden="true" />
              </button>
              {renderItemLeadingIndicator(isMovement, programNumber)}
              <strong>{item.title}</strong>
              {item.type === "intermission" ? (
                <span className="set-list-item-type">Custom entry</span>
              ) : null}
            </div>
            <SetListItemRowActions
              item={item}
              onEdit={() => {
                openItemEditor(index);
              }}
              onRemove={() => {
                updateDraftItems((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                );
              }}
              recordingStatus={recordingStatus}
            />
          </div>
          <div className="set-list-item-summary">
            <SetListItemSummaryText
              arranger={effectiveSetListItemArranger(item, resources.music)}
              composer={effectiveSetListItemComposer(item, resources.music)}
              displayCredit={displayCredit}
              duration={effectiveSetListItemDuration(item, resources.music)}
              isSong={itemType(item) === "song"}
              itemNotes={itemNotes}
              movementCount={movementCount}
              parentWorkTitle={parentWorkTitle}
              recordingStatus={recordingStatus}
            />
            {item.isFeaturedNumber ? <span className="status-pill">Featured</span> : null}
          </div>
          <SetListItemNotes notes={itemNotes} showNotes={showNotes} />
        </li>
        {index < items.length - 1 ? (
          <SetListInsertZone
            dragIndex={dragIndex}
            dropAfter={dropState.after}
            index={index}
            itemTitle={item.title}
            onDrop={dropDraggedItem}
            onInsertCustom={insertCustomItem}
            onSetDragOverBoundary={setDragOverBoundary}
            programNumber={programNumber}
          />
        ) : null}
      </Fragment>
    );
  }

  return (
    <section className="account-section set-list-section" aria-label="Set list editor">
      <div className="section-heading section-heading--compact set-list-page-intro">
        {selectedEvent ? (
          <>
            <div className="button-row" aria-label="Set-list tools">
              <button
                className="button button--secondary"
                disabled={
                  busy ||
                  playerAction !== null ||
                  practicePlayerUnavailableReason !== undefined ||
                  linkStatus?.status === "expired"
                }
                onClick={() => {
                  void openPracticePlayer();
                }}
                title={practicePlayerUnavailableReason}
                type="button"
              >
                {playerAction === "open" ? "Opening player…" : "Practice Player"}
              </button>
              <button
                className="button button--secondary"
                disabled={
                  busy ||
                  playerAction !== null ||
                  practicePlayerUnavailableReason !== undefined ||
                  linkStatus?.status === "expired"
                }
                onClick={() => {
                  void copyPracticePlayerLink();
                }}
                title={practicePlayerUnavailableReason}
                type="button"
              >
                {playerAction === "copy" ? "Copying link…" : "Copy player link"}
              </button>
              <button
                className="button button--secondary"
                disabled={
                  busy ||
                  playerAction !== null ||
                  practicePlayerUnavailableReason !== undefined ||
                  linkStatus?.status === "expired"
                }
                onClick={() => {
                  void openPlayerQrCode();
                }}
                title={practicePlayerUnavailableReason}
                type="button"
              >
                {playerAction === "qr" ? "Preparing QR code…" : "Player QR code"}
              </button>
              {linkStatus?.status === "expired" ? (
                <button
                  className="button button--secondary"
                  disabled={
                    busy || playerAction !== null || practicePlayerUnavailableReason !== undefined
                  }
                  onClick={() => {
                    void renewPracticePlayerLink();
                  }}
                  title={practicePlayerUnavailableReason}
                  type="button"
                >
                  {playerAction === "renew" ? "Generating link…" : "Renew player link"}
                </button>
              ) : null}
              <button
                className="button button--secondary"
                onClick={() => {
                  setPrintDialogOpen(true);
                }}
                type="button"
              >
                Print &amp; Copy
              </button>
              {practicePlayerUnavailableReason ? (
                <p className="field-help set-list-player-help">{practicePlayerUnavailableReason}</p>
              ) : linkStatusError || !linkStatus?.expiresAt ? (
                <p className="field-help set-list-player-help">
                  {linkStatusError ?? formatPracticePlayerExpiration(linkStatus)}
                </p>
              ) : (
                <span
                  className="set-list-player-expiration"
                  tabIndex={0}
                  aria-describedby="set-list-player-expiration-detail"
                  data-dismissed={expirationHintDismissed}
                  onFocus={() => {
                    setExpirationHintDismissed(false);
                  }}
                  onMouseEnter={() => {
                    setExpirationHintDismissed(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setExpirationHintDismissed(true);
                  }}
                >
                  {formatPracticePlayerExpiration(linkStatus, undefined, "date")}
                  <span
                    className="set-list-player-expiration__detail"
                    id="set-list-player-expiration-detail"
                    role="tooltip"
                  >
                    {formatPracticePlayerExpiration(linkStatus)}
                  </span>
                </span>
              )}
            </div>
          </>
        ) : null}
      </div>
      {/* The status strip always renders so autosave messages cannot shift the
       * layout; the list below stays put while saving. */}
      <div aria-live="polite" className="set-list-save-status">
        {error ? (
          <p
            className="set-list-save-status__message set-list-save-status__message--error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {message ? (
          <p
            className="set-list-save-status__message set-list-save-status__message--success"
            role="status"
          >
            {message}
          </p>
        ) : null}
      </div>
      {!loaded ? <p>Loading set lists…</p> : null}
      {loaded && performances.length === 0 ? (
        <div className="empty-state">
          <h2>Create an event first</h2>
          <p>Set lists belong to active Performance events.</p>
          <div className="button-row">
            <AppLink
              className="button button--primary"
              href="/admin/events?action=create&type=Performance&returnTo=/admin/setlists"
              onNavigate={
                navigate ??
                ((href) => {
                  window.location.assign(href);
                })
              }
            >
              Create an event
            </AppLink>
          </div>
        </div>
      ) : null}
      {selectedEvent ? (
        <div className="set-list-layout">
          <div className="set-list-toolbar">
            <label className="field">
              <span className="set-list-field-label">Select event</span>
              <select
                disabled={busy}
                value={selectedEventId}
                onChange={(event) => {
                  const nextEvent = performances.find(({ id }) => id === event.target.value);
                  setSelectedEventId(nextEvent?.id ?? "");
                  setItems(normalizeItems(nextEvent?.setList ?? []));
                  setApproved(nextEvent?.setListApproved ?? false);
                  setDefaultTransitionSeconds(nextEvent?.setListDefaultTransitionSeconds ?? 0);
                  setDirty(false);
                  setMusicQuery("");
                  setCopyEventId("");
                  setError(null);
                  setMessage(null);
                }}
              >
                {performances.map((performance) => (
                  <option key={performance.id} value={performance.id}>
                    {displayEvent(performance)}
                  </option>
                ))}
              </select>
            </label>
            <div className="set-list-copy-row">
              <label className="field">
                <span className="set-list-field-label">Copy from previous</span>
                <select
                  value={copyEventId}
                  onChange={(event) => {
                    setCopyEventId(event.target.value);
                  }}
                >
                  <option value="">Choose another Performance…</option>
                  {performances
                    .filter(({ id }) => id !== selectedEvent.id)
                    .map((performance) => (
                      <option key={performance.id} value={performance.id}>
                        {displayEvent(performance)}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="button button--secondary button--control-height"
                disabled={!copyEventId}
                type="button"
                onClick={copyMissingItems}
              >
                Copy items
              </button>
            </div>
            <label className="set-list-visibility checkbox-field">
              <input
                checked={approved}
                type="checkbox"
                onChange={(event) => {
                  setApproved(event.target.checked);
                  markDraftDirty();
                }}
              />
              <span>
                <strong>Approved for {performerLabelPlural.toLowerCase()}</strong>
                <small>Members can see this set list.</small>
              </span>
            </label>
            <label className="set-list-visibility checkbox-field">
              <input
                checked={showNotes}
                type="checkbox"
                onChange={(event) => {
                  setShowNotes(event.target.checked);
                }}
              />
              <span>
                <strong>Show announcer notes</strong>
                <small>Display piece notes for the emcee.</small>
              </span>
            </label>
            <div className="set-list-transition-control">
              <label className="field" htmlFor="set-list-transition-seconds">
                <span className="set-list-field-label">Between songs</span>
              </label>
              <div className="set-list-inline-control">
                <NumberInput
                  aria-describedby="set-list-transition-help"
                  disabled={busy}
                  id="set-list-transition-seconds"
                  max={3600}
                  min={0}
                  value={defaultTransitionSeconds}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    updateDefaultTransitionSeconds(Number.isNaN(parsed) ? 0 : parsed);
                  }}
                />
                <span className="set-list-unit">seconds</span>
              </div>
            </div>
            <div className="set-list-transition-help">
              <small className="field-help" id="set-list-transition-help">
                Between songs, except within a work or around custom entries.
              </small>
              <details className="set-list-help-disclosure">
                <summary aria-label="About between-song time" title="About between-song time">
                  ⓘ
                </summary>
                <p className="field-help">
                  Applied between consecutive songs, except movements of the same work or when a
                  Custom entry is placed between them.
                </p>
              </details>
            </div>
          </div>

          <div className="set-list-add-panel">
            <div className="set-list-add-bar">
              <div className="field set-list-music-search">
                <label className="sr-only" htmlFor="set-list-music-search">
                  Search music library or enter a title
                </label>
                <input
                  aria-controls="set-list-music-results"
                  aria-expanded={Boolean(musicQuery.trim())}
                  aria-autocomplete="list"
                  id="set-list-music-search"
                  onChange={(event) => {
                    setMusicQuery(event.target.value);
                  }}
                  placeholder="Search music library or enter a title…"
                  type="search"
                  value={musicQuery}
                />
                {musicQuery.trim() ? (
                  <div
                    aria-label="Matching music"
                    className="set-list-music-results"
                    id="set-list-music-results"
                    role="listbox"
                  >
                    {filteredMusic.length > 0 ? (
                      filteredMusic.slice(0, 50).map((piece) => {
                        const parentPiece = piece.parentId
                          ? musicById.get(piece.parentId)
                          : undefined;
                        const childCount = piece.parentId
                          ? 0
                          : (childCountByParentId.get(piece.id) ?? 0);
                        return (
                          <button
                            className="set-list-music-result"
                            key={piece.id}
                            onClick={() => {
                              addMusicPiece(piece);
                            }}
                            role="option"
                            type="button"
                          >
                            <strong>{piece.parentId ? `↳ ${piece.title}` : piece.title}</strong>
                            {parentPiece ? (
                              <span className="set-list-music-result__parent">
                                Movement of {parentPiece.title}
                              </span>
                            ) : null}
                            {childCount > 0 ? (
                              <span className="set-list-music-result__movement-count">
                                {String(childCount)} {childCount === 1 ? "movement" : "movements"}
                              </span>
                            ) : null}
                            <span>
                              {setListBuilderCredit(piece.composer, piece.arranger) ??
                                "Composer not listed"}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <p className="set-list-music-results__empty">No matching music pieces.</p>
                    )}
                  </div>
                ) : null}
              </div>
              <label className="field set-list-duration-input">
                <span className="sr-only">Duration</span>
                <input
                  onChange={(event) => {
                    setCustomDuration(event.target.value);
                  }}
                  placeholder="Duration"
                  type="text"
                  value={customDuration}
                />
              </label>
              <div className="set-list-add-actions">
                <button
                  className="button button--primary button--small button--control-height"
                  type="button"
                  onClick={() => {
                    openCustomItem(musicQuery.trim(), customDuration.trim(), "song");
                  }}
                >
                  + Add new song
                </button>
                <button
                  className="button button--secondary button--small button--control-height"
                  type="button"
                  onClick={() => {
                    insertCustomItem(items.length);
                  }}
                >
                  + Insert Custom entry
                </button>
              </div>
            </div>
            <p className="field-help set-list-add-tip" aria-live="polite">
              {musicQuery.trim()
                ? `${String(filteredMusic.length)} matching piece${filteredMusic.length === 1 ? "" : "s"}${filteredMusic.length > 50 ? " · showing first 50" : ""} · Select a result or add a song.`
                : `${String(resources.music.length)} piece${resources.music.length === 1 ? "" : "s"} · Search to select, or add a song.`}{" "}
              Custom entries cover intermissions and other items.
            </p>
          </div>

          <div className="set-list-summary" aria-live="polite">
            <section className="set-list-summary__contents" aria-label="Set list summary">
              <h3>Set list</h3>
              <dl className="set-list-summary__breakdown">
                <div className="set-list-summary__counts">
                  <dt>Items</dt>{" "}
                  <dd>
                    <span>{items.length}</span>
                    <small>
                      {coverage.songsWithRecording}/{coverage.songCount} recorded
                      {coverage.songsMissingRecording > 0
                        ? ` · ${String(coverage.songsMissingRecording)} missing`
                        : ""}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Songs</dt> <dd>{formatSetListDuration(songsDuration)}</dd>
                </div>
                <div>
                  <dt>Custom entries</dt> <dd>{formatSetListDuration(intermissionsDuration)}</dd>
                </div>
                {defaultTransitionDuration > 0 ? (
                  <div>
                    <dt className="set-list-summary__transition-label">
                      <span>Between-song time</span>{" "}
                      <small>
                        {defaultTransitionCount} transition{defaultTransitionCount === 1 ? "" : "s"}{" "}
                        × {defaultTransitionSeconds} sec
                      </small>
                    </dt>{" "}
                    <dd>{formatSetListDuration(defaultTransitionDuration)}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
            <section className="set-list-summary__totals" aria-label="Set list timing">
              <h3>Timing</h3>
              <dl className="set-list-summary__timing">
                <div className="set-list-summary__estimated">
                  <dt>Estimated runtime</dt> <dd>{formatSetListDuration(estimatedRuntime)}</dd>
                </div>
                {selectedEvent.durationMinutes ? (
                  <>
                    <div>
                      <dt>Scheduled duration</dt>{" "}
                      <dd>{formatSetListDuration(selectedEvent.durationMinutes * 60)}</dd>
                    </div>
                    {estimatedRuntime <= selectedEvent.durationMinutes * 60 ? (
                      <div>
                        <dt>Remaining time</dt>{" "}
                        <dd>
                          {formatSetListDuration(
                            selectedEvent.durationMinutes * 60 - estimatedRuntime,
                          )}
                        </dd>
                      </div>
                    ) : (
                      <div className="set-list-summary__overage">
                        <dt>Over by</dt>{" "}
                        <dd>
                          {formatSetListDuration(
                            estimatedRuntime - selectedEvent.durationMinutes * 60,
                          )}
                        </dd>
                      </div>
                    )}
                  </>
                ) : null}
                {selectedEvent.startsAt && estimatedRuntime > 0 ? (
                  <div>
                    <dt>Estimated concert end</dt>{" "}
                    <dd>
                      {printTimeOnly(
                        new Date(
                          new Date(selectedEvent.startsAt).getTime() + estimatedRuntime * 1000,
                        ).toISOString(),
                      )}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          </div>
          {missingDurationCustomCount > 0 ? (
            <p className="notice notice--warning set-list-duration-warning" role="status">
              <strong>
                {missingDurationCustomCount === 1
                  ? "1 Custom entry has no duration and is not included in the estimated runtime."
                  : `${String(missingDurationCustomCount)} Custom entries have no duration and are not included in the estimated runtime.`}
              </strong>
            </p>
          ) : null}

          {items.length === 0 ? (
            <p className="empty-state">This Performance does not have set-list items yet.</p>
          ) : (
            <>
              <div className="set-list-reorder-help field-help">
                <span>Drag to reorder</span>
                <details className="set-list-help-disclosure">
                  <summary>Keyboard instructions</summary>
                  <p>
                    Focus an item's reorder handle and press Space or Enter to pick it up. Use the
                    arrow keys to move it, then press Space or Enter to drop; Escape cancels.
                  </p>
                </details>
              </div>
              <p className="sr-only" id="set-list-keyboard-reorder-help">
                Press Space or Enter to pick up this item. Use Arrow Up or Arrow Down to move it.
                Press Space or Enter to drop it, or Escape to cancel.
              </p>
              <ol
                className="set-list-items"
                aria-label="Ordered set-list items"
                id="set-list-items"
              >
                {presentation.flatMap((entry) => {
                  if (entry.kind === "intermission") {
                    return renderItemRow({ index: entry.flatIndex, item: entry.item });
                  }
                  if (entry.kind === "standalone") {
                    return renderItemRow({
                      index: entry.flatIndex,
                      item: entry.item,
                      parentWorkTitle: entry.parentPiece?.title,
                      programNumber: entry.programNumber,
                    });
                  }

                  const parentTitle = entry.parentItem?.title ?? entry.parentPiece.title;
                  // Keep every real row at the same React reconciliation depth, keyed by
                  // item ID, so regrouping never remounts a focused reorder handle.
                  return [
                    entry.parentItem && entry.parentFlatIndex !== undefined ? (
                      renderItemRow({
                        index: entry.parentFlatIndex,
                        item: entry.parentItem,
                        movementCount: entry.movements.length,
                        programNumber: entry.programNumber,
                      })
                    ) : (
                      <li
                        aria-label={`Grouped work: ${parentTitle}`}
                        className="set-list-group-header"
                        key={`group-header-${entry.parentPiece.id}-${String(entry.movements[0]?.item.id)}`}
                      >
                        <div className="set-list-group-header__content">
                          <strong className="set-list-item-position">
                            {String(entry.programNumber)}.
                          </strong>
                          <strong>{parentTitle}</strong>
                          <span className="set-list-item-type">
                            {String(entry.movements.length)}{" "}
                            {entry.movements.length === 1 ? "movement" : "movements"}
                          </span>
                          {entry.builderCredit ? (
                            <span className="set-list-group-header__credit">
                              · {entry.builderCredit}
                            </span>
                          ) : null}
                        </div>
                      </li>
                    ),
                    ...entry.movements.map((movement) =>
                      renderItemRow({
                        displayCredit: movement.builderCredit,
                        index: movement.flatIndex,
                        isMovement: true,
                        item: movement.item,
                        parentTitle,
                      }),
                    ),
                  ];
                })}
              </ol>
            </>
          )}

          <CustomItemDialog
            addCustomItem={addCustomItem}
            customComposer={customComposer}
            customDuration={customDuration}
            customNotes={customNotes}
            customTitle={customTitle}
            customType={customType}
            onClose={() => {
              setCustomDialogOpen(false);
            }}
            open={customDialogOpen}
            setCustomComposer={setCustomComposer}
            setCustomDuration={setCustomDuration}
            setCustomNotes={setCustomNotes}
            setCustomTitle={setCustomTitle}
            setCustomType={setCustomType}
          />

          <PrintPreviewDialog
            copyListText={copyListText}
            defaultTransitionSeconds={defaultTransitionSeconds}
            event={selectedEvent}
            items={items}
            music={resources.music}
            onClose={() => {
              setPrintDialogOpen(false);
            }}
            open={printDialogOpen}
            showNotes={showNotes}
            venues={resources.venues}
          />

          <PracticePlayerShareDialog
            event={selectedEvent}
            linkStatus={linkStatus}
            onClose={() => {
              setQrDialogOpen(false);
            }}
            onCopyLink={copyPracticePlayerLink}
            open={qrDialogOpen}
            url={qrUrl}
          />

          <EditItemDialog
            closeItemEditor={closeItemEditor}
            editingItem={editingItem}
            error={error}
            performerLabelPlural={performerLabelPlural}
            resources={resources}
            saveItemEdit={saveItemEdit}
            setEditingItem={setEditingItem}
          />

          <div className="set-list-save-row">
            <span className="field-help" role="status">
              {busy
                ? "Saving automatically…"
                : dirty
                  ? "Changes save automatically."
                  : "All changes saved."}
            </span>
            <label className="checkbox-field">
              <input
                checked={approved}
                type="checkbox"
                onChange={(event) => {
                  setApproved(event.target.checked);
                  markDraftDirty();
                }}
              />
              Set list approved for member use
            </label>
            <button
              className="button button--primary"
              disabled={busy || items.some((item) => !item.title.trim())}
              type="button"
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save now"}
            </button>
          </div>
        </div>
      ) : null}
      {selectedEvent ? (
        <SetListPrintView
          defaultTransitionSeconds={defaultTransitionSeconds}
          event={selectedEvent}
          items={items}
          music={resources.music}
          showNotes={showNotes}
          venues={resources.venues}
        />
      ) : null}
    </section>
  );
}
