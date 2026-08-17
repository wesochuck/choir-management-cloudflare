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
const organizationFiles = requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");

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
  includeControlDatabase = false,
) {
  const batch = createBatch(body, attempts, id);
  const executionContext = createExecutionContext();
  const consumerEnvironment = {
    EXTERNAL_EFFECTS_MODE: externalEffectsMode,
    ORGANIZATION_FILES: organizationFiles,
    ORGANIZATION_STORE: organizationStore,
    PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
    SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
    ...(includeControlDatabase ? { CONTROL_DB: controlDatabase } : {}),
  };
  await processDeliveryBatch(batch, consumerEnvironment);
  const result: unknown = await getQueueResult(batch, executionContext);
  return queueResultSchema.parse(result);
}

async function provisionScheduledCommunicationFixture(): Promise<
  DurableObjectStub<OrganizationStore>
> {
  const organizationId = "organization-scheduled";
  const profileId = "99999999-9999-4999-8999-999999999999";
  const now = new Date();
  const nowIso = now.toISOString();
  await controlDatabase.batch([
    controlDatabase
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, 'Scheduled Organization', 'scheduled', 'active', ?, 0, ?, ?, ?)`,
      )
      .bind(organizationId, organizationId, nowIso, nowIso, nowIso),
    controlDatabase
      .prepare(
        `INSERT INTO user
          (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
         VALUES (?, 'Scheduled Owner', 'scheduled-owner@example.test', 1, ?, ?, 0)`,
      )
      .bind("scheduled-owner-user", now.getTime(), now.getTime()),
    controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt)
         VALUES (?, ?, ?, 'owner', ?, ?)`,
      )
      .bind(
        "scheduled-owner-member",
        organizationId,
        "scheduled-owner-user",
        profileId,
        now.getTime(),
      ),
  ]);
  const stub = organizationStore.get(organizationStore.idFromName(organizationId));
  const provisionResponse = await stub.fetch("https://organization.internal/internal/provision", {
    body: JSON.stringify({
      actorUserId: "bootstrap",
      canonicalHostname: "scheduled.localhost",
      canonicalStatus: "active",
      name: "Scheduled Organization",
      organizationId,
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      slug: "scheduled",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(provisionResponse.status).toBe(200);
  await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
    const reportEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
    const reminderEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
    const followUpEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf";
    state.storage.sql.exec(
      `INSERT INTO profiles (id, display_name, phone, voice_part, global_status,
         show_in_directory, created_at, updated_at)
       VALUES (?, 'Scheduled Singer', '+15550000000', 'S1', 'Active', 1, ?, ?)`,
      profileId,
      nowIso,
      nowIso,
    );
    state.storage.sql.exec(
      `INSERT INTO events (id, title, type, starts_at, duration_minutes, call_time, location,
         details, created_at, updated_at)
       VALUES (?, 'Scheduled RSVP Follow-up Performance', 'Performance', ?, 90, '19:00', 'Hall',
         'Follow-up details', ?, ?)`,
      followUpEventId,
      new Date(now.getTime() + 10 * 24 * 60 * 60 * 1_000).toISOString(),
      nowIso,
      nowIso,
    );
    state.storage.sql.exec(
      `INSERT INTO events (id, title, type, starts_at, duration_minutes, call_time, location,
         details, created_at, updated_at)
       VALUES (?, 'Scheduled Report Performance', 'Performance', ?, 90, '19:00', 'Main Hall',
         'Report details', ?, ?)`,
      reportEventId,
      new Date(now.getTime() - 12.5 * 60 * 60 * 1_000).toISOString(),
      nowIso,
      nowIso,
    );
    state.storage.sql.exec(
      `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at)
       VALUES (?, ?, 'Pending', 'Pending', ?, ?)`,
      followUpEventId,
      profileId,
      nowIso,
      nowIso,
    );
    state.storage.sql.exec(
      `INSERT INTO events (id, title, type, starts_at, duration_minutes, call_time, location,
         details, created_at, updated_at)
       VALUES (?, 'Scheduled Reminder Rehearsal', 'Rehearsal', ?, 90, '19:00', 'Studio',
         'Reminder details', ?, ?)`,
      reminderEventId,
      new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
      nowIso,
      nowIso,
    );
    state.storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'rsvp_follow_up', ?, ?, ?)`,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
      `rsvp-follow-up:${organizationId}:${followUpEventId}`,
      nowIso,
      nowIso,
    );
    state.storage.sql.exec(
      `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at)
       VALUES (?, ?, 'Pending', 'Pending', ?, ?)`,
      reportEventId,
      profileId,
      nowIso,
      nowIso,
    );
    state.storage.sql.exec(
      `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at)
       VALUES (?, ?, 'Yes', 'Present', ?, ?)`,
      reminderEventId,
      profileId,
      nowIso,
      nowIso,
    );
    state.storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'attendance_report', ?, ?, ?)`,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad",
      `post-event-report:${organizationId}:${reportEventId}`,
      nowIso,
      nowIso,
    );
    state.storage.sql.exec(
      `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
       VALUES (?, 'event_reminder', ?, ?, ?)`,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae",
      `event-reminder:${organizationId}:${reminderEventId}`,
      nowIso,
      nowIso,
    );
  });
  return stub;
}

async function readCommunicationOutboxJobs(
  stub: DurableObjectStub<OrganizationStore>,
): Promise<readonly { readonly idempotencyKey: string; readonly jobId: string }[]> {
  return runInDurableObject<
    OrganizationStore,
    { readonly idempotencyKey: string; readonly jobId: string }[]
  >(stub, (_instance, state) =>
    state.storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly idempotencyKey: string;
        readonly jobId: string;
      }>(
        `SELECT job_id AS jobId, idempotency_key AS idempotencyKey
           FROM scheduled_job_outbox WHERE kind = 'communication_delivery'
           ORDER BY job_id`,
      )
      .toArray(),
  );
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
  for (const organizationId of ["organization-alpha", "organization-bravo"]) {
    const response = await organizationStore
      .get(organizationStore.idFromName(organizationId))
      .fetch("https://organization.internal/internal/provision", {
        body: JSON.stringify({
          actorUserId: "queue-test",
          canonicalHostname: `${organizationId}.localhost`,
          canonicalStatus: "active",
          name: organizationId,
          organizationId,
          requestId: crypto.randomUUID(),
          slug: organizationId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    expect(response.status).toBe(200);
  }
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
      if (observation === 0) {
        await expect(
          controlDatabase
            .prepare("SELECT id FROM job_dead_letters WHERE message_id = ?")
            .bind("alpha-dead-letter")
            .first(),
        ).resolves.toBeNull();
      }
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
      observationCount: 1,
      organizationId: alphaJob.organizationId,
      queueName: "choir-management-jobs-dlq-local",
    });

    const columns = await controlDatabase.prepare("PRAGMA table_info(job_dead_letters)").all<{
      readonly name: string;
    }>();
    expect(columns.results.map((column) => column.name)).not.toContain("body");
    expect(columns.results.map((column) => column.name)).not.toContain("payload");
  });

  it("accepts and completes an event_reminder job in fake mode", async () => {
    const eventReminderJob: DeliveryJob = {
      attempt: 1,
      idempotencyKey: "event-reminder:organization-alpha:77777777-7777-4777-8777-777777777777",
      jobId: "88888888-8888-4888-8888-888888888888",
      kind: "event_reminder",
      organizationId: "organization-alpha",
      version: 1,
    };
    const result = await processBatch(eventReminderJob, 1, "event-reminder-test");
    expect(result.explicitAcks).toEqual(["event-reminder-test"]);
    await expect(
      readJobLedger("organization-alpha", eventReminderJob.idempotencyKey),
    ).resolves.toEqual({
      attempt: 1,
      failedAt: null,
      jobId: eventReminderJob.jobId,
      status: "completed",
    });
  });

  it("delivers scheduled reminders and attendance reports through the communication ledger", async () => {
    const stub = await provisionScheduledCommunicationFixture();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE profiles SET receive_attendance_reports = 0");
      return undefined;
    });
    const outerJobs: readonly DeliveryJob[] = [
      {
        attempt: 1,
        idempotencyKey:
          "event-reminder:organization-scheduled:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac",
        jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae",
        kind: "event_reminder",
        organizationId: "organization-scheduled",
        version: 1,
      },
      {
        attempt: 1,
        idempotencyKey:
          "rsvp-follow-up:organization-scheduled:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf",
        jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
        kind: "rsvp_follow_up",
        organizationId: "organization-scheduled",
        version: 1,
      },
      {
        attempt: 1,
        idempotencyKey:
          "post-event-report:organization-scheduled:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
        jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad",
        kind: "attendance_report",
        organizationId: "organization-scheduled",
        version: 1,
      },
    ];
    for (const [index, job] of outerJobs.entries()) {
      const result = await processBatch(job, 1, `scheduled-outer-${String(index)}`, "fake", true);
      expect(result.explicitAcks).toEqual([`scheduled-outer-${String(index)}`]);
    }
    const communicationJobs = await readCommunicationOutboxJobs(stub);
    expect(communicationJobs).toHaveLength(3);
    for (const [index, queuedJob] of communicationJobs.entries()) {
      const communicationJob: DeliveryJob = {
        attempt: 1,
        idempotencyKey: queuedJob.idempotencyKey,
        jobId: queuedJob.jobId,
        kind: "communication_delivery",
        organizationId: "organization-scheduled",
        version: 1,
      };
      const result = await processBatch(
        communicationJob,
        1,
        `scheduled-inner-${String(index)}`,
        "fake",
        true,
      );
      expect(result.explicitAcks).toEqual([`scheduled-inner-${String(index)}`]);
    }
    const stored = await runInDurableObject<
      OrganizationStore,
      {
        readonly attendance: string;
        readonly content: string;
        readonly deliveryStatus: string;
        readonly messageCount: number;
        readonly reminderSentAt: string | null;
      }
    >(stub, (_instance, state) => ({
      attendance: state.storage.sql
        .exec<{ readonly [column: string]: SqlStorageValue; readonly attendance: string }>(
          `SELECT attendance FROM event_rosters
           WHERE event_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab' LIMIT 1`,
        )
        .one().attendance,
      content: state.storage.sql
        .exec<{ readonly [column: string]: SqlStorageValue; readonly content: string }>(
          `SELECT content_markdown AS content FROM communication_messages
           WHERE subject LIKE 'Attendance report:%' LIMIT 1`,
        )
        .one().content,
      deliveryStatus: state.storage.sql
        .exec<{ readonly [column: string]: SqlStorageValue; readonly deliveryStatus: string }>(
          `SELECT d.status AS deliveryStatus FROM communication_deliveries d
           JOIN communication_messages m ON m.id = d.message_id
           WHERE m.subject LIKE 'Attendance report:%' LIMIT 1`,
        )
        .one().deliveryStatus,
      messageCount: state.storage.sql
        .exec<{ readonly [column: string]: SqlStorageValue; readonly messageCount: number }>(
          "SELECT COUNT(*) AS messageCount FROM communication_messages",
        )
        .one().messageCount,
      reminderSentAt: state.storage.sql
        .exec<{
          readonly [column: string]: SqlStorageValue;
          readonly reminderSentAt: string | null;
        }>(
          `SELECT reminder_sent_at AS reminderSentAt FROM events
           WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac' LIMIT 1`,
        )
        .one().reminderSentAt,
    }));
    expect(stored.attendance).toBe("Absent");
    expect(stored.content).toContain("Attendance rate:");
    expect(stored.deliveryStatus).toBe("sent");
    expect(stored.messageCount).toBe(3);
    expect(stored.reminderSentAt).toEqual(expect.any(String));
  });
});
