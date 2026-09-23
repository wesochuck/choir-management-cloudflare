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
import { organizationRequest, readEmailOneTimeCode, signInWithOtp } from "@choir/testkit";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { readCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";
import { processDeliveryBatch } from "../src/jobs/consumer";
import type { DeliveryJob } from "../src/jobs/contracts";
import { backfillCommerceContactLinks } from "../src/organization/commerceContacts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { invokeOrganizationRpc, organizationStoreStub } from "../src/organization/rpc/client";
import { issueSignedLink } from "../src/security/signedLinks";
import {
  requireIntegrationBinding,
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";
import {
  readTicketMessageTemplate,
  ticketMessageTemplates,
} from "../src/organization/ticketMessageTemplates";

const database = requireIntegrationBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireIntegrationBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const organizationFiles = requireIntegrationBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");
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

describe("Organization communications", () => {
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
      "Bundle Ticket Refund Confirmation",
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
      "Ticket Refund Confirmation",
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
      "Bundle Ticket Refund Confirmation",
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
      "Ticket Refund Confirmation",
      "Weather / Schedule Delay Alert",
    ]);
    const systemEmailTemplates = templates.templates.filter(
      ({ channel, isSystem }) => isSystem && channel === "Email",
    );
    expect(systemEmailTemplates).toHaveLength(17);
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

  it("resets only registered system templates to the current canonical default", async () => {
    const cookie = await signIn();
    const initialTemplates = communicationTemplatesResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/templates", cookie),
        )
      ).json(),
    ).templates;
    const ticketTemplate = initialTemplates.find(({ title }) => title === "Ticket Confirmation");
    const otherSystemTemplate = initialTemplates.find(
      ({ title }) => title === "Bundle Ticket Confirmation",
    );
    if (!ticketTemplate || !otherSystemTemplate) {
      throw new Error("The seeded system ticket templates are unavailable.");
    }
    const canonical = ticketMessageTemplates.find(({ kind }) => kind === "confirmation");
    if (!canonical) throw new Error("The canonical ticket confirmation template is unavailable.");
    const ticketConfirmationSettingsBefore = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly settings: string }>(
            "SELECT ticket_confirmation_settings_json AS settings FROM organization_metadata LIMIT 1",
          )
          .one().settings,
    );

    const updated = communicationTemplateResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/communications/templates/${ticketTemplate.id}`,
            cookie,
            {
              body: JSON.stringify({
                channel: "Both",
                contentMarkdown: "Older ticket wording without venue details.",
                subject: "Older ticket subject",
                title: "Older ticket title",
              }),
              headers: { "content-type": "application/json" },
              method: "PUT",
            },
          ),
        )
      ).json(),
    );
    expect(updated).toMatchObject({ channel: "Both", isSystem: true, title: "Older ticket title" });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const reset = await write(
      "alpha.localhost",
      `/api/organization/communications/templates/${ticketTemplate.id}/reset-system-default`,
      cookie,
      {},
    );
    expect(reset.status).toBe(200);
    const restored = communicationTemplateResponseSchema.parse(await reset.json());
    expect(restored).toMatchObject({
      channel: canonical.channel,
      contentMarkdown: canonical.contentMarkdown,
      id: ticketTemplate.id,
      isSystem: true,
      subject: canonical.subject,
      title: canonical.title,
    });
    expect(restored.contentMarkdown).toContain("- **Venue:** {venueName}");
    expect(restored.contentMarkdown).toContain("- **Address:** {venueAddress}");
    expect(Date.parse(restored.updatedAt)).toBeGreaterThan(Date.parse(updated.updatedAt));

    const secondReset = communicationTemplateResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/communications/templates/${ticketTemplate.id}/reset-system-default`,
          cookie,
          {},
        )
      ).json(),
    );
    expect(secondReset).toMatchObject({
      channel: canonical.channel,
      contentMarkdown: canonical.contentMarkdown,
      subject: canonical.subject,
      title: canonical.title,
    });

    const customTemplate = communicationTemplateResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/templates", cookie, {
          channel: "Email",
          contentMarkdown: "Organization-owned custom wording.",
          subject: "Custom subject",
          title: "Custom template",
        })
      ).json(),
    );
    expect(customTemplate.isSystem).toBe(false);
    const customReset = await write(
      "alpha.localhost",
      `/api/organization/communications/templates/${customTemplate.id}/reset-system-default`,
      cookie,
      {},
    );
    expect(customReset.status).toBe(409);
    expect(await customReset.json()).toMatchObject({ code: "communication_template_not_system" });

    const missingReset = await write(
      "alpha.localhost",
      `/api/organization/communications/templates/${crypto.randomUUID()}/reset-system-default`,
      cookie,
      {},
    );
    expect(missingReset.status).toBe(404);

    const reloadedTemplates = communicationTemplatesResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/templates", cookie),
        )
      ).json(),
    ).templates;
    expect(reloadedTemplates.find(({ id }) => id === ticketTemplate.id)).toMatchObject({
      channel: canonical.channel,
      contentMarkdown: canonical.contentMarkdown,
      id: ticketTemplate.id,
      isSystem: true,
      subject: canonical.subject,
      title: canonical.title,
      updatedAt: secondReset.updatedAt,
    });
    expect(reloadedTemplates.find(({ id }) => id === otherSystemTemplate.id)).toEqual(
      otherSystemTemplate,
    );

    const deliveredTicketTemplate = await runInDurableObject<
      OrganizationStore,
      ReturnType<typeof readTicketMessageTemplate>
    >(stores.get(stores.idFromName("organization-alpha")), (_instance, state) =>
      readTicketMessageTemplate(state.storage, "confirmation"),
    );
    expect(deliveredTicketTemplate).toMatchObject({
      contentMarkdown: canonical.contentMarkdown,
      subject: canonical.subject,
      title: canonical.title,
    });
    const ticketConfirmationSettingsAfter = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly settings: string }>(
            "SELECT ticket_confirmation_settings_json AS settings FROM organization_metadata LIMIT 1",
          )
          .one().settings,
    );
    expect(ticketConfirmationSettingsAfter).toBe(ticketConfirmationSettingsBefore);
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

  it("unsubscribes contacts with typed signed links and keeps them listed", async () => {
    const cookie = await signIn();
    const contactEmail = "newsletter.jane@example.test";
    const contactResponse = await write("alpha.localhost", "/api/organization/contacts", cookie, {
      displayName: "Newsletter Jane",
      email: contactEmail,
      emailStatus: "subscribed",
    });
    expect(contactResponse.status).toBe(201);
    const contactId = z
      .object({ contact: z.object({ id: z.uuid() }) })
      .parse(await contactResponse.json()).contact.id;
    const bounceContactResponse = await write(
      "alpha.localhost",
      "/api/organization/contacts",
      cookie,
      {
        displayName: "Bounce June",
        email: "bounce.june@example.test",
        emailStatus: "subscribed",
      },
    );
    expect(bounceContactResponse.status).toBe(201);
    const bounceContactId = z
      .object({ contact: z.object({ id: z.uuid() }) })
      .parse(await bounceContactResponse.json()).contact.id;
    const listResponse = await write("alpha.localhost", "/api/organization/contact-lists", cookie, {
      name: "Newsletter",
    });
    expect(listResponse.status).toBe(201);
    const listId = z.object({ list: z.object({ id: z.uuid() }) }).parse(await listResponse.json())
      .list.id;
    expect(
      (
        await write(
          "alpha.localhost",
          `/api/organization/contact-lists/${listId}/members`,
          cookie,
          {
            contactIds: [contactId, bounceContactId],
          },
        )
      ).status,
    ).toBe(200);

    const secret = env.SIGNED_LINK_SECRET;
    const issuedAt = Math.floor(Date.now() / 1_000);
    const mintContactToken = (
      subjectId: string,
      organizationId: string,
      issued: number = issuedAt,
      expires: number = issuedAt + 3_600,
    ) =>
      issueSignedLink(secret, {
        algorithm: "HS256",
        expiresAt: expires,
        issuedAt: issued,
        organizationId,
        purpose: "unsubscribe",
        resourceId: "contact",
        revocation: "email-v1",
        subjectId,
        version: 1,
      });
    const validToken = await mintContactToken(contactId, "organization-alpha");
    const tamperedToken = `${validToken.slice(0, -1)}${validToken.endsWith("a") ? "b" : "a"}`;
    const expiredToken = await mintContactToken(
      contactId,
      "organization-alpha",
      issuedAt - 7_200,
      issuedAt - 7_140,
    );
    const unknownContactToken = await mintContactToken(crypto.randomUUID(), "organization-alpha");

    const unsubscribe = (host: string, token: string) =>
      write(host, "/api/public/unsubscribe", cookie, { token });

    // A modified contact ID breaks the signature (constant-time verification).
    const tampered = await unsubscribe("alpha.localhost", tamperedToken);
    expect(tampered.status).toBe(400);
    expect(await tampered.json()).toMatchObject({ code: "invalid_unsubscribe_link" });

    // Expired tokens are rejected without touching storage.
    const expired = await unsubscribe("alpha.localhost", expiredToken);
    expect(expired.status).toBe(400);
    expect(await expired.json()).toMatchObject({ code: "invalid_unsubscribe_link" });

    // An Organization A token replayed on Organization B's host is rejected:
    // the Organization is resolved from the validated hostname, never from
    // client input, and the envelope stays bound to Organization A.
    const replayed = await unsubscribe("bravo.localhost", validToken);
    expect(replayed.status).toBe(400);
    expect(await replayed.json()).toMatchObject({ code: "invalid_unsubscribe_link" });

    // A well-formed signature for an unknown contact resolves to not-found
    // rather than leaking which IDs exist.
    expect((await unsubscribe("alpha.localhost", unknownContactToken)).status).toBe(404);

    const first = communicationUnsubscribeResponseSchema.parse(
      await (await unsubscribe("alpha.localhost", validToken)).json(),
    );
    expect(first.success).toBe(true);
    // Duplicate unsubscribe is idempotent: still success, no error.
    const second = communicationUnsubscribeResponseSchema.parse(
      await (await unsubscribe("alpha.localhost", validToken)).json(),
    );
    expect(second.success).toBe(true);

    const contactDetailSchema = z.object({
      contact: z.object({ email: z.string().nullable(), id: z.uuid() }),
      listIds: z.array(z.uuid()),
      preferences: z.array(
        z.object({
          channel: z.string(),
          source: z.string().nullable(),
          status: z.string(),
        }),
      ),
    });
    const readContact = async () =>
      contactDetailSchema.parse(
        await (
          await exports.default.fetch(
            api("alpha.localhost", `/api/organization/contacts/${contactId}`, cookie),
          )
        ).json(),
      );
    const detail = await readContact();
    // Unsubscribing never deletes the contact, removes list membership, or
    // changes the stored address: only the email preference flips.
    expect(detail.contact.email).toBe(contactEmail);
    expect(detail.listIds).toContain(listId);
    expect(detail.preferences.find((preference) => preference.channel === "email")).toMatchObject({
      status: "unsubscribed",
      source: "user_unsubscribe",
    });
    expect(detail.preferences.find((preference) => preference.channel === "sms")?.status).not.toBe(
      "unsubscribed",
    );

    // Audit evidence is append-only, one row per request, and carries no
    // email address (audit-safe event).
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    const auditSummaries = await runInDurableObject<OrganizationStore, string[]>(
      alphaStub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly summary: string }>(
            `SELECT change_summary AS summary FROM audit_events
             WHERE action = 'organization.communication.contact.unsubscribed' AND target_id = ?`,
            contactId,
          )
          .toArray()
          .map(({ summary }) => summary),
    );
    expect(auditSummaries).toHaveLength(2);
    for (const summary of auditSummaries) {
      expect(summary).toBe(JSON.stringify({ channel: "email" }));
      expect(summary).not.toContain(contactEmail);
    }
    // The contact path never writes profile-keyed suppression rows: contact
    // IDs are never stored as profile IDs (no fake-ID bolt-on).
    const suppressionCount = await runInDurableObject<OrganizationStore, number>(
      alphaStub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM communication_suppressions",
          )
          .toArray()[0]?.count ?? -1,
    );
    expect(suppressionCount).toBe(0);

    // Future audience previews exclude the unsubscribed contact regardless of
    // list membership (Scenario I setup: still listed, never delivered).
    const contactsAudience = {
      contactEmailStatus: null,
      contactIds: [],
      contactListIds: [listId],
      contactSmsStatus: null,
      contactSource: null,
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      targetAudiences: ["Contacts"],
      voiceParts: [],
    };
    const preview = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience: contactsAudience,
          channel: "Email",
        })
      ).json(),
    );
    // Bounce June remains eligible; Newsletter Jane is unreachable.
    expect(preview).toMatchObject({ email: 1, total: 1, unreachable: 1 });

    // Future sends exclude the unsubscribed contact: a list send delivers
    // only to still-eligible June, with no delivery row for Jane.
    const listSend = communicationMessageResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/send", cookie, {
          audience: contactsAudience,
          channel: "Email",
          contentMarkdown: "Newsletter body",
          subject: "Newsletter",
        })
      ).json(),
    );
    const listDestinations = await runInDurableObject<OrganizationStore, string[]>(
      alphaStub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly destination: string }>(
            `SELECT destination FROM communication_deliveries
             WHERE message_id = ? AND channel = 'email' ORDER BY destination`,
            listSend.id,
          )
          .toArray()
          .map(({ destination }) => destination),
    );
    expect(listDestinations).toEqual(["bounce.june@example.test"]);

    // A send whose entire audience unsubscribed is refused instead of
    // creating an empty message: zero reachable recipients, 409.
    const janeOnlyAudience = { ...contactsAudience, contactIds: [contactId], contactListIds: [] };
    const janePreview = communicationReachResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/reach-preview", cookie, {
          audience: janeOnlyAudience,
          channel: "Email",
        })
      ).json(),
    );
    expect(janePreview).toMatchObject({ email: 0, total: 0, unreachable: 1 });
    const janeOnlySend = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      {
        audience: janeOnlyAudience,
        channel: "Email",
        contentMarkdown: "Newsletter body",
        subject: "Newsletter",
      },
    );
    expect(janeOnlySend.status).toBe(409);
    expect(await janeOnlySend.json()).toMatchObject({
      code: "communication_has_no_recipients",
    });

    // CSV re-import policy (Scenario C/I): an imported `subscribed` value can
    // never override the stored unsubscribe; only an explicit resubscribe
    // workflow could. PATCH shares the import merge helper, so this proves
    // the re-import path too (import-level suppressedPreserved coverage lives
    // in contactImportStore.test.ts).
    const resubscribeResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/contacts/${contactId}`, cookie, {
        body: JSON.stringify({ emailStatus: "subscribed" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
    );
    expect(resubscribeResponse.status).toBe(200);
    expect(
      (await readContact()).preferences.find((preference) => preference.channel === "email")
        ?.status,
    ).toBe("unsubscribed");

    // Provider webhook (hard bounce): secure receipt resolves the delivery to
    // the correct Organization and contact, marks email unsubscribed with the
    // provider reason, and never touches other contacts or profiles.
    const deliveryId = crypto.randomUUID();
    const providerMessageId = `provider-msg-${deliveryId}`;
    await runInDurableObject<OrganizationStore, undefined>(alphaStub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries
            (id, message_id, profile_id, recipient_name, channel, destination, status,
             attempts, provider_message_id, failure_detail, created_at, updated_at,
             unsubscribe_url, recipient_subject_json)
           VALUES (?, ?, ?, 'Bounce June', 'email', 'bounce.june@example.test', 'sent',
             1, ?, '', ?, ?, NULL, ?)`,
        deliveryId,
        crypto.randomUUID(),
        bounceContactId,
        providerMessageId,
        now,
        now,
        JSON.stringify({ contactId: bounceContactId, kind: "contact" }),
      );
      return undefined;
    });
    const feedbackBody = {
      bounceType: "hard",
      eventId: crypto.randomUUID(),
      eventTimestamp: new Date().toISOString(),
      organizationId: "organization-alpha",
      providerMessageId,
      providerReason: "550 5.1.1 User unknown",
      providerSmtpEnhancedStatusCode: "5.1.1",
      providerSmtpResponse: "550 5.1.1 User unknown",
      providerSmtpStatusCode: "550",
      providerStatus: "bounced",
      recipient: "bounce.june@example.test",
      sourceId: deliveryId,
      sourceKind: "communication_delivery",
      shouldSuppress: true,
    };
    const postFeedback = (body: unknown) =>
      invokeOrganizationRpc(
        organizationStoreStub(env, "organization-alpha"),
        "https://organization.internal/internal/email/provider-event",
        {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
    const feedbackResponse = await postFeedback(feedbackBody);
    expect(feedbackResponse.status).toBe(200);
    expect(await feedbackResponse.json()).toMatchObject({
      contactId: bounceContactId,
      profileId: null,
      providerSuppressed: true,
      recorded: true,
    });
    const bounceDetail = z
      .object({
        listIds: z.array(z.uuid()),
        preferences: z.array(
          z.object({ channel: z.string(), source: z.string().nullable(), status: z.string() }),
        ),
      })
      .parse(
        await (
          await exports.default.fetch(
            api("alpha.localhost", `/api/organization/contacts/${bounceContactId}`, cookie),
          )
        ).json(),
      );
    expect(
      bounceDetail.preferences.find((preference) => preference.channel === "email"),
    ).toMatchObject({ status: "unsubscribed", source: "provider_bounce" });
    expect(bounceDetail.listIds).toContain(listId);

    // Webhook replay is idempotent: one preference row, terminal state kept.
    expect((await postFeedback(feedbackBody)).status).toBe(200);
    const bouncePrefCount = await runInDurableObject<OrganizationStore, number>(
      alphaStub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly count: number }>(
            `SELECT COUNT(*) AS count FROM contact_communication_preferences
             WHERE contact_id = ? AND channel = 'email'`,
            bounceContactId,
          )
          .toArray()[0]?.count ?? -1,
    );
    expect(bouncePrefCount).toBe(1);

    // A mismatched Organization in the webhook body is rejected at the RPC
    // identity gate (not found, no cross-tenant leak): feedback can never
    // cross the Organization boundary.
    const mismatched = await postFeedback({
      ...feedbackBody,
      organizationId: "organization-bravo",
    });
    expect(mismatched.status).toBe(404);
    expect(await mismatched.json()).toMatchObject({ code: "organization_not_found" });
    // An unknown delivery source is rejected rather than resolved by email.
    expect((await postFeedback({ ...feedbackBody, sourceId: crypto.randomUUID() })).status).toBe(
      404,
    );
  });
});
