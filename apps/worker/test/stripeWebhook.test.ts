import { describe, expect, it } from "vitest";

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

  it("requires the supported event envelope", () => {
    for (const type of [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
    ]) {
      expect(
        stripeEventSchema.safeParse({
          account: "acct_test",
          data: { object: {} },
          id: "evt_test",
          type,
        }).success,
      ).toBe(true);
    }
    expect(
      stripeEventSchema.safeParse({ data: { object: {} }, id: "evt_test", type: "unknown" })
        .success,
    ).toBe(false);
  });
});
