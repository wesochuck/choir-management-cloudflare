import type { DeliveryJob } from "../jobs/contracts";

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
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

function nextDailyDue(now: Date): string {
  return new Date(now.getTime() + DAILY_INTERVAL_MS).toISOString();
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
  const nextDueAt = nextDailyDue(now);
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

function createDueJob(storage: DurableObjectStorage, organizationId: string, now: Date): void {
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
    storage.sql.exec(
      `UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1`,
      new Date(new Date(scheduler.nextDueAt).getTime() + DAILY_INTERVAL_MS).toISOString(),
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
): Promise<void> {
  const organizationId = readOrganizationId(storage);
  if (!organizationId) {
    await storage.deleteAlarm();
    return;
  }
  createDueJob(storage, organizationId, now);
  const pendingJobs = readPendingJobs(storage);
  if (pendingJobs.length === 0) {
    await scheduleNextAlarm(storage, now, false);
    return;
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
}
