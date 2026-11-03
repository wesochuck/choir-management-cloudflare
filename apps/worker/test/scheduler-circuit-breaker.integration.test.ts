import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import type { DeliveryJob } from "../src/jobs/contracts";
import {
  readSchedulerState,
  runOrganizationAlarm,
  wakeOrganizationAlarm,
} from "../src/organization/scheduler";
import {
  organizationStore,
  provisionScheduler,
  requireBinding,
} from "./helpers/schedulerTestHarness";

function createFailingQueue(errorMessage: string): Queue<DeliveryJob> {
  return {
    metrics: async (): Promise<never> => {
      await Promise.resolve();
      throw new Error(errorMessage);
    },
    send: async (): Promise<never> => {
      await Promise.resolve();
      throw new Error(errorMessage);
    },
    sendBatch: async (): Promise<never> => {
      await Promise.resolve();
      throw new Error(errorMessage);
    },
  };
}

afterEach(async () => {
  await reset();
});

describe("runaway-work circuit breaker", () => {
  it("trips after 30 consecutive full batches, arms 15-minute backoff, and halts 1-second continuation", async () => {
    const stub = await provisionScheduler();
    await runInDurableObject(stub, async (_instance, state) => {
      const now = new Date();
      for (let index = 0; index < 310; index++) {
        state.storage.sql.exec(
          `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
           VALUES (?, 'event_reminder', ?, ?, ?)`,
          crypto.randomUUID(),
          `circuit-loop-job:${String(index)}`,
          now.toISOString(),
          now.toISOString(),
        );
      }
      const queue = requireBinding(env.JOBS_QUEUE, "JOBS_QUEUE");

      let currentTime = now;
      let lastResult;
      for (let batch = 0; batch < 30; batch++) {
        lastResult = await runOrganizationAlarm(state.storage, queue, currentTime);
        expect(lastResult.enqueuedJobCount).toBe(10);
        if (batch < 29) {
          currentTime = new Date(currentTime.getTime() + 1_000);
        }
      }

      expect(lastResult?.circuitBreaker?.state).toBe("open");
      expect(lastResult?.circuitBreaker?.reason).toBe("consecutive_full_batches");
      expect(lastResult?.circuitBreaker?.tripCount).toBe(1);
      const resumeAt = lastResult?.circuitBreaker?.resumeAt;
      expect(resumeAt).toBeDefined();
      if (!resumeAt) throw new Error("Missing resumeAt");
      const resumeTime = new Date(resumeAt).getTime();
      expect(resumeTime).toBe(currentTime.getTime() + 15 * 60 * 1000);

      expect(await state.storage.getAlarm()).toBe(resumeTime);

      const throttledTime = new Date(currentTime.getTime() + 5_000);
      const throttledResult = await runOrganizationAlarm(state.storage, queue, throttledTime);
      expect(throttledResult.enqueuedJobCount).toBe(0);
      expect(throttledResult.circuitBreaker?.state).toBe("open");
      expect(await state.storage.getAlarm()).toBe(resumeTime);
    });
  });

  it("prevents wakeOrganizationAlarm from defeating cooldown while open", async () => {
    const stub = await provisionScheduler();
    await runInDurableObject(stub, async (_instance, state) => {
      const now = new Date();
      for (let index = 0; index < 300; index++) {
        state.storage.sql.exec(
          `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
           VALUES (?, 'event_reminder', ?, ?, ?)`,
          crypto.randomUUID(),
          `circuit-wake-job:${String(index)}`,
          now.toISOString(),
          now.toISOString(),
        );
      }
      const queue = requireBinding(env.JOBS_QUEUE, "JOBS_QUEUE");
      let currentTime = now;
      let lastResult;
      for (let batch = 0; batch < 30; batch++) {
        lastResult = await runOrganizationAlarm(state.storage, queue, currentTime);
        if (batch < 29) {
          currentTime = new Date(currentTime.getTime() + 1_000);
        }
      }
      expect(lastResult?.circuitBreaker?.state).toBe("open");
      const resumeAt = lastResult?.circuitBreaker?.resumeAt;
      expect(resumeAt).toBeDefined();
      if (!resumeAt) throw new Error("Missing resumeAt");
      const resumeTime = new Date(resumeAt).getTime();
      expect(await state.storage.getAlarm()).toBe(resumeTime);

      const wakeTime = new Date(now.getTime() + 60_000);
      await wakeOrganizationAlarm(state.storage, wakeTime);
      expect(await state.storage.getAlarm()).toBe(resumeTime);

      await wakeOrganizationAlarm(state.storage, new Date(now.getTime() + 120_000));
      expect(await state.storage.getAlarm()).toBe(resumeTime);
    });
  });

  it("recovers via half-open probe and drains remaining backlog safely without dropped jobs", async () => {
    const stub = await provisionScheduler();
    await runInDurableObject(stub, async (_instance, state) => {
      const now = new Date();
      for (let index = 0; index < 320; index++) {
        state.storage.sql.exec(
          `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
           VALUES (?, 'event_reminder', ?, ?, ?)`,
          crypto.randomUUID(),
          `circuit-recover-job:${String(index)}`,
          now.toISOString(),
          now.toISOString(),
        );
      }
      const queue = requireBinding(env.JOBS_QUEUE, "JOBS_QUEUE");
      let currentTime = now;
      for (let batch = 0; batch < 30; batch++) {
        await runOrganizationAlarm(state.storage, queue, currentTime);
        if (batch < 29) {
          currentTime = new Date(currentTime.getTime() + 1_000);
        }
      }
      const schedulerBefore = readSchedulerState(state.storage);
      expect(schedulerBefore?.circuitState).toBe("open");
      const resumeAt = schedulerBefore?.resumeAt;
      expect(resumeAt).toBeDefined();
      if (!resumeAt) throw new Error("Missing resumeAt");
      const resumeTime = new Date(resumeAt).getTime();

      const probeTime = new Date(resumeTime);
      const probeResult = await runOrganizationAlarm(state.storage, queue, probeTime);
      expect(probeResult.enqueuedJobCount).toBe(10);
      expect(probeResult.circuitBreaker?.state).toBe("closed");

      const nextTime = new Date(probeTime.getTime() + 1_000);
      const finalResult = await runOrganizationAlarm(state.storage, queue, nextTime);
      expect(finalResult.enqueuedJobCount).toBe(10);
      expect(finalResult.circuitBreaker?.state).toBe("closed");

      const totalEnqueued = state.storage.sql
        .exec<{ readonly count: number }>(
          "SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE enqueued_at IS NOT NULL",
        )
        .one().count;
      expect(totalEnqueued).toBe(320);
    });
  });

  it("trips immediately back to open with backoff if half-open probe dispatch fails", async () => {
    const stub = await provisionScheduler();
    await runInDurableObject(stub, async (_instance, state) => {
      const now = new Date();
      for (let index = 0; index < 305; index++) {
        state.storage.sql.exec(
          `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
           VALUES (?, 'event_reminder', ?, ?, ?)`,
          crypto.randomUUID(),
          `circuit-probe-fail-job:${String(index)}`,
          now.toISOString(),
          now.toISOString(),
        );
      }
      const queue = requireBinding(env.JOBS_QUEUE, "JOBS_QUEUE");
      let currentTime = now;
      for (let batch = 0; batch < 30; batch++) {
        await runOrganizationAlarm(state.storage, queue, currentTime);
        if (batch < 29) {
          currentTime = new Date(currentTime.getTime() + 1_000);
        }
      }
      const schedulerBefore = readSchedulerState(state.storage);
      expect(schedulerBefore?.circuitState).toBe("open");
      const resumeAt = schedulerBefore?.resumeAt;
      expect(resumeAt).toBeDefined();
      if (!resumeAt) throw new Error("Missing resumeAt");
      const resumeTime = new Date(resumeAt).getTime();

      const failingQueue = createFailingQueue("simulated_probe_queue_failure");

      await expect(
        runOrganizationAlarm(state.storage, failingQueue, new Date(resumeTime)),
      ).rejects.toThrow("The Organization scheduler could not enqueue its stable job batch.");

      const schedulerAfter = readSchedulerState(state.storage);
      expect(schedulerAfter?.circuitState).toBe("open");
      expect(schedulerAfter?.lastTripReason).toBe("probe_dispatch_failure");
      expect(schedulerAfter?.tripCount).toBe(2);
      const resumeAtAfter = schedulerAfter?.resumeAt;
      expect(resumeAtAfter).toBeDefined();
      if (!resumeAtAfter) throw new Error("Missing resumeAtAfter");
      expect(await state.storage.getAlarm()).toBe(new Date(resumeAtAfter).getTime());
    });
  });

  it("trips to open with 15-minute backoff after 5 consecutive dispatch failures", async () => {
    const stub = await provisionScheduler();
    await runInDurableObject(stub, async (_instance, state) => {
      const now = new Date();
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, 'event_reminder', 'fail-test-1', ?, ?)`,
        crypto.randomUUID(),
        now.toISOString(),
        now.toISOString(),
      );
      const failingQueue = createFailingQueue("simulated_dispatch_failure");

      let currentTime = now;
      for (let attempt = 1; attempt <= 4; attempt++) {
        await expect(
          runOrganizationAlarm(state.storage, failingQueue, currentTime),
        ).rejects.toThrow();
        const sched = readSchedulerState(state.storage);
        expect(sched?.circuitState).toBe("closed");
        expect(sched?.consecutiveDispatchFailures).toBe(attempt);
        expect(await state.storage.getAlarm()).toBe(currentTime.getTime() + 60_000);
        currentTime = new Date(currentTime.getTime() + 60_000);
      }

      await expect(
        runOrganizationAlarm(state.storage, failingQueue, currentTime),
      ).rejects.toThrow();
      const schedTripped = readSchedulerState(state.storage);
      expect(schedTripped?.circuitState).toBe("open");
      expect(schedTripped?.lastTripReason).toBe("consecutive_dispatch_failures");
      expect(schedTripped?.consecutiveDispatchFailures).toBe(5);
      expect(schedTripped?.tripCount).toBe(1);
      const resumeAt = schedTripped?.resumeAt;
      expect(resumeAt).toBeDefined();
      if (!resumeAt) throw new Error("Missing resumeAt");
      const resumeTime = new Date(resumeAt).getTime();
      expect(resumeTime).toBe(currentTime.getTime() + 15 * 60 * 1000);
      expect(await state.storage.getAlarm()).toBe(resumeTime);

      const retryCall = await runOrganizationAlarm(
        state.storage,
        failingQueue,
        new Date(currentTime.getTime() + 10_000),
      );
      expect(retryCall.enqueuedJobCount).toBe(0);
      expect(retryCall.circuitBreaker?.state).toBe("open");
      expect(await state.storage.getAlarm()).toBe(resumeTime);
    });
  });

  it("persists circuit breaker state across DO restarts and isolates independent organizations", async () => {
    const stubA = await provisionScheduler();
    const objectIdB = organizationStore.idFromName("organization-independent-b");
    const stubB = organizationStore.get(objectIdB);
    await stubB.fetch("https://organization.internal/internal/provision", {
      body: JSON.stringify({
        actorUserId: "bootstrap",
        canonicalHostname: "sched-b.localhost",
        canonicalStatus: "active",
        name: "Scheduler B Org",
        organizationId: "organization-independent-b",
        requestId: "88888888-8888-4888-8888-888888888888",
        slug: "sched-b",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    const now = new Date();
    const failingQueue = createFailingQueue("simulated_failure");

    await runInDurableObject(stubA, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, 'event_reminder', 'org-a-job', ?, ?)`,
        crypto.randomUUID(),
        now.toISOString(),
        now.toISOString(),
      );
      let t = now;
      for (let i = 0; i < 5; i++) {
        await runOrganizationAlarm(state.storage, failingQueue, t).catch(() => undefined);
        t = new Date(t.getTime() + 60_000);
      }
      expect(readSchedulerState(state.storage)?.circuitState).toBe("open");
    });

    const freshStubA = organizationStore.get(
      organizationStore.idFromName("organization-scheduler"),
    );
    await runInDurableObject(freshStubA, (_instance, state) => {
      const stateA = readSchedulerState(state.storage);
      expect(stateA?.circuitState).toBe("open");
      expect(stateA?.tripCount).toBe(1);
    });

    await runInDurableObject(stubB, async (_instance, state) => {
      const stateB = readSchedulerState(state.storage);
      expect(stateB?.circuitState).toBe("closed");
      expect(stateB?.tripCount).toBe(0);

      await wakeOrganizationAlarm(state.storage, now);
      expect(await state.storage.getAlarm()).toBe(now.getTime() + 1_000);
    });
  });

  it("supports authorized operator override and reset via /internal/scheduler/run-now", async () => {
    const stub = await provisionScheduler();
    const now = new Date();
    const failingQueue = createFailingQueue("simulated_failure");

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, 'event_reminder', 'reset-test-job', ?, ?)`,
        crypto.randomUUID(),
        now.toISOString(),
        now.toISOString(),
      );
      let t = now;
      for (let i = 0; i < 5; i++) {
        await runOrganizationAlarm(state.storage, failingQueue, t).catch(() => undefined);
        t = new Date(t.getTime() + 60_000);
      }
      expect(readSchedulerState(state.storage)?.circuitState).toBe("open");
    });

    const response = await stub.fetch("https://organization.internal/internal/scheduler/run-now", {
      body: JSON.stringify({
        force: true,
        organizationId: "organization-scheduler",
        resetCircuitBreaker: true,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(200);

    await runInDurableObject(stub, (_instance, state) => {
      const stateAfter = readSchedulerState(state.storage);
      expect(stateAfter?.circuitState).toBe("closed");
      expect(stateAfter?.consecutiveDispatchFailures).toBe(0);
      expect(stateAfter?.consecutiveFullBatches).toBe(0);
    });
  });
});
