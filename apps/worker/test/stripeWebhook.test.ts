import { describe, expect, it } from "vitest";

import {
  stripeEventSchema,
  stripeSignatureForTest,
  verifyStripeWebhookSignature,
} from "../src/payments/stripeWebhook";

describe("Stripe webhook verification", () => {
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
    expect(
      stripeEventSchema.safeParse({
        data: { object: {} },
        id: "evt_test",
        type: "checkout.session.completed",
      }).success,
    ).toBe(true);
    expect(
      stripeEventSchema.safeParse({ data: { object: {} }, id: "evt_test", type: "unknown" })
        .success,
    ).toBe(false);
  });
});
