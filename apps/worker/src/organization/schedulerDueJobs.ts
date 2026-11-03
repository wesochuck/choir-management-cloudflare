import { recordDatabaseCost } from "../observability/databaseCost";
import { readTicketMessageTemplate } from "./ticketMessageTemplates";
import { readRosterAutomationConfiguration } from "./statusAutomationStore";
import { advanceComplianceReminder, findDueComplianceReminders } from "./complianceStore";
import { schedulePaymentFeeReconciliationInStore } from "./feeReconciliation";
import { prepareMusicTrackImportCleanupSweepInStore } from "./music/trackImportStore";
import {
  EVENT_REMINDER_LEAD_MS,
  TICKET_REMINDER_LEAD_MS,
  ATTENDANCE_REPORT_DELAY_MS,
  rsvpFollowUpSchedule,
} from "./communicationSchedule";

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const FEE_RECONCILIATION_BATCH_SIZE = 10;

interface FeeReconciliationCandidateRow {
  readonly [column: string]: SqlStorageValue;
  readonly providerPaymentId: string;
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
  readonly type: string;
}

interface PostEventReportCandidateRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventType: string;
  readonly eventStartsAt: string;
}

interface SchedulerDueStateRow {
  readonly [column: string]: SqlStorageValue;
  readonly nextDueAt: string;
}

function nextSchedulerDue(now: Date): string {
  return new Date(now.getTime() + SCHEDULER_INTERVAL_MS).toISOString();
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
         type,
         rsvp_follow_up_mode AS rsvpFollowUpMode,
         rsvp_follow_up_lead_hours AS rsvpFollowUpLeadHours,
         rsvp_deadline_date AS rsvpDeadlineDate
       FROM events
       WHERE is_archived = 0 AND is_canceled = 0
         AND starts_at > ?
         AND (
           type = 'Performance'
           OR (type = 'Other' AND other_event_rsvp_mode = 'response_requested' AND rsvp_follow_up_mode = 'enabled')
         )
       ORDER BY starts_at, id LIMIT 500`,
      now.toISOString(),
    )
    .toArray();
  for (const candidate of candidates) {
    const schedule = rsvpFollowUpSchedule(
      {
        rsvpDeadlineDate: candidate.rsvpDeadlineDate,
        rsvpFollowUpLeadHours: candidate.rsvpFollowUpLeadHours,
        rsvpFollowUpMode: candidate.rsvpFollowUpMode,
        startsAt: candidate.eventStartsAt,
        type: candidate.type,
      },
      configuration,
      timezone,
    );
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
         AND (type <> 'Other' OR other_event_rsvp_mode <> 'off')
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

export function createPostEventReportJobs(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
): void {
  const configuration = readRosterAutomationConfiguration(storage);
  const dueBefore = new Date(now.getTime() - ATTENDANCE_REPORT_DELAY_MS).toISOString();
  const eventTypeClause = configuration.rehearsalAttendanceReportsEnabled
    ? "type IN ('Performance', 'Rehearsal')"
    : "type = 'Performance'";
  const candidates = storage.sql
    .exec<PostEventReportCandidateRow>(
      `SELECT id AS eventId, title AS eventTitle, type AS eventType, starts_at AS eventStartsAt
       FROM events
       WHERE ${eventTypeClause} AND is_archived = 0 AND is_canceled = 0
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
           SELECT COUNT(*) AS count FROM job_ledger WHERE idempotency_key = ?`,
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

export function createDueJobs(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
  force: boolean,
): void {
  storage.transactionSync(() => {
    const scheduler = storage.sql
      .exec<SchedulerDueStateRow>(
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
      .exec<SchedulerDueStateRow>(
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
    createFeeReconciliationJobs(storage, organizationId, now);
    createComplianceReminderJobs(storage, organizationId, now);
    createMusicTrackImportCleanupJobs(storage, organizationId, now);
    if (schedulerDueAt.getTime() <= now.getTime()) {
      storage.sql.exec(
        `UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1`,
        new Date(schedulerDueAt.getTime() + SCHEDULER_INTERVAL_MS).toISOString(),
        now.toISOString(),
      );
    }
  });
}

function readFeeReconciliationCandidatePage(
  storage: DurableObjectStorage,
  operator: ">" | "<=",
  cursor: string,
  limit: number,
): { readonly rows: readonly FeeReconciliationCandidateRow[]; readonly rowsRead: number } {
  const result = storage.sql.exec<FeeReconciliationCandidateRow>(
    `SELECT DISTINCT provider_payment_id AS providerPaymentId
       FROM payment_attempts
       WHERE provider_payment_id ${operator} ?
         AND status IN ('paid', 'refunded')
         AND processor_fee_cents IS NULL
         AND provider_payment_id NOT LIKE 'fake_%'
         AND provider_payment_id <> ''
       ORDER BY provider_payment_id
       LIMIT ?`,
    cursor,
    limit,
  );
  return { rows: result.toArray(), rowsRead: result.rowsRead };
}

function createFeeReconciliationJobs(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
): void {
  const savedCursor = storage.sql
    .exec<{ readonly feeReconciliationCursor: string }>(
      `SELECT fee_reconciliation_cursor AS feeReconciliationCursor
       FROM scheduler_state WHERE singleton = 1`,
    )
    .toArray()
    .at(0)?.feeReconciliationCursor;
  const cursor = savedCursor ?? "";
  const firstPage = readFeeReconciliationCandidatePage(
    storage,
    ">",
    cursor,
    FEE_RECONCILIATION_BATCH_SIZE,
  );
  const candidates = [...firstPage.rows];
  let rowsRead = firstPage.rowsRead;
  if (cursor !== "" && candidates.length < FEE_RECONCILIATION_BATCH_SIZE) {
    const wrappedPage = readFeeReconciliationCandidatePage(
      storage,
      "<=",
      cursor,
      FEE_RECONCILIATION_BATCH_SIZE - candidates.length,
    );
    candidates.push(...wrappedPage.rows);
    rowsRead += wrappedPage.rowsRead;
  }

  for (const row of candidates) {
    schedulePaymentFeeReconciliationInStore(storage, {
      now,
      organizationId,
      providerPaymentId: row.providerPaymentId,
    });
  }

  const nextCursor = candidates.at(-1)?.providerPaymentId ?? "";
  const cursorUpdate = storage.sql.exec(
    `UPDATE scheduler_state
     SET fee_reconciliation_cursor = ?, updated_at = ? WHERE singleton = 1`,
    nextCursor,
    now.toISOString(),
  );
  recordDatabaseCost({
    operation: "organization_sqlite.scheduler.fee_reconciliation",
    rowsRead,
    rowsReturned: candidates.length,
    rowsWritten: cursorUpdate.rowsWritten,
    store: "organization_sqlite",
  });
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

/**
 * Session-backed practice-track import cleanup sweep (issue #278).
 *
 * Expires idle/absolute-expired sessions and enqueues at most 10 cleanup
 * executions per Organization scan. The store function owns the outbox
 * writes with round-scoped idempotency keys and skips sessions that already
 * have an unenqueued cleanup row, so hourly passes never duplicate work.
 */
function createMusicTrackImportCleanupJobs(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
): void {
  prepareMusicTrackImportCleanupSweepInStore(storage, {
    now: now.toISOString(),
    organizationId,
  });
}
