import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import * as stripeConnectModule from "../src/payments/stripeConnect";
import { handleStripeV2Webhook, handleStripeWebhook } from "../src/payments/stripeWebhookHandler";
import { stripeSignatureForTest, stripeV2EventSchema } from "../src/payments/stripeWebhook";
import * as stripeRoutingModule from "../src/payments/stripeRouting";
import * as rpcClientModule from "../src/organization/rpc/client";

function createMockEnv(overrides: Record<string, unknown>): Env {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only mock environment
  return overrides as unknown as Env;
}

describe("Stripe Accounts v2 webhook verification & processing", () => {
  it("validates thin event schema for v2.core.account events", () => {
    for (const type of [
      "v2.core.account.created",
      "v2.core.account.updated",
      "v2.core.account.closed",
      "v2.core.account[defaults].updated",
    ]) {
      const parsed = stripeV2EventSchema.safeParse({
        id: "evt_v2_123",
        livemode: false,
        object: "v2.core.event",
        related_object: {
          id: "acct_test123",
          type: "account",
          url: "https://api.stripe.com/v2/core/accounts/acct_test123",
        },
        type,
      });
      expect(parsed.success).toBe(true);
    }

    // Missing livemode fails
    expect(
      stripeV2EventSchema.safeParse({
        id: "evt_v2_123",
        object: "v2.core.event",
        related_object: { id: "acct_test123", type: "account" },
        type: "v2.core.account.updated",
      }).success,
    ).toBe(false);

    // Invalid account ID fails
    expect(
      stripeV2EventSchema.safeParse({
        id: "evt_v2_123",
        livemode: false,
        object: "v2.core.event",
        related_object: { id: "invalid_acct", type: "account" },
        type: "v2.core.account.updated",
      }).success,
    ).toBe(false);
  });

  function createTestApp() {
    const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();
    app.use("*", (c, next) => {
      c.set("requestId", "11111111-1111-4111-8111-111111111111");
      return next();
    });
    app.post("/api/webhook/stripe/v2", handleStripeV2Webhook);
    app.post("/api/webhook/stripe", handleStripeWebhook);
    return app;
  }

  it("verifies webhook signature and rejects tampering or missing signatures", async () => {
    const secret = "whsec_v2_test_secret";
    const app = createTestApp();
    const body = JSON.stringify({
      id: "evt_v2_123",
      livemode: false,
      object: "v2.core.event",
      related_object: { id: "acct_test123", type: "account" },
      type: "v2.core.account.updated",
    });
    const timestamp = Math.floor(Date.now() / 1_000);
    const signature = await stripeSignatureForTest(secret, body, timestamp);

    const env = createMockEnv({
      APP_ENV: "staging",
      STRIPE_V2_EVENT_DESTINATION_SECRET: secret,
    });

    // Tampered body fails
    const tampered = await app.request(
      "https://example.test/api/webhook/stripe/v2",
      {
        body: `${body} `,
        headers: { "content-type": "application/json", "stripe-signature": signature },
        method: "POST",
      },
      env,
    );
    expect(tampered.status).toBe(400);
    expect(await tampered.json()).toMatchObject({ code: "invalid_webhook_signature" });

    // Missing signature fails
    const missingSig = await app.request(
      "https://example.test/api/webhook/stripe/v2",
      {
        body,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      env,
    );
    expect(missingSig.status).toBe(400);
    expect(await missingSig.json()).toMatchObject({ code: "invalid_webhook_signature" });
  });

  it("enforces test mode in staging and live mode in production", async () => {
    const secret = "whsec_v2_test_secret";
    const app = createTestApp();

    async function sendEvent(appEnv: "staging" | "production", livemode: boolean) {
      const body = JSON.stringify({
        id: "evt_v2_123",
        livemode,
        object: "v2.core.event",
        related_object: { id: "acct_test123", type: "account" },
        type: "v2.core.account.updated",
      });
      const timestamp = Math.floor(Date.now() / 1_000);
      const signature = await stripeSignatureForTest(secret, body, timestamp);
      const env = createMockEnv({
        APP_ENV: appEnv,
        STRIPE_V2_EVENT_DESTINATION_SECRET: secret,
      });

      return app.request(
        "https://example.test/api/webhook/stripe/v2",
        {
          body,
          headers: { "content-type": "application/json", "stripe-signature": signature },
          method: "POST",
        },
        env,
      );
    }

    // Staging + livemode: true -> rejected
    const stagingLive = await sendEvent("staging", true);
    expect(stagingLive.status).toBe(400);
    expect(await stagingLive.json()).toMatchObject({ code: "livemode_mismatch" });

    // Production + livemode: false -> rejected
    const prodTest = await sendEvent("production", false);
    expect(prodTest.status).toBe(400);
    expect(await prodTest.json()).toMatchObject({ code: "livemode_mismatch" });
  });

  it("safely ignores events without related account or for unknown accounts", async () => {
    const secret = "whsec_v2_test_secret";
    const app = createTestApp();
    const env = createMockEnv({
      APP_ENV: "staging",
      CONTROL_DB: {},
      STRIPE_V2_EVENT_DESTINATION_SECRET: secret,
    });

    // 1. Event without account
    const noAccountBody = JSON.stringify({
      id: "evt_v2_no_acct",
      livemode: false,
      object: "v2.core.event",
      type: "v2.core.account.updated",
    });
    const sig1 = await stripeSignatureForTest(
      secret,
      noAccountBody,
      Math.floor(Date.now() / 1_000),
    );
    const noAccountRes = await app.request(
      "https://example.test/api/webhook/stripe/v2",
      {
        body: noAccountBody,
        headers: { "content-type": "application/json", "stripe-signature": sig1 },
        method: "POST",
      },
      env,
    );
    expect(noAccountRes.status).toBe(200);
    expect(await noAccountRes.json()).toMatchObject({
      ignored: true,
      reason: "irrelevant_event_type",
      success: true,
    });

    // 2. Unknown account
    vi.spyOn(stripeRoutingModule, "resolveOrganizationForStripeAccount").mockResolvedValue(null);
    const unknownAcctBody = JSON.stringify({
      id: "evt_v2_unknown",
      livemode: false,
      object: "v2.core.event",
      related_object: { id: "acct_unknown123", type: "account" },
      type: "v2.core.account.updated",
    });
    const sig2 = await stripeSignatureForTest(
      secret,
      unknownAcctBody,
      Math.floor(Date.now() / 1_000),
    );
    const unknownRes = await app.request(
      "https://example.test/api/webhook/stripe/v2",
      {
        body: unknownAcctBody,
        headers: { "content-type": "application/json", "stripe-signature": sig2 },
        method: "POST",
      },
      env,
    );
    expect(unknownRes.status).toBe(200);
    expect(await unknownRes.json()).toMatchObject({
      ignored: true,
      reason: "unknown_account",
      success: true,
    });
  });

  it("retrieves current account and updates store on v2.core.account.updated", async () => {
    const secret = "whsec_v2_test_secret";
    const app = createTestApp();
    const env = createMockEnv({
      APP_ENV: "staging",
      CONTROL_DB: {},
      ORGANIZATION_STORE: {
        getByName: vi.fn().mockReturnValue({}),
      },
      STRIPE_SECRET_KEY: "sk_test_secret_key",
      STRIPE_V2_EVENT_DESTINATION_SECRET: secret,
    });

    vi.spyOn(stripeRoutingModule, "resolveOrganizationForStripeAccount").mockResolvedValue({
      accountId: "acct_test123",
      organizationId: "org_alpha",
      status: "active",
    });

    vi.spyOn(stripeRoutingModule, "upsertStripeAccountOrganization").mockResolvedValue();

    const retrieveSpy = vi
      .spyOn(stripeConnectModule, "retrieveStripeConnectedAccount")
      .mockResolvedValue({
        applied_configurations: ["merchant"],
        configuration: {
          merchant: {
            capabilities: {
              card_payments: { status: "active" },
            },
          },
        },
        dashboard: "full",
        defaults: {
          responsibilities: {
            fees_collector: "stripe",
            losses_collector: "stripe",
            requirements_collector: "stripe",
          },
        },
        id: "acct_test123",
        livemode: false,
        metadata: { organization_id: "org_alpha" },
        object: "v2.core.account",
        requirements: {
          currently_due: [],
          eventually_due: [],
          past_due: [],
        },
      });

    let storeBody: unknown;
    vi.spyOn(rpcClientModule, "invokeOrganizationRpc").mockImplementation((_stub, _input, init) => {
      if (typeof init?.body === "string") {
        storeBody = JSON.parse(init.body);
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    });

    const body = JSON.stringify({
      id: "evt_v2_updated",
      livemode: false,
      object: "v2.core.event",
      related_object: { id: "acct_test123", type: "account" },
      type: "v2.core.account.updated",
    });
    const sig = await stripeSignatureForTest(secret, body, Math.floor(Date.now() / 1_000));

    const response = await app.request(
      "https://example.test/api/webhook/stripe/v2",
      {
        body,
        headers: { "content-type": "application/json", "stripe-signature": sig },
        method: "POST",
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      eventId: "evt_v2_updated",
      success: true,
    });

    // Proves it fetched current account state rather than trusting a snapshot payload
    expect(retrieveSpy).toHaveBeenCalledWith("sk_test_secret_key", "acct_test123");

    // Proves it updated the store with ready state
    expect(storeBody).toMatchObject({
      accountId: "acct_test123",
      cardPaymentsStatus: "active",
      chargesEnabled: true,
      dashboardType: "full",
      feesCollector: "stripe",
      lossesCollector: "stripe",
      organizationId: "org_alpha",
      payoutsEnabled: true,
      status: "ready",
    });
  });

  it("handles account closure by restricting status and disabling routing", async () => {
    const secret = "whsec_v2_test_secret";
    const app = createTestApp();
    const env = createMockEnv({
      APP_ENV: "staging",
      CONTROL_DB: {},
      ORGANIZATION_STORE: {
        getByName: vi.fn().mockReturnValue({}),
      },
      STRIPE_V2_EVENT_DESTINATION_SECRET: secret,
    });

    vi.spyOn(stripeRoutingModule, "resolveOrganizationForStripeAccount").mockResolvedValue({
      accountId: "acct_closed123",
      organizationId: "org_beta",
      status: "active",
    });

    let storeBody: unknown;
    vi.spyOn(rpcClientModule, "invokeOrganizationRpc").mockImplementation((_stub, _input, init) => {
      if (typeof init?.body === "string") {
        storeBody = JSON.parse(init.body);
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    });

    const upsertSpy = vi
      .spyOn(stripeRoutingModule, "upsertStripeAccountOrganization")
      .mockResolvedValue();

    const body = JSON.stringify({
      id: "evt_v2_closed",
      livemode: false,
      object: "v2.core.event",
      related_object: { id: "acct_closed123", type: "account" },
      type: "v2.core.account.closed",
    });
    const sig = await stripeSignatureForTest(secret, body, Math.floor(Date.now() / 1_000));

    const response = await app.request(
      "https://example.test/api/webhook/stripe/v2",
      {
        body,
        headers: { "content-type": "application/json", "stripe-signature": sig },
        method: "POST",
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(storeBody).toMatchObject({
      accountId: "acct_closed123",
      cardPaymentsStatus: "restricted",
      chargesEnabled: false,
      organizationId: "org_beta",
      payoutsEnabled: false,
      status: "restricted",
    });
    expect(upsertSpy).toHaveBeenCalledWith(env.CONTROL_DB, {
      accountId: "acct_closed123",
      organizationId: "org_beta",
      status: "disabled",
    });
  });

  it("delegates v2 event arriving at legacy /api/webhook/stripe to v2 handler", async () => {
    const secret = "whsec_shared_secret";
    const app = createTestApp();
    const env = createMockEnv({
      APP_ENV: "staging",
      CONTROL_DB: {},
      STRIPE_WEBHOOK_SECRET: secret,
    });

    vi.spyOn(stripeRoutingModule, "resolveOrganizationForStripeAccount").mockResolvedValue(null);

    const body = JSON.stringify({
      id: "evt_v2_delegated",
      livemode: false,
      object: "v2.core.event",
      related_object: { id: "acct_delegated123", type: "account" },
      type: "v2.core.account.updated",
    });
    const sig = await stripeSignatureForTest(secret, body, Math.floor(Date.now() / 1_000));

    // Send to v1 endpoint
    const response = await app.request(
      "https://example.test/api/webhook/stripe",
      {
        body,
        headers: { "content-type": "application/json", "stripe-signature": sig },
        method: "POST",
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ignored: true,
      reason: "unknown_account",
      success: true,
    });
  });

  it("rejects classic checkout events sent to /api/webhook/stripe/v2 as invalid_webhook_event", async () => {
    const secret = "whsec_v2_test_secret";
    const app = createTestApp();
    const env = createMockEnv({
      APP_ENV: "staging",
      STRIPE_V2_EVENT_DESTINATION_SECRET: secret,
    });

    const classicBody = JSON.stringify({
      account: "acct_test123",
      data: { object: { id: "cs_test" } },
      id: "evt_classic_123",
      livemode: false,
      object: "event",
      type: "checkout.session.completed",
    });
    const timestamp = Math.floor(Date.now() / 1_000);
    const signature = await stripeSignatureForTest(secret, classicBody, timestamp);

    const response = await app.request(
      "https://example.test/api/webhook/stripe/v2",
      {
        body: classicBody,
        headers: { "content-type": "application/json", "stripe-signature": signature },
        method: "POST",
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_webhook_event" });
  });
});
