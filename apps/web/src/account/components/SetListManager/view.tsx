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
  effectiveSetListItemComposer,
  effectiveSetListItemDuration,
  effectiveSetListItemNotes,
  itemType,
  normalizeItems,
  printTimeOnly,
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

function SetListItemSummaryText({
  composer,
  duration,
  isSong,
  itemNotes,
  recordingStatus,
}: {
  readonly composer: string | undefined;
  readonly duration: string | undefined;
  readonly isSong: boolean;
  readonly itemNotes: string;
  readonly recordingStatus: SetListItemRecordingStatus;
}) {
  const details = [composer, duration].filter(Boolean).join(" · ");
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

// eslint-disable-next-line complexity -- render composition preserves the existing screen's independent states and dialogs.
export function SetListManagerView({
  model,
  navigate,
}: {
  readonly model: SetListManagerModel;
  readonly navigate?: ((href: string) => void) | undefined;
}) {
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
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
    openPracticePlayer,
    performances,
    performerLabelPlural,
    playerBusy,
    resources,
    rotatePracticePlayer,
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
  return (
    <section className="account-section set-list-section" aria-label="Set list editor">
      <div className="section-heading section-heading--compact set-list-page-intro">
        {selectedEvent ? (
          <>
            <div className="button-row" aria-label="Set-list tools">
              <button
                className="button button--secondary"
                disabled={busy || playerBusy || practicePlayerUnavailableReason !== undefined}
                onClick={() => {
                  void openPracticePlayer();
                }}
                title={practicePlayerUnavailableReason}
                type="button"
              >
                {playerBusy ? "Opening player…" : "Practice Player"}
              </button>
              <button
                className="button button--secondary"
                disabled={busy || playerBusy || practicePlayerUnavailableReason !== undefined}
                onClick={() => {
                  void rotatePracticePlayer();
                }}
                title={practicePlayerUnavailableReason}
                type="button"
              >
                {playerBusy ? "Rotating link…" : "Rotate & copy link"}
              </button>
              <button
                className="button button--secondary"
                onClick={() => {
                  setPrintDialogOpen(true);
                }}
                type="button"
              >
                Print &amp; Copy
              </button>
            </div>
            {practicePlayerUnavailableReason ? (
              <p className="field-help set-list-player-help">{practicePlayerUnavailableReason}</p>
            ) : null}
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
                className="button button--secondary button--small"
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
                <span className="set-list-field-label">Default time between songs</span>
              </label>
              <div className="set-list-inline-control">
                <input
                  aria-describedby="set-list-transition-help"
                  disabled={busy}
                  id="set-list-transition-seconds"
                  max={3600}
                  min={0}
                  type="number"
                  value={defaultTransitionSeconds}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    updateDefaultTransitionSeconds(Number.isNaN(parsed) ? 0 : parsed);
                  }}
                />
                <span className="set-list-unit">seconds</span>
              </div>
              <small className="field-help" id="set-list-transition-help">
                Applied between consecutive songs unless a Custom entry is placed between them.
              </small>
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
                      filteredMusic.slice(0, 50).map((piece) => (
                        <button
                          className="set-list-music-result"
                          key={piece.id}
                          onClick={() => {
                            addMusicPiece(piece);
                          }}
                          role="option"
                          type="button"
                        >
                          <strong>{piece.title}</strong>
                          <span>{piece.composer || "Composer not listed"}</span>
                        </button>
                      ))
                    ) : (
                      <p className="set-list-music-results__empty">No matching music pieces.</p>
                    )}
                  </div>
                ) : null}
                <p className="field-help" aria-live="polite">
                  {musicQuery.trim()
                    ? `${String(filteredMusic.length)} matching piece${filteredMusic.length === 1 ? "" : "s"}${filteredMusic.length > 50 ? " · showing first 50" : ""}. Select a result to add it.`
                    : `${String(resources.music.length)} pieces available. Start typing to search.`}
                </p>
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
                  className="button button--primary button--small"
                  type="button"
                  onClick={() => {
                    openCustomItem(musicQuery.trim(), customDuration.trim(), "song");
                  }}
                >
                  + Add new song
                </button>
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => {
                    insertCustomItem(items.length);
                  }}
                >
                  + Insert Custom entry
                </button>
              </div>
            </div>
            <p className="field-help set-list-add-tip">
              Select an existing music piece from the suggestions, or add a new song. Use a Custom
              entry for an intermission or another item that is not in the library.
            </p>
          </div>

          <div className="set-list-summary" aria-live="polite">
            <div className="set-list-summary__breakdown">
              <span>
                <strong>Songs</strong> {formatSetListDuration(songsDuration)}
              </span>
              <span>
                <strong>Custom entries</strong> {formatSetListDuration(intermissionsDuration)}
              </span>
              {defaultTransitionDuration > 0 ? (
                <span>
                  <strong>Between-song time</strong>{" "}
                  {formatSetListDuration(defaultTransitionDuration)}
                  <small className="set-list-summary__subtext">
                    ({defaultTransitionCount} automatic transition
                    {defaultTransitionCount === 1 ? "" : "s"} × {defaultTransitionSeconds} sec)
                  </small>
                </span>
              ) : null}
              <span>
                <strong>Items</strong> {String(items.length)}
              </span>
              <span>
                <strong>Recordings</strong> {coverage.songsWithRecording} of {coverage.songCount}
                {coverage.songsMissingRecording > 0 ? (
                  <>
                    {" "}
                    <small className="set-list-summary__subtext">
                      ({coverage.songsMissingRecording} missing)
                    </small>
                  </>
                ) : null}
              </span>
            </div>
            <div className="set-list-summary__totals">
              <span className="set-list-summary__estimated">
                <strong>Estimated runtime</strong> {formatSetListDuration(estimatedRuntime)}
              </span>
              {selectedEvent.durationMinutes ? (
                <div className="set-list-summary__comparison">
                  <span>
                    <strong>Scheduled duration</strong>{" "}
                    {formatSetListDuration(selectedEvent.durationMinutes * 60)}
                  </span>
                  {estimatedRuntime <= selectedEvent.durationMinutes * 60 ? (
                    <span className="set-list-summary__remaining">
                      <strong>Remaining time</strong>{" "}
                      {formatSetListDuration(selectedEvent.durationMinutes * 60 - estimatedRuntime)}
                    </span>
                  ) : (
                    <span className="set-list-summary__overage">
                      <strong>Over by</strong>{" "}
                      {formatSetListDuration(estimatedRuntime - selectedEvent.durationMinutes * 60)}
                    </span>
                  )}
                </div>
              ) : null}
              {selectedEvent.startsAt && estimatedRuntime > 0 ? (
                <div className="set-list-summary__end-time">
                  <span>
                    <strong>Estimated concert end:</strong>{" "}
                    {printTimeOnly(
                      new Date(
                        new Date(selectedEvent.startsAt).getTime() + estimatedRuntime * 1000,
                      ).toISOString(),
                    )}
                  </span>
                </div>
              ) : null}
            </div>
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
              <p className="field-help" aria-live="polite">
                Drag an item to reorder it, or focus its reorder handle and press Space or Enter to
                pick it up. Use the arrow keys to move it, then press Space or Enter to drop; Escape
                cancels.
              </p>
              <p className="sr-only" id="set-list-keyboard-reorder-help">
                Press Space or Enter to pick up this item. Use Arrow Up or Arrow Down to move it.
                Press Space or Enter to drop it, or Escape to cancel.
              </p>
              <ol
                className="set-list-items"
                aria-label="Ordered set-list items"
                id="set-list-items"
              >
                {items.map((item, index) => {
                  const itemNotes = effectiveSetListItemNotes(item, resources.music);
                  const dropState = dropStateForItem(index, dragIndex, dragOverBoundary);
                  const keyboardDragging = keyboardDragIndex === index;
                  const itemDragging = setListItemIsDragging(index, dragIndex, keyboardDragIndex);
                  const recordingStatus = setListItemRecordingStatus(item, resources.music);
                  return (
                    <Fragment key={item.id}>
                      <li
                        className={`set-list-item${itemDragging ? " set-list-item--dragging" : ""}${item.type === "intermission" ? " set-list-item--intermission" : ""}${dropState.before ? " set-list-item--drop-before" : ""}${dropState.after ? " set-list-item--drop-after" : ""}${recentlyMovedItemId === item.id ? " set-list-item--moved" : ""}`}
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
                              aria-label={reorderHandleLabel(
                                item.title,
                                index,
                                items.length,
                                keyboardDragging,
                              )}
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
                            <strong className="set-list-item-position">{String(index + 1)}.</strong>
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
                            composer={effectiveSetListItemComposer(item, resources.music)}
                            duration={effectiveSetListItemDuration(item, resources.music)}
                            isSong={itemType(item) === "song"}
                            itemNotes={itemNotes}
                            recordingStatus={recordingStatus}
                          />
                          {item.isFeaturedNumber ? (
                            <span className="status-pill">Featured</span>
                          ) : null}
                        </div>
                        <SetListItemNotes notes={itemNotes} showNotes={showNotes} />
                      </li>
                      {index < items.length - 1 ? (
                        <li
                          className={`set-list-insert-zone${dropState.after ? " set-list-insert-zone--drop-target" : ""}`}
                          role="presentation"
                          onDragOver={(event) => {
                            if (dragIndex === null) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            setDragOverBoundary(index + 1);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            dropDraggedItem(index + 1);
                          }}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          {dropState.after ? (
                            <span className="set-list-insert-zone__drop-label" aria-hidden="true">
                              Drop item here
                            </span>
                          ) : null}
                          <button
                            aria-label={`Insert custom entry after ${String(index + 1)}. ${item.title}`}
                            className="set-list-insert-zone__button"
                            type="button"
                            onClick={() => {
                              insertCustomItem(index + 1);
                            }}
                          >
                            + Insert custom entry
                          </button>
                        </li>
                      ) : null}
                    </Fragment>
                  );
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
        />
      ) : null}
    </section>
  );
}
