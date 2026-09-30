import { useEffect, useRef, useState } from "react";
import { NumberInput, Dialog, DialogClose, useConfirmation } from "@choir/ui";
import { usePersistedDraft } from "../persistence";
import type {
  NonprofitComplianceSettingsResponse,
  NonprofitComplianceTask,
} from "@choir/contracts";
import { datePartInTimeZone } from "@choir/domain";
import {
  completeComplianceTask,
  getNonprofitComplianceSettings,
  toggleNonprofitCompliance,
  updateComplianceTask,
} from "../api/organization";

interface ComplianceDraft {
  readonly taskId: string;
  readonly applicable: boolean;
  readonly nextDueDate: string;
  readonly recurrenceMonths: number;
}

function taskDraft(task: NonprofitComplianceTask): ComplianceDraft {
  return {
    taskId: task.id,
    applicable: task.applicable,
    nextDueDate: task.nextDueDate ?? "",
    recurrenceMonths: task.recurrenceMonths,
  };
}

interface ComplianceStatus {
  readonly label: string;
  readonly tone: "neutral" | "success" | "warning" | "danger";
}

function calculateTaskStatus(task: NonprofitComplianceTask, today: string): ComplianceStatus {
  if (!task.applicable) {
    return { label: "Not applicable", tone: "neutral" };
  }
  if (!task.nextDueDate) {
    return { label: "Upcoming", tone: "neutral" };
  }
  if (task.nextDueDate < today) {
    return { label: "Overdue", tone: "danger" };
  }
  if (task.nextDueDate === today) {
    return { label: "Due", tone: "warning" };
  }
  return { label: "Upcoming", tone: "neutral" };
}

export function OrganizationNonprofitCompliancePanel({
  timezone,
}: {
  readonly timezone?: string | null;
}) {
  const effectiveTimezone = timezone ?? "UTC";
  const [settings, setSettings] = useState<NonprofitComplianceSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Completion modal state
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const completionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [completionDate, setCompletionDate] = useState<string>("");

  // The active task draft is registered with the shared SaveBar and navigation guard.
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmation();
  const [editBaseline, setEditBaseline] = useState<ComplianceDraft | null>(null);
  const editor = usePersistedDraft<ComplianceDraft>({
    initialValue: editBaseline,
    resourceKey: "organization-compliance-task",
    save: async (snapshot) => {
      const updated = await updateComplianceTask(snapshot.taskId, {
        applicable: snapshot.applicable,
        nextDueDate: snapshot.nextDueDate || null,
        recurrenceMonths: snapshot.recurrenceMonths,
      });
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

  async function handleToggle(enabled: boolean) {
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
          : "Nonprofit compliance tracking paused. All reminders stopped.",
      );
    } catch {
      setError("Failed to update nonprofit setting. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function startEditing(task: NonprofitComplianceTask) {
    if (!(await leaveEditor())) return;
    const next = taskDraft(task);
    setEditingTaskId(task.id);
    setEditBaseline(next);
    if (editor.draft) editor.replaceDraft(next);
    setError(null);
    setSuccess(null);
  }

  async function startCompletion(task: NonprofitComplianceTask, trigger: HTMLButtonElement) {
    if (!(await leaveEditor())) return;
    completionTriggerRef.current = trigger;
    setCompletingTaskId(task.id);
    setCompletionDate(today);
    setError(null);
    setSuccess(null);
  }

  async function handleConfirmCompletion() {
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

  const completingTask = settings?.tasks.find((task) => task.id === completingTaskId);

  return (
    <fieldset className="surface-card organization-settings-panel">
      <legend id="nonprofit-compliance-title">Nonprofit compliance</legend>
      {loading ? <p role="status">Loading nonprofit compliance settings…</p> : null}

      {error || editor.error ? (
        <div className="notice notice--error" role="alert">
          <p>{error ?? editor.error}</p>
        </div>
      ) : null}

      {success ? (
        <div className="notice notice--success" role="status">
          <p>{success}</p>
        </div>
      ) : null}

      {!loading && settings ? (
        <div className="form-stack settings-form">
          <div className="field-checkbox">
            <label htmlFor="nonprofit-enabled-checkbox">
              <input
                checked={settings.enabled}
                disabled={operationBusy}
                id="nonprofit-enabled-checkbox"
                onChange={(e) => {
                  void handleToggle(e.target.checked);
                }}
                type="checkbox"
              />
              <span>This Organization is a nonprofit organization</span>
            </label>
          </div>

          {settings.enabled ? (
            <div className="compliance-tracker-container" style={{ marginTop: "1rem" }}>
              <p className="field__hint" style={{ marginBottom: "1rem" }}>
                Track recurring filing requirements. Weekly reminders are sent to all Organization
                Owners and Administrators starting on the stored due date until marked complete.
              </p>

              <div className="compliance-tasks-list" style={{ display: "grid", gap: "1rem" }}>
                {settings.tasks.map((task) => {
                  const status = calculateTaskStatus(task, today);
                  const isEditing = editingTaskId === task.id;

                  return (
                    <div
                      key={task.id}
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
                        <div>
                          <strong style={{ display: "block", fontSize: "1rem" }}>
                            {task.title}
                          </strong>
                          <span
                            aria-label={`Status: ${status.label}`}
                            className={`status-pill status-pill--${status.tone}`}
                            style={{
                              display: "inline-block",
                              fontSize: "0.8125rem",
                              fontWeight: 600,
                              marginTop: "0.25rem",
                            }}
                          >
                            Status: {status.label}
                          </span>
                        </div>

                        {!isEditing && task.applicable ? (
                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            <button
                              className="button button--secondary button--sm"
                              disabled={operationBusy}
                              onClick={() => {
                                void startEditing(task);
                              }}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="button button--primary button--sm"
                              disabled={operationBusy}
                              onClick={(event) => {
                                void startCompletion(task, event.currentTarget);
                              }}
                              type="button"
                            >
                              Mark completed
                            </button>
                          </div>
                        ) : !isEditing ? (
                          <button
                            className="button button--secondary button--sm"
                            disabled={operationBusy}
                            onClick={() => {
                              void startEditing(task);
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                        ) : null}
                      </div>

                      {isEditing ? (
                        <div
                          className="form-stack"
                          style={{
                            borderTop: "1px solid var(--color-border-subtle)",
                            marginTop: "0.75rem",
                            paddingTop: "0.75rem",
                          }}
                        >
                          <div className="field-checkbox">
                            <label htmlFor={`task-applicable-${task.id}`}>
                              <input
                                checked={editor.draft?.applicable ?? task.applicable}
                                id={`task-applicable-${task.id}`}
                                onChange={(e) => {
                                  editor.updateField("applicable", e.target.checked);
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
                                  editor.updateField("nextDueDate", e.target.value);
                                }}
                                type="date"
                                value={editor.draft?.nextDueDate ?? ""}
                              />
                            </div>

                            <div className="field">
                              <label htmlFor={`task-recurrence-${task.id}`}>
                                Recurrence (months)
                              </label>
                              <NumberInput
                                id={`task-recurrence-${task.id}`}
                                max={120}
                                min={1}
                                onChange={(e) => {
                                  editor.updateField("recurrenceMonths", Number(e.target.value));
                                }}
                                value={editor.draft?.recurrenceMonths ?? task.recurrenceMonths}
                              />
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                            <button
                              className="button button--primary button--sm"
                              disabled={operationBusy}
                              onClick={() => {
                                void editor.save();
                              }}
                              type="button"
                            >
                              Save changes
                            </button>
                            <button
                              className="button button--secondary button--sm"
                              disabled={operationBusy}
                              onClick={() => {
                                void leaveEditor().then((allowed) => {
                                  if (allowed) setEditingTaskId(null);
                                });
                              }}
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "grid",
                            fontSize: "0.875rem",
                            gap: "0.5rem",
                            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                          }}
                        >
                          <div>
                            <span style={{ color: "var(--color-text-subtle)", display: "block" }}>
                              Next due:
                            </span>
                            <span>{task.nextDueDate ?? "Not set"}</span>
                          </div>
                          <div>
                            <span style={{ color: "var(--color-text-subtle)", display: "block" }}>
                              Last completed:
                            </span>
                            <span>{task.lastCompletedDate ?? "None recorded"}</span>
                          </div>
                          <div>
                            <span style={{ color: "var(--color-text-subtle)", display: "block" }}>
                              Recurrence:
                            </span>
                            <span>Every {task.recurrenceMonths} months</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {completingTask ? (
        <Dialog
          open
          title={`Mark ${completingTask.title} complete`}
          description="Record the filing completion date."
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            completionTriggerRef.current?.focus();
          }}
          onClose={() => {
            if (!operationBusy) setCompletingTaskId(null);
          }}
        >
          {error ? <p role="alert">{error}</p> : null}
          <p className="field__hint">
            Record when this filing was completed. The next due date will automatically advance by{" "}
            {completingTask.recurrenceMonths} months from the cycle deadline without drift.
          </p>

          <div className="field" style={{ margin: "1rem 0" }}>
            <label htmlFor="completion-date-input">Completion date</label>
            <input
              id="completion-date-input"
              onChange={(e) => {
                setCompletionDate(e.target.value);
              }}
              required
              type="date"
              value={completionDate}
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
              disabled={operationBusy || completionDate.trim().length === 0}
              onClick={() => {
                void handleConfirmCompletion();
              }}
              type="button"
            >
              Confirm completion
            </button>
          </div>
        </Dialog>
      ) : null}
      {confirmationDialog}
    </fieldset>
  );
}
