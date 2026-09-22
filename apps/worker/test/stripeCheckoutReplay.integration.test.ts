import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { createPublicTicketCheckout } from "../src/organization/organizationTicketing";
import { createDonationCheckoutSession } from "../src/organization/organizationDonations";
import {
  setupTicketingIntegration,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

const ORG_ID = "organization-alpha";
const ORIGIN = "https://tickets.example.test";
const EVENT_ID = "11111111-1111-4111-8111-111111111111";

const mockEnv = {
  APP_ENV: "staging" as const,
  EXTERNAL_EFFECTS_MODE: "sandbox" as const,
  ORGANIZATION_STORE: stores,
  SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
  STRIPE_PAYMENTS_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_mock_secret_key_12345",
};

function callUrl(call: unknown[] | undefined): string {
  const arg = call?.[0];
  if (typeof arg === "string") return arg;
  if (arg instanceof Request) return arg.url;
  if (arg instanceof URL) return arg.href;
  return "";
}

beforeEach(async () => {
  await setupTicketingIntegration();
  const stub = stores.get(stores.idFromName(ORG_ID));
  await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
    const now = new Date().toISOString();
    state.storage.sql.exec(
      `UPDATE organization_metadata
       SET payment_activation_json = '{"tickets":true,"donations":true,"dues":true}'
       WHERE organization_id = ?`,
      ORG_ID,
    );
    state.storage.sql.exec(
      `INSERT OR REPLACE INTO stripe_connect_accounts
        (organization_id, account_id, details_submitted, charges_enabled, payouts_enabled,
         requirements_due_json, card_payments_status, payouts_status, dashboard_type,
         fees_collector, losses_collector, last_synced_at, status, created_at, updated_at)
       VALUES (?, 'acct_1testconnect1', 1, 1, 1, '[]', 'active', 'active', 'full',
               'stripe', 'stripe', ?, 'ready', ?, ?)`,
      ORG_ID,
      now,
      now,
      now,
    );
    state.storage.sql.exec(
      `INSERT OR REPLACE INTO events
        (id, title, type, starts_at, is_archived, is_canceled,
         publish_on_website, is_ticketing_enabled,
         advance_price_cents, day_of_price_cents, ticket_capacity,
         created_at, updated_at)
       VALUES (?, 'Replay Concert', 'Performance', '2026-11-01T20:00:00Z',
               0, 0, 1, 1, 2500, 2500, 2, ?, ?)`,
      EVENT_ID,
      now,
      now,
    );
    return null;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await teardownTicketingIntegration();
});

describe("Stripe ticket checkout replay idempotency and failure-resilience", () => {
  it("identical replay returns same resource ID, Stripe session, and stable receipt token", async () => {
    const checkoutRequestId = crypto.randomUUID();
    const sessionId = "cs_ticket_replay_1";
    const sessionUrl = "https://checkout.stripe.test/c/pay/cs_ticket_replay_1";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((info) => {
      const url = typeof info === "string" ? info : info instanceof Request ? info.url : "";
      if (url.includes("/v1/checkout/sessions/") && !url.endsWith("/sessions")) {
        return Promise.resolve(Response.json({ id: sessionId, url: sessionUrl }));
      }
      if (url.includes("/v1/checkout/sessions")) {
        return Promise.resolve(Response.json({ id: sessionId, url: sessionUrl }));
      }
      return Promise.resolve(Response.json({}));
    });

    const checkoutInput = {
      buyerEmail: "buyer@example.test",
      buyerName: "Jane Buyer",
      checkoutRequestId,
      eventId: EVENT_ID,
      marketingOptIn: false,
      quantity: 1,
    };

    // First attempt
    const first = await createPublicTicketCheckout(mockEnv, ORG_ID, ORIGIN, checkoutInput);
    expect(first.checkoutMode).toBe("stripe");
    expect(first.purchase.status).toBe("pending");
    expect(first.url).toBe(sessionUrl);

    // Verify initial call to Stripe had stable idempotency key
    const firstStripeCall = fetchSpy.mock.calls.find((call) =>
      callUrl(call).includes("/v1/checkout/sessions"),
    );
    expect(firstStripeCall).toBeDefined();
    const firstHeaders = new Headers(firstStripeCall?.[1]?.headers);
    expect(firstHeaders.get("idempotency-key")).toBe(`payment-checkout-${checkoutRequestId}`);

    // Second identical attempt (replay)
    const replay = await createPublicTicketCheckout(mockEnv, ORG_ID, ORIGIN, checkoutInput);
    expect(replay.purchase.id).toBe(first.purchase.id);
    expect(replay.successToken).toBe(first.successToken);
    expect(replay.url).toBe(first.url);
  });

  it("changed payload under same checkoutRequestId returns HTTP 409", async () => {
    const checkoutRequestId = crypto.randomUUID();
    const sessionId = "cs_ticket_conflict_1";

    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        Response.json({ id: sessionId, url: "https://checkout.stripe.test/session" }),
      ),
    );

    await createPublicTicketCheckout(mockEnv, ORG_ID, ORIGIN, {
      buyerEmail: "buyer@example.test",
      buyerName: "Jane Buyer",
      checkoutRequestId,
      eventId: EVENT_ID,
      marketingOptIn: false,
      quantity: 1,
    });

    await expect(
      createPublicTicketCheckout(mockEnv, ORG_ID, ORIGIN, {
        buyerEmail: "buyer@example.test",
        buyerName: "Jane Buyer",
        checkoutRequestId,
        eventId: EVENT_ID,
        marketingOptIn: false,
        quantity: 2, // Changed quantity
      }),
    ).rejects.toMatchObject({
      code: "checkout_request_conflict",
      status: 409,
    });
  });

  it("replay does not double-reserve capacity", async () => {
    const checkoutRequestId = crypto.randomUUID();
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        Response.json({ id: "cs_ticket_cap_1", url: "https://checkout.stripe.test/session" }),
      ),
    );

    // Event capacity is 2; request quantity 2
    const first = await createPublicTicketCheckout(mockEnv, ORG_ID, ORIGIN, {
      buyerEmail: "capacity@example.test",
      buyerName: "Capacity Buyer",
      checkoutRequestId,
      eventId: EVENT_ID,
      marketingOptIn: false,
      quantity: 2,
    });
    expect(first.purchase.quantity).toBe(2);

    // Replay should NOT throw capacity exceeded
    const replay = await createPublicTicketCheckout(mockEnv, ORG_ID, ORIGIN, {
      buyerEmail: "capacity@example.test",
      buyerName: "Capacity Buyer",
      checkoutRequestId,
      eventId: EVENT_ID,
      marketingOptIn: false,
      quantity: 2,
    });
    expect(replay.purchase.id).toBe(first.purchase.id);
  });

  it("paid replay returns receipt destination directly without calling Stripe", async () => {
    const checkoutRequestId = crypto.randomUUID();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ id: "cs_ticket_paid_1", url: "https://checkout.stripe.test/session" }),
        ),
      );

    const first = await createPublicTicketCheckout(mockEnv, ORG_ID, ORIGIN, {
      buyerEmail: "paid@example.test",
      buyerName: "Paid Buyer",
      checkoutRequestId,
      eventId: EVENT_ID,
      marketingOptIn: false,
      quantity: 1,
    });

    // Mark as paid in DO
    const stub = stores.get(stores.idFromName(ORG_ID));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE ticket_purchases SET status = 'paid' WHERE id = ?`,
        first.purchase.id,
      );
      return null;
    });

    fetchSpy.mockClear();

    const replay = await createPublicTicketCheckout(mockEnv, ORG_ID, ORIGIN, {
      buyerEmail: "paid@example.test",
      buyerName: "Paid Buyer",
      checkoutRequestId,
      eventId: EVENT_ID,
      marketingOptIn: false,
      quantity: 1,
    });

    expect(replay.purchase.id).toBe(first.purchase.id);
    expect(replay.url).toContain("/tickets/order/success?token=");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("expired replay throws 409 ticket_checkout_expired", async () => {
    const checkoutRequestId = crypto.randomUUID();
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        Response.json({ id: "cs_ticket_exp_1", url: "https://checkout.stripe.test/session" }),
      ),
    );

    const first = await createPublicTicketCheckout(mockEnv, ORG_ID, ORIGIN, {
      buyerEmail: "expired@example.test",
      buyerName: "Expired Buyer",
      checkoutRequestId,
      eventId: EVENT_ID,
      marketingOptIn: false,
      quantity: 1,
    });

    // Mark as expired in DO
    const stub = stores.get(stores.idFromName(ORG_ID));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE ticket_purchases SET status = 'expired' WHERE id = ?`,
        first.purchase.id,
      );
      return null;
    });

    await expect(
      createPublicTicketCheckout(mockEnv, ORG_ID, ORIGIN, {
        buyerEmail: "expired@example.test",
        buyerName: "Expired Buyer",
        checkoutRequestId,
        eventId: EVENT_ID,
        marketingOptIn: false,
        quantity: 1,
      }),
    ).rejects.toMatchObject({
      code: "ticket_checkout_expired",
      status: 409,
    });
  });

  it("failed replay attempt does not expire an existing attached reservation", async () => {
    const checkoutRequestId = crypto.randomUUID();
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        Response.json({
          id: "cs_ticket_attached_1",
          url: "https://checkout.stripe.test/session",
        }),
      ),
    );

    const first = await createPublicTicketCheckout(mockEnv, ORG_ID, ORIGIN, {
      buyerEmail: "survivor@example.test",
      buyerName: "Survivor Buyer",
      checkoutRequestId,
      eventId: EVENT_ID,
      marketingOptIn: false,
      quantity: 1,
    });

    // Make Stripe retrieve fail on second call
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Stripe network failure"));

    await expect(
      createPublicTicketCheckout(mockEnv, ORG_ID, ORIGIN, {
        buyerEmail: "survivor@example.test",
        buyerName: "Survivor Buyer",
        checkoutRequestId,
        eventId: EVENT_ID,
        marketingOptIn: false,
        quantity: 1,
      }),
    ).rejects.toThrow();

    // Verify reservation was NOT expired
    const stub = stores.get(stores.idFromName(ORG_ID));
    const status = await runInDurableObject<OrganizationStore, string>(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ readonly status: string }>(
          `SELECT status FROM ticket_purchases WHERE id = ?`,
          first.purchase.id,
        )
        .one();
      return row.status;
    });
    expect(status).toBe("pending");
  });
});

describe("Stripe donation checkout replay idempotency and failure-resilience", () => {
  it("identical donation replay returns same donation ID, Stripe session, and stable receipt token", async () => {
    const checkoutRequestId = crypto.randomUUID();
    const sessionId = "cs_donation_replay_1";
    const sessionUrl = "https://checkout.stripe.test/c/pay/cs_donation_replay_1";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((info) => {
      const url = typeof info === "string" ? info : info instanceof Request ? info.url : "";
      if (url.includes("/v1/checkout/sessions/") && !url.endsWith("/sessions")) {
        return Promise.resolve(Response.json({ id: sessionId, url: sessionUrl }));
      }
      if (url.includes("/v1/checkout/sessions")) {
        return Promise.resolve(Response.json({ id: sessionId, url: sessionUrl }));
      }
      return Promise.resolve(Response.json({}));
    });

    const donationInput = {
      amountCents: 5000,
      anonymous: false,
      buyerEmail: "donor@example.test",
      buyerName: "Generous Donor",
      checkoutRequestId,
      marketingConsent: true,
      tributeName: "",
      tributeNotifyEmail: "",
      tributeType: "none" as const,
    };

    const first = await createDonationCheckoutSession(mockEnv, ORG_ID, ORIGIN, donationInput);
    expect(first.checkoutMode).toBe("stripe");
    expect(first.donation.status).toBe("pending");
    expect(first.url).toBe(sessionUrl);

    // Verify idempotency key sent to Stripe
    const firstCall = fetchSpy.mock.calls.find((call) =>
      callUrl(call).includes("/v1/checkout/sessions"),
    );
    expect(firstCall).toBeDefined();
    const headers = new Headers(firstCall?.[1]?.headers);
    expect(headers.get("idempotency-key")).toBe(`payment-checkout-${checkoutRequestId}`);

    // Replay
    const replay = await createDonationCheckoutSession(mockEnv, ORG_ID, ORIGIN, donationInput);
    expect(replay.donation.id).toBe(first.donation.id);
    expect(replay.successToken).toBe(first.successToken);
    expect(replay.url).toBe(first.url);
  });

  it("changed donation payload under same checkoutRequestId returns HTTP 409", async () => {
    const checkoutRequestId = crypto.randomUUID();
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        Response.json({ id: "cs_don_conflict", url: "https://checkout.stripe.test/session" }),
      ),
    );

    await createDonationCheckoutSession(mockEnv, ORG_ID, ORIGIN, {
      amountCents: 5000,
      anonymous: false,
      buyerEmail: "donor@example.test",
      buyerName: "Generous Donor",
      checkoutRequestId,
      marketingConsent: true,
      tributeName: "",
      tributeNotifyEmail: "",
      tributeType: "none",
    });

    await expect(
      createDonationCheckoutSession(mockEnv, ORG_ID, ORIGIN, {
        amountCents: 10000, // Changed amount
        anonymous: false,
        buyerEmail: "donor@example.test",
        buyerName: "Generous Donor",
        checkoutRequestId,
        marketingConsent: true,
        tributeName: "",
        tributeNotifyEmail: "",
        tributeType: "none",
      }),
    ).rejects.toMatchObject({
      code: "donation_checkout_conflict",
      status: 409,
    });
  });

  it("paid donation replay returns receipt directly without calling Stripe", async () => {
    const checkoutRequestId = crypto.randomUUID();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ id: "cs_don_paid", url: "https://checkout.stripe.test/session" }),
        ),
      );

    const first = await createDonationCheckoutSession(mockEnv, ORG_ID, ORIGIN, {
      amountCents: 5000,
      anonymous: false,
      buyerEmail: "donor@example.test",
      buyerName: "Generous Donor",
      checkoutRequestId,
      marketingConsent: true,
      tributeName: "",
      tributeNotifyEmail: "",
      tributeType: "none",
    });

    // Mark as paid in DO
    const stub = stores.get(stores.idFromName(ORG_ID));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE donations SET status = 'paid' WHERE id = ?`,
        first.donation.id,
      );
      return null;
    });

    fetchSpy.mockClear();

    const replay = await createDonationCheckoutSession(mockEnv, ORG_ID, ORIGIN, {
      amountCents: 5000,
      anonymous: false,
      buyerEmail: "donor@example.test",
      buyerName: "Generous Donor",
      checkoutRequestId,
      marketingConsent: true,
      tributeName: "",
      tributeNotifyEmail: "",
      tributeType: "none",
    });

    expect(replay.donation.id).toBe(first.donation.id);
    expect(replay.url).toContain("/donate/success?token=");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("expired donation replay throws 409 donation_checkout_expired", async () => {
    const checkoutRequestId = crypto.randomUUID();
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        Response.json({ id: "cs_don_exp", url: "https://checkout.stripe.test/session" }),
      ),
    );

    const first = await createDonationCheckoutSession(mockEnv, ORG_ID, ORIGIN, {
      amountCents: 5000,
      anonymous: false,
      buyerEmail: "donor@example.test",
      buyerName: "Generous Donor",
      checkoutRequestId,
      marketingConsent: true,
      tributeName: "",
      tributeNotifyEmail: "",
      tributeType: "none",
    });

    // Mark as expired in DO
    const stub = stores.get(stores.idFromName(ORG_ID));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO donation_expirations (donation_id, stripe_event_id, expired_at) VALUES (?, 'evt_test_exp', ?)`,
        first.donation.id,
        new Date().toISOString(),
      );
      return null;
    });

    await expect(
      createDonationCheckoutSession(mockEnv, ORG_ID, ORIGIN, {
        amountCents: 5000,
        anonymous: false,
        buyerEmail: "donor@example.test",
        buyerName: "Generous Donor",
        checkoutRequestId,
        marketingConsent: true,
        tributeName: "",
        tributeNotifyEmail: "",
        tributeType: "none",
      }),
    ).rejects.toMatchObject({
      code: "donation_checkout_expired",
      status: 409,
    });
  });

  it("failed donation replay does not expire existing attached donation", async () => {
    const checkoutRequestId = crypto.randomUUID();
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        Response.json({ id: "cs_don_survive", url: "https://checkout.stripe.test/session" }),
      ),
    );

    const first = await createDonationCheckoutSession(mockEnv, ORG_ID, ORIGIN, {
      amountCents: 5000,
      anonymous: false,
      buyerEmail: "survivor@example.test",
      buyerName: "Survivor Donor",
      checkoutRequestId,
      marketingConsent: true,
      tributeName: "",
      tributeNotifyEmail: "",
      tributeType: "none",
    });

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Stripe network error"));

    await expect(
      createDonationCheckoutSession(mockEnv, ORG_ID, ORIGIN, {
        amountCents: 5000,
        anonymous: false,
        buyerEmail: "survivor@example.test",
        buyerName: "Survivor Donor",
        checkoutRequestId,
        marketingConsent: true,
        tributeName: "",
        tributeNotifyEmail: "",
        tributeType: "none",
      }),
    ).rejects.toThrow();

    const stub = stores.get(stores.idFromName(ORG_ID));
    const status = await runInDurableObject<OrganizationStore, string>(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ readonly status: string }>(
          `SELECT status FROM donations WHERE id = ?`,
          first.donation.id,
        )
        .one();
      return row.status;
    });
    expect(status).toBe("pending");
  });
});
