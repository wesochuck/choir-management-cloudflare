import { env } from "cloudflare:workers";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";

interface OutboxState {
  readonly enqueuedAt: string | null;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly nextDueAt: string;
}

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

async function provisionScheduler(): Promise<DurableObjectStub<OrganizationStore>> {
  const objectId = organizationStore.idFromName("organization-scheduler");
  const stub = organizationStore.get(objectId);
  const response = await stub.fetch("https://organization.internal/internal/provision", {
    body: JSON.stringify({
      actorUserId: "bootstrap",
      canonicalHostname: "scheduler.localhost",
      canonicalStatus: "active",
      name: "Scheduler Organization",
      organizationId: "organization-scheduler",
      requestId: "77777777-7777-4777-8777-777777777777",
      slug: "scheduler",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
  return stub;
}

async function readOutbox(stub: DurableObjectStub<OrganizationStore>): Promise<OutboxState> {
  return runInDurableObject<OrganizationStore, OutboxState>(stub, (_instance, state) => {
    const row = state.storage.sql
      .exec<
        Record<string, SqlStorageValue> & {
          enqueuedAt: string | null;
          idempotencyKey: string;
          jobId: string;
        }
      >(
        `SELECT job_id AS jobId, idempotency_key AS idempotencyKey,
          enqueued_at AS enqueuedAt
         FROM scheduled_job_outbox LIMIT 1`,
      )
      .one();
    const scheduler = state.storage.sql
      .exec<Record<string, SqlStorageValue> & { nextDueAt: string }>(
        "SELECT next_due_at AS nextDueAt FROM scheduler_state WHERE singleton = 1",
      )
      .one();
    return { ...row, nextDueAt: scheduler.nextDueAt };
  });
}

async function readAllOutboxJobs(stub: DurableObjectStub<OrganizationStore>): Promise<
  readonly {
    readonly enqueuedAt: string | null;
    readonly idempotencyKey: string;
    readonly jobId: string;
    readonly kind: string;
  }[]
> {
  return runInDurableObject<
    OrganizationStore,
    {
      readonly enqueuedAt: string | null;
      readonly idempotencyKey: string;
      readonly jobId: string;
      readonly kind: string;
    }[]
  >(stub, (_instance, state) =>
    state.storage.sql
      .exec<
        Record<string, SqlStorageValue> & {
          enqueuedAt: string | null;
          idempotencyKey: string;
          jobId: string;
          kind: string;
        }
      >(
        `SELECT job_id AS jobId, kind, idempotency_key AS idempotencyKey,
           enqueued_at AS enqueuedAt
         FROM scheduled_job_outbox
         ORDER BY kind, job_id`,
      )
      .toArray(),
  );
}

afterEach(async () => {
  await reset();
});

describe("Organization scheduler", () => {
  it("creates one stable job and safely re-enqueues an uncertain outbox delivery", async () => {
    const stub = await provisionScheduler();
    const overdueAt = new Date(Date.now() - 1_000).toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1",
        overdueAt,
        overdueAt,
      );
      return state.storage.setAlarm(Date.now() + 60_000).then(() => undefined);
    });

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const firstDelivery = await readOutbox(stub);
    expect(firstDelivery).toMatchObject({
      enqueuedAt: expect.any(String),
      idempotencyKey: `scheduler:organization-scheduler:stale_checkout_cleanup:${overdueAt}`,
      jobId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(new Date(firstDelivery.nextDueAt).getTime()).toBeGreaterThan(
      new Date(overdueAt).getTime(),
    );

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE scheduled_job_outbox SET enqueued_at = NULL");
      return state.storage.setAlarm(Date.now() + 60_000).then(() => undefined);
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const replayedDelivery = await readOutbox(stub);
    expect(replayedDelivery.jobId).toBe(firstDelivery.jobId);
    expect(replayedDelivery.idempotencyKey).toBe(firstDelivery.idempotencyKey);
    expect(replayedDelivery.enqueuedAt).toEqual(expect.any(String));

    await expect(
      runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<Record<string, SqlStorageValue> & { count: number }>(
              "SELECT COUNT(*) AS count FROM scheduled_job_outbox",
            )
            .one().count,
      ),
    ).resolves.toBe(1);
  });

  it("creates an event_reminder job for an upcoming event and an attendance_report job for a past performance", async () => {
    const stub = await provisionScheduler();
    const now = Date.now();
    const overdueAt = new Date(now - 1_000).toISOString();
    const upcomingEventId = "33333333-3333-4333-8333-333333333333";
    const pastEventId = "44444444-4444-4444-8444-444444444444";
    const profileId = "55555555-5555-4555-8555-555555555555";

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, phone, voice_part, global_status,
           show_in_directory, created_at, updated_at)
         VALUES (?, 'Test Singer', '+15551234567', 'Soprano', 'Active', 1, ?, ?)`,
        profileId,
        overdueAt,
        overdueAt,
      );
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, call_time, location,
           created_at, updated_at)
         VALUES (?, 'Upcoming Rehearsal', 'Rehearsal', ?, '', 'Room 1', ?, ?)`,
        upcomingEventId,
        new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
        overdueAt,
        overdueAt,
      );
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, call_time, location,
           details, created_at, updated_at)
         VALUES (?, 'Past Performance', 'Performance', ?, '19:00', 'Main Hall',
           'A wonderful concert', ?, ?)`,
        pastEventId,
        new Date(now - 12.5 * 60 * 60 * 1_000).toISOString(),
        overdueAt,
        overdueAt,
      );
      state.storage.sql.exec(
        `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at)
         VALUES (?, ?, 'Yes', 'Present', ?, ?)`,
        upcomingEventId,
        profileId,
        overdueAt,
        overdueAt,
      );
      state.storage.sql.exec(
        `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at)
         VALUES (?, ?, 'Yes', 'Pending', ?, ?)`,
        pastEventId,
        profileId,
        overdueAt,
        overdueAt,
      );
      state.storage.sql.exec(
        "UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1",
        overdueAt,
        overdueAt,
      );
      return state.storage.setAlarm(now + 60_000).then(() => undefined);
    });

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const jobs = await readAllOutboxJobs(stub);

    const eventReminderJob = jobs.find((j) => j.kind === "event_reminder");
    expect(eventReminderJob).toMatchObject({
      idempotencyKey: `event-reminder:organization-scheduler:${upcomingEventId}`,
      enqueuedAt: expect.any(String),
    });

    const attendanceReportJob = jobs.find((j) => j.kind === "attendance_report");
    expect(attendanceReportJob).toMatchObject({
      idempotencyKey: `post-event-report:organization-scheduler:${pastEventId}`,
      enqueuedAt: expect.any(String),
    });

    const staleCheckoutJob = jobs.find((j) => j.kind === "stale_checkout_cleanup");
    expect(staleCheckoutJob).toBeDefined();

    expect(
      await runInDurableObject<OrganizationStore, string | null>(stub, (_instance, state) => {
        const row = state.storage.sql
          .exec<{
            readonly [column: string]: SqlStorageValue;
            readonly reminderSentAt: string | null;
          }>("SELECT reminder_sent_at AS reminderSentAt FROM events WHERE id = ?", upcomingEventId)
          .toArray()
          .at(0);
        return row?.reminderSentAt ?? null;
      }),
    ).toEqual(expect.any(String));
  });

  it("does not duplicate event_reminder or attendance_report jobs on re-alarm when already enqueued", async () => {
    const stub = await provisionScheduler();
    const now = Date.now();
    const overdueAt = new Date(now - 1_000).toISOString();
    const eventId = "66666666-6666-4666-8666-666666666666";

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES (?, 'Rehearsal', 'Rehearsal', ?, ?, ?)`,
        eventId,
        new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
        overdueAt,
        overdueAt,
      );
      state.storage.sql.exec(
        "UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1",
        overdueAt,
        overdueAt,
      );
      return state.storage.setAlarm(now + 60_000).then(() => undefined);
    });

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const afterFirst = await readAllOutboxJobs(stub);
    const eventReminderJobs = afterFirst.filter((j) => j.kind === "event_reminder");
    expect(eventReminderJobs).toHaveLength(1);

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE scheduled_job_outbox SET enqueued_at = NULL");
      return state.storage.setAlarm(now + 60_000).then(() => undefined);
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const afterSecond = await readAllOutboxJobs(stub);
    const eventReminderJobsAgain = afterSecond.filter((j) => j.kind === "event_reminder");
    expect(eventReminderJobsAgain).toHaveLength(1);
  });
});
