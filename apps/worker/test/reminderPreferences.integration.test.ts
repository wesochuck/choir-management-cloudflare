import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  reset,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { processDeliveryBatch } from "../src/jobs/consumer";
import type { DeliveryJob } from "../src/jobs/contracts";
import { scheduledEventJobResponseSchema } from "../src/jobs/deliveries/shared";
import { deliveryJobResponseSchema } from "../src/organization/organizationCommunications";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  readEventReminderJobFromStore,
  readRsvpFollowUpJobFromStore,
} from "../src/organization/schedulingStore";
import { readCommunicationJobFromStore } from "../src/organization/communicationStore/queries";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const organizationFiles = requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");

const ORG_ID = "organization-reminders";
const PROFILE_ALL = "10000000-0000-4000-8000-000000000001";
const PROFILE_NO_REHEARSAL = "10000000-0000-4000-8000-000000000002";
const PROFILE_NO_PERFORMANCE = "10000000-0000-4000-8000-000000000003";
const PROFILE_NONE = "10000000-0000-4000-8000-000000000004";
const EVENT_PERFORMANCE = "20000000-0000-4000-8000-000000000001";
const EVENT_REHEARSAL = "20000000-0000-4000-8000-000000000002";
const EVENT_FOLLOW_UP_PARENT = "20000000-0000-4000-8000-000000000003";
const EVENT_FOLLOW_UP_CHILD = "20000000-0000-4000-8000-000000000004";
const JOB_REHEARSAL_REMINDER = "30000000-0000-4000-8000-000000000001";
const JOB_PERFORMANCE_REMINDER = "30000000-0000-4000-8000-000000000002";
const JOB_FOLLOW_UP = "30000000-0000-4000-8000-000000000003";

async function provisionReminders(): Promise<DurableObjectStub<OrganizationStore>> {
  const stub = organizationStore.get(organizationStore.idFromName(ORG_ID));
  const provisionResponse = await stub.fetch("https://organization.internal/internal/provision", {
    body: JSON.stringify({
      actorUserId: "bootstrap",
      canonicalHostname: "reminders.localhost",
      canonicalStatus: "active",
      name: "Reminders Organization",
      organizationId: ORG_ID,
      requestId: "30000000-0000-4000-8000-000000000000",
      slug: "reminders",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(provisionResponse.status).toBe(200);
  const now = new Date();
  const nowIso = now.toISOString();
  const upcoming = new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString();
  await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
    const profiles: [string, string, number, number, number][] = [
      [PROFILE_ALL, "Singer All", 1, 1, 1],
      [PROFILE_NO_REHEARSAL, "Singer No Rehearsal", 0, 1, 1],
      [PROFILE_NO_PERFORMANCE, "Singer No Performance", 1, 0, 1],
      [PROFILE_NONE, "Singer None", 0, 0, 1],
    ];
    for (const [id, name, rehearsal, performance, other] of profiles) {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, phone, voice_part, global_status,
           show_in_directory, receive_rehearsal_reminders, receive_performance_reminders,
           receive_other_event_reminders, created_at, updated_at)
         VALUES (?, ?, '+15550000000', 'S1', 'Active', 1, ?, ?, ?, ?, ?)`,
        id,
        name,
        rehearsal,
        performance,
        other,
        nowIso,
        nowIso,
      );
    }
    state.storage.sql.exec(
      `INSERT INTO events (id, title, type, starts_at, duration_minutes, call_time, location,
         details, created_at, updated_at)
       VALUES (?, 'Reminder Performance', 'Performance', ?, 90, '19:00', 'Hall',
         'Details', ?, ?)`,
      EVENT_PERFORMANCE,
      upcoming,
      nowIso,
      nowIso,
    );
    state.storage.sql.exec(
      `INSERT INTO events (id, title, type, starts_at, duration_minutes, call_time, location,
         details, parent_performance_id, created_at, updated_at)
       VALUES (?, 'Reminder Rehearsal', 'Rehearsal', ?, 90, '19:00', 'Studio',
         'Details', ?, ?, ?)`,
      EVENT_REHEARSAL,
      upcoming,
      EVENT_PERFORMANCE,
      nowIso,
      nowIso,
    );
    for (const profileId of [
      PROFILE_ALL,
      PROFILE_NO_REHEARSAL,
      PROFILE_NO_PERFORMANCE,
      PROFILE_NONE,
    ]) {
      state.storage.sql.exec(
        `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at)
         VALUES (?, ?, 'Yes', 'Pending', ?, ?)`,
        EVENT_PERFORMANCE,
        profileId,
        nowIso,
        nowIso,
      );
    }
    for (const [eventId, title, type, parent] of [
      [EVENT_FOLLOW_UP_PARENT, "Follow-up Performance", "Performance", null],
      [EVENT_FOLLOW_UP_CHILD, "Follow-up Rehearsal", "Rehearsal", EVENT_FOLLOW_UP_PARENT],
    ] as const) {
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, duration_minutes, call_time, location,
           details, parent_performance_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 90, '19:00', 'Studio', 'Details', ?, ?, ?)`,
        eventId,
        title,
        type,
        upcoming,
        parent,
        nowIso,
        nowIso,
      );
    }
    state.storage.sql.exec(
      `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at)
       VALUES (?, ?, 'Pending', 'Pending', ?, ?)`,
      EVENT_FOLLOW_UP_PARENT,
      PROFILE_NO_REHEARSAL,
      nowIso,
      nowIso,
    );
    const outbox: [string, string, string][] = [
      [JOB_REHEARSAL_REMINDER, "event_reminder", `event-reminder:${ORG_ID}:${EVENT_REHEARSAL}`],
      [JOB_PERFORMANCE_REMINDER, "event_reminder", `event-reminder:${ORG_ID}:${EVENT_PERFORMANCE}`],
      [JOB_FOLLOW_UP, "rsvp_follow_up", `rsvp-follow-up:${ORG_ID}:${EVENT_FOLLOW_UP_CHILD}`],
    ];
    for (const [jobId, kind, key] of outbox) {
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        jobId,
        kind,
        key,
        nowIso,
        nowIso,
      );
    }
    return undefined;
  });
  return stub;
}

async function readJobRecipients(
  stub: DurableObjectStub<OrganizationStore>,
  jobId: string,
): Promise<readonly { readonly profileId: string }[]> {
  return runInDurableObject<OrganizationStore, readonly { readonly profileId: string }[]>(
    stub,
    async (_instance, state) => {
      const job = state.storage.sql
        .exec<{ readonly [column: string]: SqlStorageValue; readonly kind: string }>(
          "SELECT kind FROM scheduled_job_outbox WHERE job_id = ? LIMIT 1",
          jobId,
        )
        .one().kind;
      const response =
        job === "rsvp_follow_up"
          ? readRsvpFollowUpJobFromStore(state.storage, ORG_ID, jobId)
          : readEventReminderJobFromStore(state.storage, ORG_ID, jobId);
      if (!response.ok) throw new Error(`Job read failed with ${String(response.status)}`);
      return scheduledEventJobResponseSchema.parse(await response.json()).recipients;
    },
  );
}

afterEach(async () => {
  await reset();
});

describe("automated event-reminder preferences", () => {
  it("filters reminder recipients by the event's own type and spares follow-ups", async () => {
    const stub = await provisionReminders();
    const rehearsal = await readJobRecipients(stub, JOB_REHEARSAL_REMINDER);
    expect(rehearsal.map(({ profileId }) => profileId).sort()).toEqual(
      [PROFILE_ALL, PROFILE_NO_PERFORMANCE].sort(),
    );
    const performance = await readJobRecipients(stub, JOB_PERFORMANCE_REMINDER);
    expect(performance.map(({ profileId }) => profileId).sort()).toEqual(
      [PROFILE_ALL, PROFILE_NO_REHEARSAL].sort(),
    );
    // The linked rehearsal honors its own type even though every roster row
    // lives on the parent Performance.
    const followUp = await readJobRecipients(stub, JOB_FOLLOW_UP);
    expect(followUp.map(({ profileId }) => profileId)).toContain(PROFILE_NO_REHEARSAL);
  });

  it("completes quietly when every eligible recipient opted out", async () => {
    const stub = await provisionReminders();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE profiles SET receive_rehearsal_reminders = 0");
      return undefined;
    });
    expect(await readJobRecipients(stub, JOB_REHEARSAL_REMINDER)).toEqual([]);

    const batch = createMessageBatch("choir-management-jobs-local", [
      {
        attempts: 1,
        body: {
          attempt: 1,
          idempotencyKey: `event-reminder:${ORG_ID}:${EVENT_REHEARSAL}`,
          jobId: JOB_REHEARSAL_REMINDER,
          kind: "event_reminder",
          organizationId: ORG_ID,
          version: 1,
        } satisfies DeliveryJob,
        id: "reminder-empty-test",
        timestamp: new Date("2026-09-20T00:00:00.000Z"),
      },
    ]);
    const executionContext = createExecutionContext();
    await processDeliveryBatch(batch, {
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_FILES: organizationFiles,
      ORGANIZATION_STORE: organizationStore,
      PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
      SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
    });
    const result: unknown = await getQueueResult(batch, executionContext);
    expect(
      z
        .object({ explicitAcks: z.array(z.string()), retryMessages: z.array(z.unknown()) })
        .parse(result),
    ).toMatchObject({ explicitAcks: ["reminder-empty-test"], retryMessages: [] });
    const messageCount = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly count: number }>("SELECT COUNT(*) AS count FROM communication_messages")
          .one().count,
    );
    expect(messageCount).toBe(0);
  });

  it("suppresses queued reminders after opt-out while sparing manual sends", async () => {
    const stub = await provisionReminders();
    const nowIso = new Date().toISOString();
    const automation = JSON.stringify({
      eventId: EVENT_REHEARSAL,
      eventType: "Rehearsal",
      kind: "event_reminder",
    });
    const audience = JSON.stringify({ eventId: EVENT_REHEARSAL });
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      for (const [messageId, automationJson] of [
        ["40000000-0000-4000-8000-000000000001", automation],
        ["40000000-0000-4000-8000-000000000002", null],
      ] as const) {
        state.storage.sql.exec(
          `INSERT INTO communication_messages
            (id, channel, status, subject, content_markdown, audience_json, reach_json,
             created_by, created_at, updated_at, queued_at, automation_json)
           VALUES (?, 'Email', 'Queued', 'Reminder', 'Hello', ?,
             '{"both":1,"email":1,"sms":0,"total":1,"unreachable":0}',
             'system:scheduler', ?, ?, ?, ?)`,
          messageId,
          audience,
          nowIso,
          nowIso,
          nowIso,
          automationJson,
        );
        state.storage.sql.exec(
          `INSERT INTO communication_deliveries
            (id, message_id, profile_id, recipient_name, channel, destination, status,
             created_at, updated_at)
           VALUES (?, ?, ?, 'Singer All', 'email', 'all@example.test', 'queued', ?, ?)`,
          `50000000-0000-4000-8000-00000000000${messageId === "40000000-0000-4000-8000-000000000001" ? "1" : "2"}`,
          messageId,
          PROFILE_ALL,
          nowIso,
          nowIso,
        );
        state.storage.sql.exec(
          `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
           VALUES (?, 'communication_delivery', ?, ?, ?)`,
          `60000000-0000-4000-8000-00000000000${messageId === "40000000-0000-4000-8000-000000000001" ? "1" : "2"}`,
          `communication:${messageId}:initial`,
          nowIso,
          nowIso,
        );
      }
      // Opt out after queueing: only the pre-delivery recheck can catch this.
      state.storage.sql.exec(
        "UPDATE profiles SET receive_rehearsal_reminders = 0 WHERE id = ?",
        PROFILE_ALL,
      );
      return undefined;
    });

    const prepare = (jobId: string) =>
      runInDurableObject<OrganizationStore, { readonly ids: string[] }>(
        stub,
        async (_instance, state) => {
          const response = readCommunicationJobFromStore(state.storage, ORG_ID, jobId);
          const parsed = deliveryJobResponseSchema.parse(await response.json());
          return { ids: parsed.deliveries.map(({ id }) => id) };
        },
      );
    // Automated reminder: suppressed by the fresh opt-out.
    expect((await prepare("60000000-0000-4000-8000-000000000001")).ids).toEqual([]);
    // Manual send to the same event and profile is unaffected: provenance, not
    // eventId inference, drives the decision.
    const manual = await prepare("60000000-0000-4000-8000-000000000002");
    expect(manual.ids).toHaveLength(1);

    const statuses = await runInDurableObject<OrganizationStore, string[]>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM communication_deliveries ORDER BY id",
          )
          .toArray()
          .map((row) => row.status),
    );
    expect(statuses).toEqual(["suppressed", "processing"]);
    // Re-preparing finds nothing queued, so nothing duplicates.
    expect((await prepare("60000000-0000-4000-8000-000000000001")).ids).toEqual([]);
  });
});
