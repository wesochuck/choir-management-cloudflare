import { describe, expect, it, vi } from "vitest";

import {
  createStripeCheckoutSession,
  createStripeRefund,
  stripeConnectSetupUrl,
  stripeAccountIsReady,
} from "./stripeConnect";

function requestBody(request: RequestInit | undefined): string {
  if (typeof request?.body === "string") return request.body;
  if (request?.body instanceof URLSearchParams) return request.body.toString();
  throw new Error("Expected a URL-encoded Stripe request body.");
}

describe("Stripe Connect provider contract", () => {
  it("recognizes only fully enabled connected accounts as ready", () => {
    expect(
      stripeAccountIsReady({
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [] },
      }),
    ).toBe(true);
    expect(
      stripeAccountIsReady({
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: ["business_profile.url"] },
      }),
    ).toBe(false);
    expect(
      stripeAccountIsReady({
        charges_enabled: false,
        payouts_enabled: true,
        requirements: { currently_due: [] },
      }),
    ).toBe(false);
  });

  it("returns Stripe Connect to the setup checklist with an outcome", () => {
    expect(stripeConnectSetupUrl("https://lcc.staging.musicsite.org", "return")).toBe(
      "https://lcc.staging.musicsite.org/admin/settings/setup-checklist?stripe=return#provider-status-title",
    );
    expect(stripeConnectSetupUrl("https://lcc.staging.musicsite.org", "refresh")).toBe(
      "https://lcc.staging.musicsite.org/admin/settings/setup-checklist?stripe=refresh#provider-status-title",
    );
  });

  it("creates direct-charge Checkout Sessions with tenant and retry identity", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ id: "cs_test_session", url: "https://checkout.stripe.test/session" }),
      );
    try {
      const session = await createStripeCheckoutSession("sk_test_secret", "acct_test", {
        cancelUrl: "https://choir.example.test/cancel",
        currency: "usd",
        customerEmail: "singer@example.test",
        lineItems: [
          { productName: "Spring tickets", quantity: 2, unitAmountCents: 1_500 },
          { productName: "Processing fee", quantity: 1, unitAmountCents: 100 },
        ],
        metadata: {
          checkout_request_id: "checkout-request-1",
          organization_id: "organization-alpha",
          payment_type: "bundle",
        },
        organizationName: "Example Choir",
        successUrl: "https://choir.example.test/success",
      });

      expect(session).toEqual({
        id: "cs_test_session",
        url: "https://checkout.stripe.test/session",
      });
      const [url, request] = fetchSpy.mock.calls[0] ?? [];
      expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
      const headers = new Headers(request?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk_test_secret");
      expect(headers.get("stripe-account")).toBe("acct_test");
      expect(headers.get("idempotency-key")).toBe("payment-checkout-checkout-request-1");
      const body = new URLSearchParams(requestBody(request));
      expect(body.get("customer_email")).toBe("singer@example.test");
      expect(body.get("metadata[organization_id]")).toBe("organization-alpha");
      expect(body.get("line_items[0][price_data][unit_amount]")).toBe("1500");
      expect(body.get("line_items[1][price_data][unit_amount]")).toBe("100");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("creates connected-account refunds with a stable retry identity", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ id: "re_test_refund", status: "succeeded" }));
    try {
      await expect(
        createStripeRefund("sk_test_secret", "acct_test", "pi_test_payment", "refund-ticket-1"),
      ).resolves.toEqual({ id: "re_test_refund", status: "succeeded" });
      const [url, request] = fetchSpy.mock.calls[0] ?? [];
      expect(url).toBe("https://api.stripe.com/v1/refunds");
      const headers = new Headers(request?.headers);
      expect(headers.get("stripe-account")).toBe("acct_test");
      expect(headers.get("idempotency-key")).toBe("refund-ticket-1");
      expect(new URLSearchParams(requestBody(request)).get("payment_intent")).toBe(
        "pi_test_payment",
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
