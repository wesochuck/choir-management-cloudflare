import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { Env } from "../src/env";
import { validateStartupConfig } from "../src/env";
import {
  handleStripeWebhook,
  stripeRefundDispatchMatched,
} from "../src/payments/stripeWebhookHandler";
import {
  stripeChargeRefundIsComplete,
  stripeCheckoutSessionIsPaid,
  stripeEventSchema,
  stripeSignatureForTest,
  verifyStripeWebhookSignature,
} from "../src/payments/stripeWebhook";

describe("Stripe webhook verification", () => {
  it("requires a paid Checkout Session before fulfillment", () => {
    expect(stripeCheckoutSessionIsPaid({ payment_status: "paid" })).toBe(true);
    expect(stripeCheckoutSessionIsPaid({ payment_status: "unpaid" })).toBe(false);
    expect(stripeCheckoutSessionIsPaid({})).toBe(false);
  });

  it("requires a complete charge refund before local access is revoked", () => {
    expect(stripeChargeRefundIsComplete({ amount: 2_500, amount_refunded: 2_500 })).toBe(true);
    expect(stripeChargeRefundIsComplete({ amount: 2_500, amount_refunded: 1_000 })).toBe(false);
    expect(stripeChargeRefundIsComplete({ amount: 2_500 })).toBe(false);
  });

  it("treats an already-applied refund webhook as a matched result", () => {
    expect(stripeRefundDispatchMatched({ duplicate: true, refunded: 0 })).toBe(true);
    expect(stripeRefundDispatchMatched({ refunded: 1 })).toBe(true);
    expect(stripeRefundDispatchMatched({ refunded: 0 })).toBe(false);
  });

  it("accepts a current signed payload and rejects tampering", async () => {
    const secret = "whsec_test_secret";
    const body = JSON.stringify({ id: "evt_test", type: "charge.refunded" });
    const timestamp = Math.floor(Date.now() / 1_000);
    const signature = await stripeSignatureForTest(secret, body, timestamp);

    await expect(verifyStripeWebhookSignature(secret, signature, body)).resolves.toBe(true);
    await expect(verifyStripeWebhookSignature(secret, signature, `${body} `)).resolves.toBe(false);
  });

  it("rejects stale signatures and accepts any valid v1 signature", async () => {
    const secret = "whsec_test_secret";
    const body = "{}";
    const now = Date.now();
    const stale = await stripeSignatureForTest(secret, body, Math.floor(now / 1_000) - 301);
    const current = await stripeSignatureForTest(secret, body, Math.floor(now / 1_000));

    await expect(verifyStripeWebhookSignature(secret, stale, body, now)).resolves.toBe(false);
    await expect(
      verifyStripeWebhookSignature(secret, `${stale},${current}`, body, now),
    ).resolves.toBe(true);
  });

  it("requires the supported event envelope including livemode and valid account", () => {
    for (const type of [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
      "charge.refunded",
      "charge.dispute.created",
      "charge.dispute.closed",
      "charge.dispute.funds_reinstated",
      "charge.dispute.funds_withdrawn",
    ]) {
      expect(
        stripeEventSchema.safeParse({
          account: "acct_test123",
          data: { object: {} },
          id: "evt_test",
          livemode: false,
          type,
        }).success,
      ).toBe(true);
    }
    // Missing livemode fails
    expect(
      stripeEventSchema.safeParse({
        account: "acct_test123",
        data: { object: {} },
        id: "evt_test",
        type: "checkout.session.completed",
      }).success,
    ).toBe(false);
    // Missing top-level account identifier is accepted
    expect(
      stripeEventSchema.safeParse({
        data: { object: { id: "cs_test123" } },
        id: "evt_test",
        livemode: false,
        type: "checkout.session.completed",
      }).success,
    ).toBe(true);
    // Invalid account identifier fails
    expect(
      stripeEventSchema.safeParse({
        account: "invalid_account",
        data: { object: {} },
        id: "evt_test",
        livemode: false,
        type: "checkout.session.completed",
      }).success,
    ).toBe(false);
    // Unsupported event type fails
    expect(
      stripeEventSchema.safeParse({
        account: "acct_test123",
        data: { object: {} },
        id: "evt_test",
        livemode: false,
        type: "unknown.event",
      }).success,
    ).toBe(false);
  });

  it("enforces test mode in staging and live mode in production", async () => {
    const secret = "whsec_test_secret";
    const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();
    app.use("*", (c, next) => {
      c.set("requestId", "11111111-1111-4111-8111-111111111111");
      return next();
    });
    app.post("/api/webhook/stripe", handleStripeWebhook);

    async function sendEvent(appEnv: "staging" | "production", livemode: boolean) {
      const body = JSON.stringify({
        account: "acct_test123",
        data: { object: { id: "cs_test" } },
        id: "evt_test",
        livemode,
        type: "checkout.session.completed",
      });
      const timestamp = Math.floor(Date.now() / 1_000);
      const signature = await stripeSignatureForTest(secret, body, timestamp);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only mock environment for webhook endpoint
      const env = {
        APP_ENV: appEnv,
        STRIPE_WEBHOOK_SECRET: secret,
      } as unknown as Env;
      return app.request(
        "https://example.test/api/webhook/stripe",
        {
          body,
          headers: {
            "content-type": "application/json",
            "stripe-signature": signature,
          },
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

  it("uses STRIPE_WEBHOOK_SECRET for classic checkout events and rejects events signed only with v2 destination secret", async () => {
    const classicSecret = "whsec_classic_secret";
    const v2Secret = "we_sec_v2_secret";
    const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();
    app.use("*", (c, next) => {
      c.set("requestId", "11111111-1111-4111-8111-111111111111");
      return next();
    });
    app.post("/api/webhook/stripe", handleStripeWebhook);

    const body = JSON.stringify({
      account: "acct_test123",
      data: { object: { id: "cs_test" } },
      id: "evt_test",
      livemode: false,
      type: "checkout.session.completed",
    });
    const timestamp = Math.floor(Date.now() / 1_000);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    const env = {
      APP_ENV: "staging",
      CONTROL_DB: {
        prepare: () => ({
          bind: () => ({
            all: () => Promise.resolve({ results: [] }),
            first: () => Promise.resolve(null),
          }),
        }),
      },
      STRIPE_V2_EVENT_DESTINATION_SECRET: v2Secret,
      STRIPE_WEBHOOK_SECRET: classicSecret,
    } as unknown as Env;

    // Signed only with v2 destination secret -> rejected on classic endpoint
    const v2Signature = await stripeSignatureForTest(v2Secret, body, timestamp);
    const v2SignedRes = await app.request(
      "https://example.test/api/webhook/stripe",
      {
        body,
        headers: {
          "content-type": "application/json",
          "stripe-signature": v2Signature,
        },
        method: "POST",
      },
      env,
    );
    expect(v2SignedRes.status).toBe(400);
    expect(await v2SignedRes.json()).toMatchObject({ code: "invalid_webhook_signature" });

    // Signed with classic secret -> accepted signature and processed through routing
    const classicSignature = await stripeSignatureForTest(classicSecret, body, timestamp);
    const classicSignedRes = await app.request(
      "https://example.test/api/webhook/stripe",
      {
        body,
        headers: {
          "content-type": "application/json",
          "stripe-signature": classicSignature,
        },
        method: "POST",
      },
      env,
    );
    expect(classicSignedRes.status).toBe(404);
    expect(await classicSignedRes.json()).toMatchObject({
      code: "organization_not_found",
    });
  });

  it("validates classic Stripe configuration at startup in payments-enabled staging/production", () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    const baseEnv = {
      APP_ENV: "staging",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BUILD_VERSION: "1.0.0",
      CUSTOM_DOMAIN_PROVIDER_MODE: "fake",
      EMAIL_EVENTS_DLQ_NAME: "dlq",
      EMAIL_EVENTS_QUEUE_NAME: "queue",
      EXTERNAL_EFFECTS_MODE: "fake",
      JOBS_DLQ_NAME: "jobs-dlq",
      JOBS_QUEUE_NAME: "jobs-queue",
      PLATFORM_EMAIL_FROM: "auth@mail.staging.musicsite.org",
      PLATFORM_EMAIL_MODE: "sandbox",
      PRODUCT_BASE_DOMAIN: "staging.musicsite.org",
      SIGNED_LINK_SECRET: "b".repeat(32),
    } as unknown as Env;

    // When payments disabled, passes without stripe secrets
    expect(() => validateStartupConfig(baseEnv)).not.toThrow();

    // In local development, passes even if STRIPE_PAYMENTS_ENABLED=true without secrets
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    const localEnv = {
      ...baseEnv,
      APP_ENV: "local",
      STRIPE_PAYMENTS_ENABLED: "true",
    } as unknown as Env;
    expect(() => validateStartupConfig(localEnv)).not.toThrow();

    // In staging with STRIPE_PAYMENTS_ENABLED=true:
    // Missing STRIPE_SECRET_KEY throws clear error
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    const stagingMissingKey = {
      ...baseEnv,
      APP_ENV: "staging",
      STRIPE_PAYMENTS_ENABLED: "true",
    } as unknown as Env;
    expect(() => validateStartupConfig(stagingMissingKey)).toThrow(
      "Missing required Stripe secret key (STRIPE_SECRET_KEY).",
    );

    // Missing STRIPE_WEBHOOK_SECRET throws clear error
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    const stagingMissingWebhook = {
      ...baseEnv,
      APP_ENV: "staging",
      STRIPE_PAYMENTS_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_123",
    } as unknown as Env;
    expect(() => validateStartupConfig(stagingMissingWebhook)).toThrow(
      "Missing required classic Stripe webhook secret (STRIPE_WEBHOOK_SECRET).",
    );

    // Fully configured classic secrets pass (v2 destination secret remains optional)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    const stagingValid = {
      ...baseEnv,
      APP_ENV: "staging",
      STRIPE_PAYMENTS_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_WEBHOOK_SECRET: "whsec_123",
    } as unknown as Env;
    expect(() => validateStartupConfig(stagingValid)).not.toThrow();
  });
});
