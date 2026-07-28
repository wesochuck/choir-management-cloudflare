import type { DeliveryJob } from "../jobs/contracts";

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const OUTBOX_BATCH_SIZE = 10;
const RETRY_ALARM_DELAY_MS = 60_000;

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
       WHERE p.bundle_id IS NULL AND p.status = 'paid' AND e.starts_at > ? AND e.starts_at <= ?
       UNION ALL
       SELECT p.id, p.buyer_name, p.buyer_email, p.quantity,
        e.id, e.title, e.starts_at
       FROM ticket_bundle_allocations a
       JOIN ticket_purchases p ON p.id = a.purchase_id
       JOIN events e ON e.id = a.event_id
       WHERE p.status = 'paid' AND e.starts_at > ? AND e.starts_at <= ?
       ORDER BY eventStartsAt, purchaseId, eventId LIMIT 100`,
      now.toISOString(),
      horizon,
      now.toISOString(),
      horizon,
    )
    .toArray();
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
      `Reminder: ${candidate.eventTitle}`,
      `Hello ${candidate.buyerName},\n\nThis is your reminder for ${candidate.eventTitle}. Your order includes ${String(candidate.quantity)} ticket(s).`,
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
       WHERE is_archived = 0
         AND reminder_sent_at IS NULL
         AND starts_at > ?
         AND starts_at <= ?
       ORDER BY eventStartsAt, eventId LIMIT 50`,
      now.toISOString(),
      leadTimeHorizon,
    )
    .toArray();
  for (const candidate of candidates) {
    const idempotencyKey = `event-reminder:${organizationId}:${candidate.eventId}`;
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
       VALUES (?, 'event_reminder', ?, ?, ?)`,
      crypto.randomUUID(),
      idempotencyKey,
      now.toISOString(),
      now.toISOString(),
    );
    storage.sql.exec(
      "UPDATE events SET reminder_sent_at = ? WHERE id = ?",
      now.toISOString(),
      candidate.eventId,
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
  const windowEnd = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const windowStart = new Date(now.getTime() - 13 * 60 * 60 * 1000).toISOString();
  const candidates = storage.sql
    .exec<PostEventReportCandidateRow>(
      `SELECT id AS eventId, title AS eventTitle, type AS eventType, starts_at AS eventStartsAt
       FROM events
       WHERE is_archived = 0
         AND type = 'Performance'
         AND starts_at >= ?
         AND starts_at < ?
       ORDER BY eventStartsAt, eventId LIMIT 50`,
      windowStart,
      windowEnd,
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
