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

async function deliverQueuedTicketNotification(organizationId: string): Promise<void> {
  const stub = stores.get(stores.idFromName(organizationId));
  const job = await runInDurableObject<OrganizationStore, DeliveryJob>(stub, (_instance, state) => {
    const row = state.storage.sql
      .exec<
        Record<string, SqlStorageValue> & {
          idempotencyKey: string;
          jobId: string;
          kind: DeliveryJob["kind"];
        }
      >(
        `SELECT job_id AS jobId, idempotency_key AS idempotencyKey, kind
           FROM scheduled_job_outbox WHERE kind = 'ticket_notification' AND job_id NOT IN
            (SELECT job_id FROM job_ledger WHERE status = 'completed')
           ORDER BY created_at, job_id LIMIT 1`,
      )
      .one();
    return {
      attempt: 1,
      idempotencyKey: row.idempotencyKey,
      jobId: row.jobId,
      kind: row.kind,
      organizationId,
      version: 1,
    };
  });
  const batch = createMessageBatch("choir-management-jobs-local", [
    { attempts: 1, body: job, id: `ticket-${job.jobId}`, timestamp: new Date() },
  ]);
  await processDeliveryBatch(batch, {
    EXTERNAL_EFFECTS_MODE: "fake",
    ORGANIZATION_FILES: organizationFiles,
    ORGANIZATION_STORE: stores,
    PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
    SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
  });
  expect(await getQueueResult(batch, createExecutionContext())).toMatchObject({
    explicitAcks: [`ticket-${job.jobId}`],
  });
}

beforeEach(async () => {
  await setupOrganizationIntegration(database, stores, {
    displayName: "Communications Manager",
    email: managerEmail,
    organizations: [{ id: "organization-alpha", role: "admin", slug: "alpha" }],
    userId: "communications-manager",
  });
});

afterEach(async () => teardownOrganizationIntegration());

describe("Ticket notifications rendered Communications history", () => {
  it("renders concrete event title at delivery time and persists rendered snapshot without altering template subject", async () => {
    const cookie = await signIn();
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const purchaseId = crypto.randomUUID();
    const notificationId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES (?, 'Earth and Sky and Sea', 'Performance', ?, ?, ?)`,
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
         VALUES (?, ?, ?, 'Earth and Sky and Sea', ?, 'UTC', 'Alice Buyer',
           'alice@example.test', 2, 2500, 100, 5100, 'usd', 'cs_test_1', 'pi_test_1',
           'paid', 1, ?, ?, '[]', '')`,
        purchaseId,
        crypto.randomUUID(),
        eventId,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO ticket_notifications
          (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
           content_markdown, status, scheduled_for, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'confirmation', 'alice@example.test',
           'Tickets confirmed: {eventTitle}',
           'Hello {buyerName},\n\nYour tickets for {eventTitle} are confirmed!\n\n{{TICKET_LINK}}',
           'queued', ?, ?, ?)`,
        notificationId,
        purchaseId,
        eventId,
        `ticket-confirmation:${purchaseId}`,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, 'ticket_notification', ?, ?, ?)`,
        jobId,
        `ticket-notification:${notificationId}`,
        now,
        now,
      );
      return null;
    });

    // Deliver the queued ticket notification
    await deliverQueuedTicketNotification("organization-alpha");

    // Inspect ticket_notifications row directly in DO storage
    const stored = await runInDurableObject<
      OrganizationStore,
      {
        readonly contentMarkdown: string;
        readonly renderedAt: string | null;
        readonly renderedContentMarkdown: string | null;
        readonly renderedSubject: string | null;
        readonly status: string;
        readonly subject: string;
      }
    >(alphaStub, (_instance, state) =>
      state.storage.sql
        .exec<{
          contentMarkdown: string;
          renderedAt: string | null;
          renderedContentMarkdown: string | null;
          renderedSubject: string | null;
          status: string;
          subject: string;
        }>(
          `SELECT subject, content_markdown AS contentMarkdown,
                  rendered_subject AS renderedSubject,
                  rendered_content_markdown AS renderedContentMarkdown,
                  rendered_at AS renderedAt,
                  status
           FROM ticket_notifications WHERE id = ?`,
          notificationId,
        )
        .one(),
    );

    expect(stored.status).toBe("sent");
    // Raw template subject is preserved for provenance
    expect(stored.subject).toBe("Tickets confirmed: {eventTitle}");
    // Persisted rendered subject has concrete event title
    expect(stored.renderedSubject).toBe("Tickets confirmed: Earth and Sky and Sea");
    expect(stored.renderedAt).toBeTruthy();
    // Persisted rendered content markdown has human link text and no signed token URL
    expect(stored.renderedContentMarkdown).toContain(
      "Your tickets for Earth and Sky and Sea are confirmed!",
    );
    expect(stored.renderedContentMarkdown).toContain("[View ticket / QR code](#)");
    expect(stored.renderedContentMarkdown).not.toContain("token=");

    // Query Communications history API
    const historyRes = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/communications/history?origin=automated", cookie),
    );
    expect(historyRes.status).toBe(200);
    const historyPage = communicationHistoryPageResponseSchema.parse(await historyRes.json());
    const ticketItem = historyPage.items.find(
      (item) => item.kind === "automated" && item.scheduledMessage.id === notificationId,
    );
    expect(ticketItem).toBeDefined();
    if (ticketItem?.kind === "automated") {
      expect(ticketItem.scheduledMessage.subject).toBe("Tickets confirmed: Earth and Sky and Sea");
      expect(ticketItem.scheduledMessage.status).toBe("Sent");
    }
  });

  it("renders concrete bundle title for bundle confirmations without placeholder", async () => {
    const cookie = await signIn();
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    const now = new Date().toISOString();
    const purchaseId = crypto.randomUUID();
    const notificationId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           bundle_id, bundle_title, included_events_json,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
           created_at, updated_at)
         VALUES (?, ?, '00000000-0000-4000-8000-000000000001', 'Bundle Concert 1', ?, 'UTC',
           '00000000-0000-4000-8000-000000000002', 'LCC 2026–2027 Season', '[]',
           'Bob BundleBuyer', 'bob@example.test', 1, 10000, 200, 10200, 'usd',
           'cs_test_bundle', 'pi_test_bundle', 'paid', 1, ?, ?)`,
        purchaseId,
        crypto.randomUUID(),
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO ticket_notifications
          (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
           content_markdown, status, scheduled_for, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'confirmation', 'bob@example.test',
           'Ticket bundle confirmed: {ticketBundleName}',
           'Hello {buyerName}, bundle {ticketBundleName} confirmed!\n\n{{TICKET_ORDER_LINK}}',
           'queued', ?, ?, ?)`,
        notificationId,
        purchaseId,
        `ticket-confirmation:${purchaseId}`,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, 'ticket_notification', ?, ?, ?)`,
        jobId,
        `ticket-notification:${notificationId}`,
        now,
        now,
      );
      return null;
    });

    await deliverQueuedTicketNotification("organization-alpha");

    const historyRes = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/communications/history?origin=automated", cookie),
    );
    expect(historyRes.status).toBe(200);
    const historyPage = communicationHistoryPageResponseSchema.parse(await historyRes.json());
    const item = historyPage.items.find(
      (i) => i.kind === "automated" && i.scheduledMessage.id === notificationId,
    );
    expect(item).toBeDefined();
    if (item?.kind === "automated") {
      expect(item.scheduledMessage.subject).toBe("Ticket bundle confirmed: LCC 2026–2027 Season");
      expect(item.scheduledMessage.subject).not.toContain("{ticketBundleName}");
    }
  });

  it("renders concrete concert title for ticket reminders", async () => {
    const cookie = await signIn();
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const purchaseId = crypto.randomUUID();
    const notificationId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES (?, 'Messiah Sing-Along', 'Performance', ?, ?, ?)`,
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
         VALUES (?, ?, ?, 'Messiah Sing-Along', ?, 'UTC', 'Carol Concertgoer',
           'carol@example.test', 1, 2000, 100, 2100, 'usd', 'cs_test_rem', 'pi_test_rem',
           'paid', 1, ?, ?, '[]', '')`,
        purchaseId,
        crypto.randomUUID(),
        eventId,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO ticket_notifications
          (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
           content_markdown, status, scheduled_for, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'reminder', 'carol@example.test',
           'Reminder: {eventTitle}',
           'Concert {eventTitle} starts soon!\n\n{{TICKET_LINK}}',
           'queued', ?, ?, ?)`,
        notificationId,
        purchaseId,
        eventId,
        `ticket-reminder:${purchaseId}`,
        now,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at)
         VALUES (?, 'ticket_notification', ?, ?, ?)`,
        jobId,
        `ticket-notification:${notificationId}`,
        now,
        now,
      );
      return null;
    });

    await deliverQueuedTicketNotification("organization-alpha");

    const historyRes = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/communications/history?origin=automated", cookie),
    );
    expect(historyRes.status).toBe(200);
    const historyPage = communicationHistoryPageResponseSchema.parse(await historyRes.json());
    const item = historyPage.items.find(
      (i) => i.kind === "automated" && i.scheduledMessage.id === notificationId,
    );
    expect(item).toBeDefined();
    if (item?.kind === "automated") {
      expect(item.scheduledMessage.subject).toBe("Reminder: Messiah Sing-Along");
    }
  });

  it("resolves legacy ticket notifications where rendered_subject is NULL using purchase snapshot", async () => {
    const cookie = await signIn();
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const singlePurchaseId = crypto.randomUUID();
    const bundlePurchaseId = crypto.randomUUID();
    const singleNotifId = crypto.randomUUID();
    const bundleNotifId = crypto.randomUUID();

    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      // Event
      state.storage.sql.exec(
        `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
         VALUES (?, 'Earth and Sky and Sea', 'Performance', ?, ?, ?)`,
        eventId,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
      // Single ticket purchase & notification (legacy, rendered_subject is NULL)
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
           created_at, updated_at, included_events_json, bundle_title)
         VALUES (?, ?, ?, 'Earth and Sky and Sea', ?, 'UTC', 'Legacy Single',
           'single@example.test', 1, 2000, 100, 2100, 'usd', 'cs_legacy_1', '',
           'paid', 1, ?, ?, '[]', '')`,
        singlePurchaseId,
        crypto.randomUUID(),
        eventId,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO ticket_notifications
          (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
           content_markdown, status, scheduled_for, created_at, updated_at, sent_at,
           rendered_subject, rendered_content_markdown, rendered_at)
         VALUES (?, ?, ?, 'legacy-single-dedupe', 'confirmation', 'single@example.test',
           'Tickets confirmed: {eventTitle}', 'Legacy body', 'sent', ?, ?, ?, ?,
           NULL, NULL, NULL)`,
        singleNotifId,
        singlePurchaseId,
        eventId,
        now,
        now,
        now,
        now,
      );

      // Bundle purchase & notification (legacy, rendered_subject is NULL)
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           bundle_id, bundle_title, included_events_json,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
           created_at, updated_at)
         VALUES (?, ?, ?, 'Concert', ?, 'UTC',
           'bundle-uuid', '2026–2027 Season', '[]',
           'Legacy Bundle', 'bundle@example.test', 1, 8000, 200, 8200, 'usd',
           'cs_legacy_2', '', 'paid', 1, ?, ?)`,
        bundlePurchaseId,
        crypto.randomUUID(),
        eventId,
        new Date(Date.now() + 86_400_000).toISOString(),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO ticket_notifications
          (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
           content_markdown, status, scheduled_for, created_at, updated_at, sent_at,
           rendered_subject, rendered_content_markdown, rendered_at)
         VALUES (?, ?, NULL, 'legacy-bundle-dedupe', 'confirmation', 'bundle@example.test',
           'Ticket bundle confirmed: {ticketBundleName}', 'Legacy bundle body', 'sent', ?, ?, ?, ?,
           NULL, NULL, NULL)`,
        bundleNotifId,
        bundlePurchaseId,
        now,
        now,
        now,
        now,
      );
      return null;
    });

    const historyRes = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/communications/history?origin=automated", cookie),
    );
    expect(historyRes.status).toBe(200);
    const historyPage = communicationHistoryPageResponseSchema.parse(await historyRes.json());

    const singleItem = historyPage.items.find(
      (i) => i.kind === "automated" && i.scheduledMessage.id === singleNotifId,
    );
    expect(singleItem).toBeDefined();
    if (singleItem?.kind === "automated") {
      expect(singleItem.scheduledMessage.subject).toBe("Tickets confirmed: Earth and Sky and Sea");
    }

    const bundleItem = historyPage.items.find(
      (i) => i.kind === "automated" && i.scheduledMessage.id === bundleNotifId,
    );
    expect(bundleItem).toBeDefined();
    if (bundleItem?.kind === "automated") {
      expect(bundleItem.scheduledMessage.subject).toBe("Ticket bundle confirmed: 2026–2027 Season");
    }
  });
});
