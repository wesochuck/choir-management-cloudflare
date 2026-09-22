import { organizationEventSchema, organizationVenueSchema } from "@choir/contracts";
import { exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  api,
  jsonWrite,
  setupTicketingIntegration,
  signIn,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

beforeEach(async () => setupTicketingIntegration());
afterEach(async () => teardownTicketingIntegration());

async function makeCheckoutRequest(
  host: string,
  body: Record<string, unknown>,
  clientIp?: string,
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (clientIp) {
    headers["cf-connecting-ip"] = clientIp;
  }
  return exports.default.fetch(
    api(host, "/api/public/tickets/checkout", undefined, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    }),
  );
}

describe("Public checkout rate limiting and abuse protection", () => {
  it("enforces challenge escalation, hard limits, and protects inventory from unauthenticated abuse", async () => {
    const cookie = await signIn();
    const venue = organizationVenueSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/venues",
          "POST",
          { address: "1 Stage Road", name: "Main Hall" },
          cookie,
        )
      ).json(),
    );
    // Create event with capacity 10
    const event = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          {
            advancePriceCents: 1_000,
            callTime: "18:00",
            dayOfPriceCents: 1_500,
            details: "",
            doorsOpenTime: "18:30",
            durationMinutes: 90,
            isTicketingEnabled: true,
            location: "Downtown",
            parentPerformanceId: null,
            publicDetails: "A concert with limited capacity.",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            setList: [],
            setListApproved: false,
            startsAt: "2027-12-20T00:00:00.000Z",
            ticketCapacity: 100,
            timezone: "America/New_York",
            title: "Capacity Limited Concert",
            type: "Performance",
            rsvpDeadlineDate: "2030-01-01",
            venueId: venue.id,
          },
          cookie,
        )
      ).json(),
    );

    const clientIp = "198.51.100.42";
    const acceptedCheckouts: string[] = [];

    // 1. Initial 5 checkouts succeed with fake mode (each under email & IP challenge threshold)
    for (let i = 1; i <= 5; i++) {
      const checkoutRequestId = crypto.randomUUID();
      const res = await makeCheckoutRequest(
        "tickets.example.test",
        {
          buyerEmail: `buyer${String(i)}@example.test`,
          buyerName: `Buyer ${String(i)}`,
          checkoutRequestId,
          eventId: event.id,
          quantity: 1,
        },
        clientIp,
      );
      expect(res.status).toBe(201);
      acceptedCheckouts.push(checkoutRequestId);
    }

    // 2. 6th request from the same IP reaches the IP challenge threshold (5).
    // Without turnstile token, it must fail with 403 challenge_required
    const unverifiedRequestId = crypto.randomUUID();
    const unverifiedRes = await makeCheckoutRequest(
      "tickets.example.test",
      {
        buyerEmail: "buyer6@example.test",
        buyerName: "Buyer 6",
        checkoutRequestId: unverifiedRequestId,
        eventId: event.id,
        quantity: 1,
      },
      clientIp,
    );
    expect(unverifiedRes.status).toBe(403);
    expect(await unverifiedRes.json()).toMatchObject({
      code: "challenge_required",
    });

    // 3. Attempt with an invalid challenge token fails with 403 invalid_challenge_token
    const invalidTokenRes = await makeCheckoutRequest(
      "tickets.example.test",
      {
        buyerEmail: "buyer6@example.test",
        buyerName: "Buyer 6",
        checkoutRequestId: unverifiedRequestId,
        eventId: event.id,
        quantity: 1,
        turnstileToken: "invalid-token-here",
      },
      clientIp,
    );
    expect(invalidTokenRes.status).toBe(403);
    expect(await invalidTokenRes.json()).toMatchObject({
      code: "invalid_challenge_token",
    });

    // 4. Verify rejected attempts did not create any purchase rows or reserve capacity
    const stub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const purchases = state.storage.sql
        .exec<{ readonly id: string }>(
          "SELECT id FROM ticket_purchases WHERE checkout_request_id = ?",
          unverifiedRequestId,
        )
        .toArray();
      expect(purchases).toHaveLength(0);

      const attempts = state.storage.sql
        .exec<{ readonly id: string }>(
          "SELECT id FROM payment_attempts WHERE checkout_request_id = ?",
          unverifiedRequestId,
        )
        .toArray();
      expect(attempts).toHaveLength(0);
      return null;
    });

    // 5. Attempt with a valid challenge token succeeds
    const verifiedReqId = crypto.randomUUID();
    const verifiedRes = await makeCheckoutRequest(
      "tickets.example.test",
      {
        buyerEmail: "buyer6@example.test",
        buyerName: "Buyer 6",
        checkoutRequestId: verifiedReqId,
        eventId: event.id,
        quantity: 1,
        turnstileToken: "valid-turnstile-token",
      },
      clientIp,
    );
    expect(verifiedRes.status).toBe(201);
    acceptedCheckouts.push(verifiedReqId);

    // 6. Test email-specific challenge threshold:
    // Repeated checkouts with the same email from different IPs trigger challenge on 6th attempt (after 5 initial)
    const targetEmail = "repeat.buyer@example.test";
    for (let i = 1; i <= 5; i++) {
      const emailRes = await makeCheckoutRequest(
        "tickets.example.test",
        {
          buyerEmail: targetEmail,
          buyerName: "Repeat Buyer",
          checkoutRequestId: crypto.randomUUID(),
          eventId: event.id,
          quantity: 1,
        },
        `203.0.113.${String(10 + i)}`,
      );
      expect(emailRes.status).toBe(201);
    }

    // 6th attempt for this email requires challenge even from a new IP
    const emailRes6 = await makeCheckoutRequest(
      "tickets.example.test",
      {
        buyerEmail: targetEmail,
        buyerName: "Repeat Buyer",
        checkoutRequestId: crypto.randomUUID(),
        eventId: event.id,
        quantity: 1,
      },
      "203.0.113.99",
    );
    expect(emailRes6.status).toBe(403);
    expect(await emailRes6.json()).toMatchObject({ code: "challenge_required" });

    // 7. Idempotent replay of an accepted checkout succeeds without consuming quota
    const firstAcceptedId = acceptedCheckouts[0];
    expect(firstAcceptedId).toBeDefined();
    if (firstAcceptedId) {
      const replayRes = await makeCheckoutRequest(
        "tickets.example.test",
        {
          buyerEmail: "buyer1@example.test",
          buyerName: "Buyer 1",
          checkoutRequestId: firstAcceptedId,
          eventId: event.id,
          quantity: 1,
        },
        clientIp,
      );
      expect(replayRes.status).toBe(201);
    }

    // 8. Push IP to hard limit (10 requests)
    for (let i = 6; i <= 10; i++) {
      await makeCheckoutRequest(
        "tickets.example.test",
        {
          buyerEmail: `buyer${String(i)}@example.test`,
          buyerName: `Buyer ${String(i)}`,
          checkoutRequestId: crypto.randomUUID(),
          eventId: event.id,
          quantity: 1,
          turnstileToken: "valid-turnstile-token",
        },
        clientIp,
      );
    }
    // 11th request from clientIp reaches hard cap 429
    const cappedRes = await makeCheckoutRequest(
      "tickets.example.test",
      {
        buyerEmail: "another@example.test",
        buyerName: "Another Buyer",
        checkoutRequestId: crypto.randomUUID(),
        eventId: event.id,
        quantity: 1,
        turnstileToken: "valid-turnstile-token",
      },
      clientIp,
    );
    expect(cappedRes.status).toBe(429);
    expect(cappedRes.headers.get("retry-after")).toBeDefined();
    expect(await cappedRes.json()).toMatchObject({
      code: "public_rate_limit_exceeded",
    });

    // 9. Separate budget for quotes: ticket quotes still succeed from capped clientIp
    const quoteRes = await exports.default.fetch(
      api("tickets.example.test", "/api/public/tickets/quote", undefined, {
        body: JSON.stringify({
          eventId: event.id,
          quantity: 2,
        }),
        headers: {
          "cf-connecting-ip": clientIp,
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(quoteRes.status).toBe(200);

    // 10. Distinct client IP can still checkout
    const distinctIp = "192.0.2.99";
    const distinctRes = await makeCheckoutRequest(
      "tickets.example.test",
      {
        buyerEmail: "distinct@example.test",
        buyerName: "Distinct Buyer",
        checkoutRequestId: crypto.randomUUID(),
        eventId: event.id,
        quantity: 1,
      },
      distinctIp,
    );
    expect(distinctRes.status).toBe(201);
  });

  it("releases inventory promptly when reservation expires and cleanup runs", async () => {
    const cookie = await signIn();
    const venue = organizationVenueSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/venues",
          "POST",
          { address: "2 Park Row", name: "Recital Hall" },
          cookie,
        )
      ).json(),
    );
    // Create event with exact capacity 2
    const event = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          {
            advancePriceCents: 2_000,
            callTime: "18:00",
            dayOfPriceCents: 2_500,
            details: "",
            doorsOpenTime: "18:30",
            durationMinutes: 90,
            isTicketingEnabled: true,
            location: "Uptown",
            parentPerformanceId: null,
            publicDetails: "Exclusive recital.",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            setList: [],
            setListApproved: false,
            startsAt: "2027-12-21T00:00:00.000Z",
            ticketCapacity: 2,
            timezone: "America/New_York",
            title: "Tight Capacity Recital",
            type: "Performance",
            rsvpDeadlineDate: "2030-01-01",
            venueId: venue.id,
          },
          cookie,
        )
      ).json(),
    );

    const stub = stores.get(stores.idFromName("organization-alpha"));

    // Insert a pending reservation that expired 5 minutes ago
    const expiredPurchaseId = crypto.randomUUID();
    const expiredRequestId = crypto.randomUUID();
    const pastTime = new Date(Date.now() - 35 * 60 * 1_000).toISOString();
    const expiredAtDeadline = new Date(Date.now() - 5 * 60 * 1_000).toISOString();

    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases
        (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
         buyer_name, buyer_email, quantity, unit_price_cents, fee_cents,
         amount_paid_cents, currency, provider_session_id, provider_payment_id,
         status, marketing_opt_in, created_at, updated_at, expires_at)
        VALUES (?, ?, ?, 'Tight Capacity Recital', '2027-12-21T00:00:00.000Z', 'America/New_York',
         'Expired Buyer', 'expired@example.test', 2, 2000, 0, 0, 'usd', ?, '', 'pending', 0, ?, ?, ?)`,
        expiredPurchaseId,
        expiredRequestId,
        event.id,
        `sess_${expiredPurchaseId}`,
        pastTime,
        pastTime,
        expiredAtDeadline,
      );
      state.storage.sql.exec(
        `INSERT INTO payment_attempts
        (id, payment_type, resource_id, checkout_request_id, provider_session_id,
         provider_payment_id, status, amount_cents, created_at, updated_at)
        VALUES (?, 'ticket', ?, ?, ?, '', 'pending', 4000, ?, ?)`,
        `pa_${expiredPurchaseId}`,
        expiredPurchaseId,
        expiredRequestId,
        `sess_${expiredPurchaseId}`,
        pastTime,
        pastTime,
      );
      return null;
    });

    // Because the pending purchase's expires_at has passed, committedEventQuantity immediately
    // treats the inventory as free, allowing a new buyer to reserve the remaining 2 tickets!
    const newBuyerRes = await makeCheckoutRequest(
      "tickets.example.test",
      {
        buyerEmail: "newbuyer@example.test",
        buyerName: "New Buyer",
        checkoutRequestId: crypto.randomUUID(),
        eventId: event.id,
        quantity: 2,
      },
      "198.51.100.99",
    );
    expect(newBuyerRes.status).toBe(201);

    // Run cleanup to transition the expired row in storage
    const cleanupRes = await stub.fetch("https://organization.internal/internal/payments/cleanup", {
      body: JSON.stringify({
        now: new Date().toISOString(),
        organizationId: "organization-alpha",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(cleanupRes.status).toBe(200);

    // Verify the old reservation is officially marked 'expired'
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ readonly status: string }>(
          "SELECT status FROM ticket_purchases WHERE id = ?",
          expiredPurchaseId,
        )
        .toArray()
        .at(0);
      expect(row?.status).toBe("expired");
      return null;
    });
  });
});
