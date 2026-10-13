import type { ComplianceAssignee } from "@choir/contracts";
import { Dialog, DialogClose, NumberInput } from "@choir/ui";

import type { AddDialogState } from "../types";

export function AddReminderDialog({
  assignees,
  onCancel,
  onChange,
  onCreate,
  operationBusy,
  open,
  state,
}: {
  readonly assignees: readonly ComplianceAssignee[];
  readonly onCancel: () => void;
  readonly onChange: (patch: Partial<AddDialogState>) => void;
  readonly onCreate: () => void;
  readonly operationBusy: boolean;
  readonly open: boolean;
  readonly state: AddDialogState;
}): React.JSX.Element | null {
  if (!open) return null;
  const dirty =
    state.title.trim().length > 0 ||
    state.description.trim().length > 0 ||
    state.referenceUrl.trim().length > 0 ||
    state.dueDate.trim().length > 0 ||
    state.responsible.trim().length > 0;
  return (
    <Dialog
      open
      title="Add compliance reminder"
      description="Create a custom Organization reminder."
      dirty={dirty}
      onClose={() => {
        if (!operationBusy) onCancel();
      }}
    >
      <div className="form-stack">
        <div className="field">
          <label htmlFor="new-reminder-title">Requirement title</label>
          <input
            id="new-reminder-title"
            onChange={(e) => {
              onChange({ title: e.target.value });
            }}
            required
            type="text"
            value={state.title}
          />
        </div>
        <div className="field">
          <label htmlFor="new-reminder-description">Description / notes (optional)</label>
          <textarea
            id="new-reminder-description"
            onChange={(e) => {
              onChange({ description: e.target.value });
            }}
            rows={2}
            value={state.description}
          />
        </div>
        <div className="field">
          <label htmlFor="new-reminder-reference">Reference URL (optional)</label>
          <input
            id="new-reminder-reference"
            onChange={(e) => {
              onChange({ referenceUrl: e.target.value });
            }}
            placeholder="https://"
            type="url"
            value={state.referenceUrl}
          />
        </div>
        <div
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          }}
        >
          <div className="field">
            <label htmlFor="new-reminder-due">Next due date</label>
            <input
              id="new-reminder-due"
              onChange={(e) => {
                onChange({ dueDate: e.target.value });
              }}
              required
              type="date"
              value={state.dueDate}
            />
          </div>
          <div className="field">
            <label htmlFor="new-reminder-recurrence">Recurrence (months)</label>
            <NumberInput
              id="new-reminder-recurrence"
              max={120}
              min={1}
              onChange={(e) => {
                onChange({ recurrence: Number(e.target.value) });
              }}
              value={state.recurrence}
            />
          </div>
        </div>
        <div className="field-checkbox">
          <label htmlFor="new-reminder-applicable">
            <input
              checked={state.applicable}
              id="new-reminder-applicable"
              onChange={(e) => {
                onChange({ applicable: e.target.checked });
              }}
              type="checkbox"
            />
            <span>Applicable to this Organization</span>
          </label>
        </div>
        <div className="field">
          <label htmlFor="new-reminder-responsible">Responsible administrator</label>
          <select
            aria-describedby="new-reminder-responsible-hint"
            id="new-reminder-responsible"
            onChange={(e) => {
              onChange({ responsible: e.target.value });
            }}
            value={state.responsible}
          >
            <option value="">Unassigned</option>
            {assignees.map((assignee) => (
              <option key={assignee.membershipId} value={assignee.membershipId}>
                {assignee.name} ({assignee.email})
              </option>
            ))}
          </select>
          <span className="field__hint" id="new-reminder-responsible-hint">
            This assignment is for accountability only. Reminder emails go to all Organization
            Owners and Administrators, not just the selected person.
          </span>
        </div>
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
          disabled={
            operationBusy || state.title.trim().length === 0 || state.dueDate.trim().length === 0
          }
          onClick={() => {
            onCreate();
          }}
          type="button"
        >
          Add reminder
        </button>
      </div>
    </Dialog>
  );
}
