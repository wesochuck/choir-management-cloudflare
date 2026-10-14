import { communicationHistoryPageResponseSchema } from "@choir/contracts";
import { organizationRequest, readEmailOneTimeCode, signInWithOtp } from "@choir/testkit";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";
import { processDeliveryBatch } from "../src/jobs/consumer";
import type { DeliveryJob } from "../src/jobs/contracts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  requireIntegrationBinding,
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";

const database = requireIntegrationBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireIntegrationBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const organizationFiles = requireIntegrationBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");
const managerEmail = "communications.manager@example.test";

const api = organizationRequest;

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", managerEmail, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await setupOrganizationIntegration(database, stores, {
    displayName: "Communications Manager",
    email: managerEmail,
    organizations: [{ id: "organization-alpha", role: "admin", slug: "alpha" }],
    userId: "communications-manager",
  });
});

afterEach(async () => teardownOrganizationIntegration());

describe("Event reminder rendered Communications history (#172)", () => {
  it("persists rendered event reminder subject snapshot and preserves it when event is renamed", async () => {
    const cookie = await signIn();
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const reminderJobId = crypto.randomUUID();

    // 1. Create event, profile, roster and schedule event-reminder outbox job
    const memberProfileId = crypto.randomUUID();
    const memberUserId = crypto.randomUUID();
    const nowMs = Date.now();
    await database.batch([
      database
        .prepare(
          `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
           VALUES (?, 'Alice Singer', 'alice@example.test', 1, ?, ?, 0)`,
        )
        .bind(memberUserId, nowMs, nowMs),
      database
        .prepare(
          `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt)
           VALUES (?, 'organization-alpha', ?, 'member', ?, ?)`,
        )
        .bind(crypto.randomUUID(), memberUserId, memberProfileId, nowMs),
    ]);

    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, phone, voice_part, global_status,
           show_in_directory, receive_rehearsal_reminders, created_at, updated_at)
         VALUES (?, 'Alice Singer', '+15550000000', 'S1', 'Active', 1, 1, ?, ?)`,
        memberProfileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES (?, 'Fall Concert Rehearsal', 'Rehearsal', ?, ?, ?)`,
        eventId,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at)
         VALUES (?, ?, 'Yes', 'Pending', ?, ?)`,
        eventId,
        memberProfileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, 'event_reminder', ?, ?, ?)`,
        reminderJobId,
        `event-reminder:organization-alpha:${eventId}`,
        now,
        now,
      );
      return null;
    });

    // 2. Deliver the outer event_reminder job
    const reminderDeliveryJob: DeliveryJob = {
      attempt: 1,
      idempotencyKey: `event-reminder:organization-alpha:${eventId}`,
      jobId: reminderJobId,
      kind: "event_reminder",
      organizationId: "organization-alpha",
      version: 1,
    };
    const batch = createMessageBatch("choir-management-jobs-local", [
      {
        attempts: 1,
        body: reminderDeliveryJob,
        id: `reminder-${reminderJobId}`,
        timestamp: new Date(),
      },
    ]);
    await processDeliveryBatch(batch, {
      CONTROL_DB: database,
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_FILES: organizationFiles,
      ORGANIZATION_STORE: stores,
      PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
      SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
    });
    expect(await getQueueResult(batch, createExecutionContext())).toMatchObject({
      explicitAcks: [`reminder-${reminderJobId}`],
    });

    // 3. Inspect communication_messages row directly in DO storage
    const stored = await runInDurableObject<
      OrganizationStore,
      {
        readonly contentMarkdown: string;
        readonly status: string;
        readonly subject: string;
      }
    >(alphaStub, (_instance, state) =>
      state.storage.sql
        .exec<{
          contentMarkdown: string;
          status: string;
          subject: string;
        }>(
          `SELECT subject, content_markdown AS contentMarkdown, status
           FROM communication_messages
           WHERE automation_json IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`,
        )
        .one(),
    );

    expect(stored.status).toBe("Queued");
    expect(stored.subject).toBe("Rehearsal reminder: Fall Concert Rehearsal");
    expect(stored.subject).not.toContain("{eventTitle}");
    expect(stored.contentMarkdown).toContain("Fall Concert Rehearsal");

    // 4. Query Communications history API
    const historyRes = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/communications/history", cookie),
    );
    expect(historyRes.status).toBe(200);
    const historyPage = communicationHistoryPageResponseSchema.parse(await historyRes.json());
    const reminderItem = historyPage.items.find(
      (item) => item.kind === "manual" && item.message.subject.includes("Fall Concert Rehearsal"),
    );
    expect(reminderItem).toBeDefined();
    if (reminderItem?.kind === "manual") {
      expect(reminderItem.message.subject).toBe("Rehearsal reminder: Fall Concert Rehearsal");
    }

    // 5. Rename the event in storage
    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE events SET title = 'Winter Concert Rehearsal' WHERE id = ?",
        eventId,
      );
      return null;
    });

    // 6. Query Communications history again: snapshot must remain stable!
    const historyResAfterRename = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/communications/history", cookie),
    );
    expect(historyResAfterRename.status).toBe(200);
    const historyPageAfterRename = communicationHistoryPageResponseSchema.parse(
      await historyResAfterRename.json(),
    );
    const reminderMessageId = reminderItem?.kind === "manual" ? reminderItem.message.id : null;
    expect(reminderMessageId).toBeTruthy();
    const reminderItemAfterRename = historyPageAfterRename.items.find(
      (item) => item.kind === "manual" && item.message.id === reminderMessageId,
    );
    expect(reminderItemAfterRename).toBeDefined();
    if (reminderItemAfterRename?.kind === "manual") {
      // Historical subject retains the rendered snapshot from send time, not current event title
      expect(reminderItemAfterRename.message.subject).toBe(
        "Rehearsal reminder: Fall Concert Rehearsal",
      );
    }
  });

  it("resolves legacy unrendered {eventTitle} placeholder in history from linked event", async () => {
    const cookie = await signIn();
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES (?, 'Spring Gala Rehearsal', 'Rehearsal', ?, ?, ?)`,
        eventId,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_messages
          (id, channel, status, subject, content_markdown, audience_json, reach_json,
           created_by, created_at, updated_at, queued_at, automation_json)
         VALUES (?, 'Email', 'Sent', 'Rehearsal reminder: {eventTitle}', 'Details for {eventTitle}',
           ?, '{"total":1,"email":1,"sms":0,"both":0,"unreachable":0}',
           'system:scheduler', ?, ?, ?, ?)`,
        messageId,
        JSON.stringify({ eventId }),
        now,
        now,
        now,
        JSON.stringify({ eventId, eventType: "Rehearsal", kind: "event_reminder" }),
      );
      return null;
    });

    const historyRes = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/communications/history", cookie),
    );
    expect(historyRes.status).toBe(200);
    const historyPage = communicationHistoryPageResponseSchema.parse(await historyRes.json());
    const legacyItem = historyPage.items.find(
      (item) => item.kind === "manual" && item.message.id === messageId,
    );
    expect(legacyItem).toBeDefined();
    if (legacyItem?.kind === "manual") {
      expect(legacyItem.message.subject).toBe("Rehearsal reminder: Spring Gala Rehearsal");
    }
  });

  it("catches unresolvable placeholders at send time and marks delivery failed without provider dispatch", async () => {
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    const now = new Date().toISOString();
    const messageId = crypto.randomUUID();
    const deliveryId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    const memberProfileId = crypto.randomUUID();
    // Create a message that has {eventTitle} in the subject, but no eventId in audience
    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, phone, voice_part, global_status,
           show_in_directory, created_at, updated_at)
         VALUES (?, 'Alice Singer', '+15550000000', 'S1', 'Active', 1, ?, ?)`,
        memberProfileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_messages
          (id, channel, status, subject, content_markdown, audience_json, reach_json,
           created_by, created_at, updated_at, queued_at)
         VALUES (?, 'Email', 'Queued', 'Missing event: {eventTitle}', 'Hello {recipientName}',
           '{"eventId":null,"globalStatuses":["Active"]}',
           '{"total":1,"email":1,"sms":0,"both":0,"unreachable":0}',
           'communications-manager', ?, ?, ?)`,
        messageId,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries
          (id, message_id, profile_id, recipient_name, channel, destination, status,
           created_at, updated_at, unsubscribe_url)
         VALUES (?, ?, ?, 'Alice Singer', 'email', 'alice@example.test', 'queued',
           ?, ?, NULL)`,
        deliveryId,
        messageId,
        memberProfileId,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, 'communication_delivery', ?, ?, ?)`,
        jobId,
        `communication_delivery:${messageId}`,
        now,
        now,
      );
      return null;
    });

    const deliveryJob: DeliveryJob = {
      attempt: 1,
      idempotencyKey: `communication_delivery:${messageId}`,
      jobId,
      kind: "communication_delivery",
      organizationId: "organization-alpha",
      version: 1,
    };
    const batch = createMessageBatch("choir-management-jobs-local", [
      {
        attempts: 1,
        body: deliveryJob,
        id: `delivery-${jobId}`,
        timestamp: new Date(),
      },
    ]);
    await processDeliveryBatch(batch, {
      CONTROL_DB: database,
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_FILES: organizationFiles,
      ORGANIZATION_STORE: stores,
      PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
      SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
    });

    // Verify delivery row status in DO storage
    const delivery = await runInDurableObject<
      OrganizationStore,
      { failureDetail: string; status: string }
    >(alphaStub, (_instance, state) =>
      state.storage.sql
        .exec<{ failureDetail: string; status: string }>(
          `SELECT status, failure_detail AS failureDetail
           FROM communication_deliveries WHERE id = ?`,
          deliveryId,
        )
        .one(),
    );

    expect(delivery.status).toBe("failed");
    expect(delivery.failureDetail).toContain(
      "unresolved_placeholders: Cannot deliver communication due to unresolvable placeholders: {eventTitle}",
    );
  });

  it("rejects test-email requests containing unresolvable placeholders", async () => {
    const cookie = await signIn();
    const res = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/communications/test-email", cookie, {
        body: JSON.stringify({
          audience: { eventId: null },
          contentMarkdown: "Testing placeholders without event context.",
          email: "test@example.test",
          subject: "Test reminder: {eventTitle}",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json<{ message?: string }>();
    expect(body.message).toContain("unresolvable placeholders: {eventTitle}");
  });
});
