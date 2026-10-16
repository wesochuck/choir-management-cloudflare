import type { OrganizationMusicPiece } from "@choir/contracts";
import { useState } from "react";
import { durationText } from "./utils";

export function MusicMovementList({
  busy,
  movements,
  onAdd,
  onOpen,
  onReorder,
}: {
  readonly busy: boolean;
  readonly movements: readonly OrganizationMusicPiece[];
  readonly onAdd: () => void;
  readonly onOpen: (piece: OrganizationMusicPiece) => void;
  readonly onReorder: (ids: string[]) => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  function move(from: number, to: number): void {
    const moved = movements[from];
    if (busy || !moved || from === to || to < 0 || to >= movements.length) return;
    const ids = movements.map(({ id }) => id);
    ids.splice(from, 1);
    ids.splice(to, 0, moved.id);
    onReorder(ids);
    setAnnouncement(`${moved.title} moved to position ${String(to + 1)}.`);
  }
  return (
    <section aria-labelledby="music-movement-order-heading" className="music-movements">
      <h2 id="music-movement-order-heading">Movement order</h2>
      <p className="field-help">
        This order is used in the library and when adding the whole work to a set list. Individual
        set lists can use a different order.
      </p>
      <p className="field-help" id="music-movement-reorder-help">
        Drag movements or use Move up and Move down. Select a movement to edit it and return here.
      </p>
      {movements.length ? (
        <ol aria-label="Default movement order" className="music-movements__list">
          {movements.map((movement, index) => (
            <li
              className="music-movements__row"
              key={movement.id}
              draggable={!busy}
              onDragStart={(event) => {
                setDraggedId(movement.id);
                event.dataTransfer.setData("text/plain", movement.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                if (!busy && draggedId) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedId)
                  move(
                    movements.findIndex(({ id }) => id === draggedId),
                    index,
                  );
                setDraggedId(null);
              }}
              onDragEnd={() => {
                setDraggedId(null);
              }}
            >
              <span aria-hidden="true" className="set-list-drag-handle">
                <span />
              </span>
              <span className="music-movements__number">{String(index + 1)}</span>
              <button
                aria-label={`Open movement: ${movement.title}`}
                className="text-button music-movements__title"
                disabled={busy}
                id={`music-movement-${movement.id}`}
                onClick={() => {
                  onOpen(movement);
                }}
                type="button"
              >
                {movement.title}
              </button>
              <span className="music-movements__duration">
                {durationText(movement.durationSeconds) || "—"}
              </span>
              <div className="music-movements__actions">
                <button
                  aria-label={`Move ${movement.title} up`}
                  aria-describedby="music-movement-reorder-help"
                  className="button button--secondary button--small"
                  disabled={busy || index === 0}
                  onClick={() => {
                    move(index, index - 1);
                  }}
                  type="button"
                >
                  Move up
                </button>
                <button
                  aria-label={`Move ${movement.title} down`}
                  aria-describedby="music-movement-reorder-help"
                  className="button button--secondary button--small"
                  disabled={busy || index === movements.length - 1}
                  onClick={() => {
                    move(index, index + 1);
                  }}
                  type="button"
                >
                  Move down
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-state">This work has no movements yet.</p>
      )}
      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
      <button className="text-button" disabled={busy} onClick={onAdd} type="button">
        Add movement
      </button>
    </section>
  );
}
