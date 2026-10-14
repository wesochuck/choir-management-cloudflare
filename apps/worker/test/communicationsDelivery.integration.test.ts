import {
  communicationMessageResponseSchema,
  communicationMessagesResponseSchema,
  communicationReachResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { processDeliveryBatch } from "../src/jobs/consumer";
import type { DeliveryJob } from "../src/jobs/contracts";
import { backfillCommerceContactLinks } from "../src/organization/commerceContacts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";
import {
  api,
  createProfile,
  database,
  managerEmail,
  organizationFiles,
  signIn,
  stores,
  write,
} from "./communications.integration.fixture";

beforeEach(async () => {
  await setupOrganizationIntegration(database, stores, {
    displayName: "Communications Manager",
    email: managerEmail,
    organizations: [
      { id: "organization-alpha", role: "admin", slug: "alpha" },
      { id: "organization-bravo", role: "member", slug: "bravo" },
    ],
    userId: "communications-manager",
  });
});

afterEach(async () => teardownOrganizationIntegration());

describe("Organization communications delivery, idempotency, and cancellation", () => {
  it("queues service notices to unsubscribed holders while retaining provider and admin suppressions", async () => {
    const cookie = await signIn();
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const suffix = eventId.slice(0, 8);
    const unsubscribedEmail = `ticket-unsub-${suffix}@example.test`;
    const bouncedEmail = `ticket-bounce-${suffix}@example.test`;
    const adminSuppressedEmail = `ticket-admin-${suffix}@example.test`;
    const adminProfileId = await createProfile(cookie, {
      displayName: "Ticket holder with email restriction",
      doNotEmail: true,
      phone: "+1 555 100 0088",
      voicePart: "S1",
    });
    await runInDurableObject<OrganizationStore, undefined>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          `INSERT INTO events
            (id, title, type, starts_at, created_at, updated_at, is_canceled)
           VALUES (?, 'Canceled service-notice performance', 'Performance', ?, ?, ?, 1)`,
          eventId,
          new Date(Date.now() + 86_400_000).toISOString(),
          now,
          now,
        );
        for (const [name, email] of [
          ["Unsubscribed ticket holder", unsubscribedEmail],
          ["Bounced ticket holder", bouncedEmail],
          ["Admin-suppressed ticket holder", adminSuppressedEmail],
        ] as const) {
          state.storage.sql.exec(
            `INSERT INTO ticket_purchases
              (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
               buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
               currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
               created_at, updated_at, included_events_json, bundle_title)
             VALUES (?, ?, ?, 'Canceled service-notice performance', ?, 'America/New_York',
               ?, ?, 1, 2000, 100, 2100, 'usd', ?, '', 'paid', 0, ?, ?, '[]', '')`,
            crypto.randomUUID(),
            crypto.randomUUID(),
            eventId,
            new Date(Date.now() + 86_400_000).toISOString(),
            name,
            email,
            crypto.randomUUID(),
            now,
            now,
          );
        }
        backfillCommerceContactLinks(state.storage, {});
        state.storage.sql.exec(
          `UPDATE contact_communication_preferences SET status = 'unsubscribed', source = 'user_unsubscribe'
           WHERE channel = 'email' AND contact_id = (
             SELECT contact_id FROM ticket_purchases WHERE buyer_email = ? LIMIT 1
           )`,
          unsubscribedEmail,
        );
        state.storage.sql.exec(
          `UPDATE contact_communication_preferences SET status = 'unsubscribed', source = 'provider_bounce'
           WHERE channel = 'email' AND contact_id = (
             SELECT contact_id FROM ticket_purchases WHERE buyer_email = ? LIMIT 1
           )`,
          bouncedEmail,
        );
        state.storage.sql.exec(
          `UPDATE contacts SET profile_id = ? WHERE normalized_email = ?`,
          adminProfileId,
          adminSuppressedEmail,
        );
        return undefined;
      },
    );
    await database
      .prepare(
        `INSERT INTO email_recipient_suppressions
          (email_normalized, reason, source_event_id, provider_message_id, detail, active,
           created_at, updated_at)
         VALUES (?, 'bounce', ?, ?, '', 1, ?, ?)`,
      )
      .bind(bouncedEmail, crypto.randomUUID(), crypto.randomUUID(), now, now)
      .run();

    const serviceAudience = {
      eventId,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      targetAudiences: ["Ticket Buyers"],
      ticketBuyerMode: "ticket_service",
      voiceParts: [],
    };
    const marketingReach = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience: { ...serviceAudience, ticketBuyerMode: "marketing" },
          channel: "Email",
        })
      ).json(),
    );
    expect(marketingReach).toMatchObject({ email: 0, total: 0 });

    const reach = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience: serviceAudience,
          channel: "Email",
        })
      ).json(),
    );
    expect(reach).toMatchObject({ email: 1, total: 1, unreachable: 2 });

    const draftResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      {
        audience: serviceAudience,
        channel: "Email",
        contentMarkdown: "A service-notice draft",
        subject: "Service-notice draft",
      },
    );
    expect(draftResponse.status).toBe(201);
    const draft = communicationMessageResponseSchema.parse(await draftResponse.json());
    expect(draft.audience).toMatchObject({ eventId, ticketBuyerMode: "ticket_service" });

    const sendResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      {
        audience: serviceAudience,
        channel: "Email",
        contentMarkdown: "The performance has been canceled.",
        subject: "Performance cancellation",
      },
    );
    expect(sendResponse.status).toBe(202);
    const message = communicationMessageResponseSchema.parse(await sendResponse.json());
    expect(message).toMatchObject({
      audience: { eventId, ticketBuyerMode: "ticket_service" },
      reach: { email: 1, total: 1, unreachable: 2 },
      status: "Queued",
    });

    const stub = stores.get(stores.idFromName("organization-alpha"));
    const storedRows = await runInDurableObject<
      OrganizationStore,
      {
        readonly destinations: readonly string[];
        readonly preference: { readonly source: string; readonly status: string };
        readonly unsubscribeUrls: readonly (string | null)[];
      }
    >(stub, (_instance, state) => ({
      destinations: state.storage.sql
        .exec<{ readonly destination: string }>(
          `SELECT destination FROM communication_deliveries WHERE message_id = ? ORDER BY destination`,
          message.id,
        )
        .toArray()
        .map(({ destination }) => destination),
      preference: state.storage.sql
        .exec<{ readonly source: string; readonly status: string }>(
          `SELECT pref.source, pref.status FROM contact_communication_preferences pref
           JOIN contacts c ON c.id = pref.contact_id
           WHERE c.normalized_email = ? AND pref.channel = 'email' LIMIT 1`,
          unsubscribedEmail,
        )
        .one(),
      unsubscribeUrls: state.storage.sql
        .exec<{ readonly unsubscribeUrl: string | null }>(
          `SELECT unsubscribe_url AS unsubscribeUrl FROM communication_deliveries
           WHERE message_id = ? ORDER BY destination`,
          message.id,
        )
        .toArray()
        .map(({ unsubscribeUrl }) => unsubscribeUrl),
    }));
    expect(storedRows).toEqual({
      destinations: [unsubscribedEmail],
      preference: { source: "user_unsubscribe", status: "unsubscribed" },
      unsubscribeUrls: [null],
    });

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
           FROM scheduled_job_outbox WHERE idempotency_key = ? LIMIT 1`,
            `communication:${message.id}:initial`,
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
      { attempts: 1, body: job, id: "ticket-service-communication-job", timestamp: new Date() },
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
    expect(queueResult.explicitAcks).toEqual(["ticket-service-communication-job"]);

    const sentStatus = await runInDurableObject<OrganizationStore, string>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM communication_deliveries WHERE message_id = ? LIMIT 1",
            message.id,
          )
          .one().status,
    );
    expect(sentStatus).toBe("sent");
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
