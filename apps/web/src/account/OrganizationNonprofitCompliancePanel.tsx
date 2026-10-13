import { useEffect, useRef, useState } from "react";
import { useConfirmation } from "@choir/ui";
import { usePersistedDraft } from "../persistence";
import type {
  ComplianceAssignee,
  NonprofitComplianceSettingsResponse,
  NonprofitComplianceTask,
} from "@choir/contracts";
import { datePartInTimeZone } from "@choir/domain";
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

import { ComplianceCatalogView } from "./components/OrganizationNonprofitCompliancePanel/ComplianceCatalogView";
import { AddReminderDialog } from "./components/OrganizationNonprofitCompliancePanel/dialogs/AddReminderDialog";
import { CompletionDialog } from "./components/OrganizationNonprofitCompliancePanel/dialogs/CompletionDialog";
import {
  taskDraft,
  type AddDialogState,
  type ComplianceDraft,
  type TaskCardActions,
} from "./components/OrganizationNonprofitCompliancePanel/types";

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
      confirmLabel: "Discard changes",
      destructive: true,
      description: "Your unsaved compliance changes will be lost.",
      title: "Discard unsaved changes?",
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
      confirmLabel: "Archive reminder",
      destructive: true,
      description:
        "Archiving halts all future reminders for this task but retains completion and audit history. You can restore it later.",
      title: `Archive ${task.title}?`,
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
      confirmLabel: "Restore reminder",
      destructive: false,
      description:
        "Restoring re-enables scheduling from the stored due date. Update the due date first if the filing is already handled to avoid a past-due reminder.",
      title: `Restore ${task.title}?`,
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
          timezone={effectiveTimezone}
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
