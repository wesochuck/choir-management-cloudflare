import type { DeliveryJob } from "../jobs/contracts";
import { recordDatabaseCost } from "../observability/databaseCost";
import { runRosterAutomations } from "./statusAutomationStore";
import { cleanupExpiredNotificationReceipts } from "./notificationInboxStore";
import { createDueJobs, createPostEventReportJobs } from "./schedulerDueJobs";
import {
  archiveDuePolls,
  autoDisableExpiredAuditions,
  processCheckoutReminderWork,
} from "./schedulerMaintenance";

export { createPostEventReportJobs };

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const OUTBOX_BATCH_SIZE = 10;
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
  const nextReminder = storage.sql
    .exec<{ dueAt: string }>(
      "SELECT due_at AS dueAt FROM checkout_reminders WHERE state = 'scheduled' ORDER BY due_at,id LIMIT 1",
    )
    .toArray()[0];
  const nextDueAt = Math.min(
    new Date(scheduler.nextDueAt).getTime(),
    nextJob ? new Date(nextJob.dueAt).getTime() : Infinity,
    nextReminder ? Date.parse(nextReminder.dueAt) : Infinity,
  );
  const scheduledTime = pendingBatchWasFull
    ? now.getTime() + 1_000
    : Math.max(now.getTime() + 1_000, nextDueAt);
  await storage.setAlarm(scheduledTime);
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
  cleanupExpiredNotificationReceipts(storage, now);
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

  const reminderBatchFull =
    scheduler.circuitState === "closed"
      ? processCheckoutReminderWork(storage, organizationId, now)
      : false;
  triggerDueSchedulerTasks(storage, organizationId, scheduler, now, options.force === true);

  const pendingJobs = readPendingJobs(storage, now);
  if (pendingJobs.length === 0) {
    const status = settleQuietScheduler(storage, organizationId, scheduler, now);
    await scheduleNextAlarm(storage, now, reminderBatchFull);
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
    await scheduleNextAlarm(storage, now, result.isFullBatch || reminderBatchFull);
  }
  return {
    circuitBreaker: result.status,
    enqueuedJobCount: pendingJobs.length,
    organizationId,
  };
}
