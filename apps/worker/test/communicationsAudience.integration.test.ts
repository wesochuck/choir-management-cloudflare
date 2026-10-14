import {
  communicationDeliverySummaryResponseSchema,
  communicationMessageResponseSchema,
  communicationReachResponseSchema,
  communicationRetryResponseSchema,
  communicationScheduledMessagesResponseSchema,
  communicationUnsubscribeResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { processDeliveryBatch } from "../src/jobs/consumer";
import type { DeliveryJob } from "../src/jobs/contracts";
import { backfillCommerceContactLinks } from "../src/organization/commerceContacts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { issueSignedLink } from "../src/security/signedLinks";
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

describe("Organization communications audience and reach", () => {
  it("resolves opted-in donors and ticket buyers and lists automated sends", async () => {
    const cookie = await signIn();
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const purchaseId = crypto.randomUUID();
    const donationId = crypto.randomUUID();
    const notificationId = crypto.randomUUID();
    const refundNotificationId = crypto.randomUUID();
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
          `INSERT INTO ticket_notifications
            (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
             content_markdown, status, scheduled_for, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'confirmation', 'buyer@example.test', 'Refund processed',
             'Refund body', 'queued', ?, ?, ?)`,
          refundNotificationId,
          purchaseId,
          eventId,
          `ticket-refund:${purchaseId}`,
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
    // Phase 9: commerce audiences resolve through Contacts. Direct SQL seeds
    // bypass checkout linkage, so run the real backfill to link the seeded
    // paid rows before asserting reach.
    await runInDurableObject<OrganizationStore, undefined>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        backfillCommerceContactLinks(state.storage, {});
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

    // Phase 9: the Ticket Buyer audience resolves to the linked Contact, so
    // unsubscribing that Contact excludes ticket reach while donor reach
    // stays intact. This proves current commerce sends unsubscribe the
    // resulting Contact rather than a transaction pseudo-identity.
    const buyerContactId = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<Record<string, SqlStorageValue> & { contactId: string }>(
            "SELECT contact_id AS contactId FROM ticket_purchases WHERE id = ?",
            purchaseId,
          )
          .one().contactId,
    );
    expect(buyerContactId).not.toBe(purchaseId);
    const issuedAt = Math.floor(Date.now() / 1_000);
    const buyerToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      expiresAt: issuedAt + 3_600,
      issuedAt,
      organizationId: "organization-alpha",
      purpose: "unsubscribe",
      resourceId: "contact",
      revocation: "email-v1",
      subjectId: buyerContactId,
      version: 1,
    });
    expect(
      (await write("alpha.localhost", "/api/public/unsubscribe", cookie, { token: buyerToken }))
        .status,
    ).toBe(200);
    const ticketReachAfter = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience: ticketAudience,
          channel: "Email",
        })
      ).json(),
    );
    expect(ticketReachAfter).toMatchObject({ email: 0 });
    const donorReachAfter = communicationReachResponseSchema.parse(
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
    expect(donorReachAfter).toMatchObject({ email: 1, total: 1 });

    const scheduled = communicationScheduledMessagesResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/scheduled", cookie),
        )
      ).json(),
    );
    expect(scheduled.messages.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(["ticket_refund", "ticket_reminder", "event_reminder"]),
    );
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

  it("dedupes members and contacts sharing one email across the full stack", async () => {
    const cookie = await signIn();
    const profileId = await createProfile(cookie, {
      displayName: "Shared Recipient",
      phone: "+1 555 100 0011",
      voicePart: "S1",
    });
    await database
      .prepare("UPDATE member SET profileId = ? WHERE id = 'member-alpha'")
      .bind(profileId)
      .run();
    // The member resolves its delivery email from D1 identity data; the
    // contact carries the same address directly (Scenario E).
    const contactResponse = await write("alpha.localhost", "/api/organization/contacts", cookie, {
      displayName: "Shared Contact",
      email: managerEmail,
    });
    expect(contactResponse.status).toBe(201);
    const contactId = z
      .object({ contact: z.object({ id: z.uuid() }) })
      .parse(await contactResponse.json()).contact.id;
    const listResponse = await write("alpha.localhost", "/api/organization/contact-lists", cookie, {
      name: "Newsletter",
    });
    expect(listResponse.status).toBe(201);
    const listId = z.object({ list: z.object({ id: z.uuid() }) }).parse(await listResponse.json())
      .list.id;
    const membershipResponse = await write(
      "alpha.localhost",
      `/api/organization/contact-lists/${listId}/members`,
      cookie,
      { contactIds: [contactId] },
    );
    expect(membershipResponse.status).toBe(200);

    const audience = {
      contactEmailStatus: null,
      contactIds: [],
      contactListIds: [listId],
      contactSmsStatus: null,
      contactSource: null,
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      targetAudiences: ["Members", "Contacts"],
      voiceParts: [],
    };
    const combined = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience,
          channel: "Email",
        })
      ).json(),
    );
    expect(combined).toMatchObject({ email: 1, total: 1 });

    const contactsOnly = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience: { ...audience, targetAudiences: ["Contacts"] },
          channel: "Email",
        })
      ).json(),
    );
    expect(contactsOnly).toMatchObject({ email: 1, total: 1 });

    // Cross-tenant: the same audience on another Organization's host cannot
    // resolve alpha's contact list (organization-scoped storage).
    expect(
      (
        await write("bravo.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience,
          channel: "Email",
        })
      ).status,
    ).toBe(403);
  });
});
