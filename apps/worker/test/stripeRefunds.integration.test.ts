import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { reconcileProviderRefundInStore } from "../src/organization/paymentRefundStore";
import { readTicketNotificationJobFromStore } from "../src/organization/ticketingStore/queries";
import { ticketNotificationJobSchema } from "../src/jobs/deliveries/shared";
import {
  deliverQueuedTicketNotification,
  setupTicketingIntegration,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

interface TicketPurchaseSeed {
  readonly amountPaidCents?: number;
  readonly buyerEmail: string;
  readonly bundleId?: string;
  readonly bundleTitle?: string;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly id: string;
  readonly providerPaymentId?: string;
}

async function seedPaidTicketPurchase(
  organizationId: string,
  purchase: TicketPurchaseSeed,
): Promise<void> {
  const stub = stores.get(stores.idFromName(organizationId));
  await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
    const now = new Date().toISOString();
    const checkoutRequestId = crypto.randomUUID();
    const providerSessionId = `cs_test_${purchase.id}`;
    const providerPaymentId = purchase.providerPaymentId ?? "";
    state.storage.sql.exec(
      `INSERT INTO ticket_purchases
        (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
         bundle_id, bundle_title, buyer_name, buyer_email, quantity, unit_price_cents,
         fee_cents, amount_paid_cents, currency, provider_session_id,
         provider_payment_id, status, marketing_opt_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'America/New_York', ?, ?, 'Refund Buyer', ?, 2, ?, 0, ?,
         'usd', ?, ?, 'paid', 0, ?, ?)`,
      purchase.id,
      checkoutRequestId,
      purchase.eventId,
      purchase.eventTitle,
      new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      purchase.bundleId ?? null,
      purchase.bundleTitle ?? "",
      purchase.buyerEmail,
      purchase.amountPaidCents ?? 2_500,
      purchase.amountPaidCents ?? 2_500,
      providerSessionId,
      providerPaymentId,
      now,
      now,
    );
    if (providerPaymentId) {
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at)
         VALUES (?, 'ticket', ?, ?, ?, ?, 'paid', ?, ?, ?)`,
        crypto.randomUUID(),
        purchase.id,
        checkoutRequestId,
        providerSessionId,
        providerPaymentId,
        purchase.amountPaidCents ?? 2_500,
        now,
        now,
      );
    }
  });
}

beforeEach(async () => setupTicketingIntegration());
afterEach(async () => teardownTicketingIntegration());

describe("Organization Stripe refund reconciliation", () => {
  it("reconciles ticket refund by provider payment ID fallback", async () => {
    const orgId = "organization-alpha";
    const stub = stores.get(stores.idFromName(orgId));

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
           created_at, updated_at)
         VALUES
          ('pur-fallback-1', 'req-fallback-1', 'ev-1', 'Concert Title', '2026-10-01T20:00:00Z', 'America/New_York',
           'Fallback Buyer', 'buyer@example.test', 1, 2000, 0, 2000,
           'usd', 'cs_fallback_1', 'pi_fallback_ticket', 'paid', 0,
           ?, ?)`,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at)
         VALUES
          ('pa-fallback-1', 'ticket', 'pur-fallback-1', 'req-fallback-1', 'cs_fallback_1',
           'pi_fallback_ticket', 'paid', 2000, ?, ?)`,
        now,
        now,
      );
    });

    const response = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: orgId,
          providerPaymentId: "pi_fallback_ticket",
          stripeEventId: "evt_fallback_ticket_1",
        }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ refunded: 1 });

    const status = await runInDurableObject<OrganizationStore, string>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM ticket_purchases WHERE id = 'pur-fallback-1' LIMIT 1",
          )
          .one().status,
    );
    expect(status).toBe("refunded");

    // Replaying duplicate event returns duplicate: true
    const replayResponse = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: orgId,
          providerPaymentId: "pi_fallback_ticket",
          stripeEventId: "evt_fallback_ticket_1",
        }),
    );
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toEqual({ duplicate: true, refunded: 0 });
  });

  it("queues a Stripe refund email only after webhook reconciliation and delivers it once", async () => {
    const orgId = "organization-alpha";
    const stub = stores.get(stores.idFromName(orgId));
    const purchaseId = crypto.randomUUID();
    const providerPaymentId = `pi_${crypto.randomUUID()}`;
    await seedPaidTicketPurchase(orgId, {
      buyerEmail: "refund-buyer@example.test",
      eventId: crypto.randomUUID(),
      eventTitle: "Refund Concert",
      id: purchaseId,
      providerPaymentId,
    });

    const distantFutureAlarm = Date.now() + 60 * 60 * 1_000;
    await runInDurableObject<OrganizationStore, undefined>(stub, async (_instance, state) => {
      await state.storage.setAlarm(distantFutureAlarm);
      return undefined;
    });
    const refundRequest = await stub.fetch(
      "https://organization.internal/internal/payments/refund-request",
      {
        body: JSON.stringify({
          action: "record_provider_refund_requested",
          actorUserId: "ticket-manager",
          organizationId: orgId,
          paymentType: "ticket",
          requestId: crypto.randomUUID(),
          resourceId: purchaseId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(refundRequest.status).toBe(200);
    const beforeWebhook = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ?",
            purchaseId,
          )
          .one().count,
    );
    expect(beforeWebhook).toBe(0);

    const stripeEventId = `evt_${crypto.randomUUID()}`;
    const refundResponse = await stub.fetch(
      "https://organization.internal/internal/payments/manage",
      {
        body: JSON.stringify({
          action: "reconcile_provider_refund",
          organizationId: orgId,
          providerPaymentId,
          stripeEventId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(refundResponse.status).toBe(200);
    expect(await refundResponse.json()).toEqual({ refunded: 1 });

    const queuedState = await runInDurableObject<
      OrganizationStore,
      {
        alarm: number | null;
        dedupeKey: string;
        contentMarkdown: string;
        kind: string;
        notificationCount: number;
        outboxCount: number;
      }
    >(stub, async (_instance, state) => {
      const alarm = await state.storage.getAlarm();
      const notification = state.storage.sql
        .exec<{
          readonly contentMarkdown: string;
          readonly dedupeKey: string;
          readonly kind: string;
        }>(
          `SELECT dedupe_key AS dedupeKey, kind, content_markdown AS contentMarkdown
           FROM ticket_notifications WHERE purchase_id = ?`,
          purchaseId,
        )
        .one();
      const notificationCount = state.storage.sql
        .exec<{ readonly count: number }>(
          "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ?",
          purchaseId,
        )
        .one().count;
      const outboxCount = state.storage.sql
        .exec<{ readonly count: number }>(
          "SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE idempotency_key = ?",
          `ticket-notification:${
            state.storage.sql
              .exec<{ readonly id: string }>(
                "SELECT id FROM ticket_notifications WHERE purchase_id = ?",
                purchaseId,
              )
              .one().id
          }`,
        )
        .one().count;
      return {
        alarm,
        contentMarkdown: notification.contentMarkdown,
        dedupeKey: notification.dedupeKey,
        kind: notification.kind,
        notificationCount,
        outboxCount,
      };
    });
    expect(queuedState).toMatchObject({
      dedupeKey: `ticket-refund:${purchaseId}`,
      kind: "refund",
      notificationCount: 1,
      outboxCount: 1,
    });
    expect(queuedState.alarm).not.toBeNull();
    expect(queuedState.alarm).toBeLessThan(distantFutureAlarm);
    expect(queuedState.contentMarkdown).toContain("Refund amount:** $25.00");
    expect(queuedState.contentMarkdown).toContain(
      "Review your order details and refund status using the link below:",
    );
    expect(queuedState.contentMarkdown).toContain(
      "The order link above shows the refund status; refunded tickets cannot be used for admission.",
    );
    expect(queuedState.contentMarkdown).toContain("{{TICKET_ORDER_LINK}}");
    expect(queuedState.contentMarkdown).not.toContain("{refundAmount}");
    expect(queuedState.contentMarkdown).not.toContain("{refundDate}");
    expect(queuedState.contentMarkdown).not.toContain("{{TICKET_LINK}}");

    const replay = await stub.fetch("https://organization.internal/internal/payments/manage", {
      body: JSON.stringify({
        action: "reconcile_provider_refund",
        organizationId: orgId,
        providerPaymentId,
        stripeEventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(await replay.json()).toEqual({ duplicate: true, refunded: 0 });

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const jobId = await runInDurableObject<OrganizationStore, string>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly jobId: string }>(
            `SELECT job_id AS jobId FROM scheduled_job_outbox
           WHERE kind = 'ticket_notification' AND idempotency_key =
             'ticket-notification:' || (SELECT id FROM ticket_notifications WHERE purchase_id = ?)
           LIMIT 1`,
            purchaseId,
          )
          .one().jobId,
    );
    const notificationResponse = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) => readTicketNotificationJobFromStore(state.storage, orgId, jobId),
    );
    const notification = ticketNotificationJobSchema.parse(await notificationResponse.json());
    expect(notification).toMatchObject({
      amountPaidCents: 2_500,
      buyerName: "Refund Buyer",
      destination: "refund-buyer@example.test",
      eventTitle: "Refund Concert",
      kind: "refund",
      refundDate: expect.any(String),
    });
    expect(notification.contentMarkdown).toContain("$25.00");
    expect(notification.contentMarkdown).toContain("Refund processed:**");
    expect(notification.contentMarkdown).toContain(
      "Review your order details and refund status using the link below:",
    );
    expect(notification.contentMarkdown).toContain(
      "The order link above shows the refund status; refunded tickets cannot be used for admission.",
    );
    expect(notification.contentMarkdown).toContain("{{TICKET_ORDER_LINK}}");
    expect(notification.contentMarkdown).not.toContain("{refundAmount}");
    expect(notification.contentMarkdown).not.toContain("{refundDate}");
    expect(notification.contentMarkdown).not.toMatch(/qr code/i);

    await deliverQueuedTicketNotification(orgId);
    const completedState = await runInDurableObject<
      OrganizationStore,
      { notificationStatus: string; purchaseStatus: string; notificationCount: number }
    >(stub, (_instance, state) => {
      const notification = state.storage.sql
        .exec<{ readonly status: string }>(
          "SELECT status FROM ticket_notifications WHERE purchase_id = ?",
          purchaseId,
        )
        .one();
      const purchase = state.storage.sql
        .exec<{ readonly status: string }>(
          "SELECT status FROM ticket_purchases WHERE id = ?",
          purchaseId,
        )
        .one();
      const count = state.storage.sql
        .exec<{ readonly count: number }>(
          "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ?",
          purchaseId,
        )
        .one().count;
      return {
        notificationCount: count,
        notificationStatus: notification.status,
        purchaseStatus: purchase.status,
      };
    });
    expect(completedState).toEqual({
      notificationCount: 1,
      notificationStatus: "sent",
      purchaseStatus: "refunded",
    });
  });

  it("queues fake refunds immediately and skips invalid buyer emails without blocking the refund", async () => {
    const orgId = "organization-alpha";
    const stub = stores.get(stores.idFromName(orgId));
    const purchaseId = crypto.randomUUID();
    await seedPaidTicketPurchase(orgId, {
      buyerEmail: "not-an-email",
      eventId: crypto.randomUUID(),
      eventTitle: "Fake Refund Concert",
      id: purchaseId,
    });

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) =>
      state.storage.deleteAlarm().then(() => undefined),
    );
    const refundRequestId = crypto.randomUUID();
    const refundResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "refund_fake_purchase",
          actorUserId: "ticket-manager",
          organizationId: orgId,
          purchaseId,
          requestId: refundRequestId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(refundResponse.status).toBe(200);
    expect(await refundResponse.json()).toMatchObject({ id: purchaseId, status: "refunded" });

    const skippedState = await runInDurableObject<
      OrganizationStore,
      {
        alarm: number | null;
        notificationCount: number;
        outboxCount: number;
        purchaseStatus: string;
        skippedAuditCount: number;
      }
    >(stub, async (_instance, state) => {
      const alarm = await state.storage.getAlarm();
      const notificationCount = state.storage.sql
        .exec<{ readonly count: number }>(
          "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ?",
          purchaseId,
        )
        .one().count;
      const outboxCount = state.storage.sql
        .exec<{ readonly count: number }>(
          "SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE kind = 'ticket_notification'",
        )
        .one().count;
      const purchaseStatus = state.storage.sql
        .exec<{ readonly status: string }>(
          "SELECT status FROM ticket_purchases WHERE id = ?",
          purchaseId,
        )
        .one().status;
      const skippedAuditCount = state.storage.sql
        .exec<{ readonly count: number }>(
          `SELECT COUNT(*) AS count FROM audit_events
           WHERE target_id = ? AND action = 'ticket.refund.notification.skipped'`,
          purchaseId,
        )
        .one().count;
      return { alarm, notificationCount, outboxCount, purchaseStatus, skippedAuditCount };
    });
    expect(skippedState).toEqual({
      alarm: null,
      notificationCount: 0,
      outboxCount: 0,
      purchaseStatus: "refunded",
      skippedAuditCount: 1,
    });
  });

  it("uses the bundle refund system template and includes the allocated performances", async () => {
    const orgId = "organization-alpha";
    const stub = stores.get(stores.idFromName(orgId));
    const purchaseId = crypto.randomUUID();
    const bundleId = crypto.randomUUID();
    const eventIds = [crypto.randomUUID(), crypto.randomUUID()];
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      for (const [index, eventId] of eventIds.entries()) {
        state.storage.sql.exec(
          `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
           VALUES (?, ?, 'Performance', ?, ?, ?)`,
          eventId,
          `Bundle Performance ${String(index + 1)}`,
          new Date(Date.now() + (index + 1) * 24 * 60 * 60 * 1_000).toISOString(),
          now,
          now,
        );
      }
      state.storage.sql.exec(
        `INSERT INTO ticket_bundles
          (id, title, price_cents, sale_end_at, is_active, created_at, updated_at)
         VALUES (?, 'Spring Bundle', 3000, ?, 1, ?, ?)`,
        bundleId,
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
        now,
        now,
      );
      return undefined;
    });
    await seedPaidTicketPurchase(orgId, {
      amountPaidCents: 3_000,
      buyerEmail: "bundle-buyer@example.test",
      bundleId,
      bundleTitle: "Spring Bundle",
      eventId: eventIds[0] ?? crypto.randomUUID(),
      eventTitle: "Bundle Performance 1",
      id: purchaseId,
    });
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      for (const eventId of eventIds) {
        state.storage.sql.exec(
          `INSERT INTO ticket_bundle_allocations (purchase_id, event_id, quantity)
           VALUES (?, ?, 2)`,
          purchaseId,
          eventId,
        );
      }
    });

    const refundResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "refund_fake_purchase",
          actorUserId: "ticket-manager",
          organizationId: orgId,
          purchaseId,
          requestId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(refundResponse.status).toBe(200);
    const notificationJobId = await runInDurableObject<OrganizationStore, string>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly jobId: string }>(
            `SELECT job_id AS jobId FROM scheduled_job_outbox
             WHERE idempotency_key = 'ticket-notification:' ||
               (SELECT id FROM ticket_notifications WHERE purchase_id = ?)
             LIMIT 1`,
            purchaseId,
          )
          .one().jobId,
    );
    const notificationResponse = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        readTicketNotificationJobFromStore(state.storage, orgId, notificationJobId),
    );
    const notification = ticketNotificationJobSchema.parse(await notificationResponse.json());
    expect(notification).toMatchObject({
      bundleTitle: "Spring Bundle",
      kind: "refund",
    });
    expect(notification.contentMarkdown).toContain("{{TICKET_EVENT_LIST}}");
    expect(notification.contentMarkdown).toContain("$30.00");
    expect(notification.bundleEvents.map((event) => event.title)).toEqual([
      "Bundle Performance 1",
      "Bundle Performance 2",
    ]);
  });

  it("reconciles donation refund by provider payment ID fallback", async () => {
    const orgId = "organization-alpha";
    const stub = stores.get(stores.idFromName(orgId));

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO donations
          (id, buyer_name, buyer_email, amount_cents, fee_cents, anonymous,
           tribute_type, tribute_name, tribute_notify_email, checkout_request_id,
           provider_session_id, provider_payment_id, status, created_at, updated_at)
         VALUES
          ('don-fallback-1', 'Donor Fallback', 'donor@example.test', 5000, 0, 0,
           'none', '', '', 'req-don-1',
           'cs_don_1', 'pi_fallback_donation', 'paid', ?, ?)`,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           provider_payment_id, status, amount_cents, created_at, updated_at)
         VALUES
          ('pa-don-1', 'donation', 'don-fallback-1', 'req-don-1', 'cs_don_1',
           'pi_fallback_donation', 'paid', 5000, ?, ?)`,
        now,
        now,
      );
    });

    const response = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: orgId,
          providerPaymentId: "pi_fallback_donation",
          stripeEventId: "evt_fallback_donation_1",
        }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ refunded: 1 });

    const status = await runInDurableObject<OrganizationStore, string>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM donations WHERE id = 'don-fallback-1' LIMIT 1",
          )
          .one().status,
    );
    expect(status).toBe("refunded");
  });

  it("fails closed when multiple payment domains match the provider payment ID", async () => {
    const orgId = "organization-alpha";
    const stub = stores.get(stores.idFromName(orgId));

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      const duplicatePi = "pi_duplicate_shared";
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           currency, provider_session_id, provider_payment_id, status, marketing_opt_in,
           created_at, updated_at)
         VALUES
          ('pur-ambig-1', 'req-ambig-1', 'ev-1', 'Concert Title', '2026-10-01T20:00:00Z', 'America/New_York',
           'Ambig Buyer', 'buyer@example.test', 1, 2000, 0, 2000,
           'usd', 'cs_ambig_1', ?, 'paid', 0,
           ?, ?)`,
        duplicatePi,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO donations
          (id, buyer_name, buyer_email, amount_cents, fee_cents, anonymous,
           tribute_type, tribute_name, tribute_notify_email, checkout_request_id,
           provider_session_id, provider_payment_id, status, created_at, updated_at)
         VALUES
          ('don-ambig-1', 'Donor Ambig', 'donor@example.test', 2000, 0, 0,
           'none', '', '', 'req-ambig-2',
           'cs_ambig_2', ?, 'paid', ?, ?)`,
        duplicatePi,
        now,
        now,
      );
    });

    const response = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: orgId,
          providerPaymentId: "pi_duplicate_shared",
          stripeEventId: "evt_ambiguous_1",
        }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ambiguous_payment_refund" });
  });

  it("returns 404 when no matching payment is found", async () => {
    const orgId = "organization-alpha";
    const stub = stores.get(stores.idFromName(orgId));

    const response = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: orgId,
          providerPaymentId: "pi_nonexistent",
          stripeEventId: "evt_missing_1",
        }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "payment_not_found" });
  });

  it("fails closed on organization identity mismatch", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));

    const response = await runInDurableObject<OrganizationStore, Response>(
      stub,
      (_instance, state) =>
        reconcileProviderRefundInStore(state.storage, {
          action: "reconcile_provider_refund",
          organizationId: "organization-bravo",
          providerPaymentId: "pi_some_payment",
          stripeEventId: "evt_wrong_org_1",
        }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "organization_identity_conflict" });
  });
});
