import type { Season } from "@choir/contracts";
import { Dialog } from "@choir/ui";

export function DeleteSeasonDialog({
  confirmSeason,
  error,
  onClose,
  open,
  removeSeason,
  seasonBusy,
}: {
  readonly confirmSeason: Season | null;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly removeSeason: () => Promise<void>;
  readonly seasonBusy: boolean;
}) {
  return (
    <Dialog
      description="A season with dues records cannot be deleted."
      onClose={onClose}
      open={open}
      title="Delete season?"
    >
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <p>
        {confirmSeason
          ? `Delete ${confirmSeason.name}? This action cannot be undone.`
          : "Delete this season?"}
      </p>
      <div className="dialog__actions">
        <button
          className="button button--secondary"
          disabled={seasonBusy}
          onClick={onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className="button button--danger"
          disabled={seasonBusy}
          onClick={() => void removeSeason()}
          type="button"
        >
          {seasonBusy ? "Deleting…" : "Delete season"}
        </button>
      </div>
    </Dialog>
  );
}
