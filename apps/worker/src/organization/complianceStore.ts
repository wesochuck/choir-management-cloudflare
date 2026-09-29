import type { SqlStorageValue } from "@cloudflare/workers-types";
import {
  nonprofitComplianceTaskKindSchema,
  type NonprofitComplianceTask,
  type NonprofitComplianceTaskKind,
} from "@choir/contracts";
import {
  addDaysToIsoDateTime,
  datePartInTimeZone,
  isValidDateOnlyString,
  nextDueDateFromCompletion,
} from "@choir/domain";

export interface ComplianceStoreStorage {
  readonly sql: {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: readonly unknown[]
    ): {
      toArray(): T[];
    };
  };
  transactionSync<T>(fn: () => T): T;
}

export const DEFAULT_COMPLIANCE_TASKS: readonly {
  readonly kind: NonprofitComplianceTaskKind;
  readonly recurrenceMonths: number;
  readonly title: string;
}[] = [
  {
    kind: "irs_annual_return",
    recurrenceMonths: 12,
    title: "IRS annual return (Form 990 / 990-EZ / 990-N as applicable)",
  },
  {
    kind: "ohio_ag_annual_report",
    recurrenceMonths: 12,
    title: "Ohio Attorney General annual charitable report",
  },
  {
    kind: "ohio_continued_existence",
    recurrenceMonths: 60,
    title: "Ohio Secretary of State Statement of Continued Existence",
  },
];

interface ComplianceTaskRow {
  readonly [column: string]: SqlStorageValue;
  readonly applicable: number;
  readonly id: string;
  readonly kind: string;
  readonly last_completed_date: string | null;
  readonly next_due_date: string | null;
  readonly next_reminder_at: string | null;
  readonly recurrence_months: number;
  readonly reminder_interval_days: number;
  readonly title: string;
}

interface ComplianceActor {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

function rowToTask(row: ComplianceTaskRow): NonprofitComplianceTask {
  return {
    applicable: row.applicable === 1,
    id: row.id,
    kind: nonprofitComplianceTaskKindSchema.parse(row.kind),
    lastCompletedDate: row.last_completed_date,
    nextDueDate: row.next_due_date,
    nextReminderAt: row.next_reminder_at,
    recurrenceMonths: row.recurrence_months,
    reminderIntervalDays: row.reminder_interval_days,
    title: row.title,
  };
}

function readNonprofitEnabled(storage: ComplianceStoreStorage): boolean {
  const row = storage.sql
    .exec<{ readonly nonprofit_enabled: number }>(
      "SELECT nonprofit_enabled FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  return (row?.nonprofit_enabled ?? 0) === 1;
}

function readOrganizationTimezone(storage: ComplianceStoreStorage): string {
  const row = storage.sql
    .exec<{ readonly timezone: string }>("SELECT timezone FROM organization_metadata LIMIT 1")
    .toArray()
    .at(0);
  return row?.timezone ?? "UTC";
}

function writeAuditEvent(
  storage: ComplianceStoreStorage,
  actor: ComplianceActor,
  action: string,
  summary: Record<string, unknown>,
  occurredAt: string,
): void {
  storage.sql.exec(
    `INSERT INTO audit_events
      (id, actor_type, actor_id, action, target_type, target_id,
       request_id, change_summary, occurred_at)
     VALUES (?, 'organization_member', ?, ?, 'organization', ?, ?, ?, ?)`,
    crypto.randomUUID(),
    actor.actorUserId,
    action,
    actor.organizationId,
    actor.requestId,
    JSON.stringify(summary),
    occurredAt,
  );
}

export function readNonprofitComplianceFromStore(storage: ComplianceStoreStorage): {
  readonly enabled: boolean;
  readonly tasks: readonly NonprofitComplianceTask[];
} {
  const tasks = storage.sql
    .exec<ComplianceTaskRow>(
      `SELECT id, kind, title, applicable, recurrence_months, next_due_date,
        last_completed_date, next_reminder_at, reminder_interval_days
       FROM organization_compliance_tasks ORDER BY kind`,
    )
    .toArray()
    .map(rowToTask);
  return { enabled: readNonprofitEnabled(storage), tasks };
}

export function setNonprofitEnabledInStore(
  storage: ComplianceStoreStorage,
  actor: ComplianceActor,
  enabled: boolean,
): { readonly enabled: boolean; readonly tasks: readonly NonprofitComplianceTask[] } {
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE organization_metadata SET nonprofit_enabled = ?, updated_at = ?",
      enabled ? 1 : 0,
      occurredAt,
    );
    if (enabled) {
      for (const seed of DEFAULT_COMPLIANCE_TASKS) {
        storage.sql.exec(
          `INSERT OR IGNORE INTO organization_compliance_tasks
            (id, kind, title, applicable, recurrence_months, next_due_date,
             last_completed_date, next_reminder_at, reminder_interval_days,
             created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, NULL, NULL, NULL, 7, ?, ?)`,
          crypto.randomUUID(),
          seed.kind,
          seed.title,
          seed.recurrenceMonths,
          occurredAt,
          occurredAt,
        );
      }
    }
    writeAuditEvent(
      storage,
      actor,
      enabled ? "organization.nonprofit.enabled" : "organization.nonprofit.disabled",
      {},
      occurredAt,
    );
  });
  return readNonprofitComplianceFromStore(storage);
}

export function updateComplianceTaskInStore(
  storage: ComplianceStoreStorage,
  actor: ComplianceActor,
  taskId: string,
  update: {
    readonly applicable?: boolean;
    readonly nextDueDate?: string | null;
    readonly recurrenceMonths?: number;
  },
): { readonly code?: string; readonly ok: boolean; readonly task?: NonprofitComplianceTask } {
  if (
    update.nextDueDate !== undefined &&
    update.nextDueDate !== null &&
    !isValidDateOnlyString(update.nextDueDate)
  ) {
    return { code: "validation_failed", ok: false };
  }
  if (
    update.recurrenceMonths !== undefined &&
    (!Number.isInteger(update.recurrenceMonths) ||
      update.recurrenceMonths < 1 ||
      update.recurrenceMonths > 120)
  ) {
    return { code: "validation_failed", ok: false };
  }
  const occurredAt = new Date().toISOString();
  const updated = storage.transactionSync((): NonprofitComplianceTask | null => {
    const existing = storage.sql
      .exec<ComplianceTaskRow>(
        "SELECT * FROM organization_compliance_tasks WHERE id = ? LIMIT 1",
        taskId,
      )
      .toArray()
      .at(0);
    if (!existing) return null;
    const nextDueDate =
      update.nextDueDate === undefined ? existing.next_due_date : update.nextDueDate;
    storage.sql.exec(
      `UPDATE organization_compliance_tasks
       SET applicable = ?, recurrence_months = ?, next_due_date = ?,
           next_reminder_at = CASE WHEN ? IS NOT NULL THEN NULL ELSE next_reminder_at END,
           updated_at = ?
       WHERE id = ?`,
      update.applicable === undefined ? existing.applicable : update.applicable ? 1 : 0,
      update.recurrenceMonths ?? existing.recurrence_months,
      nextDueDate,
      update.nextDueDate === undefined ? null : "reset",
      occurredAt,
      taskId,
    );
    writeAuditEvent(
      storage,
      actor,
      "organization.compliance.updated",
      { taskId, taskKind: existing.kind },
      occurredAt,
    );
    const refreshed = storage.sql
      .exec<ComplianceTaskRow>(
        "SELECT * FROM organization_compliance_tasks WHERE id = ? LIMIT 1",
        taskId,
      )
      .toArray()
      .at(0);
    return refreshed ? rowToTask(refreshed) : null;
  });
  if (updated === null) return { code: "not_found", ok: false };
  return { ok: true, task: updated };
}

export function completeComplianceTaskInStore(
  storage: ComplianceStoreStorage,
  actor: ComplianceActor,
  taskId: string,
  completedDate: string | null,
  now: Date,
): { readonly code?: string; readonly ok: boolean; readonly task?: NonprofitComplianceTask } {
  if (completedDate !== null && !isValidDateOnlyString(completedDate)) {
    return { code: "validation_failed", ok: false };
  }
  const timezone = readOrganizationTimezone(storage);
  const effectiveCompletedDate = completedDate ?? datePartInTimeZone(now, timezone);
  const occurredAt = now.toISOString();
  const updated = storage.transactionSync((): NonprofitComplianceTask | null => {
    const existing = storage.sql
      .exec<ComplianceTaskRow>(
        "SELECT * FROM organization_compliance_tasks WHERE id = ? LIMIT 1",
        taskId,
      )
      .toArray()
      .at(0);
    if (!existing) return null;
    const cycleDueDate = existing.next_due_date ?? effectiveCompletedDate;
    storage.sql.exec(
      `INSERT INTO organization_compliance_completions
        (id, task_id, cycle_due_date, completed_date, completed_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      taskId,
      cycleDueDate,
      effectiveCompletedDate,
      actor.actorUserId,
      occurredAt,
    );
    const nextDueDate = nextDueDateFromCompletion(cycleDueDate, existing.recurrence_months);
    storage.sql.exec(
      `UPDATE organization_compliance_tasks
       SET last_completed_date = ?, next_due_date = ?, next_reminder_at = NULL, updated_at = ?
       WHERE id = ?`,
      effectiveCompletedDate,
      nextDueDate,
      occurredAt,
      taskId,
    );
    writeAuditEvent(
      storage,
      actor,
      "organization.compliance.completed",
      { cycleDueDate, completedDate: effectiveCompletedDate, taskId, taskKind: existing.kind },
      occurredAt,
    );
    const refreshed = storage.sql
      .exec<ComplianceTaskRow>(
        "SELECT * FROM organization_compliance_tasks WHERE id = ? LIMIT 1",
        taskId,
      )
      .toArray()
      .at(0);
    return refreshed ? rowToTask(refreshed) : null;
  });
  if (updated === null) return { code: "not_found", ok: false };
  return { ok: true, task: updated };
}

export interface DueComplianceReminder {
  readonly cycleDueDate: string;
  readonly occurrenceDate: string;
  readonly task: NonprofitComplianceTask;
}

export function findDueComplianceReminders(
  storage: ComplianceStoreStorage,
  now: Date,
): readonly DueComplianceReminder[] {
  if (!readNonprofitEnabled(storage)) return [];
  const today = datePartInTimeZone(now, readOrganizationTimezone(storage));
  const nowIso = now.toISOString();
  const rows = storage.sql
    .exec<ComplianceTaskRow>(
      `SELECT * FROM organization_compliance_tasks
       WHERE applicable = 1
         AND next_due_date IS NOT NULL
         AND next_due_date <= ?
         AND (next_reminder_at IS NULL OR next_reminder_at <= ?)
       ORDER BY next_due_date, kind`,
      today,
      nowIso,
    )
    .toArray();
  return rows.flatMap((row) => {
    if (row.next_due_date === null) return [];
    return [
      {
        cycleDueDate: row.next_due_date,
        occurrenceDate: row.next_reminder_at === null ? today : row.next_reminder_at.slice(0, 10),
        task: rowToTask(row),
      },
    ];
  });
}

export function advanceComplianceReminder(
  storage: ComplianceStoreStorage,
  taskId: string,
  fromReminderAt: string | null,
  occurredAt: string,
): void {
  const row = storage.sql
    .exec<{ readonly reminder_interval_days: number }>(
      "SELECT reminder_interval_days FROM organization_compliance_tasks WHERE id = ? LIMIT 1",
      taskId,
    )
    .toArray()
    .at(0);
  const intervalDays = row?.reminder_interval_days ?? 7;
  const base = fromReminderAt ?? occurredAt;
  storage.sql.exec(
    "UPDATE organization_compliance_tasks SET next_reminder_at = ?, updated_at = ? WHERE id = ?",
    addDaysToIsoDateTime(base, intervalDays),
    occurredAt,
    taskId,
  );
}
