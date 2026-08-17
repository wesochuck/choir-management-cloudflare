import { Dialog, DialogClose } from "@choir/ui";
import type { SyntheticEvent } from "react";

export function DonationLevelDialog({
  busy,
  editingLevelId,
  error,
  levelAmount,
  levelBenefit,
  levelLabel,
  onClose,
  open,
  saveLevel,
  setLevelAmount,
  setLevelBenefit,
  setLevelLabel,
}: {
  readonly busy: boolean;
  readonly editingLevelId: string | null;
  readonly error?: string | null | undefined;
  readonly levelAmount: string;
  readonly levelBenefit: string;
  readonly levelLabel: string;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly saveLevel: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
  readonly setLevelAmount: (value: string) => void;
  readonly setLevelBenefit: (value: string) => void;
  readonly setLevelLabel: (value: string) => void;
}) {
  return (
    <Dialog
      description="Set the recognition label, suggested amount, and benefit shown to donors."
      onClose={onClose}
      open={open}
      title={editingLevelId ? "Edit donation level" : "New donation level"}
    >
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <form className="form-stack" onSubmit={(event) => void saveLevel(event)}>
        <label className="field">
          Level label
          <input
            required
            maxLength={120}
            value={levelLabel}
            onChange={(event) => {
              setLevelLabel(event.target.value);
            }}
          />
        </label>
        <label className="field">
          Suggested amount (USD)
          <input
            required
            min="0.01"
            step="0.01"
            type="number"
            value={levelAmount}
            onChange={(event) => {
              setLevelAmount(event.target.value);
            }}
          />
        </label>
        <label className="field">
          Benefit or perks
          <textarea
            maxLength={1000}
            rows={3}
            value={levelBenefit}
            onChange={(event) => {
              setLevelBenefit(event.target.value);
            }}
          />
        </label>
        <div className="form-actions">
          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Saving…" : "Save level"}
          </button>
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
        </div>
      </form>
    </Dialog>
  );
}
