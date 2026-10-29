import { InlinePracticeTrackPlayer } from "../../InlinePracticeTrackPlayer";
import type { SetListManagerModel } from "./hooks";
import { SetListInsertZone } from "./SetListInsertZone";
import type { SetListItem } from "./types";
import { dropStateForItem, reorderHandleLabel, setListItemIsDragging } from "./useSetListReorder";
import {
  effectiveSetListItemArranger,
  effectiveSetListItemComposer,
  effectiveSetListItemDuration,
  effectiveSetListItemNotes,
  itemType,
  setListBuilderCredit,
  setListItemRecordingStatus,
  type SetListItemRecordingStatus,
} from "./utils";
import type { DragEvent, KeyboardEvent, PointerEvent } from "react";

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
}: {
  readonly arranger?: string | undefined;
  readonly composer: string | undefined;
  readonly displayCredit?: string | undefined;
  readonly duration: string | undefined;
  readonly isSong: boolean;
  readonly itemNotes: string;
  readonly movementCount?: number | undefined;
  readonly parentWorkTitle?: string | undefined;
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
      {!hasDetails && (itemNotes ? "Notes added" : "No additional details")}
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
          measurement={recordingStatus.track.measurement}
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

function buildItemRowClassName({
  dropAfter,
  dropBefore,
  isDragging,
  isIntermission,
  isMovement,
  isParent,
  isQuickCue,
  isRecentlyMoved,
}: {
  readonly dropAfter: boolean;
  readonly dropBefore: boolean;
  readonly isDragging: boolean;
  readonly isIntermission: boolean;
  readonly isMovement: boolean;
  readonly isParent: boolean;
  readonly isQuickCue?: boolean | undefined;
  readonly isRecentlyMoved: boolean;
}): string {
  const classes = ["set-list-item"];
  if (isMovement) classes.push("set-list-item--movement");
  if (isParent) classes.push("set-list-item--group-parent");
  if (isDragging) classes.push("set-list-item--dragging");
  if (isIntermission) classes.push("set-list-item--intermission");
  if (isQuickCue) classes.push("set-list-item--quick-cue");
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

function QuickCueRowContent({
  index,
  item,
  keyboardDragging,
  onKeyboardReorderKeyDown,
  onOpenItemEditor,
  onRemoveItem,
  totalItems,
}: {
  readonly index: number;
  readonly item: SetListItem;
  readonly keyboardDragging: boolean;
  readonly onKeyboardReorderKeyDown: (
    index: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => void;
  readonly onOpenItemEditor: (index: number) => void;
  readonly onRemoveItem: (index: number) => void;
  readonly totalItems: number;
}) {
  return (
    <div className="set-list-item-heading set-list-item-heading--quick-cue">
      <div className="set-list-item-title set-list-item-title--quick-cue">
        <button
          aria-controls="set-list-items"
          aria-describedby="set-list-keyboard-reorder-help"
          aria-label={reorderHandleLabel(item.title, index, totalItems, keyboardDragging)}
          aria-pressed={keyboardDragging}
          className="set-list-drag-handle"
          onKeyDown={(event) => {
            onKeyboardReorderKeyDown(index, event);
          }}
          title="Drag to reorder, or press Space or Enter for keyboard control"
          type="button"
        >
          <span aria-hidden="true" />
        </button>
        <span aria-hidden="true" className="set-list-item-movement-indicator">
          ↳
        </span>
        <strong>{item.title}</strong>
        <span className="set-list-item-type set-list-item-type--quick-cue">Quick cue</span>
        {item.cueInstruction ? (
          <span className="set-list-item-instruction">{item.cueInstruction}</span>
        ) : null}
      </div>
      <div className="set-list-item-actions set-list-item-actions--quick-cue">
        <span className="set-list-item-duration">0:00</span>
        <button
          className="text-button"
          type="button"
          onClick={() => {
            onOpenItemEditor(index);
          }}
        >
          Edit
        </button>
        <button
          className="text-button text-button--danger"
          type="button"
          onClick={() => {
            onRemoveItem(index);
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export interface SetListItemRowProps {
  readonly canInsertCustomEntryAfter?: boolean | undefined;
  readonly displayCredit?: string | undefined;
  readonly dragIndex: number | null;
  readonly dragOverBoundary: number | null;
  readonly index: number;
  readonly isMovement?: boolean;
  readonly item: SetListItem;
  readonly itemsLength: number;
  readonly keyboardDragIndex: number | null;
  readonly movementCount?: number | undefined;
  readonly music: SetListManagerModel["resources"]["music"];
  readonly onDropDraggedItem: (boundary: number) => void;
  readonly onInsertMusic?: ((index: number) => void) | undefined;
  readonly onInsertCustom: (index: number) => void;
  readonly onKeyboardReorderKeyDown: (
    index: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => void;
  readonly onOpenItemEditor: (index: number) => void;
  readonly onRemoveItem: (index: number) => void;
  readonly onRowDragEnd: () => void;
  readonly onRowDragOver: (index: number, event: DragEvent<HTMLElement>) => void;
  readonly onRowDragStart: (index: number) => void;
  readonly onRowDrop: (index: number, event: DragEvent<HTMLElement>) => void;
  readonly onRowPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  readonly onRowPointerDown: (index: number, event: PointerEvent<HTMLElement>) => void;
  readonly onRowPointerUp: (index: number, event: PointerEvent<HTMLElement>) => void;
  readonly onSetDragOverBoundary: (boundary: number | null) => void;
  readonly parentTitle?: string | undefined;
  readonly parentWorkTitle?: string | undefined;
  readonly programNumber?: number | undefined;
  readonly recentlyMovedItemId: string | null;
  readonly showNotes: boolean;
}

export function SetListItemRow({
  canInsertCustomEntryAfter,
  displayCredit,
  dragIndex,
  dragOverBoundary,
  index,
  isMovement = false,
  item,
  itemsLength,
  keyboardDragIndex,
  movementCount,
  music,
  onDropDraggedItem,
  onInsertMusic,
  onInsertCustom,
  onKeyboardReorderKeyDown,
  onOpenItemEditor,
  onRemoveItem,
  onRowDragEnd,
  onRowDragOver,
  onRowDragStart,
  onRowDrop,
  onRowPointerCancel,
  onRowPointerDown,
  onRowPointerUp,
  onSetDragOverBoundary,
  parentTitle,
  parentWorkTitle,
  programNumber,
  recentlyMovedItemId,
  showNotes,
}: SetListItemRowProps) {
  const itemNotes = effectiveSetListItemNotes(item, music);
  const dropState = dropStateForItem(index, dragIndex, dragOverBoundary);
  const keyboardDragging = keyboardDragIndex === index;
  const itemDragging = setListItemIsDragging(index, dragIndex, keyboardDragIndex);
  const recordingStatus = setListItemRecordingStatus(item, music);

  const isQuickCue = item.type === "intermission" && item.cueKind === "quick";
  const className = buildItemRowClassName({
    dropAfter: dropState.after,
    dropBefore: dropState.before,
    isDragging: itemDragging,
    isIntermission: item.type === "intermission",
    isMovement,
    isParent: movementCount !== undefined,
    isQuickCue,
    isRecentlyMoved: recentlyMovedItemId === item.id,
  });
  const ariaLabel =
    isMovement && parentTitle ? `Movement: ${item.title} of ${parentTitle}` : undefined;

  return (
    <>
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
          onOpenItemEditor(index);
        }}
        onDragEnd={onRowDragEnd}
        onDragOver={(event) => {
          onRowDragOver(index, event);
        }}
        onDragStart={() => {
          onRowDragStart(index);
        }}
        onDrop={(event) => {
          onRowDrop(index, event);
        }}
        onPointerCancel={onRowPointerCancel}
        onPointerDown={(event) => {
          onRowPointerDown(index, event);
        }}
        onPointerUp={(event) => {
          onRowPointerUp(index, event);
        }}
      >
        {isQuickCue ? (
          <QuickCueRowContent
            index={index}
            item={item}
            keyboardDragging={keyboardDragging}
            onKeyboardReorderKeyDown={onKeyboardReorderKeyDown}
            onOpenItemEditor={onOpenItemEditor}
            onRemoveItem={onRemoveItem}
            totalItems={itemsLength}
          />
        ) : (
          <>
            <div className="set-list-item-heading">
              <div className="set-list-item-title">
                <button
                  aria-controls="set-list-items"
                  aria-describedby="set-list-keyboard-reorder-help"
                  aria-label={reorderHandleLabel(item.title, index, itemsLength, keyboardDragging)}
                  aria-pressed={keyboardDragging}
                  className="set-list-drag-handle"
                  onKeyDown={(event) => {
                    onKeyboardReorderKeyDown(index, event);
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
                  onOpenItemEditor(index);
                }}
                onRemove={() => {
                  onRemoveItem(index);
                }}
                recordingStatus={recordingStatus}
              />
            </div>
            <div className="set-list-item-summary">
              <SetListItemSummaryText
                arranger={effectiveSetListItemArranger(item, music)}
                composer={effectiveSetListItemComposer(item, music)}
                displayCredit={displayCredit}
                duration={effectiveSetListItemDuration(item, music)}
                isSong={itemType(item) === "song"}
                itemNotes={itemNotes}
                movementCount={movementCount}
                parentWorkTitle={parentWorkTitle}
              />
              {item.isFeaturedNumber ? <span className="status-pill">Featured</span> : null}
            </div>
          </>
        )}
        <SetListItemNotes notes={itemNotes} showNotes={showNotes} />
      </li>
      {index < itemsLength ? (
        <SetListInsertZone
          canInsertCustom={canInsertCustomEntryAfter}
          onInsertMusic={onInsertMusic}
          dragIndex={dragIndex}
          dropAfter={dropState.after}
          index={index}
          itemTitle={item.title}
          onDrop={onDropDraggedItem}
          onInsertCustom={onInsertCustom}
          onSetDragOverBoundary={onSetDragOverBoundary}
          programNumber={programNumber}
        />
      ) : null}
    </>
  );
}
