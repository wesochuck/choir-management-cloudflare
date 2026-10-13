import { useMemo } from "react";
import { DataTable, type DataTableColumn } from "@choir/ui";
import type {
  ComplianceAssignee,
  NonprofitComplianceSettingsResponse,
  NonprofitComplianceTask,
} from "@choir/contracts";
import { MAX_COMPLIANCE_TASKS } from "@choir/contracts";

import { RequirementCell, ResponsibleCell, StatusCell, TaskActionButtons } from "./cells";
import { ArchivedTasks } from "./dialogs/ArchivedTasks";
import { TaskEditor } from "./dialogs/TaskEditor";
import {
  calculateTaskStatus,
  lastCompletedDisplay,
  recurrenceLabel,
  responsibleDisplay,
  statusSortValue,
  taskDueDisplay,
  type ComplianceDraft,
  type TaskCardActions,
} from "./types";

export interface ComplianceCatalogViewProps {
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
  readonly timezone: string;
  readonly today: string;
}

export function ComplianceCatalogView({
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
  timezone,
  today,
}: ComplianceCatalogViewProps): React.JSX.Element {
  const activeTasks = settings.tasks.filter((task) => !task.archived);
  const archivedTasks = settings.tasks.filter((task) => task.archived);
  const atCap = settings.tasks.length >= MAX_COMPLIANCE_TASKS;
  const builtinCount = activeTasks.filter((t) => t.source === "builtin").length;
  const customCount = activeTasks.filter((t) => t.source === "custom").length;
  const columns: readonly DataTableColumn<NonprofitComplianceTask>[] = useMemo(
    () => [
      {
        header: "Requirement",
        id: "requirement",
        render: (task) => <RequirementCell task={task} />,
        sortValue: (task) => task.title,
      },
      {
        className: "compliance-cell--nowrap",
        header: "Status",
        id: "status",
        render: (task) => <StatusCell status={calculateTaskStatus(task, today)} />,
        sortValue: (task) => statusSortValue(task, today),
      },
      {
        className: "compliance-cell--nowrap",
        header: "Next due",
        id: "nextDue",
        render: (task) => taskDueDisplay(task, timezone),
        sortValue: (task) => task.nextDueDate,
      },
      {
        className: "compliance-cell--nowrap",
        header: "Recurrence",
        id: "recurrence",
        render: (task) => recurrenceLabel(task),
        sortValue: (task) => task.recurrenceMonths,
      },
      {
        header: "Responsible administrator",
        id: "responsible",
        render: (task) => <ResponsibleCell assignees={assignees} task={task} />,
        sortValue: (task) => responsibleDisplay(task, assignees),
      },
      {
        className: "compliance-cell--nowrap",
        header: "Last completed",
        id: "lastCompleted",
        render: (task) => (
          <span>
            <span style={{ display: "block" }}>{lastCompletedDisplay(task, timezone)}</span>
            {task.lastCompletedDate ? (
              <span className="field__hint" style={{ display: "block" }}>
                By {task.lastCompletedByName ?? "Name unavailable"}
              </span>
            ) : null}
          </span>
        ),
        sortValue: (task) => task.lastCompletedDate,
      },
      {
        className: "compliance-cell--nowrap compliance-cell--actions-wide",
        header: "Actions",
        id: "actions",
        render: (task) =>
          editingTaskId === task.id ? null : (
            <TaskActionButtons actions={actions} operationBusy={operationBusy} task={task} />
          ),
      },
    ],
    [actions, assignees, editingTaskId, operationBusy, timezone, today],
  );
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
        {activeTasks.length > 0 ? (
          <div className="compliance-tasks-table">
            <DataTable
              columns={columns}
              emptyMessage="No active compliance requirements."
              expandedRowId={editingTaskId}
              initialSort={{ columnId: "status", direction: "asc" }}
              keySelector={(task) => task.id}
              renderExpandedRow={(task) => (
                <TaskEditor
                  assignees={assignees}
                  draft={editingTaskId === task.id ? draft : null}
                  onCancel={onCancelEdit}
                  onField={onField}
                  onSave={onSave}
                  operationBusy={operationBusy}
                  task={task}
                />
              )}
              rowLabel={(task) => task.title}
              rows={activeTasks}
            />
          </div>
        ) : null}
        <ArchivedTasks onRestore={onRestore} operationBusy={operationBusy} tasks={archivedTasks} />
      </div>
    </div>
  );
}
