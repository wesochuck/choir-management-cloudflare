import { donationCheckoutResponseSchema, donationResponseSchema } from "@choir/contracts";
import { Hono } from "hono";
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { seedAuthUser } from "@choir/testkit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../src/env";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { handleStripeWebhook } from "../src/payments/stripeWebhookHandler";
import { stripeSignatureForTest } from "../src/payments/stripeWebhook";
import { upsertStripeAccountOrganization } from "../src/payments/stripeRouting";
import {
  setupTicketingIntegration,
  teardownTicketingIntegration,
  stores,
  database,
  api,
  jsonWrite,
  signIn,
} from "./ticketing.integration.fixture";

const ORG_ID = "organization-alpha";
const PUBLIC_HOST = "tickets.example.test";

const ORDINARY_USER_ID = "ordinary-member-user";
const ORDINARY_USER_EMAIL = "ordinary.singer@example.test";
const ORDINARY_PROFILE_ID = "55555555-5555-4555-8555-555555555555";

beforeEach(async () => {
  await setupTicketingIntegration();
});

afterEach(async () => {
  await teardownTicketingIntegration();
});

async function setupOptedInMember(options: {
  readonly optIn: boolean;
  readonly role?: "member" | "admin";
}) {
  const cookie = await signIn();

  // Publish website so public host is active
  await exports.default.fetch(
    api("alpha.localhost", "/api/organization/website/publish", cookie, { method: "POST" }),
  );

  // Activate payments in organization metadata
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

  // Setup ordinary user in D1 and profile in DO
  const now = new Date().toISOString();
  await seedAuthUser(database, ORDINARY_USER_ID, ORDINARY_USER_EMAIL, "Ordinary Singer");
  await database
    .prepare(
      `INSERT OR REPLACE INTO member (id, organizationId, userId, role, profileId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `member-${ORDINARY_USER_ID}`,
      ORG_ID,
      ORDINARY_USER_ID,
      options.role ?? "member",
      ORDINARY_PROFILE_ID,
      now,
    )
    .run();

  await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
    state.storage.sql.exec(
      `INSERT OR REPLACE INTO profiles
        (id, display_name, voice_part, global_status, do_not_email, provider_email_suppressed,
         receive_financial_alerts, created_at, updated_at)
       VALUES (?, 'Ordinary Singer', 'S1', 'Active', 0, 0, ?, ?, ?)`,
      ORDINARY_PROFILE_ID,
      options.optIn ? 1 : 0,
      now,
      now,
    );
    return null;
  });

  return { cookie };
}

describe("Donation Alerts integration", () => {
  it("queues donation receipt alert to member subscribed to finance on public donation checkout", async () => {
    await setupOptedInMember({ optIn: true });

    const checkoutRequestId = crypto.randomUUID();
    const checkoutResponse = await jsonWrite(
      PUBLIC_HOST,
      "/api/public/donations/checkout",
      "POST",
      {
        amountCents: 7500,
        anonymous: false,
        buyerEmail: "generous.donor@example.test",
        buyerName: "Generous Donor",
        checkoutRequestId,
        marketingConsent: false,
        tributeName: "Beloved Singer",
        tributeType: "honor",
      },
    );
    expect(checkoutResponse.status).toBe(201);
    const checkout = donationCheckoutResponseSchema.parse(await checkoutResponse.json());

    // Check DO communication messages and deliveries
    const stub = stores.get(stores.idFromName(ORG_ID));
    const alertMessage = await runInDurableObject<
      OrganizationStore,
      {
        readonly content: string;
        readonly dedupeKey: string;
        readonly destination: string;
        readonly subject: string;
      } | null
    >(stub, (_instance, state) => {
      return (
        state.storage.sql
          .exec<{
            readonly content: string;
            readonly dedupeKey: string;
            readonly destination: string;
            readonly subject: string;
          }>(
            `SELECT m.content_markdown AS content, m.dedupe_key AS dedupeKey,
                    d.destination, m.subject
             FROM communication_messages m
             JOIN communication_deliveries d ON d.message_id = m.id
             WHERE m.dedupe_key = ? LIMIT 1`,
            `donation-alert:${checkout.donation.id}`,
          )
          .toArray()
          .at(0) ?? null
      );
    });

    expect(alertMessage).not.toBeNull();
    expect(alertMessage?.destination).toBe(ORDINARY_USER_EMAIL);
    expect(alertMessage?.subject).toBe("Donation receipt: Generous Donor — $75.00");
    expect(alertMessage?.content).toContain("## Donation receipt");
    expect(alertMessage?.content).toContain("- **Amount:** $75.00");
    expect(alertMessage?.content).toContain("Generous Donor");
    expect(alertMessage?.content).toContain("generous\\.donor@example\\.test");
    expect(alertMessage?.content).toContain("- **Tribute:** In honor of Beloved Singer");
    expect(alertMessage?.content).toContain("/admin/donations");
  });

  it("queues donation receipt alert on manual donation created by administrator", async () => {
    const { cookie } = await setupOptedInMember({ optIn: true });

    const manualResponse = await jsonWrite(
      "alpha.localhost",
      "/api/organization/donations/manual",
      "POST",
      {
        amountCents: 50000,
        anonymous: false,
        buyerEmail: "offline.donor@example.test",
        buyerName: "Offline Patron",
        paymentMethod: "check",
        paymentReference: "Check #7721",
        thankYouSent: false,
        tributeName: "Choir Legacy",
        tributeType: "memory",
      },
      cookie,
    );
    expect(manualResponse.status).toBe(201);
    const manual = donationResponseSchema.parse(await manualResponse.json());

    // Check DO communication messages and deliveries
    const stub = stores.get(stores.idFromName(ORG_ID));
    const alertMessage = await runInDurableObject<
      OrganizationStore,
      {
        readonly content: string;
        readonly dedupeKey: string;
        readonly destination: string;
        readonly subject: string;
      } | null
    >(stub, (_instance, state) => {
      return (
        state.storage.sql
          .exec<{
            readonly content: string;
            readonly dedupeKey: string;
            readonly destination: string;
            readonly subject: string;
          }>(
            `SELECT m.content_markdown AS content, m.dedupe_key AS dedupeKey,
                    d.destination, m.subject
             FROM communication_messages m
             JOIN communication_deliveries d ON d.message_id = m.id
             WHERE m.dedupe_key = ? LIMIT 1`,
            `donation-alert:${manual.donation.id}`,
          )
          .toArray()
          .at(0) ?? null
      );
    });

    expect(alertMessage).not.toBeNull();
    expect(alertMessage?.destination).toBe(ORDINARY_USER_EMAIL);
    expect(alertMessage?.subject).toBe("Donation receipt: Offline Patron — $500.00");
    expect(alertMessage?.content).toContain("- **Amount:** $500.00");
    expect(alertMessage?.content).toContain(
      "- **Donor:** Offline Patron (offline\\.donor@example\\.test)",
    );
    expect(alertMessage?.content).toContain("- **Tribute:** In memory of Choir Legacy");
    expect(alertMessage?.content).toContain("- **Payment method:** Check");
    expect(alertMessage?.content).toContain("- **Payment reference:** Check \\#7721");
    expect(alertMessage?.content).toContain("/admin/donations");
  });

  it("does not queue donation receipt alert when member has receiveFinancialAlerts turned off", async () => {
    const { cookie } = await setupOptedInMember({ optIn: false });

    const manualResponse = await jsonWrite(
      "alpha.localhost",
      "/api/organization/donations/manual",
      "POST",
      {
        amountCents: 2500,
        anonymous: false,
        buyerEmail: "another.donor@example.test",
        buyerName: "Another Donor",
        paymentMethod: "cash",
      },
      cookie,
    );
    expect(manualResponse.status).toBe(201);
    const manual = donationResponseSchema.parse(await manualResponse.json());

    const stub = stores.get(stores.idFromName(ORG_ID));
    const alertMessage = await runInDurableObject<OrganizationStore, boolean>(
      stub,
      (_instance, state) => {
        const rows = state.storage.sql
          .exec(
            "SELECT id FROM communication_messages WHERE dedupe_key = ? LIMIT 1",
            `donation-alert:${manual.donation.id}`,
          )
          .toArray();
        return rows.length > 0;
      },
    );

    expect(alertMessage).toBe(false);
  });

  it("queues donation receipt alert on Stripe donation completion webhook and is idempotent on duplicate webhook delivery", async () => {
    await setupOptedInMember({ optIn: true });

    const accountId = "acct_donationAlertTest123";
    const now = new Date().toISOString();
    await upsertStripeAccountOrganization(database, {
      accountId,
      now,
      organizationId: ORG_ID,
      status: "active",
    });

    const stub = stores.get(stores.idFromName(ORG_ID));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO stripe_connect_accounts
          (organization_id, account_id, status, details_submitted, charges_enabled, payouts_enabled, created_at, updated_at)
         VALUES (?, ?, 'ready', 1, 1, 1, ?, ?)`,
        ORG_ID,
        accountId,
        now,
        now,
      );
      return null;
    });

    const donationId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const providerSessionId = `cs_don_${crypto.randomUUID()}`;
    const providerPaymentId = `pi_don_${crypto.randomUUID()}`;

    // Create pending Stripe donation in DO
    const pendingRes = await stub.fetch("https://organization.internal/internal/donations/manage", {
      body: JSON.stringify({
        action: "create_stripe_pending_donation",
        checkout: {
          amountCents: 12500,
          anonymous: false,
          buyerEmail: "stripe.donor@example.test",
          buyerName: "Stripe Donor",
          checkoutRequestId,
          marketingConsent: false,
          tributeName: "Music Program",
          tributeNotifyEmail: "",
          tributeType: "honor",
        },
        donationId,
        organizationId: ORG_ID,
        providerSessionId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(pendingRes.status).toBe(201);

    // Setup Stripe webhook app
    const secret = "whsec_donation_alert_test";
    const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();
    app.use("*", (context, next) => {
      context.set("requestId", crypto.randomUUID());
      return next();
    });
    app.post("/api/webhook/stripe", handleStripeWebhook);

    const webhookEnv: Env = {
      ...env,
      APP_ENV: "local",
      CONTROL_DB: database,
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_STORE: stores,
      STRIPE_SECRET_KEY: "sk_test_donation_alert",
      STRIPE_WEBHOOK_SECRET: secret,
    };

    const eventBody = JSON.stringify({
      account: accountId,
      data: {
        object: {
          id: providerSessionId,
          metadata: {
            checkout_request_id: checkoutRequestId,
            organization_id: ORG_ID,
            payment_type: "donation",
          },
          payment_intent: providerPaymentId,
          payment_status: "paid",
        },
      },
      id: `evt_donation_alert_${crypto.randomUUID()}`,
      livemode: false,
      type: "checkout.session.completed",
    });
    const signature = await stripeSignatureForTest(
      secret,
      eventBody,
      Math.floor(Date.now() / 1_000),
    );

    const webhookResponse = await app.request(
      "https://example.test/api/webhook/stripe",
      {
        body: eventBody,
        headers: { "content-type": "application/json", "stripe-signature": signature },
        method: "POST",
      },
      webhookEnv,
    );
    expect(webhookResponse.status).toBe(200);

    // Verify DO communication messages contains donation receipt alert
    const alertMessages = await runInDurableObject<
      OrganizationStore,
      readonly {
        readonly content: string;
        readonly dedupeKey: string;
        readonly destination: string;
        readonly subject: string;
      }[]
    >(stub, (_instance, state) => {
      return state.storage.sql
        .exec<{
          readonly content: string;
          readonly dedupeKey: string;
          readonly destination: string;
          readonly subject: string;
        }>(
          `SELECT m.content_markdown AS content, m.dedupe_key AS dedupeKey,
                  d.destination, m.subject
           FROM communication_messages m
           JOIN communication_deliveries d ON d.message_id = m.id
           WHERE m.dedupe_key = ?`,
          `donation-alert:${donationId}`,
        )
        .toArray();
    });

    expect(alertMessages).toHaveLength(1);
    expect(alertMessages[0]?.destination).toBe(ORDINARY_USER_EMAIL);
    expect(alertMessages[0]?.subject).toBe("Donation receipt: Stripe Donor — $125.00");
    expect(alertMessages[0]?.content).toContain("- **Amount:** $125.00");
    expect(alertMessages[0]?.content).toContain(
      "- **Donor:** Stripe Donor (stripe\\.donor@example\\.test)",
    );
    expect(alertMessages[0]?.content).toContain("- **Tribute:** In honor of Music Program");
    expect(alertMessages[0]?.content).toContain("/admin/donations");

    // Replay duplicate webhook event - should succeed with 200 and not create duplicate alert
    const replayResponse = await app.request(
      "https://example.test/api/webhook/stripe",
      {
        body: eventBody,
        headers: { "content-type": "application/json", "stripe-signature": signature },
        method: "POST",
      },
      webhookEnv,
    );
    expect(replayResponse.status).toBe(200);

    const replayedAlertMessages = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) => {
        return (
          state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM communication_messages WHERE dedupe_key = ?",
              `donation-alert:${donationId}`,
            )
            .toArray()
            .at(0)?.count ?? 0
        );
      },
    );
    expect(replayedAlertMessages).toBe(1);
  });
});
