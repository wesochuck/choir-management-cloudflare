import type { DeliveryJob } from "../jobs/contracts";
import { calculateRsvpDeadline } from "@choir/domain";
import { readTicketMessageTemplate } from "./ticketMessageTemplates";
import { readRosterAutomationConfiguration, runRosterAutomations } from "./statusAutomationStore";

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const OUTBOX_BATCH_SIZE = 10;
const RETRY_ALARM_DELAY_MS = 60_000;
const ALARM_WAKE_DELAY_MS = 1_000;

interface OrganizationIdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

interface SchedulerStateRow {
  readonly [column: string]: SqlStorageValue;
  readonly nextDueAt: string;
}

interface ScheduledJobRow {
  readonly [column: string]: SqlStorageValue;
  readonly dueAt: string;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly kind: DeliveryJob["kind"];
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
  const scheduler = storage.sql
    .exec<SchedulerStateRow>(
      "SELECT next_due_at AS nextDueAt FROM scheduler_state WHERE singleton = 1",
    )
    .toArray()
    .at(0);
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
  await storage.setAlarm(now.getTime() + ALARM_WAKE_DELAY_MS);
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
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
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
    const dedupeKey = `ticket-reminder:${candidate.purchaseId}:${candidate.eventId}`;
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
         rsvp_follow_up_lead_hours AS rsvpFollowUpLeadHours
       FROM events
       WHERE type = 'Performance' AND is_archived = 0 AND is_canceled = 0
         AND starts_at > ?
       ORDER BY starts_at, id LIMIT 500`,
      now.toISOString(),
    )
    .toArray();
  for (const candidate of candidates) {
    if (candidate.rsvpFollowUpMode === "disabled") continue;
    const enabled =
      candidate.rsvpFollowUpMode === "enabled"
        ? candidate.rsvpFollowUpLeadHours !== null
        : configuration.rsvpFollowUpEnabled;
    if (!enabled) continue;
    const leadHours =
      candidate.rsvpFollowUpMode === "enabled"
        ? candidate.rsvpFollowUpLeadHours
        : configuration.rsvpFollowUpLeadHours;
    if (leadHours === null) continue;
    const deadline = calculateRsvpDeadline(
      { startsAt: candidate.eventStartsAt, type: "Performance" },
      configuration.rsvpExpiryLeadDays,
      timezone,
    );
    if (!deadline) continue;
    const deadlineAt = new Date(deadline.deadlineAt).getTime();
    const dueAt = deadlineAt - leadHours * 60 * 60 * 1_000;
    if (deadlineAt <= now.getTime() || dueAt > now.getTime()) continue;
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

function createEventReminderJobs(
  storage: DurableObjectStorage,
  organizationId: string,
  now: Date,
): void {
  const leadTimeHorizon = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
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
    const existingJobs = storage.sql
      .exec<ExistingEventReminderJobRow>(
        `SELECT o.job_id AS jobId, l.status, l.terminal_at AS terminalAt
         FROM scheduled_job_outbox o
         LEFT JOIN job_ledger l ON l.job_id = o.job_id
         WHERE o.kind = 'event_reminder'
           AND (o.idempotency_key = ? OR o.idempotency_key LIKE ?)
         ORDER BY o.created_at, o.job_id`,
        baseIdempotencyKey,
        `${baseIdempotencyKey}:retry:%`,
      )
      .toArray();
    const reminderHistoryCount = storage.sql
      .exec<{ readonly count: number }>(
        `SELECT COUNT(*) AS count FROM job_ledger
         WHERE kind = 'event_reminder'
           AND (idempotency_key = ? OR idempotency_key LIKE ?)`,
        baseIdempotencyKey,
        `${baseIdempotencyKey}:retry:%`,
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
  const dueBefore = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const candidates = storage.sql
    .exec<PostEventReportCandidateRow>(
      `SELECT id AS eventId, title AS eventTitle, type AS eventType, starts_at AS eventStartsAt
       FROM events
       WHERE type = 'Performance' AND is_archived = 0 AND is_canceled = 0
         AND starts_at < ?
       ORDER BY eventStartsAt, eventId LIMIT 50`,
      dueBefore,
    )
    .toArray();
  for (const candidate of candidates) {
    const idempotencyKey = `post-event-report:${organizationId}:${candidate.eventId}`;
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
       VALUES (?, 'attendance_report', ?, ?, ?)`,
      crypto.randomUUID(),
      idempotencyKey,
      now.toISOString(),
      now.toISOString(),
    );
  }
}

function createDueJobs(storage: DurableObjectStorage, organizationId: string, now: Date): void {
  storage.transactionSync(() => {
    const scheduler = storage.sql
      .exec<SchedulerStateRow>(
        "SELECT next_due_at AS nextDueAt FROM scheduler_state WHERE singleton = 1",
      )
      .toArray()
      .at(0);
    if (!scheduler || new Date(scheduler.nextDueAt).getTime() > now.getTime()) {
      return;
    }
    const idempotencyKey = `scheduler:${organizationId}:stale_checkout_cleanup:${scheduler.nextDueAt}`;
    storage.sql.exec(
      `INSERT OR IGNORE INTO scheduled_job_outbox
        (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'stale_checkout_cleanup', ?, ?, ?)`,
      crypto.randomUUID(),
      idempotencyKey,
      scheduler.nextDueAt,
      now.toISOString(),
    );
    createTicketReminderJobs(storage, now);
    createEventReminderJobs(storage, organizationId, now);
    createRsvpFollowUpJobs(storage, organizationId, now);
    createPostEventReportJobs(storage, organizationId, now);
    storage.sql.exec(
      `UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1`,
      new Date(new Date(scheduler.nextDueAt).getTime() + SCHEDULER_INTERVAL_MS).toISOString(),
      now.toISOString(),
    );
  });
}

function readPendingJobs(storage: DurableObjectStorage): readonly ScheduledJobRow[] {
  return storage.sql
    .exec<ScheduledJobRow>(
      `SELECT job_id AS jobId, kind, idempotency_key AS idempotencyKey, due_at AS dueAt
       FROM scheduled_job_outbox
       WHERE enqueued_at IS NULL
       ORDER BY due_at, job_id
       LIMIT ?`,
      OUTBOX_BATCH_SIZE,
    )
    .toArray();
}

async function scheduleNextAlarm(
  storage: DurableObjectStorage,
  now: Date,
  pendingBatchWasFull: boolean,
): Promise<void> {
  const scheduler = storage.sql
    .exec<SchedulerStateRow>(
      "SELECT next_due_at AS nextDueAt FROM scheduler_state WHERE singleton = 1",
    )
    .toArray()
    .at(0);
  if (!scheduler) {
    return;
  }
  const scheduledTime = pendingBatchWasFull
    ? now.getTime() + 1_000
    : Math.max(now.getTime() + 1_000, new Date(scheduler.nextDueAt).getTime());
  await storage.setAlarm(scheduledTime);
}

export async function runOrganizationAlarm(
  storage: DurableObjectStorage,
  queue: Queue<DeliveryJob>,
  now = new Date(),
): Promise<{ readonly enqueuedJobCount: number; readonly organizationId: string | null }> {
  const organizationId = readOrganizationId(storage);
  if (!organizationId) {
    await storage.deleteAlarm();
    return { enqueuedJobCount: 0, organizationId: null };
  }
  runRosterAutomations(storage, organizationId, now);
  createDueJobs(storage, organizationId, now);
  const pendingJobs = readPendingJobs(storage);
  if (pendingJobs.length === 0) {
    await scheduleNextAlarm(storage, now, false);
    return { enqueuedJobCount: 0, organizationId };
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
    await storage.setAlarm(now.getTime() + RETRY_ALARM_DELAY_MS);
    throw new Error("The Organization scheduler could not enqueue its stable job batch.", {
      cause: error,
    });
  }
  const enqueuedAt = now.toISOString();
  storage.transactionSync(() => {
    for (const job of pendingJobs) {
      storage.sql.exec(
        `UPDATE scheduled_job_outbox SET enqueued_at = ?
         WHERE job_id = ? AND enqueued_at IS NULL`,
        enqueuedAt,
        job.jobId,
      );
    }
  });
  await scheduleNextAlarm(storage, now, pendingJobs.length === OUTBOX_BATCH_SIZE);
  return { enqueuedJobCount: pendingJobs.length, organizationId };
}
