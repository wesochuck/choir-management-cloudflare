import { NumberInput } from "@choir/ui";
import { formatSetListDuration } from "@choir/domain";
import { useMemo, useState } from "react";
import {
  displayEvent,
  formatPracticePlayerExpiration,
  groupSetListForPresentation,
  normalizeItems,
  printTimeOnly,
  setListBuilderCredit,
  setListHasLearningTrack,
  setListRecordingCoverage,
} from "./utils";
import { SetListPrintView } from "./shared";
import type { SetListItem } from "./types";
import type { SetListManagerModel } from "./hooks";
import { CustomItemDialog } from "./dialogs/CustomItemDialog";
import { EditItemDialog } from "./dialogs/EditItemDialog";
import { PracticePlayerShareDialog } from "./dialogs/PracticePlayerShareDialog";
import { PrintPreviewDialog } from "./dialogs/PrintPreviewDialog";
import { AppLink } from "../AuthenticatedShell/navigation";
import { SetListSetupGuide } from "./SetListSetupGuide";

import { SetListItemRow, SetListItemSummaryText } from "./SetListItemRow";
import { useSetListReorder } from "./useSetListReorder";

export { SetListItemSummaryText };

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
    customCueInstruction,
    customCueKind,
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
    quickCueCount,
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
    setCustomCueInstruction,
    setCustomCueKind,
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
  const reorder = useSetListReorder({
    dragIndex,
    items,
    moveDraggedItem,
    setDragIndex,
    setMessage,
    updateDraftItems,
  });
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
    return (
      <SetListItemRow
        displayCredit={displayCredit}
        dragIndex={dragIndex}
        dragOverBoundary={reorder.dragOverBoundary}
        index={index}
        isMovement={isMovement}
        item={item}
        itemsLength={items.length}
        key={item.id}
        keyboardDragIndex={reorder.keyboardDragIndex}
        movementCount={movementCount}
        music={resources.music}
        onDropDraggedItem={reorder.dropDraggedItem}
        onInsertCustom={insertCustomItem}
        onKeyboardReorderKeyDown={reorder.handleKeyboardReorderKeyDown}
        onOpenItemEditor={openItemEditor}
        onRemoveItem={(itemIndex) => {
          updateDraftItems((current) => current.filter((_, idx) => idx !== itemIndex));
        }}
        onRowDragEnd={reorder.handleRowDragEnd}
        onRowDragOver={reorder.handleRowDragOver}
        onRowDragStart={reorder.handleRowDragStart}
        onRowDrop={reorder.handleRowDrop}
        onRowPointerCancel={reorder.handleRowPointerCancel}
        onRowPointerDown={reorder.handleRowPointerDown}
        onRowPointerUp={reorder.handleRowPointerUp}
        onSetDragOverBoundary={reorder.setDragOverBoundary}
        parentTitle={parentTitle}
        parentWorkTitle={parentWorkTitle}
        programNumber={programNumber}
        recentlyMovedItemId={reorder.recentlyMovedItemId}
        showNotes={showNotes}
      />
    );
  }

  return (
    <section className="account-section set-list-section" aria-label="Set list editor">
      <SetListSetupGuide
        busy={busy}
        dirty={dirty}
        navigate={navigate}
        onSave={save}
        selectedEventId={selectedEventId}
      />
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
              Create Performance
            </AppLink>
          </div>
        </div>
      ) : null}
      {performances.length > 0 ? (
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
                {!selectedEvent ? <option value="">Choose a Performance…</option> : null}
                {performances.map((performance) => (
                  <option
                    key={performance.id}
                    title={displayEvent(performance)}
                    value={performance.id}
                  >
                    {displayEvent(performance)}
                  </option>
                ))}
              </select>
            </label>
            {selectedEvent ? (
              <>
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
                          <option
                            key={performance.id}
                            title={displayEvent(performance)}
                            value={performance.id}
                          >
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
                      Applied between consecutive songs; omitted within a work or around custom
                      entries.
                    </p>
                  </details>
                </div>
              </>
            ) : null}
          </div>

          {!selectedEvent ? (
            <div className="empty-state">
              <p>Select a performance above to view or edit its set list.</p>
            </div>
          ) : (
            <>
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
                                    {String(childCount)}{" "}
                                    {childCount === 1 ? "movement" : "movements"}
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
                      <dt>Custom entries</dt>{" "}
                      <dd>{formatSetListDuration(intermissionsDuration)}</dd>
                    </div>
                    {quickCueCount > 0 ? (
                      <div>
                        <dt>Quick cues</dt> <dd>{quickCueCount}</dd>
                      </div>
                    ) : null}
                    {defaultTransitionDuration > 0 ? (
                      <div>
                        <dt className="set-list-summary__transition-label">
                          <span>Between-song time</span>{" "}
                          <small>
                            {defaultTransitionCount} transition
                            {defaultTransitionCount === 1 ? "" : "s"} × {defaultTransitionSeconds}{" "}
                            sec
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
                      <p>Space/Enter: pick up or drop · ↑/↓: move · Esc: cancel.</p>
                    </details>
                  </div>
                  <p className="sr-only" id="set-list-keyboard-reorder-help">
                    Press Space or Enter to pick up this item. Use Arrow Up or Arrow Down to move
                    it. Press Space or Enter to drop it, or Escape to cancel.
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
                customCueInstruction={customCueInstruction}
                customCueKind={customCueKind}
                customDuration={customDuration}
                customNotes={customNotes}
                customTitle={customTitle}
                customType={customType}
                onClose={() => {
                  setCustomDialogOpen(false);
                }}
                open={customDialogOpen}
                setCustomComposer={setCustomComposer}
                setCustomCueInstruction={setCustomCueInstruction}
                setCustomCueKind={setCustomCueKind}
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
            </>
          )}
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
