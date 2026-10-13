import { NumberInput } from "@choir/ui";

import type { TaskEditorProps } from "../types";

function CustomIdentityFields({
  draft,
  onField,
  task,
}: Pick<TaskEditorProps, "draft" | "onField" | "task">): React.JSX.Element | null {
  if (!draft?.isCustom) return null;
  return (
    <>
      <div className="field">
        <label htmlFor={`task-title-${task.id}`}>Requirement title</label>
        <input
          id={`task-title-${task.id}`}
          onChange={(e) => {
            onField("title", e.target.value);
          }}
          type="text"
          value={draft.title}
        />
      </div>
      <div className="field">
        <label htmlFor={`task-description-${task.id}`}>Description / notes</label>
        <textarea
          id={`task-description-${task.id}`}
          onChange={(e) => {
            onField("description", e.target.value);
          }}
          rows={2}
          value={draft.description}
        />
      </div>
      <div className="field">
        <label htmlFor={`task-reference-${task.id}`}>Reference URL (optional)</label>
        <input
          id={`task-reference-${task.id}`}
          onChange={(e) => {
            onField("referenceUrl", e.target.value);
          }}
          placeholder="https://"
          type="url"
          value={draft.referenceUrl}
        />
      </div>
    </>
  );
}

function BuiltinIdentityNotes({ task }: Pick<TaskEditorProps, "task">): React.JSX.Element | null {
  if (task.source === "custom") return null;
  return (
    <>
      {task.description ? <p className="field__hint">{task.description}</p> : null}
      {task.referenceUrl ? (
        <p className="field__hint">
          Reference:{" "}
          <a href={task.referenceUrl} rel="noreferrer" target="_blank">
            {task.referenceUrl}
          </a>
        </p>
      ) : null}
    </>
  );
}

export function TaskEditor(props: TaskEditorProps): React.JSX.Element {
  const { assignees, draft, onCancel, onField, onSave, operationBusy, task } = props;
  return (
    <div
      className="form-stack"
      style={{
        borderTop: "1px solid var(--color-border-subtle)",
        marginTop: "0.75rem",
        paddingTop: "0.75rem",
      }}
    >
      <CustomIdentityFields draft={draft} onField={onField} task={task} />
      <BuiltinIdentityNotes task={task} />
      <div className="field-checkbox">
        <label htmlFor={`task-applicable-${task.id}`}>
          <input
            checked={draft?.applicable ?? task.applicable}
            id={`task-applicable-${task.id}`}
            onChange={(e) => {
              onField("applicable", e.target.checked);
            }}
            type="checkbox"
          />
          <span>Applicable to this Organization</span>
        </label>
      </div>
      <div
        style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        }}
      >
        <div className="field">
          <label htmlFor={`task-due-date-${task.id}`}>Next due date</label>
          <input
            id={`task-due-date-${task.id}`}
            onChange={(e) => {
              onField("nextDueDate", e.target.value);
            }}
            type="date"
            value={draft?.nextDueDate ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor={`task-recurrence-${task.id}`}>Recurrence (months)</label>
          <NumberInput
            id={`task-recurrence-${task.id}`}
            max={120}
            min={1}
            onChange={(e) => {
              onField("recurrenceMonths", Number(e.target.value));
            }}
            value={draft?.recurrenceMonths ?? task.recurrenceMonths}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`task-responsible-${task.id}`}>Responsible administrator</label>
        <select
          aria-describedby={`task-responsible-hint-${task.id}`}
          id={`task-responsible-${task.id}`}
          onChange={(e) => {
            onField("responsibleMembershipId", e.target.value);
          }}
          value={draft?.responsibleMembershipId ?? ""}
        >
          <option value="">Unassigned</option>
          {assignees.map((assignee) => (
            <option key={assignee.membershipId} value={assignee.membershipId}>
              {assignee.name} ({assignee.email})
            </option>
          ))}
        </select>
        <span className="field__hint" id={`task-responsible-hint-${task.id}`}>
          This assignment is for accountability only. Reminder emails go to all Organization Owners
          and Administrators, not just the selected person.
          {task.responsibleNeedsReassignment ? " Previous assignee needs reassignment." : ""}
        </span>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button
          className="button button--primary button--sm"
          disabled={operationBusy}
          onClick={() => {
            onSave();
          }}
          type="button"
        >
          Save changes
        </button>
        <button
          className="button button--secondary button--sm"
          disabled={operationBusy}
          onClick={() => {
            onCancel();
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
