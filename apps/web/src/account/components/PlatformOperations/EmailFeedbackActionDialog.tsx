import { Dialog } from "@choir/ui";

import { emailFeedbackActionLabel, type EmailFeedbackActionTarget } from "./shared";

export function EmailFeedbackActionDialog({
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
  readonly actionTarget: EmailFeedbackActionTarget | null;
  readonly closeAction: () => void;
  readonly setActionReason: (reason: string) => void;
  readonly submitAction: () => Promise<void>;
}) {
  return (
    <Dialog
      description={
        actionTarget?.action.startsWith("retry")
          ? "Retry only after reviewing the correlation or queue failure. The action is recorded with your reason."
          : "Acknowledgement removes this record from the needs-review view but never deletes its audit history."
      }
      onClose={closeAction}
      open={actionTarget !== null}
      title={
        actionTarget
          ? `${emailFeedbackActionLabel(actionTarget.action)}?`
          : "Provider feedback action"
      }
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
        <label className="field" htmlFor="platform-email-feedback-action-reason">
          <span>Reason</span>
          <textarea
            autoFocus
            id="platform-email-feedback-action-reason"
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
              : emailFeedbackActionLabel(actionTarget?.action ?? "acknowledge-event")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
