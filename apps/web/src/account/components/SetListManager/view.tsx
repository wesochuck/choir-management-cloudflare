import {
  calculateSetListDuration,
  formatSetListDuration,
  moveSetListItem,
  normalizeSetListDuration,
  parseSetListDuration,
} from "@choir/domain";
import { Dialog } from "@choir/ui";
import { Fragment, useEffect, useRef, useState, type DragEvent } from "react";
import {
  displayEvent,
  durationFromSeconds,
  itemType,
  musicPieceForSetListItem,
  normalizeItems,
  setListHasLearningTrack,
} from "./utils";
import { SetListCreditEditor, SetListPreview, SetListPrintView } from "./shared";
import type { SetListManagerModel } from "./hooks";

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

// eslint-disable-next-line complexity -- render composition preserves the existing screen's independent states and dialogs.
export function SetListManagerView({ model }: { readonly model: SetListManagerModel }) {
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [dragOverBoundary, setDragOverBoundary] = useState<number | null>(null);
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
    dirty,
    dragIndex,
    editingItem,
    enabled,
    error,
    filteredMusic,
    intermissionsDuration,
    insertCustomItem,
    items,
    loaded,
    markDraftDirty,
    message,
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
    setDirty,
    setDragIndex,
    setEditingItem,
    setError,
    setItems,
    setMessage,
    setMusicQuery,
    setSelectedEventId,
    songsDuration,
    updateDraftItems,
  } = model;
  if (!enabled) return null;
  const practicePlayerUnavailableReason = !approved
    ? "Approve this set list before opening the Practice Player."
    : !setListHasLearningTrack(items, resources.music)
      ? "Add at least one learning track to a set-list piece before opening the Practice Player."
      : undefined;
  const linkedMusicPiece = editingItem
    ? musicPieceForSetListItem(editingItem, resources.music)
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

  function moveItemWithFeedback(index: number, direction: -1 | 1): void {
    const moved = items[index];
    const targetIndex = index + direction;
    if (!moved || targetIndex < 0 || targetIndex >= items.length) return;
    updateDraftItems((current) => [...moveSetListItem(current, index, direction)]);
    if (moved.id) flashMovedItem(moved.id);
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
  const editingItemIsLinked = Boolean(editingItem?.pieceId);
  const editingTitle = linkedMusicPiece?.title ?? editingItem?.title ?? "";
  const editingComposer = linkedMusicPiece?.composer ?? editingItem?.composer ?? "";
  const editingDuration = linkedMusicPiece
    ? (durationFromSeconds(linkedMusicPiece.durationSeconds) ?? "")
    : (editingItem?.duration ?? "");
  const linkedMusicHref = linkedMusicPiece
    ? `/admin/library?pieceId=${encodeURIComponent(linkedMusicPiece.id)}`
    : null;
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
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="notice notice--success" role="status">
            {message}
          </p>
        ) : null}
      </div>
      {!loaded ? <p>Loading set lists…</p> : null}
      {loaded && performances.length === 0 ? (
        <p className="empty-state">Create a Performance before building a set list.</p>
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
            <span>
              <strong>Songs</strong> {formatSetListDuration(songsDuration)}
            </span>
            <span>
              <strong>Custom entries</strong> {formatSetListDuration(intermissionsDuration)}
            </span>
            <span>
              <strong>Items</strong> {String(items.length)}
            </span>
            <span className="set-list-summary__total">
              <strong>Total</strong> {formatSetListDuration(calculateSetListDuration(items))}
            </span>
          </div>

          {items.length === 0 ? (
            <p className="empty-state">This Performance does not have set-list items yet.</p>
          ) : (
            <>
              <p className="field-help" aria-live="polite">
                Drag an item to reorder it, or use Move up and Move down for keyboard control.
              </p>
              <ol className="set-list-items" aria-label="Ordered set-list items">
                {items.map((item, index) => {
                  const dropState = dropStateForItem(index, dragIndex, dragOverBoundary);
                  return (
                    <Fragment key={item.id}>
                      <li
                        className={`set-list-item${dragIndex === index ? " set-list-item--dragging" : ""}${item.type === "intermission" ? " set-list-item--intermission" : ""}${dropState.before ? " set-list-item--drop-before" : ""}${dropState.after ? " set-list-item--drop-after" : ""}${recentlyMovedItemId === item.id ? " set-list-item--moved" : ""}`}
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
                            setDragIndex(null);
                            setDragOverBoundary(null);
                          }
                        }}
                        onPointerDown={(event) => {
                          if (event.pointerType === "touch") {
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
                            <span
                              className="set-list-drag-handle"
                              aria-hidden="true"
                              title="Drag to reorder"
                            />
                            {item.type === "intermission" ? (
                              <span className="set-list-item-type">Custom entry</span>
                            ) : null}
                            <strong>
                              {String(index + 1)}. {item.title}
                            </strong>
                          </div>
                          <div className="button-row set-list-item-actions">
                            <button
                              className="text-button"
                              type="button"
                              onClick={() => {
                                openItemEditor(index);
                              }}
                            >
                              Set list details
                            </button>
                            {item.pieceId &&
                            resources.music.some(
                              (piece) =>
                                (piece.id === item.pieceId || piece.parentId === item.pieceId) &&
                                Object.keys(piece.trackFileIds).length > 0,
                            ) ? (
                              <a
                                className="text-button"
                                href={`/practice?pieceId=${encodeURIComponent(item.pieceId)}`}
                              >
                                Play
                              </a>
                            ) : null}
                            <button
                              aria-label={`Move ${item.title} up`}
                              className="text-button"
                              disabled={index === 0}
                              type="button"
                              onClick={() => {
                                moveItemWithFeedback(index, -1);
                              }}
                            >
                              Move up
                            </button>
                            <button
                              aria-label={`Move ${item.title} down`}
                              className="text-button"
                              disabled={index === items.length - 1}
                              type="button"
                              onClick={() => {
                                moveItemWithFeedback(index, 1);
                              }}
                            >
                              Move down
                            </button>
                            <button
                              className="text-button text-button--danger"
                              type="button"
                              onClick={() => {
                                updateDraftItems((current) =>
                                  current.filter((_, itemIndex) => itemIndex !== index),
                                );
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        <div className="set-list-item-summary">
                          <span>
                            {[item.composer, normalizeSetListDuration(item.duration)]
                              .filter(Boolean)
                              .join(" · ") ||
                              (item.notes ? "Notes added" : "No additional details")}
                          </span>
                          {item.isFeaturedNumber ? (
                            <span className="status-pill">Featured</span>
                          ) : null}
                        </div>
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

          <Dialog
            description="Add a song or Custom entry to this Performance without expanding the editor."
            onClose={() => {
              setCustomDialogOpen(false);
            }}
            open={customDialogOpen}
            title="Add custom set-list item"
          >
            <form
              className="form-stack set-list-item-dialog"
              onSubmit={(event) => {
                event.preventDefault();
                addCustomItem();
              }}
            >
              {error ? (
                <p className="notice notice--error" role="alert">
                  {error}
                </p>
              ) : null}
              <label className="field">
                Type
                <select
                  value={customType}
                  onChange={(event) => {
                    const nextType =
                      event.target.value === "intermission" ? "intermission" : "song";
                    setCustomType(nextType);
                    if (nextType === "intermission" && !customTitle.trim()) {
                      setCustomTitle("Intermission");
                    }
                  }}
                >
                  <option value="song">Song</option>
                  <option value="intermission">Custom entry</option>
                </select>
              </label>
              <label className="field">
                Title
                <input
                  autoFocus
                  maxLength={300}
                  required
                  value={customTitle}
                  onChange={(event) => {
                    setCustomTitle(event.target.value);
                  }}
                />
              </label>
              {customType === "song" ? (
                <label className="field">
                  Composer
                  <input
                    maxLength={300}
                    value={customComposer}
                    onChange={(event) => {
                      setCustomComposer(event.target.value);
                    }}
                  />
                </label>
              ) : null}
              <label className="field">
                Duration
                <input
                  maxLength={20}
                  placeholder="4:05"
                  value={customDuration}
                  onChange={(event) => {
                    setCustomDuration(event.target.value);
                  }}
                />
              </label>
              <label className="field">
                Notes
                <textarea
                  maxLength={10_000}
                  rows={3}
                  value={customNotes}
                  onChange={(event) => {
                    setCustomNotes(event.target.value);
                  }}
                />
              </label>
              <div className="dialog__actions">
                <button
                  className="button button--secondary"
                  onClick={() => {
                    setCustomDialogOpen(false);
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button className="button button--primary" type="submit">
                  Add item
                </button>
              </div>
            </form>
          </Dialog>

          <Dialog
            description={`Update the item details and ${performerLabelPlural.toLowerCase()} assignments, then close when finished.`}
            onClose={closeItemEditor}
            open={editingItem !== null}
            title="Edit set-list item"
          >
            {editingItem ? (
              <form
                className="form-stack set-list-item-dialog"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveItemEdit();
                }}
              >
                {error ? (
                  <p className="notice notice--error" role="alert">
                    {error}
                  </p>
                ) : null}
                {editingItemIsLinked ? (
                  <section
                    aria-label="Linked music library piece"
                    className={`set-list-linked-piece${linkedMusicPiece ? "" : " set-list-linked-piece--missing"}`}
                  >
                    <div>
                      <p className="eyebrow">Music library piece</p>
                      <strong>{linkedMusicPiece?.title ?? editingItem.title}</strong>
                      <p className="field-help">
                        {linkedMusicPiece
                          ? "Title, composer, and duration are managed in the music library."
                          : "This library piece is no longer available. Remove it or add a replacement from the music library."}
                      </p>
                    </div>
                    {linkedMusicHref ? (
                      <a className="button button--secondary button--small" href={linkedMusicHref}>
                        Edit in music library
                      </a>
                    ) : null}
                  </section>
                ) : null}
                <label className="field">
                  Title
                  <input
                    autoFocus={!editingItemIsLinked}
                    maxLength={300}
                    required
                    readOnly={editingItemIsLinked}
                    value={editingTitle}
                    onChange={(event) => {
                      if (!editingItemIsLinked) {
                        setEditingItem({ ...editingItem, title: event.target.value });
                      }
                    }}
                  />
                </label>
                {itemType(editingItem) === "song" ? (
                  <label className="field">
                    Composer
                    <input
                      readOnly={editingItemIsLinked}
                      maxLength={300}
                      value={editingComposer}
                      onChange={(event) => {
                        if (!editingItemIsLinked) {
                          setEditingItem({ ...editingItem, composer: event.target.value });
                        }
                      }}
                    />
                  </label>
                ) : null}
                <label className="field">
                  Duration
                  <input
                    aria-invalid={
                      Boolean(editingItem.duration) &&
                      parseSetListDuration(editingItem.duration) === null
                    }
                    maxLength={20}
                    readOnly={editingItemIsLinked}
                    value={editingDuration}
                    onChange={(event) => {
                      if (!editingItemIsLinked) {
                        setEditingItem({ ...editingItem, duration: event.target.value });
                      }
                    }}
                  />
                </label>
                <label className="field">
                  Notes
                  <textarea
                    maxLength={10_000}
                    rows={3}
                    value={editingItem.notes ?? ""}
                    onChange={(event) => {
                      setEditingItem({ ...editingItem, notes: event.target.value });
                    }}
                  />
                </label>
                {itemType(editingItem) === "song" ? (
                  <label className="checkbox-field">
                    <input
                      checked={editingItem.isFeaturedNumber ?? editingItem.soloSmallGroup ?? false}
                      type="checkbox"
                      onChange={(event) => {
                        const isFeaturedNumber = event.target.checked;
                        const updated = { ...editingItem, isFeaturedNumber };
                        delete updated.soloSmallGroup;
                        if (!isFeaturedNumber) updated.performerCredits = [];
                        setEditingItem(updated);
                      }}
                    />
                    Featured number
                  </label>
                ) : null}
                {itemType(editingItem) === "song" && editingItem.isFeaturedNumber ? (
                  <SetListCreditEditor
                    item={editingItem}
                    profiles={resources.profiles}
                    onChange={setEditingItem}
                  />
                ) : null}
                <div className="dialog__actions">
                  <button
                    className="button button--secondary"
                    onClick={closeItemEditor}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button className="button button--primary" type="submit">
                    Save item
                  </button>
                </div>
              </form>
            ) : null}
          </Dialog>

          <Dialog
            onClose={() => {
              setPrintDialogOpen(false);
            }}
            open={printDialogOpen}
            title="Printable Set List"
          >
            <div className="set-list-preview-dialog">
              <SetListPreview event={selectedEvent} items={items} music={resources.music} />
              <div className="dialog__actions">
                <button
                  className="button button--secondary"
                  onClick={() => {
                    setPrintDialogOpen(false);
                  }}
                  type="button"
                >
                  Close
                </button>
                <button
                  className="button button--secondary"
                  onClick={() => {
                    void copyListText();
                  }}
                  type="button"
                >
                  Copy Plain Text
                </button>
                <button
                  className="button button--primary"
                  onClick={() => {
                    setPrintDialogOpen(false);
                    window.setTimeout(() => {
                      window.print();
                    }, 0);
                  }}
                  type="button"
                >
                  Print List
                </button>
              </div>
            </div>
          </Dialog>

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
        <SetListPrintView event={selectedEvent} items={items} music={resources.music} />
      ) : null}
    </section>
  );
}
