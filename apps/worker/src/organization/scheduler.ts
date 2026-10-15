import type { DeliveryJob } from "../jobs/contracts";
import { recordDatabaseCost } from "../observability/databaseCost";
import { areAuditionDatesPassed, POLL_ARCHIVE_DELAY_DAYS } from "@choir/domain";
import {
  organizationAuditionSettingsSchema,
  type OrganizationAuditionSettings,
} from "@choir/contracts";
import { readTicketMessageTemplate } from "./ticketMessageTemplates";
import { readRosterAutomationConfiguration, runRosterAutomations } from "./statusAutomationStore";
import { advanceComplianceReminder, findDueComplianceReminders } from "./complianceStore";

import {
  EVENT_REMINDER_LEAD_MS,
  TICKET_REMINDER_LEAD_MS,
  ATTENDANCE_REPORT_DELAY_MS,
  rsvpFollowUpSchedule,
} from "./communicationSchedule";

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const OUTBOX_BATCH_SIZE = 10;
const POLL_ARCHIVE_BATCH_SIZE = 100;
const RETRY_ALARM_DELAY_MS = 60_000;
const ALARM_WAKE_DELAY_MS = 1_000;

export type SchedulerCircuitState = "closed" | "open" | "half_open";

export interface SchedulerCircuitBreakerPolicy {
  readonly backoffMs: number;
  readonly dispatchFailureLimit: number;
  readonly fullBatchLimit: number;
}

export const DEFAULT_SCHEDULER_CIRCUIT_POLICY: SchedulerCircuitBreakerPolicy = {
  backoffMs: 15 * 60 * 1000,
  dispatchFailureLimit: 5,
  fullBatchLimit: 30,
};

export interface SchedulerCircuitBreakerStatus {
  readonly consecutiveDispatchFailures?: number;
  readonly consecutiveFullBatches?: number;
  readonly reason: string | null;
  readonly resumeAt: string | null;
  readonly state: SchedulerCircuitState;
  readonly tripCount: number;
}

interface OrganizationIdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

export interface SchedulerStateRow {
  readonly [column: string]: SqlStorageValue;
  readonly circuitState: SchedulerCircuitState;
  readonly consecutiveDispatchFailures: number;
  readonly consecutiveFullBatches: number;
  readonly lastTripReason: string | null;
  readonly nextDueAt: string;
  readonly openedAt: string | null;
  readonly resumeAt: string | null;
  readonly tripCount: number;
  readonly updatedAt: string;
}

interface ScheduledJobRow {
  readonly [column: string]: SqlStorageValue;
  readonly dueAt: string;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly kind: DeliveryJob["kind"];
}

interface PollArchiveCandidateRow {
  readonly [column: string]: SqlStorageValue;
  readonly expiresAt: string;
  readonly id: string;
  readonly title: string;
}

export interface RunOrganizationAlarmOptions {
  readonly circuitPolicy?: Partial<SchedulerCircuitBreakerPolicy>;
  readonly force?: boolean;
  readonly operatorOverride?: boolean;
}

function nextSchedulerDue(now: Date): string {
  return new Date(now.getTime() + SCHEDULER_INTERVAL_MS).toISOString();
}

function readOrganizationId(storage: DurableObjectStorage): string | null {
  return (
    storage.sql
      .exec<OrganizationIdentityRow>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId ?? null
  );
}

export function readSchedulerState(storage: DurableObjectStorage): SchedulerStateRow | null {
  const row = storage.sql
    .exec<{
      readonly circuit_state: string | null;
      readonly consecutive_dispatch_failures: number | null;
      readonly consecutive_full_batches: number | null;
      readonly last_trip_reason: string | null;
      readonly next_due_at: string;
      readonly opened_at: string | null;
      readonly resume_at: string | null;
      readonly trip_count: number | null;
      readonly updated_at: string;
    }>(
      `SELECT next_due_at, updated_at,
              circuit_state, consecutive_full_batches,
              consecutive_dispatch_failures, trip_count,
              opened_at, resume_at, last_trip_reason
       FROM scheduler_state WHERE singleton = 1`,
    )
    .toArray()
    .at(0);
  if (!row) return null;
  const circuitState: SchedulerCircuitState =
    row.circuit_state === "open" || row.circuit_state === "half_open"
      ? row.circuit_state
      : "closed";
  return {
    circuitState,
    consecutiveDispatchFailures: row.consecutive_dispatch_failures ?? 0,
    consecutiveFullBatches: row.consecutive_full_batches ?? 0,
    lastTripReason: row.last_trip_reason ?? null,
    nextDueAt: row.next_due_at,
    openedAt: row.opened_at ?? null,
    resumeAt: row.resume_at ?? null,
    tripCount: row.trip_count ?? 0,
    updatedAt: row.updated_at,
  };
}

function emitCircuitOpenedEvent(
  organizationId: string,
  reason: string,
  policy: SchedulerCircuitBreakerPolicy,
  consecutiveFullBatches: number,
  consecutiveDispatchFailures: number,
  tripCount: number,
  now: Date,
  resumeAt: string,
): void {
  console.error(
    JSON.stringify({
      counters: {
        consecutiveDispatchFailures,
        consecutiveFullBatches,
        tripCount,
      },
      event: "scheduler_circuit_opened",
      organizationId,
      reason,
      retryTime: resumeAt,
      severity: "high",
      thresholds: {
        backoffMs: policy.backoffMs,
        dispatchFailureLimit: policy.dispatchFailureLimit,
        fullBatchLimit: policy.fullBatchLimit,
      },
      timestamp: now.toISOString(),
    }),
  );
}

function emitCircuitProbeEvent(
  organizationId: string,
  scheduler: SchedulerStateRow,
  now: Date,
): void {
  console.info(
    JSON.stringify({
      event: "scheduler_circuit_probe",
      organizationId,
      timestamp: now.toISOString(),
      tripCount: scheduler.tripCount,
    }),
  );
}

function emitCircuitClosedEvent(organizationId: string, reason: string, now: Date): void {
  console.info(
    JSON.stringify({
      event: "scheduler_circuit_closed",
      organizationId,
      reason,
      timestamp: now.toISOString(),
    }),
  );
}

export async function ensureOrganizationAlarm(
  storage: DurableObjectStorage,
  now = new Date(),
): Promise<void> {
  const nextDueAt = nextSchedulerDue(now);
  storage.sql.exec(
    `INSERT OR IGNORE INTO scheduler_state (singleton, next_due_at, updated_at)
     VALUES (1, ?, ?)`,
    nextDueAt,
    now.toISOString(),
  );
  const scheduler = readSchedulerState(storage);
  if (scheduler?.circuitState === "open" && scheduler.resumeAt) {
    const resumeTime = new Date(scheduler.resumeAt).getTime();
    if (now.getTime() < resumeTime) {
      await storage.setAlarm(resumeTime);
      return;
    }
  }
  if (scheduler) {
    await storage.setAlarm(new Date(scheduler.nextDueAt));
  }
}

/**
 * Wake the scheduler promptly after a mutation adds work to the outbox.
 *
 * The normal scheduler cadence remains hourly; this only moves the next
 * invocation forward so newly queued delivery work does not wait for that
 * cadence. The scheduler state itself is still initialized here so this is
 * also safe if an earlier alarm was never armed.
 *
 * While the runaway-work circuit breaker is open, wake requests are constrained
 * to protect the cooldown period and cannot move the alarm earlier than resumeAt.
 *
 * When closed, a wake request may move an existing alarm earlier, never later.
 * An alarm that is already sooner than the requested wake is left unchanged so
 * repeated wakes are stable and do not slide the alarm into the future.
 */
export async function wakeOrganizationAlarm(
  storage: DurableObjectStorage,
  now = new Date(),
): Promise<void> {
  const nextDueAt = nextSchedulerDue(now);
  storage.sql.exec(
    `INSERT OR IGNORE INTO scheduler_state (singleton, next_due_at, updated_at)
     VALUES (1, ?, ?)`,
    nextDueAt,
    now.toISOString(),
  );
  const scheduler = readSchedulerState(storage);
  if (scheduler?.circuitState === "open" && scheduler.resumeAt) {
    const resumeTime = new Date(scheduler.resumeAt).getTime();
    if (now.getTime() < resumeTime) {
      const existingAlarm = await storage.getAlarm();
      if (existingAlarm === null || existingAlarm < resumeTime) {
        await storage.setAlarm(resumeTime);
      }
      return;
    }
  }
  const requestedWake = now.getTime() + ALARM_WAKE_DELAY_MS;
  const existingAlarm = await storage.getAlarm();
  if (existingAlarm === null || requestedWake < existingAlarm) {
    await storage.setAlarm(requestedWake);
  }
}

interface ReminderCandidateRow {
  readonly [column: string]: SqlStorageValue;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly eventId: string;
  readonly eventStartsAt: string;
  readonly eventTitle: string;
  readonly purchaseId: string;
  readonly quantity: number;
}

function createTicketReminderJobs(storage: DurableObjectStorage, now: Date): void {
  const horizon = new Date(now.getTime() + TICKET_REMINDER_LEAD_MS).toISOString();
  const candidates = storage.sql
    .exec<ReminderCandidateRow>(
      `SELECT p.id AS purchaseId, p.buyer_name AS buyerName, p.buyer_email AS buyerEmail,
        p.quantity, e.id AS eventId, e.title AS eventTitle, e.starts_at AS eventStartsAt
       FROM ticket_purchases p JOIN events e ON e.id = p.event_id
       WHERE p.bundle_id IS NULL AND p.status = 'paid'
         AND e.is_archived = 0 AND e.is_canceled = 0
         AND e.starts_at > ? AND e.starts_at <= ?
       UNION ALL
       SELECT p.id, p.buyer_name, p.buyer_email, p.quantity,
        e.id, e.title, e.starts_at
       FROM ticket_bundle_allocations a
       JOIN ticket_purchases p ON p.id = a.purchase_id
       JOIN events e ON e.id = a.event_id
       WHERE p.status = 'paid'
         AND e.is_archived = 0 AND e.is_canceled = 0
         AND e.starts_at > ? AND e.starts_at <= ?
       ORDER BY eventStartsAt, purchaseId, eventId LIMIT 100`,
      now.toISOString(),
      horizon,
      now.toISOString(),
      horizon,
    )
    .toArray();
  const notificationTemplate = readTicketMessageTemplate(storage, "reminder");
  for (const candidate of candidates) {
    const normalizedStartsAt = new Date(candidate.eventStartsAt).toISOString();
    const dedupeKey = `ticket-reminder:${candidate.purchaseId}:${candidate.eventId}:${normalizedStartsAt}`;
    const exists = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
        "SELECT id FROM ticket_notifications WHERE dedupe_key = ? LIMIT 1",
        dedupeKey,
      )
      .toArray()
      .at(0);
    if (exists) continue;
    const notificationId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    storage.sql.exec(
      `INSERT INTO ticket_notifications
        (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
         content_markdown, status, scheduled_for, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'reminder', ?, ?, ?, 'queued', ?, ?, ?)`,
      notificationId,
      candidate.purchaseId,
      candidate.eventId,
      dedupeKey,
      candidate.buyerEmail,
      notificationTemplate.subject,
      notificationTemplate.contentMarkdown,
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
    );
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'ticket_notification', ?, ?, ?)`,
      jobId,
      `ticket-notification:${notificationId}`,
      now.toISOString(),
      now.toISOString(),
    );
  }
}

interface EventReminderCandidateRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly eventStartsAt: string;
  readonly eventTitle: string;
  readonly eventType: string;
}

interface ExistingEventReminderJobRow {
  readonly [column: string]: SqlStorageValue;
  readonly jobId: string;
  readonly status: string | null;
  readonly terminalAt: string | null;
}

interface RsvpFollowUpCandidateRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly eventStartsAt: string;
  readonly rsvpDeadlineDate: string | null;
  readonly rsvpFollowUpLeadHours: number | null;
  readonly rsvpFollowUpMode: "disabled" | "enabled" | "inherit";
}

function readOrganizationTimezone(storage: DurableObjectStorage): string {
  return storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly timezone: string }>(
      "SELECT timezone FROM organization_metadata LIMIT 1",
    )
    .one().timezone;
}

function createRsvpFollowUpJobs(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
): void {
  const configuration = readRosterAutomationConfiguration(storage);
  if (!configuration.rsvpExpiryEnabled) return;
  const timezone = readOrganizationTimezone(storage);
  const candidates = storage.sql
    .exec<RsvpFollowUpCandidateRow>(
      `SELECT id AS eventId, starts_at AS eventStartsAt,
         rsvp_follow_up_mode AS rsvpFollowUpMode,
         rsvp_follow_up_lead_hours AS rsvpFollowUpLeadHours,
         rsvp_deadline_date AS rsvpDeadlineDate
       FROM events
       WHERE type = 'Performance' AND is_archived = 0 AND is_canceled = 0
         AND starts_at > ?
       ORDER BY starts_at, id LIMIT 500`,
      now.toISOString(),
    )
    .toArray();
  for (const candidate of candidates) {
    const schedule = rsvpFollowUpSchedule(candidate, configuration, timezone);
    if (!schedule || schedule.deadlineAt <= now.getTime() || schedule.dueAt > now.getTime())
      continue;
    const idempotencyKey = `rsvp-follow-up:${organizationId}:${candidate.eventId}`;
    const alreadyQueued = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly jobId: string }>(
        "SELECT job_id AS jobId FROM scheduled_job_outbox WHERE idempotency_key = ? LIMIT 1",
        idempotencyKey,
      )
      .toArray()
      .at(0);
    if (alreadyQueued) continue;
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'rsvp_follow_up', ?, ?, ?)`,
      crypto.randomUUID(),
      idempotencyKey,
      now.toISOString(),
      now.toISOString(),
    );
  }
}

export function computePrefixUpperBound(prefix: string): string {
  if (prefix.length === 0) throw new Error("Prefix must not be empty");
  const lastCharCode = prefix.charCodeAt(prefix.length - 1);
  return `${prefix.slice(0, -1)}${String.fromCharCode(lastCharCode + 1)}`;
}

function createEventReminderJobs(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
): void {
  const leadTimeHorizon = new Date(now.getTime() + EVENT_REMINDER_LEAD_MS).toISOString();
  const candidates = storage.sql
    .exec<EventReminderCandidateRow>(
      `SELECT id AS eventId, title AS eventTitle, type AS eventType, starts_at AS eventStartsAt
       FROM events
       WHERE is_archived = 0 AND is_canceled = 0
         AND reminder_sent_at IS NULL
         AND starts_at > ?
         AND starts_at <= ?
       ORDER BY eventStartsAt, eventId LIMIT 50`,
      now.toISOString(),
      leadTimeHorizon,
    )
    .toArray();
  for (const candidate of candidates) {
    const baseIdempotencyKey = `event-reminder:${organizationId}:${candidate.eventId}`;
    const retryPrefix = `${baseIdempotencyKey}:retry:`;
    const retryPrefixUpperBound = computePrefixUpperBound(retryPrefix);
    const existingJobs = storage.sql
      .exec<ExistingEventReminderJobRow>(
        `SELECT o.job_id AS jobId, l.status, l.terminal_at AS terminalAt
         FROM scheduled_job_outbox o
         LEFT JOIN job_ledger l ON l.job_id = o.job_id
         WHERE o.kind = 'event_reminder'
           AND (
             o.idempotency_key = ?
             OR (o.idempotency_key >= ? AND o.idempotency_key < ?)
           )
         ORDER BY o.created_at, o.job_id`,
        baseIdempotencyKey,
        retryPrefix,
        retryPrefixUpperBound,
      )
      .toArray();
    const reminderHistoryCount = storage.sql
      .exec<{ readonly count: number }>(
        `SELECT COUNT(*) AS count FROM job_ledger
         WHERE kind = 'event_reminder'
           AND (
             idempotency_key = ?
             OR (idempotency_key >= ? AND idempotency_key < ?)
           )`,
        baseIdempotencyKey,
        retryPrefix,
        retryPrefixUpperBound,
      )
      .one().count;
    if (existingJobs.length > 0) {
      const allTerminal = existingJobs.every(
        (job) => job.status === "failed" && job.terminalAt !== null,
      );
      if (!allTerminal) continue;
      for (const job of existingJobs) {
        storage.sql.exec("DELETE FROM scheduled_job_outbox WHERE job_id = ?", job.jobId);
      }
    }
    const idempotencyKey =
      existingJobs.length === 0
        ? baseIdempotencyKey
        : `${baseIdempotencyKey}:retry:${String(reminderHistoryCount)}`;
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'event_reminder', ?, ?, ?)`,
      crypto.randomUUID(),
      idempotencyKey,
      now.toISOString(),
      now.toISOString(),
    );
  }
}

interface PostEventReportCandidateRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventType: string;
  readonly eventStartsAt: string;
}

function createPostEventReportJobs(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
): void {
  const dueBefore = new Date(now.getTime() - ATTENDANCE_REPORT_DELAY_MS).toISOString();
  const candidates = storage.sql
    .exec<PostEventReportCandidateRow>(
      `SELECT id AS eventId, title AS eventTitle, type AS eventType, starts_at AS eventStartsAt
       FROM events
       WHERE type = 'Performance' AND is_archived = 0 AND is_canceled = 0
         AND starts_at < ?
       ORDER BY starts_at DESC, id LIMIT 50`,
      dueBefore,
    )
    .toArray();
  for (const candidate of candidates) {
    const idempotencyKey = `post-event-report:${organizationId}:${candidate.eventId}`;
    const alreadyQueuedOrProcessed =
      storage.sql
        .exec<{ readonly count: number }>(
          `SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE idempotency_key = ?
           UNION ALL
           SELECT COUNT(*) AS count FROM job_ledger WHERE idempotency_key = ? AND status != 'failed'`,
          idempotencyKey,
          idempotencyKey,
        )
        .toArray()
        .reduce((sum, row) => sum + row.count, 0) > 0;
    if (alreadyQueuedOrProcessed) continue;
    storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'attendance_report', ?, ?, ?)`,
      crypto.randomUUID(),
      idempotencyKey,
      now.toISOString(),
      now.toISOString(),
    );
  }
}

function archiveDuePolls(storage: DurableObjectStorage, organizationId: string, now: Date): void {
  const archiveBefore = new Date(
    now.getTime() - POLL_ARCHIVE_DELAY_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const candidates = storage.sql
    .exec<PollArchiveCandidateRow>(
      `SELECT id, title, expires_at AS expiresAt
       FROM polls
       WHERE archived_at = '' AND expires_at != '' AND expires_at <= ?
       ORDER BY expires_at, id
       LIMIT ?`,
      archiveBefore,
      POLL_ARCHIVE_BATCH_SIZE,
    )
    .toArray();
  if (candidates.length === 0) return;

  const archivedAt = now.toISOString();
  storage.transactionSync(() => {
    for (const candidate of candidates) {
      storage.sql.exec(
        `UPDATE polls SET archived_at = ?, updated_at = ?
         WHERE id = ? AND archived_at = ''`,
        archivedAt,
        archivedAt,
        candidate.id,
      );
      storage.sql.exec(
        `INSERT OR IGNORE INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'organization_system', 'system:scheduler', 'poll.archived',
           'poll', ?, ?, ?, ?)`,
        `poll-auto-archived:${organizationId}:${candidate.id}`,
        candidate.id,
        `poll-auto-archived:${organizationId}:${candidate.id}`,
        JSON.stringify({ expiresAt: candidate.expiresAt, reason: "expiration" }),
        archivedAt,
      );
    }
  });
}

function createDueJobs(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
  force: boolean,
): void {
  storage.transactionSync(() => {
    const scheduler = storage.sql
      .exec<SchedulerStateRow>(
        "SELECT next_due_at AS nextDueAt FROM scheduler_state WHERE singleton = 1",
      )
      .toArray()
      .at(0);
    if (!scheduler) {
      const initializedAt = now.toISOString();
      storage.sql.exec(
        `INSERT OR IGNORE INTO scheduler_state (singleton, next_due_at, updated_at)
         VALUES (1, ?, ?)`,
        nextSchedulerDue(now),
        initializedAt,
      );
    }
    const initializedScheduler = storage.sql
      .exec<SchedulerStateRow>(
        "SELECT next_due_at AS nextDueAt FROM scheduler_state WHERE singleton = 1",
      )
      .toArray()
      .at(0);
    if (!initializedScheduler) return;
    const schedulerDueAt = new Date(initializedScheduler.nextDueAt);
    if (!force && schedulerDueAt.getTime() > now.getTime()) return;
    const idempotencyKey = `scheduler:${organizationId}:stale_checkout_cleanup:${initializedScheduler.nextDueAt}`;
    const cleanupDueAt =
      force && schedulerDueAt.getTime() > now.getTime()
        ? now.toISOString()
        : initializedScheduler.nextDueAt;
    storage.sql.exec(
      `INSERT OR IGNORE INTO scheduled_job_outbox
        (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'stale_checkout_cleanup', ?, ?, ?)`,
      crypto.randomUUID(),
      idempotencyKey,
      cleanupDueAt,
      now.toISOString(),
    );
    createTicketReminderJobs(storage, now);
    createEventReminderJobs(storage, organizationId, now);
    createRsvpFollowUpJobs(storage, organizationId, now);
    createPostEventReportJobs(storage, organizationId, now);
    createFeeReconciliationJobs(storage, now);
    createComplianceReminderJobs(storage, organizationId, now);
    if (schedulerDueAt.getTime() <= now.getTime()) {
      storage.sql.exec(
        `UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1`,
        new Date(schedulerDueAt.getTime() + SCHEDULER_INTERVAL_MS).toISOString(),
        now.toISOString(),
      );
    }
  });
}

function createFeeReconciliationJobs(storage: DurableObjectStorage, now: Date): void {
  const cursor = storage.sql.exec<{ readonly providerPaymentId: string }>(
    `SELECT DISTINCT provider_payment_id AS providerPaymentId
       FROM payment_attempts
       WHERE status IN ('paid', 'refunded')
         AND processor_fee_cents IS NULL
         AND provider_payment_id NOT LIKE 'fake_%'
         AND provider_payment_id <> ''
       LIMIT 10`,
  );
  const unreconciled = cursor.toArray();
  recordDatabaseCost({
    operation: "organization_sqlite.scheduler.fee_reconciliation",
    rowsRead: cursor.rowsRead,
    rowsReturned: unreconciled.length,
    rowsWritten: cursor.rowsWritten,
    store: "organization_sqlite",
  });

  for (const row of unreconciled) {
    storage.sql.exec(
      `INSERT OR IGNORE INTO scheduled_job_outbox
        (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'payment_fee_reconciliation', ?, ?, ?)`,
      crypto.randomUUID(),
      `reconcile-fee:${row.providerPaymentId}`,
      now.toISOString(),
      now.toISOString(),
    );
  }
}

function createComplianceReminderJobs(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
): void {
  const reminders = findDueComplianceReminders(storage, now);
  for (const reminder of reminders) {
    const idempotencyKey = `nonprofit-compliance:${organizationId}:${reminder.task.id}:${reminder.cycleDueDate}:${reminder.occurrenceDate}`;
    const nowIso = now.toISOString();
    const existing = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
        `SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE idempotency_key = ?
         UNION ALL
         SELECT COUNT(*) AS count FROM job_ledger WHERE idempotency_key = ? AND status != 'failed'`,
        idempotencyKey,
        idempotencyKey,
      )
      .toArray();
    const alreadyQueuedOrSent = existing.some((row) => row.count > 0);
    if (!alreadyQueuedOrSent) {
      storage.sql.exec(
        `INSERT OR IGNORE INTO scheduled_job_outbox
          (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, 'compliance_reminder', ?, ?, ?)`,
        crypto.randomUUID(),
        idempotencyKey,
        nowIso,
        nowIso,
      );
    }
    advanceComplianceReminder(storage, reminder.task.id, reminder.task.nextReminderAt, nowIso);
  }
}

function readPendingJobs(storage: DurableObjectStorage, now: Date): readonly ScheduledJobRow[] {
  const cursor = storage.sql.exec<ScheduledJobRow>(
    `SELECT job_id AS jobId, kind, idempotency_key AS idempotencyKey, due_at AS dueAt
       FROM scheduled_job_outbox
       WHERE enqueued_at IS NULL AND due_at <= ?
       ORDER BY due_at, job_id
       LIMIT ?`,
    now.toISOString(),
    OUTBOX_BATCH_SIZE,
  );
  const jobs = cursor.toArray();
  recordDatabaseCost({
    operation: "organization_sqlite.scheduler.pending_jobs",
    rowsRead: cursor.rowsRead,
    rowsReturned: jobs.length,
    rowsWritten: cursor.rowsWritten,
    store: "organization_sqlite",
  });
  return jobs;
}

async function scheduleNextAlarm(
  storage: DurableObjectStorage,
  now: Date,
  pendingBatchWasFull: boolean,
): Promise<void> {
  const scheduler = readSchedulerState(storage);
  if (!scheduler) {
    return;
  }
  if (scheduler.circuitState === "open" && scheduler.resumeAt) {
    const resumeTime = new Date(scheduler.resumeAt).getTime();
    if (now.getTime() < resumeTime) {
      await storage.setAlarm(resumeTime);
      return;
    }
  }
  const nextJob = storage.sql
    .exec<{ readonly dueAt: string }>(
      "SELECT due_at AS dueAt FROM scheduled_job_outbox WHERE enqueued_at IS NULL ORDER BY due_at, job_id LIMIT 1",
    )
    .toArray()
    .at(0);
  const nextDueAt = Math.min(
    new Date(scheduler.nextDueAt).getTime(),
    nextJob ? new Date(nextJob.dueAt).getTime() : Infinity,
  );
  const scheduledTime = pendingBatchWasFull
    ? now.getTime() + 1_000
    : Math.max(now.getTime() + 1_000, nextDueAt);
  await storage.setAlarm(scheduledTime);
}

function autoDisableExpiredAuditions(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
): void {
  const row = storage.sql
    .exec<{ readonly settings: string }>(
      "SELECT audition_settings_json AS settings FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (!row?.settings) return;
  try {
    const parsed = organizationAuditionSettingsSchema.safeParse(JSON.parse(row.settings));
    if (parsed.success && parsed.data.enabled && areAuditionDatesPassed(parsed.data, now)) {
      const disabled: OrganizationAuditionSettings = { ...parsed.data, enabled: false };
      const nowIso = now.toISOString();
      storage.transactionSync(() => {
        storage.sql.exec(
          "UPDATE organization_metadata SET audition_settings_json = ?, updated_at = ?",
          JSON.stringify(disabled),
          nowIso,
        );
        storage.sql.exec(
          `INSERT OR IGNORE INTO audit_events
            (id, actor_type, actor_id, action, target_type, target_id,
             request_id, change_summary, occurred_at)
           VALUES (?, 'organization_system', 'system:scheduler', 'audition.settings_auto_disabled',
             'audition_settings', ?, ?, ?, ?)`,
          `audition-auto-disabled:${organizationId}:${nowIso}`,
          organizationId,
          `audition-auto-disabled:${organizationId}:${nowIso}`,
          JSON.stringify({
            defaultPerformanceId: disabled.defaultPerformanceId,
            enabled: false,
            mode: disabled.mode,
            reason: "audition_dates_passed",
            slotCount: disabled.slots.length,
          }),
          nowIso,
        );
      });
    }
  } catch {
    // Ignore invalid audition settings in scheduler loop
  }
}

export function readSchedulerStateFromStore(
  storage: DurableObjectStorage,
): SchedulerStateRow | null {
  return readSchedulerState(storage);
}

function handleOperatorOverride(
  storage: DurableObjectStorage,
  organizationId: string,
  scheduler: SchedulerStateRow,
  now: Date,
): SchedulerStateRow {
  if (
    scheduler.circuitState !== "closed" ||
    scheduler.consecutiveFullBatches > 0 ||
    scheduler.consecutiveDispatchFailures > 0
  ) {
    storage.sql.exec(
      `UPDATE scheduler_state
       SET circuit_state = 'closed',
           consecutive_full_batches = 0,
           consecutive_dispatch_failures = 0,
           opened_at = NULL,
           resume_at = NULL,
           last_trip_reason = NULL,
           updated_at = ?
       WHERE singleton = 1`,
      now.toISOString(),
    );
    emitCircuitClosedEvent(organizationId, "operator_override", now);
    return readSchedulerState(storage) ?? scheduler;
  }
  return scheduler;
}

type OpenCircuitEvaluation =
  | { readonly scheduler: SchedulerStateRow; readonly shouldHalt: false }
  | { readonly shouldHalt: true; readonly status: SchedulerCircuitBreakerStatus };

function evaluateOpenCircuit(
  storage: DurableObjectStorage,
  organizationId: string,
  scheduler: SchedulerStateRow,
  now: Date,
): OpenCircuitEvaluation {
  if (scheduler.circuitState !== "open") {
    return { scheduler, shouldHalt: false };
  }
  const resumeTime = scheduler.resumeAt ? new Date(scheduler.resumeAt).getTime() : 0;
  if (now.getTime() < resumeTime) {
    return {
      shouldHalt: true,
      status: {
        consecutiveDispatchFailures: scheduler.consecutiveDispatchFailures,
        consecutiveFullBatches: scheduler.consecutiveFullBatches,
        reason: scheduler.lastTripReason,
        resumeAt: scheduler.resumeAt,
        state: "open",
        tripCount: scheduler.tripCount,
      },
    };
  }
  storage.sql.exec(
    `UPDATE scheduler_state SET circuit_state = 'half_open', updated_at = ? WHERE singleton = 1`,
    now.toISOString(),
  );
  emitCircuitProbeEvent(organizationId, scheduler, now);
  return {
    scheduler: { ...scheduler, circuitState: "half_open" },
    shouldHalt: false,
  };
}

function triggerDueSchedulerTasks(
  storage: DurableObjectStorage,
  organizationId: string,
  scheduler: SchedulerStateRow,
  now: Date,
  force: boolean,
): void {
  if (scheduler.circuitState !== "closed") return;
  const isDue = force || new Date(scheduler.nextDueAt).getTime() <= now.getTime();
  if (!isDue) return;
  runRosterAutomations(storage, organizationId, now);
  archiveDuePolls(storage, organizationId, now);
  autoDisableExpiredAuditions(storage, organizationId, now);
  createDueJobs(storage, organizationId, now, force);
}

function settleQuietScheduler(
  storage: DurableObjectStorage,
  organizationId: string,
  scheduler: SchedulerStateRow,
  now: Date,
): SchedulerCircuitBreakerStatus {
  if (scheduler.circuitState === "half_open") {
    storage.sql.exec(
      `UPDATE scheduler_state
       SET circuit_state = 'closed',
           consecutive_full_batches = 0,
           consecutive_dispatch_failures = 0,
           opened_at = NULL,
           resume_at = NULL,
           updated_at = ?
       WHERE singleton = 1`,
      now.toISOString(),
    );
    emitCircuitClosedEvent(organizationId, "quiet_probe", now);
  } else if (scheduler.consecutiveFullBatches > 0 || scheduler.consecutiveDispatchFailures > 0) {
    storage.sql.exec(
      `UPDATE scheduler_state
       SET consecutive_full_batches = 0,
           consecutive_dispatch_failures = 0,
           updated_at = ?
       WHERE singleton = 1`,
      now.toISOString(),
    );
  }
  return {
    reason: null,
    resumeAt: null,
    state: "closed",
    tripCount: scheduler.tripCount,
  };
}

async function handleDispatchFailure(
  storage: DurableObjectStorage,
  organizationId: string,
  scheduler: SchedulerStateRow,
  policy: SchedulerCircuitBreakerPolicy,
  now: Date,
  error: unknown,
): Promise<never> {
  const newFailures = scheduler.consecutiveDispatchFailures + 1;
  const shouldTrip =
    scheduler.circuitState === "half_open" || newFailures >= policy.dispatchFailureLimit;

  if (shouldTrip) {
    const resumeAt = new Date(now.getTime() + policy.backoffMs).toISOString();
    const newTripCount = scheduler.tripCount + 1;
    const tripReason =
      scheduler.circuitState === "half_open"
        ? "probe_dispatch_failure"
        : "consecutive_dispatch_failures";
    storage.sql.exec(
      `UPDATE scheduler_state
       SET circuit_state = 'open',
           consecutive_dispatch_failures = ?,
           trip_count = ?,
           opened_at = ?,
           resume_at = ?,
           last_trip_reason = ?,
           updated_at = ?
       WHERE singleton = 1`,
      newFailures,
      newTripCount,
      now.toISOString(),
      resumeAt,
      tripReason,
      now.toISOString(),
    );
    emitCircuitOpenedEvent(
      organizationId,
      tripReason,
      policy,
      scheduler.consecutiveFullBatches,
      newFailures,
      newTripCount,
      now,
      resumeAt,
    );
    await storage.setAlarm(new Date(resumeAt).getTime());
  } else {
    storage.sql.exec(
      `UPDATE scheduler_state
       SET consecutive_dispatch_failures = ?,
           updated_at = ?
       WHERE singleton = 1`,
      newFailures,
      now.toISOString(),
    );
    await storage.setAlarm(now.getTime() + RETRY_ALARM_DELAY_MS);
  }
  throw new Error("The Organization scheduler could not enqueue its stable job batch.", {
    cause: error,
  });
}

function recordBatchEnqueued(
  storage: DurableObjectStorage,
  jobs: readonly ScheduledJobRow[],
  enqueuedAt: string,
): void {
  for (const job of jobs) {
    storage.sql.exec(
      `UPDATE scheduled_job_outbox SET enqueued_at = ?
       WHERE job_id = ? AND enqueued_at IS NULL`,
      enqueuedAt,
      job.jobId,
    );
  }
}

async function handleBatchSuccess(
  storage: DurableObjectStorage,
  organizationId: string,
  scheduler: SchedulerStateRow,
  policy: SchedulerCircuitBreakerPolicy,
  pendingJobs: readonly ScheduledJobRow[],
  now: Date,
): Promise<{ readonly isFullBatch: boolean; readonly status: SchedulerCircuitBreakerStatus }> {
  const enqueuedAt = now.toISOString();
  const isFullBatch = pendingJobs.length === OUTBOX_BATCH_SIZE;

  if (scheduler.circuitState === "half_open") {
    storage.transactionSync(() => {
      recordBatchEnqueued(storage, pendingJobs, enqueuedAt);
      storage.sql.exec(
        `UPDATE scheduler_state
         SET circuit_state = 'closed',
             consecutive_full_batches = ?,
             consecutive_dispatch_failures = 0,
             opened_at = NULL,
             resume_at = NULL,
             updated_at = ?
         WHERE singleton = 1`,
        isFullBatch ? 1 : 0,
        enqueuedAt,
      );
    });
    emitCircuitClosedEvent(organizationId, "probe_success", now);
    return {
      isFullBatch,
      status: {
        reason: null,
        resumeAt: null,
        state: "closed",
        tripCount: scheduler.tripCount,
      },
    };
  }

  const newFullBatches = isFullBatch ? scheduler.consecutiveFullBatches + 1 : 0;
  if (isFullBatch && newFullBatches >= policy.fullBatchLimit) {
    const resumeAt = new Date(now.getTime() + policy.backoffMs).toISOString();
    const newTripCount = scheduler.tripCount + 1;
    storage.transactionSync(() => {
      recordBatchEnqueued(storage, pendingJobs, enqueuedAt);
      storage.sql.exec(
        `UPDATE scheduler_state
         SET circuit_state = 'open',
             consecutive_full_batches = ?,
             consecutive_dispatch_failures = 0,
             trip_count = ?,
             opened_at = ?,
             resume_at = ?,
             last_trip_reason = 'consecutive_full_batches',
             updated_at = ?
         WHERE singleton = 1`,
        newFullBatches,
        newTripCount,
        enqueuedAt,
        resumeAt,
        enqueuedAt,
      );
    });
    emitCircuitOpenedEvent(
      organizationId,
      "consecutive_full_batches",
      policy,
      newFullBatches,
      0,
      newTripCount,
      now,
      resumeAt,
    );
    await storage.setAlarm(new Date(resumeAt).getTime());
    return {
      isFullBatch: false,
      status: {
        consecutiveFullBatches: newFullBatches,
        reason: "consecutive_full_batches",
        resumeAt,
        state: "open",
        tripCount: newTripCount,
      },
    };
  }

  storage.transactionSync(() => {
    recordBatchEnqueued(storage, pendingJobs, enqueuedAt);
    storage.sql.exec(
      `UPDATE scheduler_state
       SET consecutive_full_batches = ?,
           consecutive_dispatch_failures = 0,
           updated_at = ?
       WHERE singleton = 1`,
      newFullBatches,
      enqueuedAt,
    );
  });
  return {
    isFullBatch,
    status: {
      consecutiveFullBatches: newFullBatches,
      reason: null,
      resumeAt: null,
      state: "closed",
      tripCount: scheduler.tripCount,
    },
  };
}

function getOrInitializeSchedulerState(
  storage: DurableObjectStorage,
  now: Date,
): SchedulerStateRow | null {
  const scheduler = readSchedulerState(storage);
  if (scheduler) return scheduler;
  storage.sql.exec(
    `INSERT OR IGNORE INTO scheduler_state (singleton, next_due_at, updated_at)
     VALUES (1, ?, ?)`,
    nextSchedulerDue(now),
    now.toISOString(),
  );
  return readSchedulerState(storage);
}

function resolveCircuitPolicy(
  overrides?: Partial<SchedulerCircuitBreakerPolicy>,
): SchedulerCircuitBreakerPolicy {
  return {
    backoffMs: overrides?.backoffMs ?? DEFAULT_SCHEDULER_CIRCUIT_POLICY.backoffMs,
    dispatchFailureLimit:
      overrides?.dispatchFailureLimit ?? DEFAULT_SCHEDULER_CIRCUIT_POLICY.dispatchFailureLimit,
    fullBatchLimit: overrides?.fullBatchLimit ?? DEFAULT_SCHEDULER_CIRCUIT_POLICY.fullBatchLimit,
  };
}

export async function runOrganizationAlarm(
  storage: DurableObjectStorage,
  queue: Queue<DeliveryJob>,
  now = new Date(),
  options: RunOrganizationAlarmOptions = {},
): Promise<{
  readonly circuitBreaker?: SchedulerCircuitBreakerStatus;
  readonly enqueuedJobCount: number;
  readonly organizationId: string | null;
}> {
  const organizationId = readOrganizationId(storage);
  if (!organizationId) {
    await storage.deleteAlarm();
    return { enqueuedJobCount: 0, organizationId: null };
  }
  let scheduler = getOrInitializeSchedulerState(storage, now);
  if (!scheduler) {
    await storage.deleteAlarm();
    return { enqueuedJobCount: 0, organizationId };
  }

  const policy = resolveCircuitPolicy(options.circuitPolicy);

  if (options.operatorOverride === true) {
    scheduler = handleOperatorOverride(storage, organizationId, scheduler, now);
  }

  const openEvaluation = evaluateOpenCircuit(storage, organizationId, scheduler, now);
  if (openEvaluation.shouldHalt) {
    if (openEvaluation.status.resumeAt) {
      await storage.setAlarm(new Date(openEvaluation.status.resumeAt).getTime());
    }
    return {
      circuitBreaker: openEvaluation.status,
      enqueuedJobCount: 0,
      organizationId,
    };
  }
  scheduler = openEvaluation.scheduler;

  triggerDueSchedulerTasks(storage, organizationId, scheduler, now, options.force === true);

  const pendingJobs = readPendingJobs(storage, now);
  if (pendingJobs.length === 0) {
    const status = settleQuietScheduler(storage, organizationId, scheduler, now);
    await scheduleNextAlarm(storage, now, false);
    return {
      circuitBreaker: status,
      enqueuedJobCount: 0,
      organizationId,
    };
  }

  try {
    await queue.sendBatch(
      pendingJobs.map((job) => ({
        body: {
          attempt: 1,
          idempotencyKey: job.idempotencyKey,
          jobId: job.jobId,
          kind: job.kind,
          organizationId,
          version: 1,
        },
      })),
    );
  } catch (error: unknown) {
    await handleDispatchFailure(storage, organizationId, scheduler, policy, now, error);
  }

  const result = await handleBatchSuccess(
    storage,
    organizationId,
    scheduler,
    policy,
    pendingJobs,
    now,
  );
  if (result.status.state === "closed") {
    await scheduleNextAlarm(storage, now, result.isFullBatch);
  }
  return {
    circuitBreaker: result.status,
    enqueuedJobCount: pendingJobs.length,
    organizationId,
  };
}
