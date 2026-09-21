import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { Env } from "../src/env";
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
});
