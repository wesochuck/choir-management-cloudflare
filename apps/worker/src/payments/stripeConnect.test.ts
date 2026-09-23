import { describe, expect, it, vi } from "vitest";

import {
  createStripeAccountOnboardingLink,
  createStripeCheckoutSession,
  createStripeConnectedAccount,
  createStripeRefund,
  mapStripeAccountReadiness,
  retrieveStripeCheckoutSession,
  retrieveStripeConnectedAccount,
  stripeAccountIsReady,
  stripeConnectSetupUrl,
  StripeConnectError,
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
    expect(
      stripeAccountIsReady({
        ready: true,
      }),
    ).toBe(true);
    expect(
      stripeAccountIsReady({
        ready: false,
      }),
    ).toBe(false);
  });

  it("returns Stripe Connect to the setup checklist with an outcome", () => {
    expect(stripeConnectSetupUrl("https://lcc.staging.musicsite.org", "return")).toBe(
      "https://lcc.staging.musicsite.org/admin/settings/setup-checklist?stripe=return#provider-status-title",
    );
    expect(stripeConnectSetupUrl("https://lcc.staging.musicsite.org", "refresh")).toBe(
      "https://lcc.staging.musicsite.org/api/organization/stripe-connect/refresh",
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
          {
            productName: "Processing fee",
            productDescription: "Covers payment processing costs",
            quantity: 1,
            unitAmountCents: 100,
          },
        ],
        metadata: {
          bundle_id: "bundle-123",
          checkout_request_id: "checkout-request-1",
          organization_id: "organization-alpha",
          payment_type: "bundle",
          purchase_id: "purchase-456",
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
      expect(body.get("metadata[payment_type]")).toBe("bundle");
      expect(body.get("metadata[checkout_request_id]")).toBe("checkout-request-1");
      expect(body.get("metadata[bundle_id]")).toBe("bundle-123");
      expect(body.get("metadata[purchase_id]")).toBe("purchase-456");

      expect(body.get("payment_intent_data[metadata][organization_id]")).toBe("organization-alpha");
      expect(body.get("payment_intent_data[metadata][payment_type]")).toBe("bundle");
      expect(body.get("payment_intent_data[metadata][checkout_request_id]")).toBe(
        "checkout-request-1",
      );
      expect(body.get("payment_intent_data[metadata][bundle_id]")).toBe("bundle-123");
      expect(body.get("payment_intent_data[metadata][purchase_id]")).toBe("purchase-456");

      expect(body.get("line_items[0][price_data][unit_amount]")).toBe("1500");
      expect(body.get("line_items[1][price_data][unit_amount]")).toBe("100");
      expect(body.get("line_items[0][price_data][product_data][description]")).toBe(
        "Payment to Example Choir",
      );
      expect(body.get("line_items[1][price_data][product_data][description]")).toBe(
        "Covers payment processing costs",
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("retrieves an existing Checkout Session from Stripe", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        id: "cs_recovered_session",
        url: "https://checkout.stripe.test/recovered",
      }),
    );
    try {
      const session = await retrieveStripeCheckoutSession(
        "sk_test_secret",
        "acct_test",
        "cs_recovered_session",
      );
      expect(session).toEqual({
        id: "cs_recovered_session",
        url: "https://checkout.stripe.test/recovered",
      });
      const [url, request] = fetchSpy.mock.calls[0] ?? [];
      expect(url).toBe("https://api.stripe.com/v1/checkout/sessions/cs_recovered_session");
      const headers = new Headers(request?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk_test_secret");
      expect(headers.get("stripe-account")).toBe("acct_test");
      expect(request?.method).toBe("GET");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("creates connected accounts using Accounts v2 with merchant configuration and Stripe liability", async () => {
    const mockAccount = {
      id: "acct_test123",
      object: "v2.core.account",
      contact_email: "treasurer@choir.test",
      dashboard: "full",
      defaults: {
        responsibilities: {
          fees_collector: "stripe",
          losses_collector: "stripe",
          requirements_collector: "stripe",
        },
      },
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { status: "inactive" },
          },
        },
      },
      requirements: {
        currently_due: ["business_profile.url"],
        past_due: [],
        eventually_due: [],
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(mockAccount));

    try {
      const account = await createStripeConnectedAccount(
        "sk_test_secret",
        "org_123",
        "Example Choir",
      );

      expect(account.id).toBe("acct_test123");
      const [url, request] = fetchSpy.mock.calls[0] ?? [];
      expect(url).toBe("https://api.stripe.com/v2/core/accounts");
      const headers = new Headers(request?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk_test_secret");
      expect(headers.get("stripe-version")).toBe("2026-08-26.dahlia");
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("idempotency-key")).toBe("organization-org_123");

      const bodyText = typeof request?.body === "string" ? request.body : "";
      const body = JSON.parse(bodyText);
      expect(body).toEqual({
        configuration: {
          merchant: {
            capabilities: {
              card_payments: { requested: true },
            },
          },
        },
        dashboard: "full",
        defaults: {
          responsibilities: {
            fees_collector: "stripe",
            losses_collector: "stripe",
          },
        },
        display_name: "Example Choir",
        identity: {
          country: "US",
        },
        include: ["configuration.merchant", "defaults", "requirements"],
        metadata: {
          organization_id: "org_123",
        },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("retrieves connected accounts with merchant, defaults, and requirements includes", async () => {
    const mockAccount = {
      id: "acct_test456",
      object: "v2.core.account",
      dashboard: "full",
      defaults: {
        responsibilities: {
          fees_collector: "stripe",
          losses_collector: "stripe",
          requirements_collector: "stripe",
        },
      },
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { status: "active" },
          },
        },
      },
      requirements: {
        currently_due: [],
        past_due: [],
        eventually_due: [],
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(mockAccount));

    try {
      const account = await retrieveStripeConnectedAccount("sk_test_secret", "acct_test456");
      expect(account.id).toBe("acct_test456");

      const [url, request] = fetchSpy.mock.calls[0] ?? [];
      const urlString = typeof url === "string" ? url : "";
      const decodedUrl = decodeURIComponent(urlString);
      expect(decodedUrl).toContain("https://api.stripe.com/v2/core/accounts/acct_test456?");
      expect(decodedUrl).toContain("include[0]=configuration.merchant");
      expect(decodedUrl).toContain("include[1]=defaults");
      expect(decodedUrl).toContain("include[2]=requirements");

      const headers = new Headers(request?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk_test_secret");
      expect(headers.get("stripe-version")).toBe("2026-08-26.dahlia");
      expect(request?.method).toBe("GET");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("creates account onboarding links using Accounts v2 account_links endpoint", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ url: "https://connect.stripe.test/v2/onboarding" }));
    try {
      const url = await createStripeAccountOnboardingLink(
        "sk_test_secret",
        "acct_test",
        "https://example.test/return",
        "https://example.test/refresh",
      );
      expect(url).toBe("https://connect.stripe.test/v2/onboarding");
      const [requestUrl, request] = fetchSpy.mock.calls[0] ?? [];
      expect(requestUrl).toBe("https://api.stripe.com/v2/core/account_links");
      const headers = new Headers(request?.headers);
      expect(headers.get("stripe-version")).toBe("2026-08-26.dahlia");
      expect(headers.get("content-type")).toBe("application/json");

      const bodyText = typeof request?.body === "string" ? request.body : "";
      const body = JSON.parse(bodyText);
      expect(body).toEqual({
        account: "acct_test",
        use_case: {
          account_onboarding: {
            collection_options: {
              fields: "eventually_due",
            },
            configurations: ["merchant"],
            refresh_url: "https://example.test/refresh",
            return_url: "https://example.test/return",
          },
          type: "account_onboarding",
        },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("maps Accounts v2 readiness correctly and rejects invalid responsibility model", () => {
    // Valid ready account
    const readyAccount = {
      applied_configurations: ["merchant"],
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { status: "active" as const },
          },
        },
      },
      dashboard: "full" as const,
      defaults: {
        responsibilities: {
          fees_collector: "stripe" as const,
          losses_collector: "stripe" as const,
          requirements_collector: "stripe" as const,
        },
      },
      id: "acct_ready123",
      livemode: false,
      metadata: {},
      object: "v2.core.account" as const,
      requirements: {
        currently_due: [],
        eventually_due: [],
        past_due: [],
      },
    };

    const readyStatus = mapStripeAccountReadiness(readyAccount);
    expect(readyStatus.ready).toBe(true);
    expect(readyStatus.status).toBe("ready");
    expect(readyStatus.chargesEnabled).toBe(true);
    expect(readyStatus.payoutsEnabled).toBe(true);
    expect(readyStatus.detailsSubmitted).toBe(true);
    expect(readyStatus.cardPaymentsStatus).toBe("active");
    expect(readyStatus.payoutsStatus).toBe("active");
    expect(readyStatus.configurationValid).toBe(true);

    // Incomplete account with currently due items
    const incompleteAccount = {
      ...readyAccount,
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { status: "inactive" as const },
          },
        },
      },
      requirements: {
        currently_due: ["representative.ssn_last_4"],
        past_due: [],
        eventually_due: [],
      },
    };

    const incompleteStatus = mapStripeAccountReadiness(incompleteAccount);
    expect(incompleteStatus.ready).toBe(false);
    expect(incompleteStatus.status).toBe("onboarding");
    expect(incompleteStatus.chargesEnabled).toBe(false);
    expect(incompleteStatus.requirementsDue).toEqual(["representative.ssn_last_4"]);

    // Past-due account -> restricted
    const restrictedAccount = {
      ...readyAccount,
      requirements: {
        currently_due: [],
        past_due: ["identity_document"],
        eventually_due: [],
      },
    };
    const restrictedStatus = mapStripeAccountReadiness(restrictedAccount);
    expect(restrictedStatus.ready).toBe(false);
    expect(restrictedStatus.status).toBe("restricted");

    // Invalid responsibility model -> not configurationValid, restricted status
    const invalidLiabilityAccount = {
      ...readyAccount,
      defaults: {
        responsibilities: {
          fees_collector: "stripe" as const,
          losses_collector: "application" as const, // Platform liability is forbidden!
          requirements_collector: "stripe" as const,
        },
      },
    };

    const invalidStatus = mapStripeAccountReadiness(invalidLiabilityAccount);
    expect(invalidStatus.configurationValid).toBe(false);
    expect(invalidStatus.ready).toBe(false);
    expect(invalidStatus.status).toBe("restricted");
  });

  it("extracts structured error diagnostics from Stripe API error responses", async () => {
    const errorPayload = {
      error: {
        code: "account_invalid",
        message: "The account cannot receive payments.",
        request_log_url: "https://dashboard.stripe.com/test/logs/req_test_123",
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(errorPayload), {
        status: 400,
        headers: {
          "content-type": "application/json",
          "request-id": "req_test_123",
        },
      }),
    );

    try {
      await expect(
        retrieveStripeConnectedAccount("sk_test_secret", "acct_nonexistent"),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(StripeConnectError);
        if (!(err instanceof StripeConnectError)) return false;
        expect(err.status).toBe(400);
        expect(err.code).toBe("account_invalid");
        expect(err.requestId).toBe("req_test_123");
        expect(err.requestLogUrl).toBe("https://dashboard.stripe.com/test/logs/req_test_123");
        expect(err.safeMessage).toBe("The account cannot receive payments.");
        return true;
      });
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
