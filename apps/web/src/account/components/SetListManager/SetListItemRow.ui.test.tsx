import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SetListItemRow } from "./SetListItemRow";
import type { SetListItem } from "./types";

const mockItem: SetListItem = {
  composer: "Composer Name",
  duration: "3:00",
  id: "item-1",
  title: "Test Song",
  type: "song",
};

const mockQuickCue: SetListItem = {
  cueInstruction: "Dim lights",
  cueKind: "quick",
  duration: "0:00",
  id: "cue-1",
  title: "Lighting Cue",
  type: "intermission",
};

describe("SetListItemRow", () => {
  it("renders a standard song row with title, drag handle, actions, and insert zone", async () => {
    const onOpenItemEditor = vi.fn();
    const onRemoveItem = vi.fn();
    const onInsertCustom = vi.fn();
    const onKeyboardReorderKeyDown = vi.fn();

    render(
      <ol>
        <SetListItemRow
          dragIndex={null}
          dragOverBoundary={null}
          index={0}
          item={mockItem}
          itemsLength={2}
          keyboardDragIndex={null}
          music={[]}
          onDropDraggedItem={vi.fn()}
          onInsertCustom={onInsertCustom}
          onKeyboardReorderKeyDown={onKeyboardReorderKeyDown}
          onOpenItemEditor={onOpenItemEditor}
          onRemoveItem={onRemoveItem}
          onRowDragEnd={vi.fn()}
          onRowDragOver={vi.fn()}
          onRowDragStart={vi.fn()}
          onRowDrop={vi.fn()}
          onRowPointerCancel={vi.fn()}
          onRowPointerDown={vi.fn()}
          onRowPointerUp={vi.fn()}
          onSetDragOverBoundary={vi.fn()}
          recentlyMovedItemId={null}
          showNotes={false}
        />
      </ol>,
    );

    expect(screen.getByText("Test Song")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reorder test song/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set list details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert item after Test Song" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Test Song"));
    expect(onOpenItemEditor).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemoveItem).toHaveBeenCalledWith(0);

    await userEvent.click(screen.getByRole("button", { name: "Insert item after Test Song" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Custom entry" }));
    expect(onInsertCustom).toHaveBeenCalledWith(1);
  });

  it("renders a quick cue row with instruction, 0:00 duration, and dedicated actions", () => {
    const onOpenItemEditor = vi.fn();
    const onRemoveItem = vi.fn();

    render(
      <ol>
        <SetListItemRow
          dragIndex={null}
          dragOverBoundary={null}
          index={1}
          item={mockQuickCue}
          itemsLength={3}
          canInsertCustomEntryAfter={false}
          keyboardDragIndex={null}
          music={[]}
          onDropDraggedItem={vi.fn()}
          onInsertCustom={vi.fn()}
          onKeyboardReorderKeyDown={vi.fn()}
          onOpenItemEditor={onOpenItemEditor}
          onRemoveItem={onRemoveItem}
          onRowDragEnd={vi.fn()}
          onRowDragOver={vi.fn()}
          onRowDragStart={vi.fn()}
          onRowDrop={vi.fn()}
          onRowPointerCancel={vi.fn()}
          onRowPointerDown={vi.fn()}
          onRowPointerUp={vi.fn()}
          onSetDragOverBoundary={vi.fn()}
          recentlyMovedItemId={null}
          showNotes={false}
        />
      </ol>,
    );

    expect(screen.getByText("Lighting Cue")).toBeInTheDocument();
    expect(screen.getByText("Quick cue")).toBeInTheDocument();
    expect(screen.getByText("Dim lights")).toBeInTheDocument();
    expect(screen.getByText("0:00")).toBeInTheDocument();

    // Quick Cues do not render an insertion zone after themselves.
    expect(screen.queryByRole("button", { name: /insert custom entry/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onOpenItemEditor).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemoveItem).toHaveBeenCalledWith(1);
  });

  it("omits an insertion zone immediately before a Quick Cue", () => {
    render(
      <ol>
        <SetListItemRow
          canInsertCustomEntryAfter={false}
          dragIndex={null}
          dragOverBoundary={null}
          index={0}
          item={mockItem}
          itemsLength={2}
          keyboardDragIndex={null}
          music={[]}
          onDropDraggedItem={vi.fn()}
          onInsertCustom={vi.fn()}
          onKeyboardReorderKeyDown={vi.fn()}
          onOpenItemEditor={vi.fn()}
          onRemoveItem={vi.fn()}
          onRowDragEnd={vi.fn()}
          onRowDragOver={vi.fn()}
          onRowDragStart={vi.fn()}
          onRowDrop={vi.fn()}
          onRowPointerCancel={vi.fn()}
          onRowPointerDown={vi.fn()}
          onRowPointerUp={vi.fn()}
          onSetDragOverBoundary={vi.fn()}
          recentlyMovedItemId={null}
          showNotes={false}
        />
      </ol>,
    );

    expect(screen.queryByRole("button", { name: /insert custom entry/i })).not.toBeInTheDocument();
  });
});
