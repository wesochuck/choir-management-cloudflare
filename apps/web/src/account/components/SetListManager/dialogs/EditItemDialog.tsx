import { parseSetListDuration } from "@choir/domain";
import { Dialog, DialogClose } from "@choir/ui";
import type { SyntheticEvent } from "react";

import type { SetListManagerModel } from "../hooks";
import { SetListCreditEditor } from "../shared";
import type { SetListItem } from "../types";
import { durationFromSeconds, itemType, musicPieceForSetListItem } from "../utils";

// eslint-disable-next-line complexity -- item editor dialog handles multiple linked/unlinked piece properties and soloist assignments.
export function EditItemDialog({
  closeItemEditor,
  editingItem,
  error,
  performerLabelPlural,
  resources,
  saveItemEdit,
  setEditingItem,
}: {
  readonly closeItemEditor: () => void;
  readonly editingItem: SetListItem | null;
  readonly error: string | null;
  readonly performerLabelPlural: string;
  readonly resources: SetListManagerModel["resources"];
  readonly saveItemEdit: () => void;
  readonly setEditingItem: (item: SetListItem) => void;
}) {
  if (!editingItem) return null;

  const linkedMusicPiece = musicPieceForSetListItem(editingItem, resources.music);
  const editingItemIsLinked = Boolean(editingItem.pieceId);
  const linkedMusicHref = linkedMusicPiece
    ? `/admin/library?${new URLSearchParams({
        pieceId: linkedMusicPiece.id,
        returnTo: "/admin/setlists",
      }).toString()}`
    : undefined;
  const editingTitle = linkedMusicPiece?.title ?? editingItem.title;
  const editingComposer = linkedMusicPiece?.composer ?? editingItem.composer ?? "";
  const editingDuration =
    linkedMusicPiece !== undefined
      ? (durationFromSeconds(linkedMusicPiece.durationSeconds) ?? "")
      : (editingItem.duration ?? "");

  return (
    <Dialog
      description={`Update the item details and ${performerLabelPlural.toLowerCase()} assignments, then close when finished.`}
      onClose={closeItemEditor}
      open={true}
      title="Edit set-list item"
    >
      <form
        className="form-stack set-list-item-dialog"
        onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
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
        {itemType(editingItem) === "intermission" ? (
          <fieldset className="field set-list-cue-kind-field">
            <legend className="set-list-field-label">Entry style</legend>
            <div className="radio-group-inline">
              <label className="choice-field">
                <input
                  checked={(editingItem.cueKind ?? "timed") === "timed"}
                  name="cueKind"
                  type="radio"
                  value="timed"
                  onChange={() => {
                    setEditingItem({
                      ...editingItem,
                      cueKind: "timed",
                      duration: "",
                      title:
                        editingItem.title === "No Announcements"
                          ? "Intermission"
                          : editingItem.title,
                    });
                  }}
                />
                Timed cue
              </label>
              <label className="choice-field">
                <input
                  checked={editingItem.cueKind === "quick"}
                  name="cueKind"
                  type="radio"
                  value="quick"
                  onChange={() => {
                    setEditingItem({
                      ...editingItem,
                      cueKind: "quick",
                      duration: undefined,
                      title:
                        !editingItem.title.trim() || editingItem.title === "Intermission"
                          ? "No Announcements"
                          : editingItem.title,
                    });
                  }}
                />
                Quick cue
              </label>
            </div>
          </fieldset>
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
        {itemType(editingItem) === "intermission" && editingItem.cueKind === "quick" ? (
          <label className="field">
            Instruction (optional)
            <input
              maxLength={1_000}
              placeholder="Proceed directly into Silent Night."
              value={editingItem.cueInstruction ?? ""}
              onChange={(event) => {
                setEditingItem({ ...editingItem, cueInstruction: event.target.value });
              }}
            />
          </label>
        ) : (
          <label className="field">
            Duration
            <input
              aria-invalid={
                Boolean(editingItem.duration) && parseSetListDuration(editingItem.duration) === null
              }
              maxLength={20}
              placeholder={itemType(editingItem) === "song" ? undefined : "4:05"}
              readOnly={editingItemIsLinked}
              value={editingDuration}
              onChange={(event) => {
                if (!editingItemIsLinked) {
                  setEditingItem({ ...editingItem, duration: event.target.value });
                }
              }}
            />
          </label>
        )}
        <label className="field">
          Notes
          <textarea
            maxLength={10_000}
            placeholder={
              linkedMusicPiece?.notes.trim()
                ? linkedMusicPiece.notes.replace(/\s+/g, " ").slice(0, 160)
                : undefined
            }
            rows={3}
            value={editingItem.notes ?? ""}
            onChange={(event) => {
              setEditingItem({ ...editingItem, notes: event.target.value });
            }}
          />
          {editingItemIsLinked && linkedMusicPiece?.notes.trim() ? (
            <p className="field-help">
              Left blank, the music library notes are shown for this item on the set list.
            </p>
          ) : null}
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
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Cancel
            </button>
          </DialogClose>
          <button className="button button--primary" type="submit">
            Save item
          </button>
        </div>
      </form>
    </Dialog>
  );
}
