import { Dialog, DialogClose } from "@choir/ui";
import type { SyntheticEvent } from "react";

export function CustomItemDialog({
  addCustomItem,
  canAddCustomEntry,
  customComposer,
  customCueInstruction,
  customCueKind,
  customDuration,
  customNotes,
  customTitle,
  customType,
  onClose,
  open,
  setCustomComposer,
  setCustomCueInstruction,
  setCustomCueKind,
  setCustomDuration,
  setCustomNotes,
  setCustomTitle,
  setCustomType,
}: {
  readonly addCustomItem: () => void;
  readonly canAddCustomEntry: boolean;
  readonly customComposer: string;
  readonly customCueInstruction: string;
  readonly customCueKind: "timed" | "quick";
  readonly customDuration: string;
  readonly customNotes: string;
  readonly customTitle: string;
  readonly customType: "song" | "intermission";
  readonly onClose: () => void;
  readonly open: boolean;
  readonly setCustomComposer: (value: string) => void;
  readonly setCustomCueInstruction: (value: string) => void;
  readonly setCustomCueKind: (value: "timed" | "quick") => void;
  readonly setCustomDuration: (value: string) => void;
  readonly setCustomNotes: (value: string) => void;
  readonly setCustomTitle: (value: string) => void;
  readonly setCustomType: (value: "song" | "intermission") => void;
}) {
  return (
    <Dialog
      description="Add an announcement, intermission, or custom song to this set list."
      onClose={onClose}
      open={open}
      title="Add custom item"
    >
      <form
        className="form-stack"
        onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
          event.preventDefault();
          addCustomItem();
        }}
      >
        <label className="field">
          Item type
          <select
            value={customType}
            onChange={(event) => {
              const nextType = event.target.value === "intermission" ? "intermission" : "song";
              setCustomType(nextType);
              if (nextType === "intermission") {
                setCustomCueKind("timed");
                if (!customTitle.trim() || customTitle === "No Announcements") {
                  setCustomTitle("Intermission");
                }
              }
            }}
          >
            <option value="song">Song</option>
            <option disabled={!canAddCustomEntry} value="intermission">
              Custom entry
            </option>
          </select>
        </label>
        {!canAddCustomEntry ? (
          <p className="field-help">
            Custom entries cannot be placed directly before or after a Quick Cue.
          </p>
        ) : null}
        {customType === "intermission" ? (
          <fieldset className="field set-list-cue-kind-field">
            <legend className="set-list-field-label">Entry style</legend>
            <div className="radio-group-inline">
              <label className="choice-field">
                <input
                  checked={customCueKind === "timed"}
                  name="customCueKind"
                  type="radio"
                  value="timed"
                  onChange={() => {
                    setCustomCueKind("timed");
                    if (customTitle === "No Announcements") {
                      setCustomTitle("Intermission");
                    }
                  }}
                />
                Timed cue
              </label>
              <label className="choice-field">
                <input
                  checked={customCueKind === "quick"}
                  name="customCueKind"
                  type="radio"
                  value="quick"
                  onChange={() => {
                    setCustomCueKind("quick");
                    if (!customTitle.trim() || customTitle === "Intermission") {
                      setCustomTitle("No Announcements");
                    }
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
        {customType === "intermission" && customCueKind === "quick" ? (
          <label className="field">
            Instruction (optional)
            <input
              maxLength={1_000}
              placeholder="Proceed directly into Silent Night."
              value={customCueInstruction}
              onChange={(event) => {
                setCustomCueInstruction(event.target.value);
              }}
            />
          </label>
        ) : (
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
        )}
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
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Cancel
            </button>
          </DialogClose>
          <button className="button button--primary" type="submit">
            Add item
          </button>
        </div>
      </form>
    </Dialog>
  );
}
