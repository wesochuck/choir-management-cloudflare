import type { OrganizationMusicPiece } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { useMemo, useState } from "react";
import { durationFromSeconds, setListBuilderCredit } from "../utils";

export function InsertMusicDialog({
  music,
  description,
  error,
  onCloseAutoFocus,
  onClose,
  onInsert,
}: {
  readonly music: readonly OrganizationMusicPiece[];
  readonly description: string;
  readonly error: string | null;
  readonly onCloseAutoFocus: (event: Event) => void;
  readonly onClose: () => void;
  readonly onInsert: (piece: OrganizationMusicPiece) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const matches = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return music.filter((piece) =>
      `${piece.title} ${piece.composer} ${piece.arranger}`.toLocaleLowerCase().includes(search),
    );
  }, [music, query]);
  const selected = music.find((piece) => piece.id === selectedId);
  return (
    <Dialog
      open
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
      title="Insert song"
      description={description}
      dirty={selectedId !== ""}
      footer={
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Cancel
            </button>
          </DialogClose>
          <button
            className="button button--primary"
            type="button"
            disabled={!selected}
            onClick={() => {
              if (selected) onInsert(selected);
            }}
          >
            Insert song
          </button>
        </div>
      }
    >
      <div className="form-stack">
        <label className="field">
          Search music library
          <input
            autoFocus
            type="search"
            placeholder="Search by title, composer, or arranger"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedId("");
            }}
          />
        </label>
        <p className="field-help" role="status">
          {matches.length} matching {matches.length === 1 ? "piece" : "pieces"}
          {matches.length > 50 ? " · Showing first 50; refine your search." : ""}
        </p>
        <div className="set-list-insert-results" role="radiogroup" aria-label="Music library songs">
          {matches.slice(0, 50).map((piece) => (
            <label className="choice-field" key={piece.id}>
              <input
                type="radio"
                name="insert-song"
                value={piece.id}
                checked={selectedId === piece.id}
                onChange={() => {
                  setSelectedId(piece.id);
                }}
              />
              <span className="choice-field__content">
                <strong>{piece.title}</strong>
                <small>
                  {setListBuilderCredit(piece.composer, piece.arranger) ?? "Composer not listed"} ·{" "}
                  {durationFromSeconds(piece.durationSeconds) ?? "Duration not listed"}
                </small>
              </span>
            </label>
          ))}
        </div>
        {matches.length === 0 ? <p>No matching music pieces.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </Dialog>
  );
}
