import { DropdownMenu } from "@choir/ui";

export function SetListInsertZone({
  canInsertCustom = true,
  onInsertMusic,
  dragIndex,
  dropAfter,
  index,
  itemTitle,
  onDrop,
  onInsertCustom,
  onSetDragOverBoundary,
  programNumber,
}: {
  readonly canInsertCustom?: boolean | undefined;
  readonly onInsertMusic?: ((index: number) => void) | undefined;
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
      <DropdownMenu
        accessibleLabel={`Insert item after ${itemLabel}`}
        items={[
          { label: "Song from music library", onSelect: () => onInsertMusic?.(targetIndex) },
          {
            label: "Custom entry",
            disabled: !canInsertCustom,
            onSelect: () => {
              onInsertCustom(targetIndex);
            },
          },
        ]}
        trigger={
          <button
            id={`set-list-insert-${String(index)}`}
            className="set-list-insert-zone__button"
            type="button"
          >
            <span aria-hidden="true">+</span>
            <span className="set-list-insert-zone__text">Insert item</span>
          </button>
        }
      />
    </li>
  );
}
