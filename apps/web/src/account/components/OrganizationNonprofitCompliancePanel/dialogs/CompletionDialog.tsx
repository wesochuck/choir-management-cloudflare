import type { NonprofitComplianceTask } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";

export function CompletionDialog({
  error,
  onCancel,
  onChange,
  onConfirm,
  operationBusy,
  task,
  triggerRef,
  value,
}: {
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onChange: (value: string) => void;
  readonly onConfirm: () => void;
  readonly operationBusy: boolean;
  readonly task: NonprofitComplianceTask | undefined;
  readonly triggerRef: React.RefObject<HTMLButtonElement | null>;
  readonly value: string;
}): React.JSX.Element | null {
  if (!task) return null;
  return (
    <Dialog
      open
      title={`Mark ${task.title} complete`}
      description="Record the filing completion date."
      onClose={() => {
        if (!operationBusy) onCancel();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        triggerRef.current?.focus();
      }}
    >
      {error ? <p role="alert">{error}</p> : null}
      <p className="field__hint">
        Record when this filing was completed. The next due date will automatically advance by{" "}
        {String(task.recurrenceMonths)} months from the cycle deadline without drift.
      </p>
      <div className="field" style={{ margin: "1rem 0" }}>
        <label htmlFor="completion-date-input">Completion date</label>
        <input
          id="completion-date-input"
          onChange={(e) => {
            onChange(e.target.value);
          }}
          required
          type="date"
          value={value}
        />
      </div>
      <div className="dialog__actions">
        <DialogClose asChild>
          <button
            className="button button--secondary button--sm"
            disabled={operationBusy}
            type="button"
          >
            Cancel
          </button>
        </DialogClose>
        <button
          className="button button--primary button--sm"
          disabled={operationBusy || value.trim().length === 0}
          onClick={() => {
            onConfirm();
          }}
          type="button"
        >
          Confirm completion
        </button>
      </div>
    </Dialog>
  );
}
