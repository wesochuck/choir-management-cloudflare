import type { OrganizationEvent } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";

export function CancelEventDialog({
  busy,
  cancelCandidate,
  error,
  onCancel,
  onClose,
}: {
  readonly busy: boolean;
  readonly cancelCandidate: OrganizationEvent | null;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      description="Canceled events stay visible for history but no longer accept RSVPs or drive roster automation."
      onClose={onClose}
      open={cancelCandidate !== null}
      title="Cancel event?"
    >
      {error ? (
        <p className="notice notice--error" id="cancel-event-error" role="alert">
          {error}
        </p>
      ) : null}
      <p>
        {cancelCandidate
          ? `Cancel ${cancelCandidate.title}? Linked rehearsals will also be canceled.`
          : "Cancel this event?"}
      </p>
      <div className="dialog__actions">
        <DialogClose asChild>
          <button className="button button--secondary" disabled={busy} type="button">
            Keep event
          </button>
        </DialogClose>
        <button className="button button--danger" disabled={busy} onClick={onCancel} type="button">
          {busy ? "Canceling…" : "Cancel event"}
        </button>
      </div>
    </Dialog>
  );
}
