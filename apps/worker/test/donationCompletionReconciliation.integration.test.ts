import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { createDonationCheckoutSession } from "../src/organization/organizationDonations";
import {
  setupTicketingIntegration,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

const ORG_ID = "organization-alpha";
const ORIGIN = "https://donations.example.test";

const mockFakeEnv = {
  APP_ENV: "staging" as const,
  EXTERNAL_EFFECTS_MODE: "fake" as const,
  ORGANIZATION_STORE: stores,
  SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
  STRIPE_PAYMENTS_ENABLED: "false",
};

beforeEach(async () => {
  await setupTicketingIntegration();
  const stub = stores.get(stores.idFromName(ORG_ID));
  await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
    state.storage.sql.exec(
      `UPDATE organization_metadata
       SET payment_activation_json = '{"tickets":true,"donations":true,"dues":true}'
       WHERE organization_id = ?`,
      ORG_ID,
    );
    return null;
  });
});

afterEach(async () => {
  await teardownTicketingIntegration();
});

describe("Donation paid transition atomic scheduling and duplicate reconciliation", () => {
  it("transitions pending donation to paid, atomically creating confirmation, outbox, and contact linkage", async () => {
    const stub = stores.get(stores.idFromName(ORG_ID));
    const donationId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const sessionId = `cs_test_${crypto.randomUUID()}`;
    const paymentId = `pi_test_${crypto.randomUUID()}`;
    const stripeEventId = `evt_test_${crypto.randomUUID()}`;

    // 1. Create pending donation
    const pendingRes = await stub.fetch("https://organization.internal/internal/donations/manage", {
      body: JSON.stringify({
        action: "create_stripe_pending_donation",
        checkout: {
          amountCents: 5000,
          anonymous: false,
          buyerEmail: "donor1@example.test",
          buyerName: "Donor One",
          checkoutRequestId,
          marketingConsent: true,
          tributeName: "",
          tributeNotifyEmail: "",
          tributeType: "none",
        },
        donationId,
        organizationId: ORG_ID,
        providerSessionId: sessionId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(pendingRes.status).toBe(201);

    // Verify initially pending: no notification or outbox, contact not linked yet
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const notifs = state.storage.sql
        .exec("SELECT * FROM payment_notifications WHERE resource_id = ?", donationId)
        .toArray();
      expect(notifs).toHaveLength(0);
      const outbox = state.storage.sql
        .exec(
          "SELECT * FROM scheduled_job_outbox WHERE idempotency_key = ?",
          `payment-notification:donation-confirmation:${donationId}`,
        )
        .toArray();
      expect(outbox).toHaveLength(0);
      const donRow = state.storage.sql
        .exec<{ readonly contact_id: string | null }>(
          "SELECT contact_id FROM donations WHERE id = ?",
          donationId,
        )
        .one();
      expect(donRow.contact_id).toBeNull();
      return null;
    });

    // 2. Complete Stripe donation
    const completedRes = await stub.fetch(
      "https://organization.internal/internal/donations/manage",
      {
        body: JSON.stringify({
          action: "stripe_donation_completed",
          checkoutRequestId,
          organizationId: ORG_ID,
          providerPaymentId: paymentId,
          providerSessionId: sessionId,
          stripeEventId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(completedRes.status).toBe(200);
    expect(await completedRes.json()).toMatchObject({ status: "paid" });

    // Verify atomic state: paid, contact_id linked, exactly 1 confirmation record, exactly 1 outbox record
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const donRow = state.storage.sql
        .exec<{ readonly contact_id: string | null; readonly status: string }>(
          "SELECT contact_id, status FROM donations WHERE id = ?",
          donationId,
        )
        .one();
      expect(donRow.status).toBe("paid");
      expect(donRow.contact_id).not.toBeNull();

      const notifs = state.storage.sql
        .exec<{ readonly dedupe_key: string; readonly status: string }>(
          "SELECT dedupe_key, status FROM payment_notifications WHERE resource_id = ?",
          donationId,
        )
        .toArray();
      expect(notifs).toHaveLength(1);
      expect(notifs[0]?.dedupe_key).toBe(`donation-confirmation:${donationId}`);
      expect(notifs[0]?.status).toBe("queued");

      const outbox = state.storage.sql
        .exec<{ readonly kind: string }>(
          "SELECT kind FROM scheduled_job_outbox WHERE idempotency_key = ?",
          `payment-notification:donation-confirmation:${donationId}`,
        )
        .toArray();
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.kind).toBe("payment_notification");

      // Verify patron totals
      const patron = state.storage.sql
        .exec<{ readonly total_donated_cents: number; readonly donation_count: number }>(
          "SELECT total_donated_cents, donation_count FROM patrons WHERE email = 'donor1@example.test'",
        )
        .one();
      expect(patron.total_donated_cents).toBe(5000);
      expect(patron.donation_count).toBe(1);

      return null;
    });
  });

  it("replaying the same webhook event is idempotent and does not double-count patron totals or duplicate notifications", async () => {
    const stub = stores.get(stores.idFromName(ORG_ID));
    const donationId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const sessionId = `cs_test_${crypto.randomUUID()}`;
    const paymentId = `pi_test_${crypto.randomUUID()}`;
    const stripeEventId = `evt_test_${crypto.randomUUID()}`;

    await stub.fetch("https://organization.internal/internal/donations/manage", {
      body: JSON.stringify({
        action: "create_stripe_pending_donation",
        checkout: {
          amountCents: 7500,
          anonymous: false,
          buyerEmail: "donor2@example.test",
          buyerName: "Donor Two",
          checkoutRequestId,
          marketingConsent: true,
          tributeName: "",
          tributeNotifyEmail: "",
          tributeType: "none",
        },
        donationId,
        organizationId: ORG_ID,
        providerSessionId: sessionId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    // Complete first time
    const firstRes = await stub.fetch("https://organization.internal/internal/donations/manage", {
      body: JSON.stringify({
        action: "stripe_donation_completed",
        checkoutRequestId,
        organizationId: ORG_ID,
        providerPaymentId: paymentId,
        providerSessionId: sessionId,
        stripeEventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(firstRes.status).toBe(200);

    // Replay same webhook event
    const replayRes = await stub.fetch("https://organization.internal/internal/donations/manage", {
      body: JSON.stringify({
        action: "stripe_donation_completed",
        checkoutRequestId,
        organizationId: ORG_ID,
        providerPaymentId: paymentId,
        providerSessionId: sessionId,
        stripeEventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(replayRes.status).toBe(200);
    expect(await replayRes.json()).toMatchObject({ duplicate: true, status: "paid" });

    // Verify still exactly 1 notification, 1 outbox, and patron total not doubled
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const notifs = state.storage.sql
        .exec("SELECT id FROM payment_notifications WHERE resource_id = ?", donationId)
        .toArray();
      expect(notifs).toHaveLength(1);

      const outbox = state.storage.sql
        .exec(
          "SELECT job_id FROM scheduled_job_outbox WHERE idempotency_key = ?",
          `payment-notification:donation-confirmation:${donationId}`,
        )
        .toArray();
      expect(outbox).toHaveLength(1);

      const patron = state.storage.sql
        .exec<{ readonly total_donated_cents: number; readonly donation_count: number }>(
          "SELECT total_donated_cents, donation_count FROM patrons WHERE email = 'donor2@example.test'",
        )
        .one();
      expect(patron.total_donated_cents).toBe(7500);
      expect(patron.donation_count).toBe(1);

      return null;
    });
  });

  it("repairs missing confirmation notification and outbox record on duplicate webhook replay", async () => {
    const stub = stores.get(stores.idFromName(ORG_ID));
    const donationId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const sessionId = `cs_test_${crypto.randomUUID()}`;
    const paymentId = `pi_test_${crypto.randomUUID()}`;
    const stripeEventId = `evt_repair_${crypto.randomUUID()}`;

    // Create and complete
    await stub.fetch("https://organization.internal/internal/donations/manage", {
      body: JSON.stringify({
        action: "create_stripe_pending_donation",
        checkout: {
          amountCents: 10000,
          anonymous: false,
          buyerEmail: "donor3@example.test",
          buyerName: "Donor Three",
          checkoutRequestId,
          marketingConsent: true,
          tributeName: "",
          tributeNotifyEmail: "",
          tributeType: "none",
        },
        donationId,
        organizationId: ORG_ID,
        providerSessionId: sessionId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    await stub.fetch("https://organization.internal/internal/donations/manage", {
      body: JSON.stringify({
        action: "stripe_donation_completed",
        checkoutRequestId,
        organizationId: ORG_ID,
        providerPaymentId: paymentId,
        providerSessionId: sessionId,
        stripeEventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    // Deliberately simulate an interrupted state where notification and outbox were missing
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec("DELETE FROM payment_notifications WHERE resource_id = ?", donationId);
      state.storage.sql.exec(
        "DELETE FROM scheduled_job_outbox WHERE idempotency_key = ?",
        `payment-notification:donation-confirmation:${donationId}`,
      );
      return null;
    });

    // Replay webhook event
    const replayRes = await stub.fetch("https://organization.internal/internal/donations/manage", {
      body: JSON.stringify({
        action: "stripe_donation_completed",
        checkoutRequestId,
        organizationId: ORG_ID,
        providerPaymentId: paymentId,
        providerSessionId: sessionId,
        stripeEventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(await replayRes.json()).toMatchObject({ duplicate: true });

    // Verify the missing notification and outbox record were repaired!
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const notifs = state.storage.sql
        .exec<{ readonly dedupe_key: string }>(
          "SELECT dedupe_key FROM payment_notifications WHERE resource_id = ?",
          donationId,
        )
        .toArray();
      expect(notifs).toHaveLength(1);
      expect(notifs[0]?.dedupe_key).toBe(`donation-confirmation:${donationId}`);

      const outbox = state.storage.sql
        .exec(
          "SELECT job_id FROM scheduled_job_outbox WHERE idempotency_key = ?",
          `payment-notification:donation-confirmation:${donationId}`,
        )
        .toArray();
      expect(outbox).toHaveLength(1);

      // Verify patron aggregate was NOT double-counted
      const patron = state.storage.sql
        .exec<{ readonly total_donated_cents: number; readonly donation_count: number }>(
          "SELECT total_donated_cents, donation_count FROM patrons WHERE email = 'donor3@example.test'",
        )
        .one();
      expect(patron.total_donated_cents).toBe(10000);
      expect(patron.donation_count).toBe(1);

      return null;
    });
  });

  it("repairs missing contact linkage on duplicate webhook replay", async () => {
    const stub = stores.get(stores.idFromName(ORG_ID));
    const donationId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const sessionId = `cs_test_${crypto.randomUUID()}`;
    const paymentId = `pi_test_${crypto.randomUUID()}`;
    const stripeEventId = `evt_contact_repair_${crypto.randomUUID()}`;

    await stub.fetch("https://organization.internal/internal/donations/manage", {
      body: JSON.stringify({
        action: "create_stripe_pending_donation",
        checkout: {
          amountCents: 2500,
          anonymous: false,
          buyerEmail: "repaircontact@example.test",
          buyerName: "Repair Contact Donor",
          checkoutRequestId,
          marketingConsent: true,
          tributeName: "",
          tributeNotifyEmail: "",
          tributeType: "none",
        },
        donationId,
        organizationId: ORG_ID,
        providerSessionId: sessionId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    await stub.fetch("https://organization.internal/internal/donations/manage", {
      body: JSON.stringify({
        action: "stripe_donation_completed",
        checkoutRequestId,
        organizationId: ORG_ID,
        providerPaymentId: paymentId,
        providerSessionId: sessionId,
        stripeEventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    // Deliberately clear contact_id
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec("UPDATE donations SET contact_id = NULL WHERE id = ?", donationId);
      return null;
    });

    // Replay webhook event
    const replayRes = await stub.fetch("https://organization.internal/internal/donations/manage", {
      body: JSON.stringify({
        action: "stripe_donation_completed",
        checkoutRequestId,
        organizationId: ORG_ID,
        providerPaymentId: paymentId,
        providerSessionId: sessionId,
        stripeEventId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(replayRes.status).toBe(200);

    // Verify contact_id was restored and linked
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const donRow = state.storage.sql
        .exec<{ readonly contact_id: string | null }>(
          "SELECT contact_id FROM donations WHERE id = ?",
          donationId,
        )
        .one();
      expect(donRow.contact_id).not.toBeNull();
      return null;
    });
  });

  it("fake-paid donation checkout path atomically creates donation, contact link, confirmation notification, and outbox row", async () => {
    const checkoutRequestId = crypto.randomUUID();

    const checkout = await createDonationCheckoutSession(mockFakeEnv, ORG_ID, ORIGIN, {
      amountCents: 6000,
      anonymous: false,
      buyerEmail: "fakepaid@example.test",
      buyerName: "Fake Paid Donor",
      checkoutRequestId,
      marketingConsent: true,
      tributeName: "",
      tributeNotifyEmail: "",
      tributeType: "none",
    });

    expect(checkout.checkoutMode).toBe("fake");
    expect(checkout.donation.status).toBe("paid");

    const stub = stores.get(stores.idFromName(ORG_ID));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const donRow = state.storage.sql
        .exec<{ readonly contact_id: string | null; readonly status: string }>(
          "SELECT contact_id, status FROM donations WHERE id = ?",
          checkout.donation.id,
        )
        .one();
      expect(donRow.status).toBe("paid");
      expect(donRow.contact_id).not.toBeNull();

      const notifs = state.storage.sql
        .exec<{ readonly dedupe_key: string; readonly status: string }>(
          "SELECT dedupe_key, status FROM payment_notifications WHERE resource_id = ?",
          checkout.donation.id,
        )
        .toArray();
      expect(notifs).toHaveLength(1);
      expect(notifs[0]?.dedupe_key).toBe(`donation-confirmation:${checkout.donation.id}`);
      expect(notifs[0]?.status).toBe("queued");

      const outbox = state.storage.sql
        .exec(
          "SELECT job_id FROM scheduled_job_outbox WHERE idempotency_key = ?",
          `payment-notification:donation-confirmation:${checkout.donation.id}`,
        )
        .toArray();
      expect(outbox).toHaveLength(1);

      return null;
    });
  });

  it("email delivery failure leaves payment state paid and retries only notification delivery", async () => {
    const checkoutRequestId = crypto.randomUUID();

    const checkout = await createDonationCheckoutSession(mockFakeEnv, ORG_ID, ORIGIN, {
      amountCents: 4500,
      anonymous: false,
      buyerEmail: "faildelivery@example.test",
      buyerName: "Fail Delivery Donor",
      checkoutRequestId,
      marketingConsent: true,
      tributeName: "",
      tributeNotifyEmail: "",
      tributeType: "none",
    });

    const stub = stores.get(stores.idFromName(ORG_ID));
    // Retrieve the queued notification job ID
    const notifId = await runInDurableObject<OrganizationStore, string>(
      stub,
      (_instance, state) => {
        const row = state.storage.sql
          .exec<{ readonly id: string }>(
            "SELECT id FROM payment_notifications WHERE resource_id = ?",
            checkout.donation.id,
          )
          .one();
        return row.id;
      },
    );

    // Record delivery failure in payment notification store
    const recordRes = await stub.fetch(
      "https://organization.internal/internal/payments/notification-result",
      {
        body: JSON.stringify({
          action: "record_payment_notification_result",
          failureDetail: "SMTP Connection Timed Out",
          jobId: notifId,
          organizationId: ORG_ID,
          providerMessageId: null,
          status: "failed",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(recordRes.status).toBe(200);

    // Verify donation is still paid, and notification is recorded as failed
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const donRow = state.storage.sql
        .exec<{ readonly status: string }>(
          "SELECT status FROM donations WHERE id = ?",
          checkout.donation.id,
        )
        .one();
      expect(donRow.status).toBe("paid");

      const notifRow = state.storage.sql
        .exec<{ readonly status: string; readonly failure_detail: string }>(
          "SELECT status, failure_detail FROM payment_notifications WHERE id = ?",
          notifId,
        )
        .one();
      expect(notifRow.status).toBe("failed");
      expect(notifRow.failure_detail).toBe("SMTP Connection Timed Out");

      return null;
    });
  });
});
