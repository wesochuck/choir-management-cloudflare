import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  reset,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";
import { z } from "zod";

import { processDeadLetterBatch, processDeliveryBatch } from "../src/jobs/consumer";
import type { DeliveryJob } from "../src/jobs/contracts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

interface JobLedgerTestRow {
  readonly [column: string]: SqlStorageValue;
  readonly attempt: number;
  readonly failedAt: string | null;
  readonly jobId: string;
  readonly status: string;
}

interface DeadLetterTestRow {
  readonly idempotencyKey: string | null;
  readonly jobId: string | null;
  readonly jobKind: string | null;
  readonly messageValid: number;
  readonly observationCount: number;
  readonly organizationId: string | null;
  readonly queueName: string;
}

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");

const queueResultSchema = z.object({
  explicitAcks: z.array(z.string()),
  retryMessages: z.array(z.unknown()),
});

const alphaJob: DeliveryJob = {
  attempt: 1,
  idempotencyKey: "attendance-report:event-alpha:2026-07-21",
  jobId: "11111111-1111-4111-8111-111111111111",
  kind: "attendance_report",
  organizationId: "organization-alpha",
  version: 1,
};

function createBatch(body: unknown, attempts: number, id: string) {
  return createMessageBatch("choir-management-jobs-local", [
    { attempts, body, id, timestamp: new Date("2026-07-21T12:00:00.000Z") },
  ]);
}

async function processBatch(
  body: unknown,
  attempts: number,
  id: string,
  externalEffectsMode = "fake",
) {
  const batch = createBatch(body, attempts, id);
  const executionContext = createExecutionContext();
  await processDeliveryBatch(batch, {
    EXTERNAL_EFFECTS_MODE: externalEffectsMode,
    ORGANIZATION_STORE: organizationStore,
    SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
  });
  const result: unknown = await getQueueResult(batch, executionContext);
  return queueResultSchema.parse(result);
}

async function readJobLedger(
  organizationId: string,
  idempotencyKey: string,
): Promise<JobLedgerTestRow | null> {
  const objectId = organizationStore.idFromName(organizationId);
  return runInDurableObject<OrganizationStore, JobLedgerTestRow | null>(
    organizationStore.get(objectId),
    (_instance, state) =>
      state.storage.sql
        .exec<JobLedgerTestRow>(
          `SELECT attempt, failed_at AS failedAt, job_id AS jobId, status
           FROM job_ledger WHERE idempotency_key = ? LIMIT 1`,
          idempotencyKey,
        )
        .toArray()
        .at(0) ?? null,
  );
}

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
});

afterEach(async () => {
  await reset();
});

describe("Organization queue delivery", () => {
  it("acknowledges invalid untrusted messages without touching an Organization store", async () => {
    const result = await processBatch({ organizationId: "organization-alpha" }, 1, "invalid-job");

    expect(result.explicitAcks).toEqual(["invalid-job"]);
    await expect(readJobLedger("organization-alpha", "missing-key")).resolves.toBeNull();
  });

  it("deduplicates inside one Organization while isolating the same key in another", async () => {
    const firstResult = await processBatch(alphaJob, 1, "alpha-first");
    const replayResult = await processBatch(alphaJob, 2, "alpha-replay");
    const bravoJob: DeliveryJob = {
      ...alphaJob,
      jobId: "22222222-2222-4222-8222-222222222222",
      organizationId: "organization-bravo",
    };
    const bravoResult = await processBatch(bravoJob, 1, "bravo-first");

    expect(firstResult.explicitAcks).toEqual(["alpha-first"]);
    expect(replayResult.explicitAcks).toEqual(["alpha-replay"]);
    expect(bravoResult.explicitAcks).toEqual(["bravo-first"]);
    await expect(readJobLedger("organization-alpha", alphaJob.idempotencyKey)).resolves.toEqual({
      attempt: 1,
      failedAt: null,
      jobId: alphaJob.jobId,
      status: "completed",
    });
    await expect(readJobLedger("organization-bravo", alphaJob.idempotencyKey)).resolves.toEqual({
      attempt: 1,
      failedAt: null,
      jobId: bravoJob.jobId,
      status: "completed",
    });
  });

  it("records a failed attempt and lets a later queue delivery reclaim and complete it", async () => {
    const failedResult = await processBatch(alphaJob, 1, "alpha-failed", "sandbox");

    expect(failedResult.retryMessages).toHaveLength(1);
    await expect(
      readJobLedger("organization-alpha", alphaJob.idempotencyKey),
    ).resolves.toMatchObject({
      attempt: 1,
      jobId: alphaJob.jobId,
      status: "failed",
    });

    const retryResult = await processBatch(alphaJob, 2, "alpha-retry");

    expect(retryResult.explicitAcks).toEqual(["alpha-retry"]);
    await expect(readJobLedger("organization-alpha", alphaJob.idempotencyKey)).resolves.toEqual({
      attempt: 2,
      failedAt: null,
      jobId: alphaJob.jobId,
      status: "completed",
    });
  });

  it("records only idempotent operational metadata when a job reaches the dead-letter queue", async () => {
    for (let observation = 0; observation < 2; observation += 1) {
      const batch = createMessageBatch("choir-management-jobs-dlq-local", [
        {
          attempts: observation + 1,
          body: alphaJob,
          id: "alpha-dead-letter",
          timestamp: new Date("2026-07-21T12:00:00.000Z"),
        },
      ]);
      await processDeadLetterBatch(batch, { CONTROL_DB: controlDatabase });
    }

    const row = await controlDatabase
      .prepare(
        `SELECT queue_name AS queueName, message_valid AS messageValid,
          organization_id AS organizationId, job_id AS jobId, job_kind AS jobKind,
          idempotency_key AS idempotencyKey, observation_count AS observationCount
         FROM job_dead_letters WHERE message_id = ?`,
      )
      .bind("alpha-dead-letter")
      .first<DeadLetterTestRow>();
    expect(row).toEqual({
      idempotencyKey: alphaJob.idempotencyKey,
      jobId: alphaJob.jobId,
      jobKind: alphaJob.kind,
      messageValid: 1,
      observationCount: 2,
      organizationId: alphaJob.organizationId,
      queueName: "choir-management-jobs-dlq-local",
    });

    const columns = await controlDatabase.prepare("PRAGMA table_info(job_dead_letters)").all<{
      readonly name: string;
    }>();
    expect(columns.results.map((column) => column.name)).not.toContain("body");
    expect(columns.results.map((column) => column.name)).not.toContain("payload");
  });
});
