import { moveSetListItem } from "@choir/domain";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type SetStateAction,
} from "react";
import type { SetListItem } from "./types";

export function dropBoundaryForEvent(event: DragEvent<HTMLElement>, itemIndex: number): number {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? itemIndex : itemIndex + 1;
}

export function canDropAtBoundary(boundary: number, dragIndex: number | null): boolean {
  return dragIndex !== null && boundary !== dragIndex && boundary !== dragIndex + 1;
}

export function dropStateForItem(
  itemIndex: number,
  dragIndex: number | null,
  dragOverBoundary: number | null,
): { readonly before: boolean; readonly after: boolean } {
  return {
    after: dragOverBoundary === itemIndex + 1 && canDropAtBoundary(itemIndex + 1, dragIndex),
    before: dragOverBoundary === itemIndex && canDropAtBoundary(itemIndex, dragIndex),
  };
}

export function setListItemIsDragging(
  index: number,
  dragIndex: number | null,
  keyboardDragIndex: number | null,
): boolean {
  return dragIndex === index || keyboardDragIndex === index;
}

export function reorderHandleLabel(
  title: string,
  index: number,
  itemCount: number,
  keyboardDragging: boolean,
): string {
  return `${keyboardDragging ? "Reordering" : "Reorder"} ${title}, position ${String(index + 1)} of ${String(itemCount)}`;
}

export interface UseSetListReorderResult {
  readonly dragOverBoundary: number | null;
  readonly dropDraggedItem: (boundary: number) => void;
  readonly handleKeyboardReorderKeyDown: (
    index: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => void;
  readonly handleRowDragEnd: () => void;
  readonly handleRowDragOver: (index: number, event: DragEvent<HTMLElement>) => void;
  readonly handleRowDragStart: (index: number) => void;
  readonly handleRowDrop: (index: number, event: DragEvent<HTMLElement>) => void;
  readonly handleRowPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  readonly handleRowPointerDown: (index: number, event: PointerEvent<HTMLElement>) => void;
  readonly handleRowPointerUp: (index: number, event: PointerEvent<HTMLElement>) => void;
  readonly keyboardDragIndex: number | null;
  readonly moveDraggedItemWithFeedback: (toIndex: number) => void;
  readonly recentlyMovedItemId: string | null;
  readonly setDragOverBoundary: Dispatch<SetStateAction<number | null>>;
}

export function useSetListReorder({
  dragIndex,
  items,
  moveDraggedItem,
  setDragIndex,
  setMessage,
  updateDraftItems,
}: {
  readonly dragIndex: number | null;
  readonly items: readonly SetListItem[];
  readonly moveDraggedItem: (toIndex: number) => void;
  readonly setDragIndex: (index: number | null) => void;
  readonly setMessage: (message: string | null) => void;
  readonly updateDraftItems: (updater: (current: SetListItem[]) => SetListItem[]) => void;
}): UseSetListReorderResult {
  const [dragOverBoundary, setDragOverBoundary] = useState<number | null>(null);
  const [keyboardDragIndex, setKeyboardDragIndex] = useState<number | null>(null);
  const [keyboardDragOriginItems, setKeyboardDragOriginItems] = useState<
    readonly SetListItem[] | null
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

  function handleRowDragStart(index: number): void {
    setKeyboardDragIndex(null);
    setKeyboardDragOriginItems(null);
    setDragIndex(index);
    setDragOverBoundary(null);
    setRecentlyMovedItemId(null);
  }

  function handleRowDragEnd(): void {
    setKeyboardDragIndex(null);
    setKeyboardDragOriginItems(null);
    setDragIndex(null);
    setDragOverBoundary(null);
  }

  function handleRowDragOver(index: number, event: DragEvent<HTMLElement>): void {
    if (dragIndex === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverBoundary(dropBoundaryForEvent(event, index));
  }

  function handleRowDrop(index: number, event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    dropDraggedItem(dropBoundaryForEvent(event, index));
  }

  function handleRowPointerCancel(event: PointerEvent<HTMLElement>): void {
    if (event.pointerType === "touch") {
      setKeyboardDragIndex(null);
      setKeyboardDragOriginItems(null);
      setDragIndex(null);
      setDragOverBoundary(null);
    }
  }

  function handleRowPointerDown(index: number, event: PointerEvent<HTMLElement>): void {
    if (event.pointerType === "touch") {
      setKeyboardDragIndex(null);
      setKeyboardDragOriginItems(null);
      setDragIndex(index);
      setDragOverBoundary(null);
    }
  }

  function handleRowPointerUp(index: number, event: PointerEvent<HTMLElement>): void {
    if (event.pointerType === "touch") {
      moveDraggedItemWithFeedback(index);
      setDragOverBoundary(null);
    }
  }

  return {
    dragOverBoundary,
    dropDraggedItem,
    handleKeyboardReorderKeyDown,
    handleRowDragEnd,
    handleRowDragOver,
    handleRowDragStart,
    handleRowDrop,
    handleRowPointerCancel,
    handleRowPointerDown,
    handleRowPointerUp,
    keyboardDragIndex,
    moveDraggedItemWithFeedback,
    recentlyMovedItemId,
    setDragOverBoundary,
  };
}
