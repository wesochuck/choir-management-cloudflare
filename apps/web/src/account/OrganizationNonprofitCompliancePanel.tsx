import { useEffect, useRef, useState } from "react";
import { NumberInput, Dialog, DialogClose, useConfirmation } from "@choir/ui";
import { usePersistedDraft } from "../persistence";
import type {
  ComplianceAssignee,
  NonprofitComplianceSettingsResponse,
  NonprofitComplianceTask,
} from "@choir/contracts";
import { MAX_COMPLIANCE_TASKS } from "@choir/contracts";
import { complianceTaskStatus, datePartInTimeZone } from "@choir/domain";
import {
  archiveComplianceTask,
  completeComplianceTask,
  createComplianceTask,
  getComplianceAssignees,
  getNonprofitComplianceSettings,
  restoreComplianceTask,
  toggleNonprofitCompliance,
  updateComplianceTask,
} from "../api/organization";

interface ComplianceDraft {
  readonly taskId: string;
  readonly applicable: boolean;
  readonly nextDueDate: string;
  readonly recurrenceMonths: number;
  readonly title: string;
  readonly description: string;
  readonly referenceUrl: string;
  readonly responsibleMembershipId: string;
  readonly isCustom: boolean;
}

function taskDraft(task: NonprofitComplianceTask): ComplianceDraft {
  return {
    taskId: task.id,
    applicable: task.applicable,
    nextDueDate: task.nextDueDate ?? "",
    recurrenceMonths: task.recurrenceMonths,
    title: task.title,
    description: task.description,
    referenceUrl: task.referenceUrl ?? "",
    responsibleMembershipId: task.responsibleMembershipId ?? "",
    isCustom: task.source === "custom",
  };
}

interface ComplianceStatus {
  readonly label: string;
  readonly tone: "neutral" | "success" | "warning" | "danger";
}

function calculateTaskStatus(task: NonprofitComplianceTask, today: string): ComplianceStatus {
  const statuses: Record<ReturnType<typeof complianceTaskStatus>, ComplianceStatus> = {
    not_applicable: { label: "Not applicable", tone: "neutral" },
    not_scheduled: { label: "Not scheduled", tone: "neutral" },
    scheduled: { label: "Scheduled", tone: "neutral" },
    completed: { label: "Completed", tone: "success" },
    upcoming: { label: "Upcoming", tone: "neutral" },
    due: { label: "Due", tone: "warning" },
    overdue: { label: "Overdue", tone: "danger" },
  };
  return statuses[complianceTaskStatus(task, today)];
}

function responsibleDisplay(
  task: NonprofitComplianceTask,
  assignees: readonly ComplianceAssignee[],
): string {
  if (task.responsibleNeedsReassignment) return "Needs reassignment";
  if (task.responsibleName && task.responsibleEmail) {
    return `${task.responsibleName} (${task.responsibleEmail})`;
  }
  if (task.responsibleMembershipId) {
    const found = assignees.find((a) => a.membershipId === task.responsibleMembershipId);
    if (found) return `${found.name} (${found.email})`;
    return "Needs reassignment";
  }
  return "Unassigned";
}

function isCustomTask(task: NonprofitComplianceTask): boolean {
  return task.source === "custom";
}

function taskDueLabel(task: NonprofitComplianceTask): string {
  return task.nextDueDate ?? "Not set";
}

function recurrenceLabel(task: NonprofitComplianceTask): string {
  return `Every ${String(task.recurrenceMonths)} months`;
}

interface TaskCardActions {
  readonly onArchive: (task: NonprofitComplianceTask) => void;
  readonly onComplete: (task: NonprofitComplianceTask, trigger: HTMLButtonElement) => void;
  readonly onEdit: (task: NonprofitComplianceTask) => void;
}

function TaskActionButtons({
  actions,
  operationBusy,
  task,
}: {
  readonly actions: TaskCardActions;
  readonly operationBusy: boolean;
  readonly task: NonprofitComplianceTask;
}): React.JSX.Element {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
      {task.applicable ? (
        <button
          className="button button--primary button--sm"
          disabled={operationBusy}
          onClick={(event) => {
            actions.onComplete(task, event.currentTarget);
          }}
          type="button"
        >
          Mark completed
        </button>
      ) : null}
      <button
        className="button button--secondary button--sm"
        disabled={operationBusy}
        onClick={() => {
          actions.onEdit(task);
        }}
        type="button"
      >
        Edit
      </button>
      {isCustomTask(task) ? (
        <button
          className="button button--secondary button--sm"
          disabled={operationBusy}
          onClick={() => {
            actions.onArchive(task);
          }}
          type="button"
        >
          Archive
        </button>
      ) : null}
    </div>
  );
}

function TaskStatusHeader({
  status,
  task,
}: {
  readonly status: ComplianceStatus;
  readonly task: NonprofitComplianceTask;
}): React.JSX.Element {
  const custom = isCustomTask(task);
  return (
    <div>
      <strong style={{ display: "block", fontSize: "1rem" }}>{task.title}</strong>
      <span style={{ display: "flex", gap: "0.375rem", marginTop: "0.25rem" }}>
        <span
          aria-label={`Status: ${status.label}`}
          className={`status-pill status-pill--${status.tone}`}
          style={{ display: "inline-block", fontSize: "0.8125rem", fontWeight: 600 }}
        >
          Status: {status.label}
        </span>
        <span
          className="status-pill"
          style={{ fontSize: "0.75rem" }}
          title={
            custom
              ? "Organization-defined custom reminder"
              : "Built-in filing template with Organization-specific dates"
          }
        >
          {custom ? "Custom" : "Built-in"}
        </span>
      </span>
      {task.kind === "ohio_unclaimed_funds_annual_report" ? (
        <span className="field__hint" style={{ display: "block", marginTop: "0.375rem" }}>
          Suggested date only (October 31 target), not legal advice. Confirm applicability and dates
          for your Organization.{" "}
          <a
            href="https://unclaimedfunds.ohio.gov/app/submit-a-report"
            rel="noreferrer"
            target="_blank"
          >
            Ohio holder reporting
          </a>
          {" · "}
          <a
            href="https://codes.ohio.gov/ohio-revised-code/section-169.03"
            rel="noreferrer"
            target="_blank"
          >
            ORC 169.03
          </a>
        </span>
      ) : null}
    </div>
  );
}

function TaskViewer({
  assignees,
  task,
}: {
  readonly assignees: readonly ComplianceAssignee[];
  readonly task: NonprofitComplianceTask;
}): React.JSX.Element {
  return (
    <div>
      <div
        style={{
          display: "grid",
          fontSize: "0.875rem",
          gap: "0.5rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        }}
      >
        <div>
          <span style={{ color: "var(--color-text-subtle)", display: "block" }}>Next due:</span>
          <span>{taskDueLabel(task)}</span>
        </div>
        <div>
          <span style={{ color: "var(--color-text-subtle)", display: "block" }}>Recurrence:</span>
          <span>{recurrenceLabel(task)}</span>
        </div>
        <div>
          <span style={{ color: "var(--color-text-subtle)", display: "block" }}>
            Responsible administrator:
          </span>
          <span>{responsibleDisplay(task, assignees)}</span>
        </div>
        <div>
          <span style={{ color: "var(--color-text-subtle)", display: "block" }}>
            Last completed:
          </span>
          <span>{task.lastCompletedDate ?? "None recorded"}</span>
          {task.lastCompletedDate ? (
            <span style={{ display: "block" }}>
              By {task.lastCompletedByName ?? "Name unavailable"}
            </span>
          ) : null}
        </div>
      </div>
      {task.description ? (
        <p className="field__hint" style={{ marginTop: "0.5rem" }}>
          {task.description}
        </p>
      ) : null}
      {task.referenceUrl ? (
        <p className="field__hint">
          Reference:{" "}
          <a href={task.referenceUrl} rel="noreferrer" target="_blank">
            {task.referenceUrl}
          </a>
        </p>
      ) : null}
    </div>
  );
}

interface TaskEditorProps {
  readonly assignees: readonly ComplianceAssignee[];
  readonly draft: ComplianceDraft | null;
  readonly onCancel: () => void;
  readonly onField: (field: keyof ComplianceDraft, value: string | number | boolean) => void;
  readonly onSave: () => void;
  readonly operationBusy: boolean;
  readonly task: NonprofitComplianceTask;
}

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

function TaskEditor(props: TaskEditorProps): React.JSX.Element {
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
        <span className="field__hint">
          Accountability only — every reminder still goes to all Owners and Administrators.
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

interface TaskCardProps {
  readonly actions: TaskCardActions;
  readonly assignees: readonly ComplianceAssignee[];
  readonly draft: ComplianceDraft | null;
  readonly isEditing: boolean;
  readonly onCancel: () => void;
  readonly onField: (field: keyof ComplianceDraft, value: string | number | boolean) => void;
  readonly onSave: () => void;
  readonly operationBusy: boolean;
  readonly task: NonprofitComplianceTask;
  readonly today: string;
}

function ComplianceTaskCard(props: TaskCardProps): React.JSX.Element {
  const {
    actions,
    assignees,
    draft,
    isEditing,
    onCancel,
    onField,
    onSave,
    operationBusy,
    task,
    today,
  } = props;
  const status = calculateTaskStatus(task, today);
  return (
    <div
      className="surface-card"
      style={{
        backgroundColor: "var(--color-surface-subtle)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
        padding: "1rem",
      }}
    >
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
        }}
      >
        <TaskStatusHeader status={status} task={task} />
        {isEditing ? null : (
          <TaskActionButtons actions={actions} operationBusy={operationBusy} task={task} />
        )}
      </div>
      {isEditing ? (
        <TaskEditor
          assignees={assignees}
          draft={draft}
          onCancel={onCancel}
          onField={onField}
          onSave={onSave}
          operationBusy={operationBusy}
          task={task}
        />
      ) : (
        <TaskViewer assignees={assignees} task={task} />
      )}
    </div>
  );
}

function ArchivedTasks({
  onRestore,
  operationBusy,
  tasks,
}: {
  readonly onRestore: (task: NonprofitComplianceTask) => void;
  readonly operationBusy: boolean;
  readonly tasks: readonly NonprofitComplianceTask[];
}): React.JSX.Element | null {
  if (tasks.length === 0) return null;
  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>
        Archived reminders ({String(tasks.length)})
      </h3>
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {tasks.map((task) => (
          <div
            key={task.id}
            className="surface-card"
            style={{
              border: "1px dashed var(--color-border-subtle)",
              borderRadius: "var(--radius-md)",
              opacity: 0.9,
              padding: "0.75rem 1rem",
            }}
          >
            <div
              style={{
                alignItems: "center",
                display: "flex",
                gap: "0.5rem",
                justifyContent: "space-between",
              }}
            >
              <span>
                <strong>{task.title}</strong>{" "}
                <span className="field__hint">Archived · history retained · reminders halted</span>
              </span>
              <button
                className="button button--secondary button--sm"
                disabled={operationBusy}
                onClick={() => {
                  onRestore(task);
                }}
                type="button"
              >
                Restore
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface AddDialogState {
  readonly applicable: boolean;
  readonly description: string;
  readonly dueDate: string;
  readonly recurrence: number;
  readonly referenceUrl: string;
  readonly responsible: string;
  readonly title: string;
}

function AddReminderDialog({
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
      description="Create a custom Organization reminder. Reminders go to all Owners and Administrators."
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

function CompletionDialog({
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

function ComplianceCatalogView({
  actions,
  assignees,
  draft,
  editingTaskId,
  onAdd,
  onCancelEdit,
  onField,
  onRestore,
  onSave,
  onToggle,
  operationBusy,
  settings,
  today,
}: {
  readonly actions: TaskCardActions;
  readonly assignees: readonly ComplianceAssignee[];
  readonly draft: ComplianceDraft | null;
  readonly editingTaskId: string | null;
  readonly onAdd: () => void;
  readonly onCancelEdit: () => void;
  readonly onField: (field: keyof ComplianceDraft, value: string | number | boolean) => void;
  readonly onRestore: (task: NonprofitComplianceTask) => void;
  readonly onSave: () => void;
  readonly onToggle: (enabled: boolean) => void;
  readonly operationBusy: boolean;
  readonly settings: NonprofitComplianceSettingsResponse;
  readonly today: string;
}): React.JSX.Element {
  const activeTasks = settings.tasks.filter((task) => !task.archived);
  const archivedTasks = settings.tasks.filter((task) => task.archived);
  const atCap = settings.tasks.length >= MAX_COMPLIANCE_TASKS;
  const builtinCount = activeTasks.filter((t) => t.source === "builtin").length;
  const customCount = activeTasks.filter((t) => t.source === "custom").length;
  return (
    <div className="form-stack settings-form">
      <div className="field-checkbox">
        <label htmlFor="nonprofit-enabled-checkbox">
          <input
            checked={settings.enabled}
            disabled={operationBusy}
            id="nonprofit-enabled-checkbox"
            onChange={(e) => {
              onToggle(e.target.checked);
            }}
            type="checkbox"
          />
          <span>This Organization is a nonprofit organization</span>
        </label>
      </div>
      <div className="compliance-tracker-container" style={{ marginTop: "1rem" }}>
        <p className="field__hint" style={{ marginBottom: "0.5rem" }}>
          Track recurring filing requirements and Organization deadlines. Weekly reminders are sent
          to all Organization Owners and Administrators starting four weeks before the stored due
          date until marked complete. Built-in nonprofit obligations pause when the nonprofit toggle
          is off; custom reminders continue independently.
        </p>
        <p className="field__hint" style={{ marginBottom: "1rem" }}>
          The app tracks Organization-entered deadlines and reminders; it does not determine whether
          a filing is legally required or completed with the government. Administrators confirm
          applicability and dates.
        </p>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: "0.75rem",
            justifyContent: "space-between",
            marginBottom: "1rem",
          }}
        >
          <span className="field__hint">
            {String(builtinCount)} built-in · {String(customCount)} custom ·{" "}
            {String(archivedTasks.length)} archived
          </span>
          <button
            className="button button--primary button--sm"
            disabled={operationBusy || atCap}
            onClick={() => {
              onAdd();
            }}
            title={
              atCap
                ? `The compliance catalog is full (${String(MAX_COMPLIANCE_TASKS)} reminders).`
                : "Add a custom compliance reminder"
            }
            type="button"
          >
            Add reminder
          </button>
        </div>
        {atCap ? (
          <p className="field__hint" style={{ marginBottom: "1rem" }} role="status">
            The compliance catalog is full ({String(MAX_COMPLIANCE_TASKS)} reminders including
            archived). Archive history is retained; restore or edit within the cap.
          </p>
        ) : null}
        {!settings.enabled ? (
          <div className="notice" role="status" style={{ marginBottom: "1rem" }}>
            <p>
              Nonprofit tracking is paused. Built-in reminders are stopped and history is preserved.
              Custom Organization reminders below remain scheduled.
            </p>
          </div>
        ) : null}
        <div className="compliance-tasks-list" style={{ display: "grid", gap: "1rem" }}>
          {activeTasks.map((task) => (
            <ComplianceTaskCard
              key={task.id}
              actions={actions}
              assignees={assignees}
              draft={editingTaskId === task.id ? draft : null}
              isEditing={editingTaskId === task.id}
              onCancel={onCancelEdit}
              onField={onField}
              onSave={onSave}
              operationBusy={operationBusy}
              task={task}
              today={today}
            />
          ))}
        </div>
        <ArchivedTasks onRestore={onRestore} operationBusy={operationBusy} tasks={archivedTasks} />
      </div>
    </div>
  );
}

export function OrganizationNonprofitCompliancePanel({
  timezone,
}: {
  readonly timezone?: string | null;
}) {
  const effectiveTimezone = timezone ?? "UTC";
  const [settings, setSettings] = useState<NonprofitComplianceSettingsResponse | null>(null);
  const [assignees, setAssignees] = useState<readonly ComplianceAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const completionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [completionDate, setCompletionDate] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [addState, setAddState] = useState<AddDialogState>({
    applicable: true,
    description: "",
    dueDate: "",
    recurrence: 12,
    referenceUrl: "",
    responsible: "",
    title: "",
  });
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmation();
  const [editBaseline, setEditBaseline] = useState<ComplianceDraft | null>(null);
  const editor = usePersistedDraft<ComplianceDraft>({
    initialValue: editBaseline,
    resourceKey: "organization-compliance-task",
    save: async (snapshot) => {
      const baseline = editBaseline;
      const payload: {
        applicable: boolean;
        nextDueDate: string | null;
        recurrenceMonths: number;
        title?: string;
        description?: string;
        referenceUrl?: string | null;
        responsibleMembershipId?: string | null;
      } = {
        applicable: snapshot.applicable,
        nextDueDate: snapshot.nextDueDate || null,
        recurrenceMonths: snapshot.recurrenceMonths,
      };
      if (snapshot.isCustom) {
        if (snapshot.title !== baseline?.title) payload.title = snapshot.title;
        if (snapshot.description !== baseline?.description)
          payload.description = snapshot.description;
        if (snapshot.referenceUrl !== baseline?.referenceUrl)
          payload.referenceUrl = snapshot.referenceUrl || null;
      }
      if (snapshot.responsibleMembershipId !== baseline?.responsibleMembershipId) {
        payload.responsibleMembershipId = snapshot.responsibleMembershipId || null;
      }
      const updated = await updateComplianceTask(snapshot.taskId, payload);
      setSettings(updated);
      const saved = updated.tasks.find((task) => task.id === snapshot.taskId);
      if (!saved) throw new Error("The saved compliance task was not returned.");
      return taskDraft(saved);
    },
    onSaveSuccess: () => {
      setSuccess("Compliance task updated successfully.");
    },
  });
  const operationBusy = busy || editor.saving;
  const today = datePartInTimeZone(new Date(), effectiveTimezone);

  useEffect(() => {
    const controller = new AbortController();
    getNonprofitComplianceSettings(controller.signal)
      .then((data) => {
        setSettings(data);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError("Nonprofit compliance settings could not be loaded.");
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getComplianceAssignees(controller.signal)
      .then((data) => {
        setAssignees(data.assignees);
      })
      .catch(() => {
        // Assignee names are an affordance; the picker still works with IDs.
      });
    return () => {
      controller.abort();
    };
  }, []);

  async function leaveEditor(): Promise<boolean> {
    if (operationBusy) return false;
    if (!editor.dirty) return true;
    const discard = await confirm({
      title: "Discard unsaved changes?",
      description: "Your unsaved compliance changes will be lost.",
      confirmLabel: "Discard changes",
      destructive: true,
    });
    if (discard) editor.discard();
    return discard;
  }

  async function handleToggle(enabled: boolean): Promise<void> {
    if (!(await leaveEditor())) return;
    setEditingTaskId(null);
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await toggleNonprofitCompliance(enabled);
      setSettings(updated);
      setSuccess(
        enabled
          ? "Nonprofit compliance tracking enabled. Default filing obligations configured."
          : "Nonprofit compliance tracking paused. Built-in reminders stopped; custom reminders continue.",
      );
    } catch {
      setError("Failed to update nonprofit setting. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function startEditing(task: NonprofitComplianceTask): Promise<void> {
    if (!(await leaveEditor())) return;
    const next = taskDraft(task);
    setEditingTaskId(task.id);
    setEditBaseline(next);
    if (editor.draft) editor.replaceDraft(next);
    setError(null);
    setSuccess(null);
  }

  function cancelEditing(): void {
    void leaveEditor().then((allowed) => {
      if (allowed) setEditingTaskId(null);
    });
  }

  async function startCompletion(
    task: NonprofitComplianceTask,
    trigger: HTMLButtonElement,
  ): Promise<void> {
    if (!(await leaveEditor())) return;
    completionTriggerRef.current = trigger;
    setCompletingTaskId(task.id);
    setCompletionDate(today);
    setError(null);
    setSuccess(null);
  }

  async function handleConfirmCompletion(): Promise<void> {
    if (!completingTaskId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await completeComplianceTask(
        completingTaskId,
        completionDate.trim().length > 0 ? completionDate.trim() : undefined,
      );
      setSettings(updated);
      setCompletingTaskId(null);
      setSuccess("Task marked complete. Reminders stopped and next due date advanced.");
    } catch {
      setError("Failed to record completion. Check the completion date.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(): Promise<void> {
    if (addState.title.trim().length === 0 || addState.dueDate.trim().length === 0) {
      setError("A title and next due date are required for a new reminder.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await createComplianceTask({
        applicable: addState.applicable,
        description: addState.description.trim(),
        nextDueDate: addState.dueDate.trim(),
        recurrenceMonths: addState.recurrence,
        referenceUrl: addState.referenceUrl.trim().length > 0 ? addState.referenceUrl.trim() : null,
        responsibleMembershipId:
          addState.responsible.trim().length > 0 ? addState.responsible.trim() : null,
        title: addState.title.trim(),
      });
      setSettings(updated);
      setAdding(false);
      setAddState({
        applicable: true,
        description: "",
        dueDate: "",
        recurrence: 12,
        referenceUrl: "",
        responsible: "",
        title: "",
      });
      setSuccess("Compliance reminder added.");
    } catch (loadError: unknown) {
      const message =
        loadError instanceof Error && loadError.message.includes("50")
          ? "The compliance catalog is full (50 reminders)."
          : "Failed to create the compliance reminder. Check the fields and try again.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive(task: NonprofitComplianceTask): Promise<void> {
    const confirmed = await confirm({
      title: `Archive ${task.title}?`,
      description:
        "Archiving halts all future reminders for this task but retains completion and audit history. You can restore it later.",
      confirmLabel: "Archive reminder",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await archiveComplianceTask(task.id);
      setSettings(updated);
      setEditingTaskId(null);
      setSuccess("Compliance reminder archived. History retained.");
    } catch {
      setError("Failed to archive the reminder. Built-in requirements cannot be archived.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(task: NonprofitComplianceTask): Promise<void> {
    const confirmed = await confirm({
      title: `Restore ${task.title}?`,
      description:
        "Restoring re-enables scheduling from the stored due date. Update the due date first if the filing is already handled to avoid a past-due reminder.",
      confirmLabel: "Restore reminder",
      destructive: false,
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await restoreComplianceTask(task.id);
      setSettings(updated);
      setSuccess("Compliance reminder restored.");
    } catch {
      setError("Failed to restore the reminder. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const completingTask = settings?.tasks.find((task) => task.id === completingTaskId);
  const actions: TaskCardActions = {
    onArchive: (task) => {
      void handleArchive(task);
    },
    onComplete: (task, trigger) => {
      void startCompletion(task, trigger);
    },
    onEdit: (task) => {
      void startEditing(task);
    },
  };
  const editorError = editor.error;

  return (
    <fieldset className="surface-card organization-settings-panel">
      <legend id="nonprofit-compliance-title">Compliance &amp; deadlines</legend>
      {loading ? <p role="status">Loading compliance settings…</p> : null}
      {(error ?? editorError) ? (
        <div className="notice notice--error" role="alert">
          <p>{error ?? editorError}</p>
        </div>
      ) : null}
      {success ? (
        <div className="notice notice--success" role="status">
          <p>{success}</p>
        </div>
      ) : null}
      {!loading && settings ? (
        <ComplianceCatalogView
          actions={actions}
          assignees={assignees}
          draft={editor.draft}
          editingTaskId={editingTaskId}
          onAdd={() => {
            setAdding(true);
            setError(null);
            setSuccess(null);
          }}
          onCancelEdit={cancelEditing}
          onField={(field, value) => {
            editor.updateField(field, value);
          }}
          onRestore={(task) => {
            void handleRestore(task);
          }}
          onSave={() => {
            void editor.save();
          }}
          onToggle={(enabled) => {
            void handleToggle(enabled);
          }}
          operationBusy={operationBusy}
          settings={settings}
          today={today}
        />
      ) : null}
      <AddReminderDialog
        assignees={assignees}
        onCancel={() => {
          if (!operationBusy) setAdding(false);
        }}
        onChange={(patch) => {
          setAddState((prev) => ({ ...prev, ...patch }));
        }}
        onCreate={() => {
          void handleCreate();
        }}
        operationBusy={operationBusy}
        open={adding}
        state={addState}
      />
      <CompletionDialog
        error={error}
        onCancel={() => {
          if (!operationBusy) setCompletingTaskId(null);
        }}
        onChange={setCompletionDate}
        onConfirm={() => {
          void handleConfirmCompletion();
        }}
        operationBusy={operationBusy}
        task={completingTask}
        triggerRef={completionTriggerRef}
        value={completionDate}
      />
      {confirmationDialog}
    </fieldset>
  );
}
