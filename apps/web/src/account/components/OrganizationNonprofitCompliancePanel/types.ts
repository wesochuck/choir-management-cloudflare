import type { ComplianceAssignee, NonprofitComplianceTask } from "@choir/contracts";
import { complianceTaskStatus } from "@choir/domain";

export interface ComplianceDraft {
  readonly applicable: boolean;
  readonly description: string;
  readonly isCustom: boolean;
  readonly nextDueDate: string;
  readonly recurrenceMonths: number;
  readonly referenceUrl: string;
  readonly responsibleMembershipId: string;
  readonly taskId: string;
  readonly title: string;
}

export function taskDraft(task: NonprofitComplianceTask): ComplianceDraft {
  return {
    applicable: task.applicable,
    description: task.description,
    isCustom: task.source === "custom",
    nextDueDate: task.nextDueDate ?? "",
    recurrenceMonths: task.recurrenceMonths,
    referenceUrl: task.referenceUrl ?? "",
    responsibleMembershipId: task.responsibleMembershipId ?? "",
    taskId: task.id,
    title: task.title,
  };
}

export interface ComplianceStatus {
  readonly label: string;
  readonly tone: "neutral" | "success" | "warning" | "danger";
}

export function calculateTaskStatus(
  task: NonprofitComplianceTask,
  today: string,
): ComplianceStatus {
  const statuses: Record<ReturnType<typeof complianceTaskStatus>, ComplianceStatus> = {
    completed: { label: "Completed", tone: "success" },
    due: { label: "Due", tone: "warning" },
    not_applicable: { label: "Not applicable", tone: "neutral" },
    not_scheduled: { label: "Not scheduled", tone: "neutral" },
    overdue: { label: "Overdue", tone: "danger" },
    scheduled: { label: "Scheduled", tone: "neutral" },
    upcoming: { label: "Upcoming", tone: "neutral" },
  };
  return statuses[complianceTaskStatus(task, today)];
}

export function isCustomTask(task: NonprofitComplianceTask): boolean {
  return task.source === "custom";
}

export function formatDateOnlyLocal(value: string, timezone: string): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      timeZone: timezone,
      year: "numeric",
    }).format(date);
  } catch {
    return value;
  }
}

export function taskDueDisplay(task: NonprofitComplianceTask, timezone: string): string {
  if (!task.nextDueDate) return "Not set";
  return formatDateOnlyLocal(task.nextDueDate, timezone);
}

export function lastCompletedDisplay(task: NonprofitComplianceTask, timezone: string): string {
  if (!task.lastCompletedDate) return "None recorded";
  return formatDateOnlyLocal(task.lastCompletedDate, timezone);
}

export function recurrenceLabel(task: NonprofitComplianceTask): string {
  return `Every ${String(task.recurrenceMonths)} months`;
}

export function responsibleDisplay(
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

const STATUS_SEVERITY: Record<ReturnType<typeof complianceTaskStatus>, number> = {
  completed: 4,
  due: 1,
  not_applicable: 6,
  not_scheduled: 5,
  overdue: 0,
  scheduled: 3,
  upcoming: 2,
};

export function statusSortValue(task: NonprofitComplianceTask, today: string): string {
  const key = complianceTaskStatus(task, today);
  // Severity first so overdue/soonest surface; ISO dates sort chronologically
  // within a status. DataTable's stable sort preserves API order on ties.
  return `${String(STATUS_SEVERITY[key])}:${task.nextDueDate ?? ""}`;
}

export interface TaskCardActions {
  readonly onArchive: (task: NonprofitComplianceTask) => void;
  readonly onComplete: (task: NonprofitComplianceTask, trigger: HTMLButtonElement) => void;
  readonly onEdit: (task: NonprofitComplianceTask) => void;
}

export interface TaskEditorProps {
  readonly assignees: readonly ComplianceAssignee[];
  readonly draft: ComplianceDraft | null;
  readonly onCancel: () => void;
  readonly onField: (field: keyof ComplianceDraft, value: string | number | boolean) => void;
  readonly onSave: () => void;
  readonly operationBusy: boolean;
  readonly task: NonprofitComplianceTask;
}

export interface AddDialogState {
  readonly applicable: boolean;
  readonly description: string;
  readonly dueDate: string;
  readonly recurrence: number;
  readonly referenceUrl: string;
  readonly responsible: string;
  readonly title: string;
}
