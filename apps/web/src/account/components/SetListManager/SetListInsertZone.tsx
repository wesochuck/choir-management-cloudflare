export function SetListInsertZone({
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
