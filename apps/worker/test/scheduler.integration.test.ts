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
    ).toBeNull();
  });

  it("wakes the alarm promptly when delivery work is enqueued", async () => {
    const stub = await provisionScheduler();
    const duesProfileId = "88888888-8888-4888-8888-888888888890";
    const duesSeasonId = "88888888-8888-4888-8888-888888888891";
    const setupAt = new Date().toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, 'Dues Member', ?, ?)`,
        duesProfileId,
        setupAt,
        setupAt,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons
          (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Dues Season', ?, ?, 4000, ?, ?)`,
        duesSeasonId,
        setupAt,
        new Date(Date.now() + 86_400_000).toISOString(),
        setupAt,
        setupAt,
      );
    });
    const requests = [
      {
        body: {
          action: "queue_payment_notification",
          contentMarkdown: "Payment received.",
          dedupeKey: "alarm-payment-notification",
          destination: "member@example.test",
          organizationId: "organization-scheduler",
          paymentType: "dues",
          recipientName: "Member",
          resourceId: "88888888-8888-4888-8888-888888888888",
          subject: "Payment received",
        },
        pathname: "/internal/payments/notification",
      },
      {
        body: {
          action: "create_donation_checkout",
          checkout: {
            amountCents: 1500,
            anonymous: false,
            buyerEmail: "donor@example.test",
            buyerName: "Donor",
            checkoutRequestId: "88888888-8888-4888-8888-888888888892",
            marketingConsent: false,
            tributeName: "",
            tributeNotifyEmail: "",
            tributeType: "none",
          },
          donationId: "88888888-8888-4888-8888-888888888893",
          organizationId: "organization-scheduler",
          providerSessionId: "fake_session_alarm_donation",
        },
        pathname: "/internal/donations/manage",
      },
      {
        body: {
          action: "create_dues_checkout",
          checkout: {
            checkoutRequestId: "88888888-8888-4888-8888-888888888894",
            profileIds: [duesProfileId],
            seasonId: duesSeasonId,
          },
          organizationId: "organization-scheduler",
          origin: "https://scheduler.localhost",
          requestId: "88888888-8888-4888-8888-888888888895",
        },
        pathname: "/internal/seasons/manage",
      },
      {
        body: {
          actorType: "organization_member",
          actorUserId: "member-user",
          format: "json",
          organizationId: "organization-scheduler",
          requestId: "88888888-8888-4888-8888-888888888889",
        },
        pathname: "/internal/export/create",
      },
      {
        body: {
          availabilityNotes: "",
          email: "audition@example.test",
          experience: "",
          name: "Audition Member",
          phone: "",
          requestedSlots: [],
          status: "pending",
          voicePart: "",
        },
        pathname: "/internal/audition/create",
      },
    ] as const;

    for (const request of requests) {
      await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
        return state.storage.deleteAlarm().then(() => undefined);
      });
      const requestedAt = Date.now();
      const response = await stub.fetch(`https://organization.internal${request.pathname}`, {
        body: JSON.stringify(request.body),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(response.ok).toBe(true);
      const alarm = await runInDurableObject<OrganizationStore, number | null>(
        stub,
        (_instance, state) => state.storage.getAlarm(),
      );
      expect(alarm).not.toBeNull();
      if (alarm === null) throw new Error("The scheduler alarm was not re-armed.");
      expect(alarm).toBeGreaterThanOrEqual(requestedAt);
      expect(alarm).toBeLessThanOrEqual(requestedAt + 5_000);
      await expect(
        runInDurableObject<OrganizationStore, number | null>(stub, (_instance, state) =>
          state.storage.getAlarm(),
        ),
      ).resolves.toBe(alarm);
    }
  });

  it("makes a terminal reminder failure visible and clears its success marker", async () => {
    const stub = await provisionScheduler();
    const eventId = "99999999-9999-4999-8999-999999999999";
    const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
    const now = new Date().toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, reminder_sent_at, created_at, updated_at)
         VALUES (?, 'Terminal Reminder', 'Rehearsal', ?, ?, ?, ?)`,
        eventId,
        new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at, enqueued_at)
         VALUES (?, 'event_reminder', ?, ?, ?, ?)`,
        jobId,
        `event-reminder:organization-scheduler:${eventId}`,
        now,
        now,
        now,
      );
    });

    const response = await stub.fetch(
      "https://organization.internal/internal/scheduling/event-reminder-result",
      {
        body: JSON.stringify({
          attempt: 10,
          idempotencyKey: `event-reminder:organization-scheduler:${eventId}`,
          jobId,
          organizationId: "organization-scheduler",
          status: "terminal",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(response.status).toBe(200);
    await expect(
      runInDurableObject<
        OrganizationStore,
        { readonly reminderSentAt: string | null; readonly status: string }
      >(stub, (_instance, state) => ({
        reminderSentAt: state.storage.sql
          .exec<{ readonly reminderSentAt: string | null }>(
            "SELECT reminder_sent_at AS reminderSentAt FROM events WHERE id = ?",
            eventId,
          )
          .one().reminderSentAt,
        status: state.storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM job_ledger WHERE job_id = ?",
            jobId,
          )
          .one().status,
      })),
    ).resolves.toEqual({ reminderSentAt: null, status: "failed" });
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

  it("requeues a terminal event reminder on the next scheduler run", async () => {
    const stub = await provisionScheduler();
    const eventId = "88888888-8888-4888-8888-888888888888";
    const oldJobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const now = Date.now();
    const terminalAt = new Date(now - 1_000).toISOString();
    const overdueAt = new Date(now - 2_000).toISOString();

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES (?, 'Retry Rehearsal', 'Rehearsal', ?, ?, ?)`,
        eventId,
        new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
        terminalAt,
        terminalAt,
      );
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox
          (job_id, kind, idempotency_key, due_at, created_at, enqueued_at)
         VALUES (?, 'event_reminder', ?, ?, ?, ?)`,
        oldJobId,
        `event-reminder:organization-scheduler:${eventId}`,
        overdueAt,
        terminalAt,
        terminalAt,
      );
      state.storage.sql.exec(
        `INSERT INTO job_ledger
          (idempotency_key, job_id, kind, status, attempt, retry_count,
           claimed_at, failed_at, terminal_at, last_error_code)
         VALUES (?, ?, 'event_reminder', 'failed', 10, 10, ?, ?, ?, 'queue_dead_lettered')`,
        `event-reminder:organization-scheduler:${eventId}`,
        oldJobId,
        terminalAt,
        terminalAt,
        terminalAt,
      );
      state.storage.sql.exec(
        "UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1",
        overdueAt,
        terminalAt,
      );
      return state.storage.setAlarm(now + 60_000).then(() => undefined);
    });

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const reminderJobs = (await readAllOutboxJobs(stub)).filter(
      (job) => job.kind === "event_reminder",
    );
    expect(reminderJobs).toHaveLength(1);
    expect(reminderJobs[0]).toMatchObject({
      enqueuedAt: expect.any(String),
      idempotencyKey: `event-reminder:organization-scheduler:${eventId}:retry:1`,
    });
    const reminderJob = reminderJobs[0];
    if (!reminderJob) throw new Error("The retry reminder job was not created.");
    const reminderRead = await stub.fetch(
      `https://organization.internal/internal/scheduling/event-reminder-job?organizationId=organization-scheduler&jobId=${reminderJob.jobId}`,
    );
    expect(reminderRead.status).toBe(200);
    expect(await reminderRead.json()).toMatchObject({ eventId });
    await expect(
      runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM job_ledger WHERE job_id = ?",
              oldJobId,
            )
            .one().count,
      ),
    ).resolves.toBe(1);
  });

  it("schedules one pending RSVP follow-up at the configured deadline lead time", async () => {
    const stub = await provisionScheduler();
    const now = Date.now();
    const overdueAt = new Date(now - 1_000).toISOString();
    const eventId = "77777777-7777-4777-8777-777777777777";
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES (?, 'RSVP Follow-up Performance', 'Performance', ?, ?, ?)`,
        eventId,
        new Date(now + 8 * 24 * 60 * 60 * 1_000).toISOString(),
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
    const first = (await readAllOutboxJobs(stub)).filter((job) => job.kind === "rsvp_follow_up");
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      idempotencyKey: `rsvp-follow-up:organization-scheduler:${eventId}`,
      enqueuedAt: expect.any(String),
    });

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE scheduled_job_outbox SET enqueued_at = NULL");
      state.storage.sql.exec(
        "UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1",
        overdueAt,
        overdueAt,
      );
      return state.storage.setAlarm(now + 60_000).then(() => undefined);
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    expect(
      (await readAllOutboxJobs(stub)).filter((job) => job.kind === "rsvp_follow_up"),
    ).toHaveLength(1);
  });
});
