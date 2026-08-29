import {
  communicationDeliverySummaryResponseSchema,
  communicationMessageResponseSchema,
  communicationMessagesResponseSchema,
  communicationReachResponseSchema,
  communicationRetryResponseSchema,
  communicationScheduledMessagesResponseSchema,
  communicationDeleteResponseSchema,
  communicationTemplateResponseSchema,
  communicationTemplatesResponseSchema,
  communicationUnsubscribeResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";
import { z } from "zod";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import { processDeliveryBatch } from "../src/jobs/consumer";
import type { DeliveryJob } from "../src/jobs/contracts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

function binding<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return value;
}

const database = binding(env.CONTROL_DB, "CONTROL_DB");
const stores = binding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const organizationFiles = binding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");
const managerEmail = "communications.manager@example.test";

const api = organizationRequest;

const write = async (
  host: string,
  path: string,
  cookie: string,
  body: unknown,
  requestHeaders: HeadersInit = {},
): Promise<Response> => {
  const headers = new Headers(requestHeaders);
  headers.set("content-type", "application/json");
  return exports.default.fetch(
    api(host, path, cookie, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    }),
  );
};

const provision = (id: string, slug: string, role: "admin" | "member") =>
  provisionOrganization(database, stores, { id, slug, userId: "communications-manager", role });

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", managerEmail, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

async function createProfile(cookie: string, body: Record<string, unknown>) {
  const response = await write("alpha.localhost", "/api/organization/profiles", cookie, body);
  const parsed = z.object({ id: z.uuid() }).parse(await response.json());
  return parsed.id;
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "communications-manager", managerEmail, "Communications Manager");
  await provision("organization-alpha", "alpha", "admin");
  await provision("organization-bravo", "bravo", "member");
});

afterEach(async () => reset());

describe("Organization communications", () => {
  it("resolves opted-in donors and ticket buyers and lists automated sends", async () => {
    const cookie = await signIn();
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const purchaseId = crypto.randomUUID();
    const donationId = crypto.randomUUID();
    const notificationId = crypto.randomUUID();
    const scheduledJobId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const providerSessionId = crypto.randomUUID();
    await runInDurableObject<OrganizationStore, undefined>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          `INSERT INTO events
            (id, title, type, starts_at, created_at, updated_at)
           VALUES (?, 'Spring concert', 'Performance', ?, ?, ?)`,
          eventId,
          new Date(Date.now() + 86_400_000).toISOString(),
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO ticket_purchases
            (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
             buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
             currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
             created_at, updated_at, included_events_json, bundle_title)
           VALUES (?, ?, ?, 'Spring concert', ?, 'America/New_York', 'Ticket Buyer',
             'buyer@example.test', 2, 2000, 100, 4100, 'usd', ?, '', 'paid', 1, ?, ?, '[]', '')`,
          purchaseId,
          checkoutRequestId,
          eventId,
          new Date(Date.now() + 86_400_000).toISOString(),
          providerSessionId,
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO donations
            (id, checkout_request_id, status, amount_cents, buyer_name, buyer_email,
             provider_session_id, created_at, updated_at, marketing_consent)
           VALUES (?, ?, 'paid', 5000, 'Donor', 'donor@example.test', ?, ?, ?, 1)`,
          donationId,
          crypto.randomUUID(),
          crypto.randomUUID(),
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO ticket_notifications
            (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
             content_markdown, status, scheduled_for, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'reminder', 'buyer@example.test', 'Reminder: Spring concert',
             'Reminder body', 'queued', ?, ?, ?)`,
          notificationId,
          purchaseId,
          eventId,
          "ticket-reminder-test",
          now,
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO scheduled_job_outbox
            (job_id, kind, idempotency_key, due_at, created_at)
           VALUES (?, 'event_reminder', ?, ?, ?)`,
          scheduledJobId,
          "event-reminder:organization-alpha:" + eventId,
          now,
          now,
        );
        return undefined;
      },
    );

    const ticketAudience = {
      eventId,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      targetAudiences: ["Ticket Buyers"],
      voiceParts: [],
    };
    const ticketReach = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience: ticketAudience,
          channel: "Email",
        })
      ).json(),
    );
    expect(ticketReach).toMatchObject({ email: 1, total: 1 });

    const donorReach = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience: {
            eventId: null,
            globalStatuses: ["Active"],
            profileIds: [],
            rsvp: "All",
            targetAudiences: ["Donors"],
            voiceParts: [],
          },
          channel: "Email",
        })
      ).json(),
    );
    expect(donorReach).toMatchObject({ email: 1, total: 1 });

    const scheduled = communicationScheduledMessagesResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/scheduled", cookie),
        )
      ).json(),
    );
    expect(scheduled.messages.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(["ticket_reminder", "event_reminder"]),
    );
  });

  it("saves drafts without queueing work and rejects invalid or unreachable sends", async () => {
    const cookie = await signIn();
    const audience = {
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      voiceParts: [],
    };
    const draftResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      { audience, channel: "SMS", contentMarkdown: "", subject: "" },
    );
    expect(draftResponse.status).toBe(201);
    const draft = communicationMessageResponseSchema.parse(await draftResponse.json());
    expect(draft.status).toBe("Draft");
    const outboxCount = await runInDurableObject<OrganizationStore, number>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<Record<string, SqlStorageValue> & { count: number }>(
            "SELECT COUNT(*) AS count FROM scheduled_job_outbox",
          )
          .one().count,
    );
    expect(outboxCount).toBe(0);
    const template = communicationTemplateResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/templates", cookie, {
          channel: "SMS",
          contentMarkdown: "Hello {singerName}",
          subject: "",
          title: "Welcome",
        })
      ).json(),
    );
    const templates = communicationTemplatesResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/templates", cookie),
        )
      ).json(),
    );
    expect(templates.templates.map(({ title }) => title).sort()).toEqual([
      "Attendance Report",
      "Audition Confirmed",
      "Audition Reminder",
      "Audition Submission Thanks",
      "Bundle Ticket Confirmation",
      "Donation Payment Receipt",
      "Dues Payment Notice",
      "Dues Payment Receipt",
      "Event RSVP Follow-up",
      "Event RSVP Invitation",
      "General Announcement",
      "Performance Reminder",
      "Rehearsal Reminder",
      "Ticket Concert Reminder",
      "Ticket Confirmation",
      "Weather / Schedule Delay Alert",
      "Welcome",
    ]);
    expect(
      templates.templates
        .filter(({ isSystem }) => isSystem)
        .map(({ title }) => title)
        .sort(),
    ).toEqual([
      "Attendance Report",
      "Audition Confirmed",
      "Audition Reminder",
      "Audition Submission Thanks",
      "Bundle Ticket Confirmation",
      "Donation Payment Receipt",
      "Dues Payment Notice",
      "Dues Payment Receipt",
      "Event RSVP Follow-up",
      "Event RSVP Invitation",
      "General Announcement",
      "Performance Reminder",
      "Rehearsal Reminder",
      "Ticket Concert Reminder",
      "Ticket Confirmation",
      "Weather / Schedule Delay Alert",
    ]);
    const systemEmailTemplates = templates.templates.filter(
      ({ channel, isSystem }) => isSystem && channel === "Email",
    );
    expect(systemEmailTemplates).toHaveLength(15);
    for (const systemTemplate of systemEmailTemplates) {
      expect(systemTemplate.contentMarkdown, systemTemplate.title).toMatch(/^## |\n## /);
      expect(systemTemplate.subject, systemTemplate.title).not.toMatch(/^[A-Z\s!]+:/);
    }
    expect(
      templates.templates.find(({ title }) => title === "Audition Submission Thanks"),
    ).toMatchObject({ channel: "Email", isSystem: true });
    const ticketTemplate = templates.templates.find(({ title }) => title === "Ticket Confirmation");
    expect(ticketTemplate?.isSystem).toBe(true);
    const updatedTicketTemplate = communicationTemplateResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/communications/templates/${ticketTemplate?.id ?? ""}`,
            cookie,
            {
              body: JSON.stringify({
                channel: "Email",
                contentMarkdown: "Custom ticket wording for {singerName} {{TICKET_LINK}}",
                subject: "Custom ticket subject for {eventTitle}",
                title: "Ticket Confirmation",
              }),
              headers: { "content-type": "application/json" },
              method: "PUT",
            },
          ),
        )
      ).json(),
    );
    expect(updatedTicketTemplate).toMatchObject({
      contentMarkdown: "Custom ticket wording for {singerName} {{TICKET_LINK}}",
      isSystem: true,
      subject: "Custom ticket subject for {eventTitle}",
    });
    expect(
      communicationDeleteResponseSchema.parse(
        await (
          await exports.default.fetch(
            api(
              "alpha.localhost",
              `/api/organization/communications/templates/${template.id}`,
              cookie,
              { method: "DELETE" },
            ),
          )
        ).json(),
      ).status,
    ).toBe("deleted");
    expect(
      communicationDeleteResponseSchema.parse(
        await (
          await exports.default.fetch(
            api("alpha.localhost", `/api/organization/communications/drafts/${draft.id}`, cookie, {
              method: "DELETE",
            }),
          )
        ).json(),
      ).status,
    ).toBe("deleted");
    expect(
      (
        await write("alpha.localhost", "/api/organization/communications/send", cookie, {
          audience,
          channel: "Email",
          contentMarkdown: "Missing subject",
          subject: "",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await write("alpha.localhost", "/api/organization/communications/send", cookie, {
          audience,
          channel: "SMS",
          contentMarkdown: "Nobody can receive this",
          subject: "",
        })
      ).status,
    ).toBe(409);

    // Validation rule: mixed audience with member-only placeholder is rejected on send
    const invalidContextSendResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      {
        audience: { ...audience, targetAudiences: ["Members", "Ticket Buyers"] },
        channel: "Email",
        contentMarkdown: "Please RSVP: {{RSVP_LINKS}}",
        subject: "Mixed Audience Notice",
      },
    );
    expect(invalidContextSendResponse.status).toBe(400);
    expect(await invalidContextSendResponse.json()).toMatchObject({
      code: "invalid_communication_context",
    });

    // Saving a draft with conflicting placeholders remains allowed
    const draftWithConflictResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      {
        audience: { ...audience, targetAudiences: ["Members", "Ticket Buyers"] },
        channel: "Email",
        contentMarkdown: "Please RSVP: {{RSVP_LINKS}}",
        subject: "Draft with conflict",
      },
    );
    expect(draftWithConflictResponse.status).toBe(201);
  });

  it("deduplicates a retried manual communication request", async () => {
    const cookie = await signIn();
    const profileId = await createProfile(cookie, {
      displayName: "Retry-safe Recipient",
      phone: "+1 555 100 0004",
      voicePart: "S1",
    });
    await database
      .prepare("UPDATE member SET profileId = ? WHERE id = 'member-alpha'")
      .bind(profileId)
      .run();
    const audience = {
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      targetAudiences: ["Members"],
      voiceParts: [],
    };
    const body = {
      audience,
      channel: "Email",
      contentMarkdown: "Hello {singerName}",
      subject: "Retry-safe message",
    };
    const idempotencyKey = "manual-send-retry-" + crypto.randomUUID();
    const first = communicationMessageResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/send", cookie, body, {
          "idempotency-key": idempotencyKey,
        })
      ).json(),
    );
    const second = communicationMessageResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/send", cookie, body, {
          "idempotency-key": idempotencyKey,
        })
      ).json(),
    );

    expect(first.id).toBe(second.id);
    await expect(
      runInDurableObject<OrganizationStore, { deliveries: number; messages: number; jobs: number }>(
        stores.get(stores.idFromName("organization-alpha")),
        (_instance, state) => ({
          deliveries: state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM communication_deliveries WHERE message_id = ?",
              first.id,
            )
            .one().count,
          jobs: state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE kind = 'communication_delivery'",
            )
            .one().count,
          messages: state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM communication_messages WHERE id = ?",
              first.id,
            )
            .one().count,
        }),
      ),
    ).resolves.toEqual({ deliveries: 1, jobs: 1, messages: 1 });
  });

  it("resolves reach, queues fake delivery, summarizes it, audits it, and isolates Organizations", async () => {
    const cookie = await signIn();
    const managerProfileId = await createProfile(cookie, {
      displayName: "Communications Manager",
      phone: "+1 555 100 0001",
      voicePart: "S1",
    });
    const optedOutProfileId = await createProfile(cookie, {
      displayName: "SMS Singer",
      doNotEmail: true,
      phone: "+1 555 100 0002",
      voicePart: "A1",
    });
    const now = Date.now();
    await database.batch([
      database
        .prepare("UPDATE member SET profileId = ? WHERE id = 'member-alpha'")
        .bind(managerProfileId),
      database
        .prepare(
          `INSERT INTO user
            (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
           VALUES ('communications-singer', 'SMS Singer', 'sms.singer@example.test', 1, ?, ?, 0)`,
        )
        .bind(now, now),
      database
        .prepare(
          `INSERT INTO member (id, organizationId, userId, role, createdAt, profileId)
           VALUES ('member-singer', 'organization-alpha', 'communications-singer', 'member', ?, ?)`,
        )
        .bind(now, optedOutProfileId),
    ]);
    const audience = {
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      voiceParts: [],
    };
    const reach = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience,
          channel: "Both",
        })
      ).json(),
    );
    expect(reach).toMatchObject({ both: 1, email: 1, sms: 2, total: 2, unreachable: 0 });

    const sentResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      {
        audience,
        channel: "Both",
        contentMarkdown: "Hello {singerName}",
        subject: "Rehearsal update",
      },
    );
    expect(sentResponse.status).toBe(202);
    const message = communicationMessageResponseSchema.parse(await sentResponse.json());
    expect(message).toMatchObject({ channel: "Both", status: "Queued" });
    const unsubscribeUrl = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<Record<string, SqlStorageValue> & { unsubscribeUrl: string }>(
            `SELECT unsubscribe_url AS unsubscribeUrl FROM communication_deliveries
             WHERE message_id = ? AND channel = 'email' LIMIT 1`,
            message.id,
          )
          .one().unsubscribeUrl,
    );
    const unsubscribeToken = new URL(unsubscribeUrl).searchParams.get("token");
    expect(unsubscribeToken).toBeTruthy();
    expect(
      (
        await write("bravo.localhost", "/api/organization/communications/send", cookie, {
          audience,
          channel: "SMS",
          contentMarkdown: "Forbidden",
          subject: "",
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await write("bravo.localhost", "/api/public/unsubscribe", cookie, {
          token: unsubscribeToken,
        })
      ).status,
    ).toBe(400);
    const unsubscribe = communicationUnsubscribeResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/public/unsubscribe", cookie, {
          token: unsubscribeToken,
        })
      ).json(),
    );
    expect(unsubscribe.success).toBe(true);
    const afterUnsubscribe = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience,
          channel: "Email",
        })
      ).json(),
    );
    expect(afterUnsubscribe).toMatchObject({ email: 0, total: 0, unreachable: 2 });

    const stub = stores.get(stores.idFromName("organization-alpha"));
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const job = await runInDurableObject<OrganizationStore, DeliveryJob>(
      stub,
      (_instance, state) => {
        const row = state.storage.sql
          .exec<
            Record<string, SqlStorageValue> & {
              idempotencyKey: string;
              jobId: string;
              kind: DeliveryJob["kind"];
            }
          >(
            `SELECT job_id AS jobId, idempotency_key AS idempotencyKey, kind
             FROM scheduled_job_outbox WHERE kind = 'communication_delivery' LIMIT 1`,
          )
          .one();
        return {
          attempt: 1,
          idempotencyKey: row.idempotencyKey,
          jobId: row.jobId,
          kind: row.kind,
          organizationId: "organization-alpha",
          version: 1,
        };
      },
    );
    const batch = createMessageBatch("choir-management-jobs-local", [
      { attempts: 1, body: job, id: "communication-job", timestamp: new Date() },
    ]);
    await processDeliveryBatch(batch, {
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_FILES: organizationFiles,
      ORGANIZATION_STORE: stores,
      PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
      SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
    });
    const queueResult = z
      .object({ explicitAcks: z.array(z.string()) })
      .parse(await getQueueResult(batch, createExecutionContext()));
    expect(queueResult.explicitAcks).toEqual(["communication-job"]);

    const summary = communicationDeliverySummaryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/communications/${message.id}/delivery-summary`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(summary.state).toBe("sent");
    expect(summary.total).toMatchObject({ sent: 2, suppressed: 1, total: 3 });
    expect(summary.failures).toEqual([]);
    expect(summary.recipients).toHaveLength(3);
    expect(summary.recipients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "email",
          recipientName: "Communications Manager",
          status: "suppressed",
        }),
        expect.objectContaining({
          channel: "sms",
          recipientName: "Communications Manager",
          status: "sent",
        }),
        expect.objectContaining({
          channel: "sms",
          recipientName: "SMS Singer",
          status: "sent",
        }),
      ]),
    );

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE communication_deliveries
         SET status = 'failed', failure_detail = 'provider rejected', updated_at = ?
         WHERE id = (SELECT id FROM communication_deliveries
                     WHERE message_id = ? AND status = 'sent' LIMIT 1)`,
        new Date().toISOString(),
        message.id,
      );
      return undefined;
    });
    const retry = communicationRetryResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/communications/${message.id}/retry-failed`,
          cookie,
          {},
        )
      ).json(),
    );
    expect(retry.retried).toBe(1);
    const retrySummary = communicationDeliverySummaryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/communications/${message.id}/delivery-summary`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(retrySummary.state).toBe("sending");
    expect(retrySummary.total.queued).toBe(1);

    const actions = await runInDurableObject<OrganizationStore, string[]>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly action: string }>(
            "SELECT action FROM audit_events WHERE action LIKE 'organization.communication.%'",
          )
          .toArray()
          .map(({ action }) => action),
    );
    expect(actions).toContain("organization.communication.queued");
    expect(actions).toContain("organization.communication.retry.queued");
    expect(actions).toContain("organization.communication.unsubscribed");
  });

  it("cancels queued messages and rejects cancellation after delivery is claimed", async () => {
    const cookie = await signIn();
    const profileId = await createProfile(cookie, {
      displayName: "Queued Message Recipient",
      phone: "+1 555 100 0003",
      voicePart: "S1",
    });
    await database
      .prepare("UPDATE member SET profileId = ? WHERE id = 'member-alpha'")
      .bind(profileId)
      .run();
    const audience = {
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      targetAudiences: ["Members"],
      voiceParts: [],
    };
    const firstMessage = communicationMessageResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/send", cookie, {
          audience,
          channel: "Email",
          contentMarkdown: "First queued message",
          subject: "First queued message",
        })
      ).json(),
    );
    const canceled = communicationMessageResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/communications/${firstMessage.id}/cancel`,
          cookie,
          {},
        )
      ).json(),
    );
    expect(canceled).toMatchObject({ id: firstMessage.id, status: "Canceled" });

    const firstJob = await runInDurableObject<OrganizationStore, { jobId: string }>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly jobId: string }>(
            `SELECT job_id AS jobId FROM scheduled_job_outbox
             WHERE idempotency_key = ? LIMIT 1`,
            `communication:${firstMessage.id}:initial`,
          )
          .one(),
    );
    const canceledJobResponse = await stores
      .get(stores.idFromName("organization-alpha"))
      .fetch(
        `https://organization.internal/internal/communications/job?organizationId=organization-alpha&jobId=${firstJob.jobId}`,
      );
    expect(canceledJobResponse.status).toBe(200);
    expect(
      z.object({ deliveries: z.array(z.unknown()) }).parse(await canceledJobResponse.json())
        .deliveries,
    ).toHaveLength(0);
    const canceledDelivery = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM communication_deliveries WHERE message_id = ? LIMIT 1",
            firstMessage.id,
          )
          .one().status,
    );
    expect(canceledDelivery).toBe("suppressed");

    const messages = communicationMessagesResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications", cookie),
        )
      ).json(),
    );
    expect(messages.messages.find(({ id }) => id === firstMessage.id)?.status).toBe("Canceled");

    const secondMessage = communicationMessageResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/send", cookie, {
          audience,
          channel: "Email",
          contentMarkdown: "Second queued message",
          subject: "Second queued message",
        })
      ).json(),
    );
    const secondJob = await runInDurableObject<OrganizationStore, { jobId: string }>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly jobId: string }>(
            `SELECT job_id AS jobId FROM scheduled_job_outbox
             WHERE idempotency_key = ? LIMIT 1`,
            `communication:${secondMessage.id}:initial`,
          )
          .one(),
    );
    const claimedResponse = await stores
      .get(stores.idFromName("organization-alpha"))
      .fetch(
        `https://organization.internal/internal/communications/job?organizationId=organization-alpha&jobId=${secondJob.jobId}`,
      );
    expect(claimedResponse.status).toBe(200);
    expect(
      z.object({ deliveries: z.array(z.unknown()) }).parse(await claimedResponse.json()).deliveries,
    ).toHaveLength(1);
    const startedResponse = await write(
      "alpha.localhost",
      `/api/organization/communications/${secondMessage.id}/cancel`,
      cookie,
      {},
    );
    expect(startedResponse.status).toBe(409);
    expect(z.object({ code: z.string() }).parse(await startedResponse.json()).code).toBe(
      "communication_delivery_started",
    );
  });

  it("delivers a test email using the organization's custom sender name and reply-to", async () => {
    const cookie = await signIn();
    const updateSettingsResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/email-settings", cookie, {
        body: JSON.stringify({
          fromName: "Alpha Choir Director",
          replyToEmail: "director@alpha.example.test",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(updateSettingsResponse.status).toBe(200);

    const testEmailResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/test-email",
      cookie,
      {
        contentMarkdown: "Hello {singerName}, this is a test.",
        email: "test-recipient@example.test",
        subject: "Test Subject",
      },
    );
    expect(testEmailResponse.status).toBe(202);
    expect(await testEmailResponse.json()).toMatchObject({ sent: true });
  });
});
