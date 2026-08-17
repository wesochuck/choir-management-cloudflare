import type { Season } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import type { Dispatch, SetStateAction } from "react";

import type { SeasonForm } from "./types";

export function SeasonDialog({
  editingSeason,
  error,
  onClose,
  open,
  saveSeason,
  seasonBusy,
  seasonForm,
  setSeasonForm,
}: {
  readonly editingSeason: Season | null;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly saveSeason: () => Promise<void>;
  readonly seasonBusy: boolean;
  readonly seasonForm: SeasonForm;
  readonly setSeasonForm: Dispatch<SetStateAction<SeasonForm>>;
}) {
  return (
    <Dialog
      description="Set the dates and dues amount for this choir season. Overlapping seasons are not allowed."
      onClose={onClose}
      open={open}
      title={editingSeason ? "Edit season" : "Create season"}
    >
      <form
        className="form-stack"
        autoComplete="off"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void saveSeason();
        }}
      >
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor="season-name">Name</label>
          <input
            autoFocus
            id="season-name"
            maxLength={200}
            onChange={(event) => {
              setSeasonForm((current) => ({ ...current, name: event.target.value }));
            }}
            required
            value={seasonForm.name}
          />
        </div>
        <div className="field">
          <label htmlFor="season-dues-amount">Dues amount</label>
          <input
            id="season-dues-amount"
            min="0"
            onChange={(event) => {
              setSeasonForm((current) => ({ ...current, duesAmount: event.target.value }));
            }}
            required
            step="0.01"
            type="number"
            value={seasonForm.duesAmount}
          />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="season-starts-at">Start date</label>
            <input
              id="season-starts-at"
              onChange={(event) => {
                setSeasonForm((current) => ({ ...current, startsAt: event.target.value }));
              }}
              required
              type="date"
              value={seasonForm.startsAt}
            />
          </div>
          <div className="field">
            <label htmlFor="season-ends-at">End date</label>
            <input
              id="season-ends-at"
              onChange={(event) => {
                setSeasonForm((current) => ({ ...current, endsAt: event.target.value }));
              }}
              required
              type="date"
              value={seasonForm.endsAt}
            />
          </div>
        </div>
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" disabled={seasonBusy} type="button">
              Cancel
            </button>
          </DialogClose>
          <button className="button button--primary" disabled={seasonBusy} type="submit">
            {seasonBusy ? "Saving…" : editingSeason ? "Save changes" : "Create season"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
