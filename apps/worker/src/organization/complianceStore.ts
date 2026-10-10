import type { SqlStorageValue } from "@cloudflare/workers-types";
import {
  MAX_COMPLIANCE_TASKS,
  nonprofitComplianceTaskKindSchema,
  type NonprofitComplianceTask,
  type NonprofitComplianceTaskKind,
} from "@choir/contracts";
import {
  addDaysToDateOnly,
  addDaysToIsoDateTime,
  COMPLIANCE_REMINDER_LEAD_DAYS,
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

export const OHIO_UNCLAIMED_FUNDS_KIND = "ohio_unclaimed_funds_annual_report" as const;

export const OHIO_UNCLAIMED_FUNDS_HELP = {
  description:
    "Review unclaimed funds annually and file the required holder report or negative/no-property report, where applicable. " +
    "Ohio Admin. Code 1301:10-3-03(B) requires a holder with no unclaimed funds for the period to file a certified negative report. " +
    "State guidance identifies exemptions, including some 501(c)(3) hospitals and political subdivisions. " +
    "Applicability is an Organization decision; this tracker does not determine whether a filing is legally required. " +
    "If owner due-diligence notices are required, they must occur before reporting. Suggested date only, not legal advice.",
  referenceUrl: "https://unclaimedfunds.ohio.gov/app/submit-a-report",
} as const;

export const DEFAULT_COMPLIANCE_TASKS: readonly {
  readonly description: string;
  readonly kind: NonprofitComplianceTaskKind;
  readonly recurrenceMonths: number;
  readonly referenceUrl: string | null;
  readonly title: string;
}[] = [
  {
    description: "",
    kind: "irs_annual_return",
    recurrenceMonths: 12,
    referenceUrl: null,
    title: "IRS annual return (Form 990 / 990-EZ / 990-N as applicable)",
  },
  {
    description: "",
    kind: "ohio_ag_annual_report",
    recurrenceMonths: 12,
    referenceUrl: null,
    title: "Ohio Attorney General annual charitable report",
  },
  {
    description: "",
    kind: "ohio_continued_existence",
    recurrenceMonths: 60,
    referenceUrl: null,
    title: "Ohio Secretary of State Statement of Continued Existence",
  },
  {
    description: OHIO_UNCLAIMED_FUNDS_HELP.description,
    kind: OHIO_UNCLAIMED_FUNDS_KIND,
    recurrenceMonths: 12,
    referenceUrl: OHIO_UNCLAIMED_FUNDS_HELP.referenceUrl,
    title: "Ohio Annual Unclaimed Funds Report (including negative reports)",
  },
];

interface ComplianceTaskRow {
  readonly [column: string]: SqlStorageValue;
  readonly applicable: number;
  readonly archived: number | null;
  readonly description: string | null;
  readonly id: string;
  readonly kind: string | null;
  readonly last_completed_date: string | null;
  readonly last_completed_by_user_id?: string | null;
  readonly next_due_date: string | null;
  readonly next_reminder_at: string | null;
  readonly recurrence_months: number;
  readonly reference_url: string | null;
  readonly reminder_interval_days: number;
  readonly responsible_membership_id: string | null;
  readonly responsible_user_id: string | null;
  readonly source: string | null;
  readonly template_key: string | null;
  readonly title: string;
}

interface ComplianceActor {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

function rowToTask(row: ComplianceTaskRow): NonprofitComplianceTask {
  const kindParsed =
    typeof row.kind === "string" && row.kind.length > 0
      ? nonprofitComplianceTaskKindSchema.safeParse(row.kind)
      : null;
  const kind = kindParsed?.success ? kindParsed.data : null;
  const source = row.source === "custom" ? "custom" : "builtin";
  return {
    applicable: row.applicable === 1,
    archived: (row.archived ?? 0) === 1,
    description: row.description ?? "",
    id: row.id,
    kind,
    lastCompletedDate: row.last_completed_date,
    lastCompletedByUserId: row.last_completed_by_user_id ?? null,
    nextDueDate: row.next_due_date,
    nextReminderAt: row.next_reminder_at,
    recurrenceMonths: row.recurrence_months,
    referenceUrl: row.reference_url,
    reminderIntervalDays: row.reminder_interval_days,
    responsibleMembershipId: row.responsible_membership_id,
    responsibleUserId: row.responsible_user_id,
    responsibleName: null,
    responsibleEmail: null,
    responsibleNeedsReassignment: false,
    source,
    templateKey: typeof row.template_key === "string" ? row.template_key : (kind ?? null),
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

function columnExists(storage: ComplianceStoreStorage, column: string): boolean {
  const columns = storage.sql
    .exec<{ readonly name: string }>("PRAGMA table_info(organization_compliance_tasks)")
    .toArray();
  return columns.some((entry) => entry.name === column);
}

function readComplianceTaskRow(storage: ComplianceStoreStorage, taskId: string) {
  const hasCatalog = columnExists(storage, "archived");
  if (!hasCatalog) {
    return storage.sql
      .exec<ComplianceTaskRow>(
        `SELECT task.*,
          (SELECT completed_by_user_id FROM organization_compliance_completions
           WHERE task_id = task.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
            AS last_completed_by_user_id
         FROM organization_compliance_tasks task WHERE task.id = ? LIMIT 1`,
        taskId,
      )
      .toArray()
      .at(0);
  }
  return storage.sql
    .exec<ComplianceTaskRow>(
      `SELECT task.*,
        (SELECT completed_by_user_id FROM organization_compliance_completions
         WHERE task_id = task.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
          AS last_completed_by_user_id
       FROM organization_compliance_tasks task WHERE task.id = ? LIMIT 1`,
      taskId,
    )
    .toArray()
    .at(0);
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

function isSafeReferenceUrl(value: string | null): boolean {
  if (value === null || value.trim().length === 0) return true;
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(value.trim());
}

function isValidComplianceTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length >= 1 && trimmed.length <= 200;
}

function isValidComplianceDescription(description: string | undefined): boolean {
  if (description === undefined) return true;
  return description.trim().length <= 2000;
}

function normalizeComplianceReferenceUrl(input: string | null | undefined): {
  readonly ok: boolean;
  readonly value: string | null;
} {
  if (input === undefined || input === null) return { ok: true, value: null };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > 2048 || !isSafeReferenceUrl(trimmed)) return { ok: false, value: null };
  return { ok: true, value: trimmed };
}

function isValidComplianceDueDate(date: string | null | undefined): boolean {
  if (date === undefined || date === null) return true;
  return isValidDateOnlyString(date);
}

function isValidComplianceRecurrenceValue(months: number): boolean {
  return Number.isInteger(months) && months >= 1 && months <= 120;
}

function isValidComplianceMembershipId(id: string | null | undefined): boolean {
  if (id === undefined || id === null) return true;
  const trimmed = id.trim();
  return trimmed.length >= 1 && trimmed.length <= 128;
}

function isBuiltinIdentityEdit(update: {
  readonly description?: string;
  readonly referenceUrl?: string | null;
  readonly title?: string;
}): boolean {
  return (
    update.title !== undefined ||
    update.description !== undefined ||
    update.referenceUrl !== undefined
  );
}

interface ComplianceUpdateValues {
  readonly applicable: number;
  readonly description: string;
  readonly nextDueDate: string | null;
  readonly recurrenceMonths: number;
  readonly referenceUrl: string | null;
  readonly responsibleMembershipId: string | null;
  readonly responsibleUserId: string | null;
  readonly title: string;
}

function resolveUpdateReferenceUrl(
  existing: ComplianceTaskRow,
  referenceInput: string | null | undefined,
): string | null {
  if (referenceInput === undefined) return existing.reference_url ?? null;
  if (referenceInput === null || referenceInput.trim().length === 0) return null;
  return referenceInput.trim();
}

function buildComplianceUpdateValues(
  existing: ComplianceTaskRow,
  update: {
    readonly applicable?: boolean;
    readonly description?: string;
    readonly nextDueDate?: string | null;
    readonly recurrenceMonths?: number;
    readonly referenceUrl?: string | null;
    readonly responsibleMembershipId?: string | null;
    readonly responsibleUserId?: string | null;
    readonly title?: string;
  },
): ComplianceUpdateValues {
  const referenceUrl = resolveUpdateReferenceUrl(existing, update.referenceUrl);
  return {
    applicable: update.applicable === undefined ? existing.applicable : update.applicable ? 1 : 0,
    description:
      update.description === undefined ? (existing.description ?? "") : update.description.trim(),
    nextDueDate: update.nextDueDate === undefined ? existing.next_due_date : update.nextDueDate,
    recurrenceMonths: update.recurrenceMonths ?? existing.recurrence_months,
    referenceUrl,
    responsibleMembershipId:
      update.responsibleMembershipId === undefined
        ? (existing.responsible_membership_id ?? null)
        : update.responsibleMembershipId,
    responsibleUserId:
      update.responsibleUserId === undefined
        ? (existing.responsible_user_id ?? null)
        : update.responsibleUserId,
    title: update.title === undefined ? existing.title : update.title.trim(),
  };
}

/**
 * Conservative suggested target for the Ohio unclaimed-funds report: October 31
 * of the current year when still in the future in the Organization timezone,
 * otherwise October 31 of the following year. Callers must treat this as a
 * suggestion, never legal advice, and must never backfill overdue blasts.
 */
export function suggestedOhioUnclaimedFundsDueDate(timezone: string, now: Date): string {
  const today = datePartInTimeZone(now, timezone);
  const year = Number(today.slice(0, 4));
  const candidateThisYear = `${String(year).padStart(4, "0")}-10-31`;
  if (today <= candidateThisYear) return candidateThisYear;
  return `${String(year + 1).padStart(4, "0")}-10-31`;
}

function seedBuiltinTasks(storage: ComplianceStoreStorage, occurredAt: string): void {
  const timezone = readOrganizationTimezone(storage);
  const ohioDueDate = suggestedOhioUnclaimedFundsDueDate(timezone, new Date(occurredAt));
  for (const seed of DEFAULT_COMPLIANCE_TASKS) {
    const isOhioUnclaimed = seed.kind === OHIO_UNCLAIMED_FUNDS_KIND;
    if (columnExists(storage, "archived")) {
      storage.sql.exec(
        `INSERT OR IGNORE INTO organization_compliance_tasks
          (id, kind, template_key, source, title, description, reference_url,
           applicable, archived, recurrence_months, next_due_date,
           last_completed_date, next_reminder_at, reminder_interval_days,
           responsible_membership_id, responsible_user_id, created_at, updated_at)
         VALUES (?, ?, ?, 'builtin', ?, ?, ?, 1, 0, ?, ?, NULL, NULL, 7, NULL, NULL, ?, ?)`,
        crypto.randomUUID(),
        seed.kind,
        seed.kind,
        seed.title,
        seed.description,
        seed.referenceUrl,
        seed.recurrenceMonths,
        isOhioUnclaimed ? ohioDueDate : null,
        occurredAt,
        occurredAt,
      );
    } else {
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
}

export function readNonprofitComplianceFromStore(storage: ComplianceStoreStorage): {
  readonly enabled: boolean;
  readonly tasks: readonly NonprofitComplianceTask[];
} {
  const hasCatalog = columnExists(storage, "archived");
  const orderBy = hasCatalog
    ? "ORDER BY CASE WHEN task.source = 'custom' THEN 1 ELSE 0 END, task.kind, task.title, task.id"
    : "ORDER BY task.kind";
  const tasks = storage.sql
    .exec<ComplianceTaskRow>(
      `SELECT task.id, task.kind, task.title, task.applicable, task.recurrence_months,
        task.next_due_date, task.last_completed_date, task.next_reminder_at,
        task.reminder_interval_days,
        ${hasCatalog ? "task.source, task.template_key, task.description, task.reference_url, task.archived, task.responsible_membership_id, task.responsible_user_id," : ""}
        (SELECT completed_by_user_id FROM organization_compliance_completions
         WHERE task_id = task.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
          AS last_completed_by_user_id
       FROM organization_compliance_tasks task ${orderBy}`,
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
      seedBuiltinTasks(storage, occurredAt);
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

export function createComplianceTaskInStore(
  storage: ComplianceStoreStorage,
  actor: ComplianceActor,
  input: {
    readonly applicable?: boolean;
    readonly description?: string;
    readonly nextDueDate?: string | null;
    readonly recurrenceMonths?: number;
    readonly referenceUrl?: string | null;
    readonly responsibleMembershipId?: string | null;
    readonly responsibleUserId?: string | null;
    readonly title: string;
  },
): { readonly code?: string; readonly ok: boolean; readonly task?: NonprofitComplianceTask } {
  if (!isValidComplianceTitle(input.title)) return { code: "validation_failed", ok: false };
  if (!isValidComplianceDescription(input.description)) {
    return { code: "validation_failed", ok: false };
  }
  const reference = normalizeComplianceReferenceUrl(input.referenceUrl);
  if (!reference.ok) return { code: "validation_failed", ok: false };
  if (!isValidComplianceDueDate(input.nextDueDate)) {
    return { code: "validation_failed", ok: false };
  }
  const recurrenceMonths = input.recurrenceMonths ?? 12;
  if (!isValidComplianceRecurrenceValue(recurrenceMonths)) {
    return { code: "validation_failed", ok: false };
  }
  if (!isValidComplianceMembershipId(input.responsibleMembershipId)) {
    return { code: "validation_failed", ok: false };
  }
  const title = input.title.trim();
  const description = (input.description ?? "").trim();
  const referenceUrl = reference.value;
  const occurredAt = new Date().toISOString();
  const created = storage.transactionSync((): NonprofitComplianceTask | null => {
    const countRow = storage.sql
      .exec<{ readonly count: number }>(
        "SELECT COUNT(*) AS count FROM organization_compliance_tasks",
      )
      .toArray()
      .at(0);
    if ((countRow?.count ?? 0) >= MAX_COMPLIANCE_TASKS) return null;
    const taskId = crypto.randomUUID();
    storage.sql.exec(
      `INSERT INTO organization_compliance_tasks
        (id, kind, template_key, source, title, description, reference_url,
         applicable, archived, recurrence_months, next_due_date,
         last_completed_date, next_reminder_at, reminder_interval_days,
         responsible_membership_id, responsible_user_id, created_at, updated_at)
       VALUES (?, NULL, NULL, 'custom', ?, ?, ?, ?, 0, ?, ?, NULL, NULL, 7, ?, ?, ?, ?)`,
      taskId,
      title,
      description,
      referenceUrl,
      input.applicable === undefined ? 1 : input.applicable ? 1 : 0,
      recurrenceMonths,
      input.nextDueDate ?? null,
      input.responsibleMembershipId ?? null,
      input.responsibleUserId ?? null,
      occurredAt,
      occurredAt,
    );
    writeAuditEvent(storage, actor, "organization.compliance.created", { taskId }, occurredAt);
    const refreshed = readComplianceTaskRow(storage, taskId);
    return refreshed ? rowToTask(refreshed) : null;
  });
  if (created === null) {
    const countRow = storage.sql
      .exec<{ readonly count: number }>(
        "SELECT COUNT(*) AS count FROM organization_compliance_tasks",
      )
      .toArray()
      .at(0);
    if ((countRow?.count ?? 0) >= MAX_COMPLIANCE_TASKS) {
      return { code: "task_limit_reached", ok: false };
    }
    return { code: "service_unavailable", ok: false };
  }
  return { ok: true, task: created };
}

export function updateComplianceTaskInStore(
  storage: ComplianceStoreStorage,
  actor: ComplianceActor,
  taskId: string,
  update: {
    readonly applicable?: boolean;
    readonly description?: string;
    readonly nextDueDate?: string | null;
    readonly recurrenceMonths?: number;
    readonly referenceUrl?: string | null;
    readonly responsibleMembershipId?: string | null;
    readonly responsibleUserId?: string | null;
    readonly title?: string;
  },
): { readonly code?: string; readonly ok: boolean; readonly task?: NonprofitComplianceTask } {
  if (!isValidComplianceDueDate(update.nextDueDate)) {
    return { code: "validation_failed", ok: false };
  }
  if (
    update.recurrenceMonths !== undefined &&
    !isValidComplianceRecurrenceValue(update.recurrenceMonths)
  ) {
    return { code: "validation_failed", ok: false };
  }
  if (update.title !== undefined && !isValidComplianceTitle(update.title)) {
    return { code: "validation_failed", ok: false };
  }
  if (!isValidComplianceDescription(update.description)) {
    return { code: "validation_failed", ok: false };
  }
  if (update.referenceUrl !== undefined) {
    const reference = normalizeComplianceReferenceUrl(update.referenceUrl);
    if (!reference.ok) return { code: "validation_failed", ok: false };
  }
  if (!isValidComplianceMembershipId(update.responsibleMembershipId)) {
    return { code: "validation_failed", ok: false };
  }
  const occurredAt = new Date().toISOString();
  try {
    const updated = storage.transactionSync((): NonprofitComplianceTask | null =>
      applyComplianceUpdate(storage, actor, taskId, update, occurredAt),
    );
    if (updated === null) return { code: "not_found", ok: false };
    return { ok: true, task: updated };
  } catch (error) {
    if (error instanceof Error && error.message === "builtin_identity_immutable") {
      return { code: "validation_failed", ok: false };
    }
    throw error;
  }
}

function applyComplianceUpdate(
  storage: ComplianceStoreStorage,
  actor: ComplianceActor,
  taskId: string,
  update: {
    readonly applicable?: boolean;
    readonly description?: string;
    readonly nextDueDate?: string | null;
    readonly recurrenceMonths?: number;
    readonly referenceUrl?: string | null;
    readonly responsibleMembershipId?: string | null;
    readonly responsibleUserId?: string | null;
    readonly title?: string;
  },
  occurredAt: string,
): NonprofitComplianceTask | null {
  const existing = readComplianceTaskRow(storage, taskId);
  if (!existing) return null;
  const existingSource = existing.source === "custom" ? "custom" : "builtin";
  if (existing.archived === 1) return null;
  if (existingSource === "builtin" && isBuiltinIdentityEdit(update)) {
    throw new Error("builtin_identity_immutable");
  }
  const values = buildComplianceUpdateValues(existing, update);
  storage.sql.exec(
    `UPDATE organization_compliance_tasks
     SET applicable = ?, recurrence_months = ?, next_due_date = ?,
         title = ?, description = ?, reference_url = ?,
         responsible_membership_id = ?, responsible_user_id = ?,
         next_reminder_at = CASE WHEN ? IS NOT NULL THEN NULL ELSE next_reminder_at END,
         updated_at = ?
     WHERE id = ?`,
    values.applicable,
    values.recurrenceMonths,
    values.nextDueDate,
    values.title,
    values.description,
    values.referenceUrl,
    values.responsibleMembershipId,
    values.responsibleUserId,
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
  const refreshed = readComplianceTaskRow(storage, taskId);
  return refreshed ? rowToTask(refreshed) : null;
}

export function archiveComplianceTaskInStore(
  storage: ComplianceStoreStorage,
  actor: ComplianceActor,
  taskId: string,
): { readonly code?: string; readonly ok: boolean; readonly task?: NonprofitComplianceTask } {
  const occurredAt = new Date().toISOString();
  try {
    const updated = storage.transactionSync((): NonprofitComplianceTask | null => {
      const existing = readComplianceTaskRow(storage, taskId);
      if (!existing) return null;
      if ((existing.source ?? "builtin") === "builtin") {
        throw new Error("builtin_not_archivable");
      }
      if (existing.archived === 1) return rowToTask(existing);
      storage.sql.exec(
        `UPDATE organization_compliance_tasks
         SET archived = 1, next_reminder_at = NULL, updated_at = ?
         WHERE id = ?`,
        occurredAt,
        taskId,
      );
      writeAuditEvent(
        storage,
        actor,
        "organization.compliance.archived",
        { taskId, taskKind: existing.kind },
        occurredAt,
      );
      const refreshed = readComplianceTaskRow(storage, taskId);
      return refreshed ? rowToTask(refreshed) : null;
    });
    if (updated === null) return { code: "not_found", ok: false };
    return { ok: true, task: updated };
  } catch (error) {
    if (error instanceof Error && error.message === "builtin_not_archivable") {
      return { code: "builtin_not_archivable", ok: false };
    }
    throw error;
  }
}

export function restoreComplianceTaskInStore(
  storage: ComplianceStoreStorage,
  actor: ComplianceActor,
  taskId: string,
): { readonly code?: string; readonly ok: boolean; readonly task?: NonprofitComplianceTask } {
  const occurredAt = new Date().toISOString();
  const updated = storage.transactionSync((): NonprofitComplianceTask | null => {
    const existing = readComplianceTaskRow(storage, taskId);
    if (!existing) return null;
    if (existing.archived !== 1) return rowToTask(existing);
    storage.sql.exec(
      `UPDATE organization_compliance_tasks
       SET archived = 0, next_reminder_at = NULL, updated_at = ?
       WHERE id = ?`,
      occurredAt,
      taskId,
    );
    writeAuditEvent(
      storage,
      actor,
      "organization.compliance.restored",
      { taskId, taskKind: existing.kind },
      occurredAt,
    );
    const refreshed = readComplianceTaskRow(storage, taskId);
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
    const existing = readComplianceTaskRow(storage, taskId);
    if (!existing) return null;
    if (existing.archived === 1) return null;
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
    const refreshed = readComplianceTaskRow(storage, taskId);
    return refreshed ? rowToTask(refreshed) : null;
  });
  if (updated === null) {
    const existing = readComplianceTaskRow(storage, taskId);
    if (!existing) return { code: "not_found", ok: false };
    return { code: "validation_failed", ok: false };
  }
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
  const enabled = readNonprofitEnabled(storage);
  const hasCatalog = columnExists(storage, "archived");
  const today = datePartInTimeZone(now, readOrganizationTimezone(storage));
  const nowIso = now.toISOString();
  const sourceFilter = hasCatalog
    ? enabled
      ? "AND (task.source IS NULL OR task.source = 'builtin' OR task.source = 'custom')"
      : "AND task.source = 'custom'"
    : enabled
      ? ""
      : "AND 1 = 0";
  if (!hasCatalog && !enabled) return [];
  const archivedFilter = hasCatalog ? "AND task.archived = 0" : "";
  const rows = storage.sql
    .exec<ComplianceTaskRow>(
      `SELECT * FROM organization_compliance_tasks task
       WHERE task.applicable = 1
         ${archivedFilter}
         ${sourceFilter}
         AND task.next_due_date IS NOT NULL
         AND task.next_due_date <= ?
         AND (task.next_reminder_at IS NULL OR task.next_reminder_at <= ?)
       ORDER BY task.next_due_date, task.kind, task.id`,
      addDaysToDateOnly(today, COMPLIANCE_REMINDER_LEAD_DAYS),
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
