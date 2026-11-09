import {
  communicationMessageResponseSchema,
  communicationReachResponseSchema,
  communicationDeliverySummaryResponseSchema,
  organizationEventSchema,
  organizationVenueSchema,
} from "@choir/contracts";
import { futureDateString, futureIsoDate } from "@choir/testkit";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { recordCommunicationDeliveryResults } from "../src/organization/organizationCommunications";
import {
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";
import {
  api,
  database,
  env,
  exports,
  managerEmail,
  signIn,
  stores,
  write,
} from "./communications.integration.fixture";

beforeEach(async () => {
  await setupOrganizationIntegration(database, stores, {
    displayName: "Communications Manager",
    email: managerEmail,
    organizations: [{ id: "organization-alpha", role: "admin", slug: "alpha" }],
    userId: "communications-manager",
  });
});
afterEach(async () => teardownOrganizationIntegration());

async function seedContacts(count: number) {
  const stub = stores.get(stores.idFromName("organization-alpha"));
  return runInDurableObject<OrganizationStore, string[]>(stub, (_instance, state) => {
    const now = new Date().toISOString();
    const ids: string[] = [];
    state.storage.transactionSync(() => {
      for (let index = 0; index < count; index += 1) {
        const id = crypto.randomUUID();
        ids.push(id);
        const email = `large-${id}@example.test`;
        state.storage.sql.exec(
          `INSERT INTO contacts (id, display_name, email, normalized_email, phone, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'large campaign', ?, ?)`,
          id,
          `Recipient ${String(index)}`,
          email,
          email,
          `+1555${String(index).padStart(7, "0")}`,
          now,
          now,
        );
      }
    });
    return ids;
  });
}

async function createPromotion(cookie: string) {
  const venueResponse = await write("alpha.localhost", "/api/organization/venues", cookie, {
    address: "1 Test Way",
    name: "Large concert hall",
  });
  const venueId = organizationVenueSchema.parse(await venueResponse.json()).id;
  const eventResponse = await write("alpha.localhost", "/api/organization/events", cookie, {
    advancePriceCents: 1000,
    callTime: "",
    dayOfPriceCents: 1200,
    details: "",
    doorsOpenTime: "",
    durationMinutes: null,
    isTicketingEnabled: true,
    location: "",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: true,
    rsvpDeadlineDate: futureDateString({ days: 20 }),
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    setList: [],
    setListApproved: false,
    startsAt: futureIsoDate({ days: 30 }),
    ticketCapacity: 12_000,
    title: "Large concert",
    type: "Performance",
    venueId,
  });
  expect(eventResponse.status).toBe(201);
  return {
    announcementKind: "initial" as const,
    eventId: organizationEventSchema.parse(await eventResponse.json()).id,
    parentMessageId: null,
  };
}

describe("large Organization campaigns", () => {
  it.each([
    { promotion: false, channel: "Both" as const, deliveryCount: 20_000 },
    { promotion: true, channel: "Email" as const, deliveryCount: 10_000 },
  ])(
    "reviews and drains 10,000 recipients ($channel, promotion $promotion) without duplicate deliveries",
    async ({ promotion, channel, deliveryCount }) => {
      const cookie = await signIn();
      const contactIds = await seedContacts(10_000);
      const stub = stores.get(stores.idFromName("organization-alpha"));
      const eventPromotion = promotion ? await createPromotion(cookie) : undefined;
      const audience = {
        targetAudiences: ["Contacts"],
        contactIds,
        ...(eventPromotion ? { excludeTicketBuyersForEventId: eventPromotion.eventId } : {}),
      };
      const message = {
        audience,
        channel,
        contentMarkdown: "Hello {recipientName}.",
        subject: "Large invitation",
        eventPromotion,
      };
      const preview = await write(
        "alpha.localhost",
        "/api/organization/communications/reach-preview",
        cookie,
        { audience, channel },
      );
      expect(preview.status).toBe(200);
      expect(communicationReachResponseSchema.parse(await preview.json())).toMatchObject({
        total: 10_000,
        audienceOverLimit: false,
      });
      const savedResponse = await write(
        "alpha.localhost",
        "/api/organization/communications/drafts",
        cookie,
        message,
      );
      expect(savedResponse.status).toBe(201);
      const draft = communicationMessageResponseSchema.parse(await savedResponse.json());
      const reviewResponse = await write(
        "alpha.localhost",
        "/api/organization/communications/reach-preview",
        cookie,
        { ...message, messageId: draft.id, draftRevision: draft.draftRevision },
      );
      expect(reviewResponse.status).toBe(200);
      const review = communicationReachResponseSchema.parse(await reviewResponse.json());
      expect(review.reviewSnapshot).toBeTruthy();
      const sendInput = {
        ...message,
        messageId: draft.id,
        expectedRevision: draft.draftRevision,
        reviewSnapshot: review.reviewSnapshot,
      };
      const missingReview = await write(
        "alpha.localhost",
        "/api/organization/communications/send",
        cookie,
        { ...sendInput, reviewSnapshot: undefined },
      );
      expect(missingReview.status).toBe(409);
      const queuedResponse = await write(
        "alpha.localhost",
        "/api/organization/communications/send",
        cookie,
        sendInput,
        { "idempotency-key": "large-campaign-test" },
      );
      expect(queuedResponse.status).toBe(202);
      const queued = communicationMessageResponseSchema.parse(await queuedResponse.json());
      expect(queued.reach.total).toBe(10_000);
      // A replay keeps the same canonical message and creates no extra deliveries.
      const replay = await write(
        "alpha.localhost",
        "/api/organization/communications/send",
        cookie,
        sendInput,
        { "idempotency-key": "large-campaign-test" },
      );
      expect(replay.status).toBe(202);
      expect(communicationMessageResponseSchema.parse(await replay.json()).id).toBe(queued.id);
      let jobId = await runInDurableObject<OrganizationStore, string>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ jobId: string }>(
              "SELECT job_id AS jobId FROM scheduled_job_outbox WHERE idempotency_key = ?",
              `communication:${queued.id}:initial`,
            )
            .one().jobId,
      );
      const seen = new Set<string>();
      for (let batchNumber = 0; batchNumber < deliveryCount / 50; batchNumber += 1) {
        const batch = await stub.claimCommunicationDeliveryBatch({
          organizationId: "organization-alpha",
          jobId,
        });
        expect(batch.deliveries.length).toBeGreaterThan(0);
        expect(batch.deliveries.length).toBeLessThanOrEqual(50);
        if (batchNumber === 0) {
          const resumed = await stub.claimCommunicationDeliveryBatch({
            organizationId: "organization-alpha",
            jobId,
          });
          expect(resumed.deliveries).toEqual(batch.deliveries);
          await runInDurableObject<OrganizationStore, undefined>(stub, async (instance) => {
            await expect(
              instance.finishCommunicationDeliveryBatch({
                organizationId: "organization-alpha",
                jobId,
              }),
            ).rejects.toThrow("communication_batch_unfinished");
            await expect(
              instance.claimCommunicationDeliveryBatch({
                organizationId: "organization-bravo",
                jobId,
              }),
            ).rejects.toThrow();
          });
        }
        for (const delivery of batch.deliveries) {
          expect(seen.has(delivery.id)).toBe(false);
          seen.add(delivery.id);
        }
        const results = batch.deliveries.map((delivery) => ({
          deliveryId: delivery.id,
          failureDetail: "",
          providerMessageId: null,
          status: "sent" as const,
        }));
        if (batchNumber === 0) {
          await recordCommunicationDeliveryResults(env, {
            organizationId: "organization-alpha",
            jobId,
            results: results.slice(0, 25),
          });
          const remaining = await stub.claimCommunicationDeliveryBatch({
            organizationId: "organization-alpha",
            jobId,
          });
          expect(remaining.deliveries).toHaveLength(25);
          const recordedIds = new Set(results.slice(0, 25).map(({ deliveryId }) => deliveryId));
          expect(remaining.deliveries.every(({ id }) => !recordedIds.has(id))).toBe(true);
        }
        await recordCommunicationDeliveryResults(env, {
          organizationId: "organization-alpha",
          jobId,
          results,
        });
        // Results and batch completion are both replay-safe.
        await recordCommunicationDeliveryResults(env, {
          organizationId: "organization-alpha",
          jobId,
          results,
        });
        const next = await stub.finishCommunicationDeliveryBatch({
          organizationId: "organization-alpha",
          jobId,
        });
        expect(
          (
            await stub.claimCommunicationDeliveryBatch({
              organizationId: "organization-alpha",
              jobId,
            })
          ).deliveries,
        ).toEqual([]);
        expect(
          (
            await stub.finishCommunicationDeliveryBatch({
              organizationId: "organization-alpha",
              jobId,
            })
          ).scheduled,
        ).toBe(false);
        if (!next.scheduled) break;
        jobId = await runInDurableObject<OrganizationStore, string>(
          stub,
          (_instance, state) =>
            state.storage.sql
              .exec<{ jobId: string }>(
                "SELECT job_id AS jobId FROM scheduled_job_outbox WHERE idempotency_key = ?",
                `communication:${queued.id}:after:${jobId}`,
              )
              .one().jobId,
        );
      }
      expect(seen.size).toBe(deliveryCount);
      const summaryResponse = await exports.default.fetch(
        api(
          "alpha.localhost",
          `/api/organization/communications/${queued.id}/delivery-summary`,
          cookie,
        ),
      );
      const summary = communicationDeliverySummaryResponseSchema.parse(
        await summaryResponse.json(),
      );
      expect(summary.total).toMatchObject({
        total: deliveryCount,
        sent: deliveryCount,
        queued: 0,
        processing: 0,
      });
      await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
        expect(
          state.storage.sql
            .exec<{ attempts: number }>(
              "SELECT MAX(attempts) AS attempts FROM communication_deliveries WHERE message_id = ?",
              queued.id,
            )
            .one().attempts,
        ).toBe(1);
        const plan = state.storage.sql
          .exec<{ detail: string }>(
            "EXPLAIN QUERY PLAN SELECT id FROM communication_deliveries WHERE message_id = ? AND delivery_job_id IS NULL AND status = 'queued' ORDER BY id LIMIT 50",
            queued.id,
          )
          .toArray();
        expect(
          plan.some(({ detail }) => detail.includes("idx_communication_deliveries_batch")),
        ).toBe(true);
      });
    },
    120_000,
  );

  it.each(["Email", "SMS"])(
    "recovers legacy processing rows, fixes the queued audience, and rechecks %s consent",
    async (channel) => {
      const cookie = await signIn();
      await seedContacts(101);
      const stub = stores.get(stores.idFromName("organization-alpha"));
      const response = await write(
        "alpha.localhost",
        "/api/organization/communications/send",
        cookie,
        {
          audience: { targetAudiences: ["Contacts"], contactSource: "large campaign" },
          channel,
          contentMarkdown: "Invitation",
          subject: "Snapshot",
        },
      );
      const message = communicationMessageResponseSchema.parse(await response.json());
      let jobId = await runInDurableObject<OrganizationStore, string>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ jobId: string }>(
              "SELECT job_id AS jobId FROM scheduled_job_outbox WHERE idempotency_key = ?",
              `communication:${message.id}:initial`,
            )
            .one().jobId,
      );
      await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
        // Simulate a pre-upgrade Worker stopping after it marked the campaign processing.
        state.storage.sql.exec(
          "UPDATE communication_deliveries SET status = 'processing' WHERE message_id = ? AND delivery_job_id IS NULL",
          message.id,
        );
      });
      const first = await stub.claimCommunicationDeliveryBatch({
        organizationId: "organization-alpha",
        jobId,
      });
      expect(first.deliveries).toHaveLength(50);
      const firstRecipient = first.deliveries[0];
      if (!firstRecipient) throw new Error("Expected a claimed recipient");
      await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
        const now = new Date().toISOString();
        state.storage.sql.exec(
          "INSERT INTO contact_communication_preferences (contact_id, channel, status, source, observed_at, updated_at) VALUES (?, ?, 'unsubscribed', 'manual', ?, ?)",
          firstRecipient.profileId,
          channel.toLowerCase(),
          now,
          now,
        );
      });
      expect(
        await stub.checkCommunicationDelivery({
          organizationId: "organization-alpha",
          jobId,
          deliveryId: firstRecipient.id,
        }),
      ).toBe(false);
      await recordCommunicationDeliveryResults(env, {
        organizationId: "organization-alpha",
        jobId,
        results: first.deliveries.slice(1).map(({ id }, index) => ({
          deliveryId: id,
          status: index === 0 ? "failed" : "sent",
          failureDetail: "",
          providerMessageId: null,
        })),
      });
      // New contacts added after confirmation must never enter the delivery snapshot.
      await seedContacts(1);
      await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
        const now = new Date().toISOString();
        state.storage.sql.exec(
          `INSERT OR REPLACE INTO contact_communication_preferences (contact_id, channel, status, source, observed_at, updated_at)
         SELECT profile_id, ?, 'unsubscribed', 'manual', ?, ? FROM communication_deliveries
         WHERE message_id = ? AND delivery_job_id IS NULL`,
          channel.toLowerCase(),
          now,
          now,
          message.id,
        );
      });
      for (let index = 0; index < 3; index += 1) {
        const finished = await stub.finishCommunicationDeliveryBatch({
          organizationId: "organization-alpha",
          jobId,
        });
        if (!finished.scheduled) break;
        jobId = await runInDurableObject<OrganizationStore, string>(
          stub,
          (_instance, state) =>
            state.storage.sql
              .exec<{ jobId: string }>(
                "SELECT job_id AS jobId FROM scheduled_job_outbox WHERE idempotency_key = ?",
                `communication:${message.id}:after:${jobId}`,
              )
              .one().jobId,
        );
        expect(
          (
            await stub.claimCommunicationDeliveryBatch({
              organizationId: "organization-alpha",
              jobId,
            })
          ).deliveries,
        ).toEqual([]);
      }
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
      expect(summary.total).toMatchObject({
        total: 101,
        sent: 48,
        failed: 1,
        suppressed: 52,
        queued: 0,
        processing: 0,
      });
      const retry = await write(
        "alpha.localhost",
        `/api/organization/communications/${message.id}/retry-failed`,
        cookie,
        {},
      );
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ retried: 1 });
      const retryJobId = await runInDurableObject<OrganizationStore, string>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<{ jobId: string }>(
              "SELECT job_id AS jobId FROM scheduled_job_outbox WHERE idempotency_key >= ? AND idempotency_key < ?",
              `communication:${message.id}:retry:`,
              `communication:${message.id}:retry:~`,
            )
            .one().jobId,
      );
      const retriedBatch = await stub.claimCommunicationDeliveryBatch({
        organizationId: "organization-alpha",
        jobId: retryJobId,
      });
      expect(retriedBatch.deliveries).toHaveLength(1);
      expect(retriedBatch.deliveries[0]?.id).toBe(first.deliveries[1]?.id);
      await recordCommunicationDeliveryResults(env, {
        organizationId: "organization-alpha",
        jobId: retryJobId,
        results: retriedBatch.deliveries.map(({ id }) => ({
          deliveryId: id,
          failureDetail: "",
          providerMessageId: null,
          status: "sent",
        })),
      });
      expect(
        (
          await stub.finishCommunicationDeliveryBatch({
            organizationId: "organization-alpha",
            jobId: retryJobId,
          })
        ).scheduled,
      ).toBe(false);
      const final = communicationDeliverySummaryResponseSchema.parse(
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
      expect(final.total).toMatchObject({
        total: 101,
        sent: 49,
        suppressed: 52,
        failed: 0,
        queued: 0,
        processing: 0,
      });
      expect(final.state).toBe("sent");
    },
  );

  it("reports overflow for 10,001 Contacts and refuses to send a truncated audience", async () => {
    const cookie = await signIn();
    await seedContacts(10_001);
    const message = {
      audience: { targetAudiences: ["Contacts"], contactSource: "large campaign" },
      channel: "Email",
      contentMarkdown: "Invitation",
      subject: "Too many",
    };
    const response = await write(
      "alpha.localhost",
      "/api/organization/communications/reach-preview",
      cookie,
      message,
    );
    expect(communicationReachResponseSchema.parse(await response.json()).audienceOverLimit).toBe(
      true,
    );
    const send = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      message,
    );
    expect(send.status).toBe(409);
  }, 60_000);
});
