import { Dialog } from "@choir/ui";

import type { DeadLetterActionTarget } from "./shared";

export function QueueDeadLetterActionDialog({
  actionBusy,
  actionError,
  actionReason,
  actionTarget,
  closeAction,
  setActionReason,
  submitAction,
}: {
  readonly actionBusy: boolean;
  readonly actionError: string | null;
  readonly actionReason: string;
  readonly actionTarget: DeadLetterActionTarget | null;
  readonly closeAction: () => void;
  readonly setActionReason: (reason: string) => void;
  readonly submitAction: () => Promise<void>;
}) {
  return (
    <Dialog
      description={
        actionTarget?.action === "retry"
          ? "Retry only after fixing or confirming the cause. A retry can send the message again."
          : "Dismissal keeps the audit record and does not delete or resend the originating job."
      }
      onClose={closeAction}
      open={actionTarget !== null}
      title={actionTarget?.action === "retry" ? "Retry queue job?" : "Dismiss dead-letter record?"}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submitAction();
        }}
      >
        {actionError ? (
          <p className="notice notice--error" role="alert">
            {actionError}
          </p>
        ) : null}
        <p>
          {actionTarget?.action === "retry"
            ? `Create a new attempt for ${actionTarget.deadLetter.jobKind ?? "this job"}?`
            : "Remove this incident from the needs-review list?"}
        </p>
        <label className="field" htmlFor="platform-dead-letter-action-reason">
          <span>Reason</span>
          <textarea
            autoFocus
            id="platform-dead-letter-action-reason"
            maxLength={500}
            minLength={3}
            onChange={(event) => {
              setActionReason(event.target.value);
            }}
            required
            rows={3}
            value={actionReason}
          />
        </label>
        <div className="dialog__actions">
          <button className="button button--secondary" onClick={closeAction} type="button">
            Cancel
          </button>
          <button className="button button--primary" disabled={actionBusy} type="submit">
            {actionBusy
              ? "Saving…"
              : actionTarget?.action === "retry"
                ? "Create retry"
                : "Dismiss record"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
