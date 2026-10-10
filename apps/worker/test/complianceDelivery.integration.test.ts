import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  reset,
  createMessageBatch,
  createExecutionContext,
  getQueueResult,
} from "cloudflare:test";
import { provisionOrganization, seedAuthUser, pastDateString, relativeDate } from "@choir/testkit";
import { afterEach, beforeEach, expect, inject, it, vi } from "vitest";
import { processEmailProviderQueue } from "../src/communications/emailFeedback";
import { deliverComplianceReminderJob } from "../src/jobs/deliveries/compliance";
import type { JobConsumerEnv } from "../src/jobs/deliveries/shared";
import type { DeliveryJob } from "../src/jobs/contracts";

function binding<T>(value: T | undefined): T {
  if (!value) throw new Error("Missing test binding");
  return value;
}
const database = binding(env.CONTROL_DB);
const stores = binding(env.ORGANIZATION_STORE);
const organizationId = "compliance-delivery";
const actor = { actorUserId: "owner", organizationId, requestId: crypto.randomUUID() };
const dueDate = pastDateString({ days: 30 });
let taskId = "";

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  await seedAuthUser(database, "owner", "owner@example.test", "Owner");
  await seedAuthUser(database, "admin", "admin@example.test", "Admin");
  await seedAuthUser(database, "member", "member@example.test", "Member");
  await seedAuthUser(database, "other", "other@example.test", "Other Organization Owner");
  await provisionOrganization(database, stores, {
    id: organizationId,
    slug: "compliance",
    userId: "owner",
    role: "owner",
  });
  await provisionOrganization(database, stores, {
    id: "other-organization",
    slug: "other-compliance",
    userId: "other",
  });
  for (const role of ["admin", "member"]) {
    await database
      .prepare(
        "INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(`compliance-${role}`, organizationId, role, role, Date.now())
      .run();
  }
  const stub = stores.getByName(organizationId);
  const settings = await stub.setNonprofitEnabled({ ...actor, enabled: true });
  const task = settings.tasks.find(({ kind }) => kind === "irs_annual_return");
  if (!task) throw new Error("Missing seeded task");
  taskId = task.id;
  await stub.updateComplianceTask({ ...actor, taskId: task.id, nextDueDate: dueDate });
});
afterEach(async () => {
  await reset();
});

function job(occurrence: string, key?: string): DeliveryJob {
  return {
    attempt: 1,
    version: 1,
    jobId: crypto.randomUUID(),
    organizationId,
    kind: "compliance_reminder",
    idempotencyKey: `nonprofit-compliance:${organizationId}:${key ?? taskId}:${dueDate}:${occurrence}`,
  };
}

it("sends to each administrator once per occurrence, with replay and tenant isolation", async () => {
  const send = vi.fn<(message: EmailMessage | EmailMessageBuilder) => Promise<EmailSendResult>>(
    () =>
      Promise.resolve({
        messageId: crypto.randomUUID(),
      }),
  );
  const deliveryEnv: JobConsumerEnv = {
    ...env,
    EXTERNAL_EFFECTS_MODE: "sandbox",
    PLATFORM_EMAIL_MODE: "sandbox",
    PLATFORM_EMAIL_FROM: "notifications@example.test",
    PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
    PLATFORM_EMAIL: { send },
  };
  const first = job(dueDate);
  await deliverComplianceReminderJob(deliveryEnv, first);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls.map(([message]) => message.to).sort()).toEqual([
    "admin@example.test",
    "owner@example.test",
  ]);
  // A reconstructed queue job for the same occurrence must reuse the same provider routes.
  await deliverComplianceReminderJob(deliveryEnv, {
    ...first,
    attempt: 2,
    jobId: crypto.randomUUID(),
  });
  expect(send).toHaveBeenCalledTimes(2);
  await deliverComplianceReminderJob(
    deliveryEnv,
    job(relativeDate({ days: -23 }).toISOString().slice(0, 10)),
  );
  expect(send).toHaveBeenCalledTimes(4);
  const routes = await database
    .prepare(
      "SELECT source_id, organization_id FROM email_provider_routes WHERE source_kind = 'compliance_reminder'",
    )
    .all<{ source_id: string; organization_id: string }>();
  expect(new Set(routes.results.map((route) => route.source_id)).size).toBe(4);
  expect(routes.results.every((route) => route.organization_id === organizationId)).toBe(true);
  await stores.getByName(organizationId).setNonprofitEnabled({ ...actor, enabled: false });
  await deliverComplianceReminderJob(
    deliveryEnv,
    job(relativeDate({ days: -16 }).toISOString().slice(0, 10)),
  );
  expect(send).toHaveBeenCalledTimes(4);
});

it("delivers legacy kind-keyed jobs until old queue entries drain", async () => {
  const send = vi.fn<(message: EmailMessage | EmailMessageBuilder) => Promise<EmailSendResult>>(
    () => Promise.resolve({ messageId: crypto.randomUUID() }),
  );
  const deliveryEnv: JobConsumerEnv = {
    ...env,
    EXTERNAL_EFFECTS_MODE: "sandbox",
    PLATFORM_EMAIL_MODE: "sandbox",
    PLATFORM_EMAIL_FROM: "notifications@example.test",
    PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
    PLATFORM_EMAIL: { send },
  };
  await deliverComplianceReminderJob(deliveryEnv, job(dueDate, "irs_annual_return"));
  expect(send).toHaveBeenCalledTimes(2);
});

it("keeps all-admin fanout when a responsible administrator is assigned", async () => {
  const stub = stores.getByName(organizationId);
  await stub.updateComplianceTask({
    ...actor,
    responsibleMembershipId: "compliance-admin",
    responsibleUserId: "admin",
    taskId,
  });
  const send = vi.fn<(message: EmailMessage | EmailMessageBuilder) => Promise<EmailSendResult>>(
    () => Promise.resolve({ messageId: crypto.randomUUID() }),
  );
  const deliveryEnv: JobConsumerEnv = {
    ...env,
    EXTERNAL_EFFECTS_MODE: "sandbox",
    PLATFORM_EMAIL_MODE: "sandbox",
    PLATFORM_EMAIL_FROM: "notifications@example.test",
    PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
    PLATFORM_EMAIL: { send },
  };
  await deliverComplianceReminderJob(deliveryEnv, job(dueDate));
  // Assignee receives one copy like every other admin; ordinary members receive none.
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls.map(([message]) => message.to).sort()).toEqual([
    "admin@example.test",
    "owner@example.test",
  ]);
});

it("delivers custom reminders while nonprofit tracking is disabled", async () => {
  const stub = stores.getByName(organizationId);
  const created = await stub.createComplianceTask({
    ...actor,
    nextDueDate: dueDate,
    title: "Custom deadline",
  });
  if (!created.ok || !created.task) throw new Error("Custom creation failed.");
  await stub.setNonprofitEnabled({ ...actor, enabled: false });
  const send = vi.fn<(message: EmailMessage | EmailMessageBuilder) => Promise<EmailSendResult>>(
    () => Promise.resolve({ messageId: crypto.randomUUID() }),
  );
  const deliveryEnv: JobConsumerEnv = {
    ...env,
    EXTERNAL_EFFECTS_MODE: "sandbox",
    PLATFORM_EMAIL_MODE: "sandbox",
    PLATFORM_EMAIL_FROM: "notifications@example.test",
    PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
    PLATFORM_EMAIL: { send },
  };
  const customJob: DeliveryJob = {
    attempt: 1,
    version: 1,
    jobId: crypto.randomUUID(),
    organizationId,
    kind: "compliance_reminder",
    idempotencyKey: `nonprofit-compliance:${organizationId}:${created.task.id}:${dueDate}:${dueDate}`,
  };
  await deliverComplianceReminderJob(deliveryEnv, customJob);
  expect(send).toHaveBeenCalledTimes(2);
  // Builtin stops while disabled.
  await deliverComplianceReminderJob(deliveryEnv, job(dueDate));
  expect(send).toHaveBeenCalledTimes(2);
});

it("drops archived tasks without sending", async () => {
  const stub = stores.getByName(organizationId);
  const created = await stub.createComplianceTask({
    ...actor,
    nextDueDate: dueDate,
    title: "Archivable",
  });
  if (!created.ok || !created.task) throw new Error("Custom creation failed.");
  await stub.archiveComplianceTask({ ...actor, taskId: created.task.id });
  const send = vi.fn<(message: EmailMessage | EmailMessageBuilder) => Promise<EmailSendResult>>(
    () => Promise.resolve({ messageId: crypto.randomUUID() }),
  );
  const deliveryEnv: JobConsumerEnv = {
    ...env,
    EXTERNAL_EFFECTS_MODE: "sandbox",
    PLATFORM_EMAIL_MODE: "sandbox",
    PLATFORM_EMAIL_FROM: "notifications@example.test",
    PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
    PLATFORM_EMAIL: { send },
  };
  const archivedJob: DeliveryJob = {
    attempt: 1,
    version: 1,
    jobId: crypto.randomUUID(),
    organizationId,
    kind: "compliance_reminder",
    idempotencyKey: `nonprofit-compliance:${organizationId}:${created.task.id}:${dueDate}:${dueDate}`,
  };
  await deliverComplianceReminderJob(deliveryEnv, archivedJob);
  expect(send).not.toHaveBeenCalled();
});

it("processes compliance bounces through the global suppression ledger", async () => {
  const send = vi.fn<(message: EmailMessage | EmailMessageBuilder) => Promise<EmailSendResult>>(
    () => Promise.resolve({ messageId: crypto.randomUUID() }),
  );
  const deliveryEnv: JobConsumerEnv = {
    ...env,
    EXTERNAL_EFFECTS_MODE: "sandbox",
    PLATFORM_EMAIL_MODE: "sandbox",
    PLATFORM_EMAIL_FROM: "notifications@example.test",
    PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
    PLATFORM_EMAIL: { send },
  };
  await deliverComplianceReminderJob(deliveryEnv, job(dueDate));
  const route = await database
    .prepare(
      "SELECT provider_message_id FROM email_provider_routes WHERE destination = 'owner@example.test'",
    )
    .first<{ provider_message_id: string }>();
  if (!route) throw new Error("Missing provider route");
  const eventId = crypto.randomUUID();
  const batch = createMessageBatch(env.EMAIL_EVENTS_QUEUE_NAME, [
    {
      attempts: 0,
      id: crypto.randomUUID(),
      timestamp: new Date(),
      body: {
        metadata: { eventTimestamp: new Date().toISOString() },
        source: { domain: "example.test", type: "email.sending" },
        type: "cf.email.sending.message.bounced",
        payload: {
          eventId,
          messageId: route.provider_message_id,
          recipient: "owner@example.test",
          sender: "notifications@example.test",
          terminal: true,
          bounce: { reason: "Mailbox unavailable", type: "hard" },
        },
      },
    },
  ]);
  await processEmailProviderQueue(batch, { CONTROL_DB: database, ORGANIZATION_STORE: stores });
  await getQueueResult(batch, createExecutionContext());
  expect(
    await database
      .prepare("SELECT state FROM email_provider_events WHERE event_id = ?")
      .bind(eventId)
      .first(),
  ).toMatchObject({ state: "processed" });
  expect(
    await database
      .prepare(
        "SELECT active FROM email_recipient_suppressions WHERE email_normalized = 'owner@example.test'",
      )
      .first(),
  ).toMatchObject({ active: 1 });
  await deliverComplianceReminderJob(
    deliveryEnv,
    job(relativeDate({ days: -23 }).toISOString().slice(0, 10)),
  );
  expect(send).toHaveBeenCalledTimes(3);
  expect(send.mock.lastCall?.[0].to).toBe("admin@example.test");
});
