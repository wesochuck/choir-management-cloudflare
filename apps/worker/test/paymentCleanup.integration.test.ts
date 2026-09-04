import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

async function provisionCleanupOrganization(): Promise<DurableObjectStub<OrganizationStore>> {
  const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
  const organizationId = "payment-cleanup";
  const stub = stores.get(stores.idFromName(organizationId));
  const response = await stub.fetch("https://organization.internal/internal/provision", {
    body: JSON.stringify({
      actorUserId: "bootstrap",
      canonicalHostname: "payment-cleanup.localhost",
      canonicalStatus: "active",
      name: "Payment Cleanup Organization",
      organizationId,
      requestId: "77777777-7777-4777-8777-777777777777",
      slug: "payment-cleanup",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
  return stub;
}

describe("Organization stale payment cleanup", () => {
  afterEach(async () => {
    await reset();
  });

  it("expires old ticket, donation, and dues records atomically and replays safely", async () => {
    const stub = await provisionCleanupOrganization();
    const now = new Date("2026-08-13T12:00:00.000Z");
    const createdAt = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1_000).toISOString();

    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO seasons (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
         VALUES (?, 'Cleanup season', ?, ?, 1000, ?, ?)`,
        "season-cleanup",
        createdAt,
        now.toISOString(),
        createdAt,
        createdAt,
      );
      state.storage.sql.exec(
        `INSERT INTO dues
          (id, season_id, profile_id, amount_cents, provider_session_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 1000, ?, 'pending', ?, ?)`,
        "dues-cleanup",
        "season-cleanup",
        "profile-cleanup",
        "dues-session-cleanup",
        createdAt,
        createdAt,
      );
      state.storage.sql.exec(
        `INSERT INTO patrons
          (id, name, email, first_donated_at, last_donated_at, created_at, updated_at)
         VALUES (?, 'Cleanup donor', 'cleanup@example.test', ?, ?, ?, ?)`,
        "patron-cleanup",
        createdAt,
        createdAt,
        createdAt,
        createdAt,
      );
      state.storage.sql.exec(
        `INSERT INTO donations
          (id, checkout_request_id, status, amount_cents, buyer_name, buyer_email,
           patron_id, provider_session_id, created_at, updated_at)
         VALUES (?, ?, 'pending', 1000, 'Cleanup donor', 'cleanup@example.test', ?, ?, ?, ?)`,
        "donation-cleanup",
        "donation-request-cleanup",
        "patron-cleanup",
        "donation-session-cleanup",
        createdAt,
        createdAt,
      );
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
          (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents,
           provider_session_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'Cleanup Performance', ?, 'UTC', 'Cleanup buyer',
           'cleanup@example.test', 1, 1000, 0, 0, ?, 'pending', ?, ?)`,
        "ticket-cleanup",
        "ticket-request-cleanup",
        "event-cleanup",
        now.toISOString(),
        "ticket-session-cleanup",
        createdAt,
        createdAt,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
          (id, payment_type, resource_id, checkout_request_id, provider_session_id,
           status, amount_cents, created_at, updated_at)
         VALUES
          ('attempt-ticket-cleanup', 'ticket', 'ticket-cleanup', 'attempt-request-ticket', 'attempt-session-ticket', 'pending', 1000, ?, ?),
          ('attempt-donation-cleanup', 'donation', 'donation-cleanup', 'attempt-request-donation', 'attempt-session-donation', 'pending', 1000, ?, ?),
          ('attempt-dues-cleanup', 'dues', 'dues-cleanup', 'attempt-request-dues', 'attempt-session-dues', 'pending', 1000, ?, ?)`,
        createdAt,
        createdAt,
        createdAt,
        createdAt,
        createdAt,
        createdAt,
      );
      state.storage.sql.exec(
        `INSERT INTO discount_code_redemptions
          (id, discount_code_id, checkout_request_id, purchase_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        "redemption-cleanup",
        "discount-cleanup",
        "redemption-request-cleanup",
        "ticket-cleanup",
        createdAt,
        createdAt,
      );
    });

    const first = await stub.fetch("https://organization.internal/internal/payments/cleanup", {
      body: JSON.stringify({
        now: now.toISOString(),
        organizationId: "payment-cleanup",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ expired: 3 });

    await expect(
      runInDurableObject<
        OrganizationStore,
        {
          readonly donationExpirationCount: number;
          readonly donationStatus: string;
          readonly duesExpirationCount: number;
          readonly duesStatus: string;
          readonly paymentAttemptCount: number;
          readonly redemptionStatus: string;
          readonly ticketStatus: string;
        }
      >(stub, (_instance, state) => ({
        donationExpirationCount: state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM donation_expirations WHERE donation_id = 'donation-cleanup'",
          )
          .one().count,
        donationStatus: state.storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM donations WHERE id = 'donation-cleanup'",
          )
          .one().status,
        duesExpirationCount: state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM dues_expirations WHERE dues_id = 'dues-cleanup'",
          )
          .one().count,
        duesStatus: state.storage.sql
          .exec<{ readonly status: string }>("SELECT status FROM dues WHERE id = 'dues-cleanup'")
          .one().status,
        paymentAttemptCount: state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM payment_attempts WHERE status = 'expired'",
          )
          .one().count,
        redemptionStatus: state.storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM discount_code_redemptions WHERE purchase_id = 'ticket-cleanup'",
          )
          .one().status,
        ticketStatus: state.storage.sql
          .exec<{ readonly status: string }>(
            "SELECT status FROM ticket_purchases WHERE id = 'ticket-cleanup'",
          )
          .one().status,
      })),
    ).resolves.toEqual({
      donationExpirationCount: 1,
      donationStatus: "pending",
      duesExpirationCount: 1,
      duesStatus: "pending",
      paymentAttemptCount: 3,
      redemptionStatus: "released",
      ticketStatus: "expired",
    });

    const replay = await stub.fetch("https://organization.internal/internal/payments/cleanup", {
      body: JSON.stringify({
        now: now.toISOString(),
        organizationId: "payment-cleanup",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({ expired: 0 });

    const wrongOrganization = await stub.fetch(
      "https://organization.internal/internal/payments/cleanup",
      {
        body: JSON.stringify({
          now: now.toISOString(),
          organizationId: "another-organization",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(wrongOrganization.status).toBe(409);
  });
});
