import {
  organizationEventSchema,
  organizationTicketOrderSchema,
  organizationTicketOrdersResponseSchema,
  organizationVenueSchema,
  publicTicketPurchaseResponseSchema,
  publishedOrganizationProjectionSchema,
  ticketCheckoutResponseSchema,
  ticketScanResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueSignedLink } from "../src/security/signedLinks";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  setupTicketingIntegration,
  teardownTicketingIntegration,
  stores,
  api,
  jsonWrite,
  signIn,
  deliverQueuedTicketNotification,
} from "./ticketing.integration.fixture";

beforeEach(async () => setupTicketingIntegration());
afterEach(async () => teardownTicketingIntegration());

describe("Organization ticketing lifecycle", () => {
  it("creates replay-safe isolated fake orders with capacity and signed receipt protection", async () => {
    const cookie = await signIn();
    const setupHealth = await exports.default.fetch(
      api("alpha.localhost", "/api/setup/health", cookie),
    );
    expect(setupHealth.status).toBe(200);
    expect(await setupHealth.json()).toMatchObject({ organizationId: "organization-alpha" });
    const maintenance = await exports.default.fetch(
      api("alpha.localhost", "/api/platform/maintenance/run", cookie),
    );
    expect(maintenance.status).toBe(200);
    expect(await maintenance.json()).toMatchObject({
      organizationId: "organization-alpha",
      success: true,
    });
    const stripeWebhook = await jsonWrite("alpha.localhost", "/api/webhook/stripe", "POST", {
      id: "evt_fake",
      type: "checkout.session.completed",
    });
    expect(stripeWebhook.status).toBe(200);
    expect(await stripeWebhook.json()).toMatchObject({ mode: "fake", received: true });
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
            details: "Private backstage details",
            doorsOpenTime: "18:30",
            durationMinutes: 90,
            isTicketingEnabled: true,
            location: "Downtown",
            parentPerformanceId: null,
            publicDetails: "A public concert.",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            setList: [],
            setListApproved: false,
            startsAt: "2027-12-20T00:00:00.000Z",
            ticketCapacity: 3,
            title: "Winter Tickets",
            type: "Performance",
            rsvpDeadlineDate: "2030-01-01",
            venueId: venue.id,
          },
          cookie,
        )
      ).json(),
    );
    expect(
      (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/website/publish", cookie, { method: "POST" }),
        )
      ).status,
    ).toBe(200);
    const projection = publishedOrganizationProjectionSchema.parse(
      await (
        await exports.default.fetch(api("tickets.example.test", "/api/public/projection"))
      ).json(),
    );
    expect(projection.payload.performances[0]).toMatchObject({
      advancePriceCents: 2_000,
      id: event.id,
      isTicketingEnabled: true,
      ticketCapacity: 3,
    });
    expect(JSON.stringify(projection)).not.toContain("Private backstage details");

    const checkoutRequestId = "88888888-8888-4888-8888-888888888888";
    const checkoutBody = {
      buyerEmail: "buyer@example.test",
      buyerName: "Ticket Buyer",
      checkoutRequestId,
      eventId: event.id,
      marketingOptIn: true,
      quantity: 2,
    };
    const firstResponse = await jsonWrite(
      "tickets.example.test",
      "/api/public/tickets/checkout",
      "POST",
      checkoutBody,
    );
    expect(firstResponse.status).toBe(201);
    const first = ticketCheckoutResponseSchema.parse(await firstResponse.json());
    expect(first).toMatchObject({
      checkoutMode: "fake",
      purchase: {
        buyerName: "Ticket Buyer",
        eventId: event.id,
        quantity: 2,
        status: "paid",
        unitPriceCents: 2_000,
        venueAddress: "1 Stage Road",
        venueName: "Main Hall",
      },
    });
    expect(first.url).toContain("http://tickets.example.test/tickets/order/success?token=");
    await deliverQueuedTicketNotification("organization-alpha");
    expect(
      await runInDurableObject<OrganizationStore, Record<string, SqlStorageValue>>(
        stores.get(stores.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<Record<string, SqlStorageValue>>(
              `SELECT kind, status, provider_message_id AS providerMessageId
               FROM ticket_notifications WHERE purchase_id = ?`,
              first.purchase.id,
            )
            .one(),
      ),
    ).toMatchObject({
      kind: "confirmation",
      providerMessageId: expect.stringContaining("fake:"),
      status: "sent",
    });
    expect(
      (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/tickets/${first.purchase.id}/confirmation`,
            cookie,
            { method: "POST" },
          ),
        )
      ).status,
    ).toBe(200);
    await deliverQueuedTicketNotification("organization-alpha");
    expect(
      await runInDurableObject<OrganizationStore, number>(
        stores.get(stores.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<Record<string, SqlStorageValue> & { count: number }>(
              "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'confirmation' AND status = 'sent'",
              first.purchase.id,
            )
            .one().count,
      ),
    ).toBe(2);
    const resend = await jsonWrite(
      "alpha.localhost",
      `/api/organization/tickets/${encodeURIComponent(first.purchase.id)}/confirmation`,
      "POST",
      { recipientEmail: "replacement@example.test" },
      cookie,
    );
    expect(resend.status).toBe(200);
    expect(
      await runInDurableObject<OrganizationStore, string>(
        stores.get(stores.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<{ destination: string }>(
              "SELECT destination FROM ticket_notifications WHERE purchase_id = ? ORDER BY created_at DESC LIMIT 1",
              first.purchase.id,
            )
            .one().destination,
      ),
    ).toBe("replacement@example.test");

    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          `/api/organization/events/${event.id}`,
          "PUT",
          { ...event, ticketCapacity: 1 },
          cookie,
        )
      ).status,
    ).toBe(409);

    const replay = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("alpha.localhost", "/api/public/tickets/checkout", "POST", checkoutBody)
      ).json(),
    );
    expect(replay.purchase.id).toBe(first.purchase.id);
    expect(
      (
        await jsonWrite("alpha.localhost", "/api/public/tickets/checkout", "POST", {
          ...checkoutBody,
          quantity: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          ...checkoutBody,
          checkoutRequestId: crypto.randomUUID(),
          quantity: 2,
        })
      ).status,
    ).toBe(409);

    const receipt = publicTicketPurchaseResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "tickets.example.test",
            `/api/public/tickets/order?token=${encodeURIComponent(first.successToken)}`,
          ),
        )
      ).json(),
    );
    expect(receipt.id).toBe(first.purchase.id);
    expect(receipt.scanToken).toBeTruthy();
    // Simulate a printed legacy code issued long before the event, with its old timeout elapsed.
    const legacyIssuedAt = Math.floor(Date.now() / 1000) - 86400 * 365;
    const legacyNonce = crypto.randomUUID();
    await runInDurableObject(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance: OrganizationStore, state) => {
        state.storage.sql.exec(
          "UPDATE ticket_purchases SET scan_credential_nonce = ?, scan_credential_issued_at = ?, scan_credential_expires_at = ? WHERE id = ?",
          legacyNonce,
          legacyIssuedAt,
          legacyIssuedAt + 900,
          receipt.id,
        );
      },
    );
    const printedToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      expiresAt: legacyIssuedAt + 900,
      issuedAt: legacyIssuedAt,
      nonce: legacyNonce,
      organizationId: "organization-alpha",
      purpose: "ticket_scan",
      resourceId: receipt.id,
      version: 1,
    });
    const reopened = publicTicketPurchaseResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "tickets.example.test",
            `/api/public/tickets/order?token=${encodeURIComponent(first.successToken)}`,
          ),
        )
      ).json(),
    );
    expect(reopened.scanToken).toBe(printedToken);
    receipt.scanToken = printedToken;

    expect(receipt.venueName).toBe("Main Hall");
    expect(receipt.venueAddress).toBe("1 Stage Road");
    expect(JSON.stringify(receipt)).not.toContain("buyer@example.test");
    expect(
      (
        await exports.default.fetch(
          api(
            "bravo.localhost",
            `/api/public/tickets/order?token=${encodeURIComponent(first.successToken)}`,
          ),
        )
      ).status,
    ).toBe(404);

    const scan = ticketScanResponseSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/scan",
          "POST",
          { eventId: event.id, token: receipt.scanToken },
          cookie,
        )
      ).json(),
    );
    expect(scan).toMatchObject({
      buyerName: "Ticket Buyer",
      eventId: event.id,
      purchaseId: first.purchase.id,
      quantity: 2,
      valid: true,
    });
    expect(
      ticketScanResponseSchema.parse(
        await (
          await jsonWrite(
            "alpha.localhost",
            "/api/organization/tickets/scan",
            "POST",
            { eventId: crypto.randomUUID(), token: receipt.scanToken },
            cookie,
          )
        ).json(),
      ),
    ).toMatchObject({ reason: "wrong_event", valid: false });
    expect(
      (
        await jsonWrite(
          "bravo.localhost",
          "/api/organization/tickets/scan",
          "POST",
          { eventId: event.id, token: receipt.scanToken },
          cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/scan",
          "POST",
          { eventId: event.id, token: `${receipt.scanToken}x` },
          cookie,
        )
      ).status,
    ).toBe(404);

    const willCall = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/tickets/will-call?eventId=${encodeURIComponent(event.id)}`,
        cookie,
      ),
    );
    expect(willCall.status).toBe(200);
    expect(willCall.headers.get("content-type")).toContain("text/csv");
    expect(willCall.headers.get("content-disposition")).toMatch(
      /will-call-winter-tickets_[0-9]{4}-[A-Z][a-z]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}-(AM|PM)-UTC\.csv/,
    );
    expect(await willCall.text()).toContain('"Ticket Buyer","Buyer","buyer@example.test","2"');
    expect(
      (
        await exports.default.fetch(
          api(
            "bravo.localhost",
            `/api/organization/tickets/will-call?eventId=${encodeURIComponent(event.id)}`,
            cookie,
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (await jsonWrite("unknown.localhost", "/api/public/tickets/checkout", "POST", checkoutBody))
        .status,
    ).toBe(404);

    const ordersResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/tickets/orders", cookie),
    );
    expect(ordersResponse.status).toBe(200);
    const orders = organizationTicketOrdersResponseSchema.parse(await ordersResponse.json()).orders;
    expect(orders).toHaveLength(1);
    expect(orders[0]?.buyerEmail).toBe("buyer@example.test");
    expect(
      (
        await exports.default.fetch(
          api("bravo.localhost", "/api/organization/tickets/orders", cookie),
        )
      ).status,
    ).toBe(403);

    const refundResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/tickets/${first.purchase.id}/refund`, cookie, {
        method: "POST",
      }),
    );
    expect(refundResponse.status).toBe(200);
    expect(organizationTicketOrderSchema.parse(await refundResponse.json()).status).toBe(
      "refunded",
    );
    expect(
      ticketScanResponseSchema.parse(
        await (
          await jsonWrite(
            "alpha.localhost",
            "/api/organization/tickets/scan",
            "POST",
            { eventId: event.id, token: receipt.scanToken },
            cookie,
          )
        ).json(),
      ),
    ).toMatchObject({ reason: "not_paid", valid: false });
    expect(
      (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/tickets/${first.purchase.id}/refund`, cookie, {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(200);
    const concurrentStatuses = await Promise.all(
      [crypto.randomUUID(), crypto.randomUUID()].map(
        async (requestId) =>
          (
            await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
              ...checkoutBody,
              checkoutRequestId: requestId,
              quantity: 2,
            })
          ).status,
      ),
    );
    expect(concurrentStatuses.toSorted()).toEqual([201, 409]);

    const canonicalCheckout = await jsonWrite(
      "tickets.example.test",
      "/api/public/tickets/checkout",
      "POST",
      {
        buyerEmail: "buyer2@example.test",
        buyerName: "Second Buyer",
        checkoutRequestId: crypto.randomUUID(),
        eventId: event.id,
        marketingOptIn: false,
        quantity: 1,
      },
    );
    expect(canonicalCheckout.status).toBe(201);

    const actions = await runInDurableObject<OrganizationStore, string[]>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<Record<string, SqlStorageValue> & { action: string }>(
            `SELECT action FROM audit_events
             WHERE action LIKE 'ticket.%' ORDER BY occurred_at, id`,
          )
          .toArray()
          .map(({ action }) => action),
    );
    expect(actions).toEqual([
      "ticket.purchase.fulfilled",
      "ticket.confirmation.queued",
      "ticket.confirmation.queued",
      "ticket.scan_credential.issued",
      "ticket.scan.validated",
      "ticket.scan.replayed",
      "ticket.scan.validated",
      "ticket.refund.notification.queued",
      "ticket.purchase.refunded",
      "ticket.scan.replayed",
      "ticket.scan.validated",
      "ticket.purchase.fulfilled",
      "ticket.purchase.fulfilled",
    ]);
  });

  it("handles receipt lifecycle across pending, paid, refunded, and expired states with scanToken invariants", async () => {
    const cookie = await signIn();
    const receiptVenue = organizationVenueSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/venues",
          "POST",
          { address: "3 Receipt Way", name: "Receipt Hall" },
          cookie,
        )
      ).json(),
    );
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
            details: "Receipt lifecycle performance",
            doorsOpenTime: "18:30",
            durationMinutes: 90,
            isTicketingEnabled: true,
            location: "Hall A",
            parentPerformanceId: null,
            publicDetails: "Public notes",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            rsvpDeadlineDate: "2027-10-10",
            rsvpFollowUpLeadHours: null,
            rsvpFollowUpMode: "inherit",
            setList: [],
            setListApproved: false,
            startsAt: "2027-10-15T19:00:00Z",
            ticketCapacity: 50,
            title: "Receipt Invariant Concert",
            type: "Performance",
            venueId: receiptVenue.id,
          },
          cookie,
        )
      ).json(),
    );

    const pendingPurchaseId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const pendingSessionId = `pending_${pendingPurchaseId}`;

    // 1. Create a real Stripe pending purchase
    const pendingResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "create_stripe_pending",
          checkout: {
            buyerEmail: "pending.buyer@example.test",
            buyerName: "Pending Buyer",
            checkoutRequestId,
            eventId: event.id,
            marketingOptIn: false,
            quantity: 1,
          },
          organizationId: "organization-alpha",
          providerSessionId: pendingSessionId,
          purchaseId: pendingPurchaseId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(pendingResponse.status).toBe(201);

    const issuedAt = Math.floor(Date.now() / 1000);
    const receiptToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      expiresAt: issuedAt + 86400,
      issuedAt,
      nonce: crypto.randomUUID(),
      organizationId: "organization-alpha",
      purpose: "ticket_receipt",
      resourceId: pendingPurchaseId,
      version: 1,
    });

    // 2. Pending purchase -> 200, status: "pending", scanToken: null
    const pendingReceiptRes = await exports.default.fetch(
      api(
        "tickets.example.test",
        `/api/public/tickets/order?token=${encodeURIComponent(receiptToken)}`,
      ),
    );
    expect(pendingReceiptRes.status).toBe(200);
    const pendingReceipt = publicTicketPurchaseResponseSchema.parse(await pendingReceiptRes.json());
    expect(pendingReceipt.id).toBe(pendingPurchaseId);
    expect(pendingReceipt.status).toBe("pending");
    expect(pendingReceipt.scanToken).toBeNull();

    // 3. Invalid receipt token -> 404
    const invalidTokenRes = await exports.default.fetch(
      api("tickets.example.test", `/api/public/tickets/order?token=invalid.tampered.token`),
    );
    expect(invalidTokenRes.status).toBe(404);
    expect(await invalidTokenRes.json()).toMatchObject({ code: "not_found" });

    // 4. Valid token on wrong Organization host -> 404
    const wrongHostRes = await exports.default.fetch(
      api("bravo.localhost", `/api/public/tickets/order?token=${encodeURIComponent(receiptToken)}`),
    );
    expect(wrongHostRes.status).toBe(404);
    expect(await wrongHostRes.json()).toMatchObject({ code: "not_found" });

    // 5. Complete payment -> 200, status: "paid", non-empty scanToken
    const completeResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "stripe_ticket_completed",
          checkoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId: `pi_${pendingPurchaseId}`,
          providerSessionId: pendingSessionId,
          stripeEventId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(completeResponse.status).toBe(200);

    const paidReceiptRes = await exports.default.fetch(
      api(
        "tickets.example.test",
        `/api/public/tickets/order?token=${encodeURIComponent(receiptToken)}`,
      ),
    );
    expect(paidReceiptRes.status).toBe(200);
    const paidReceipt = publicTicketPurchaseResponseSchema.parse(await paidReceiptRes.json());
    expect(paidReceipt.status).toBe("paid");
    expect(typeof paidReceipt.scanToken === "string" && paidReceipt.scanToken.length > 0).toBe(
      true,
    );

    // 6. Refund purchase -> 200, status: "refunded", scanToken: null
    const refundResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "stripe_ticket_refunded",
          checkoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId: `pi_${pendingPurchaseId}`,
          providerSessionId: pendingSessionId,
          stripeEventId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(refundResponse.status).toBe(200);

    const refundedReceiptRes = await exports.default.fetch(
      api(
        "tickets.example.test",
        `/api/public/tickets/order?token=${encodeURIComponent(receiptToken)}`,
      ),
    );
    expect(refundedReceiptRes.status).toBe(200);
    const refundedReceipt = publicTicketPurchaseResponseSchema.parse(
      await refundedReceiptRes.json(),
    );
    expect(refundedReceipt.status).toBe("refunded");
    expect(refundedReceipt.scanToken).toBeNull();

    // 7. Expired purchase -> 200, status: "expired", scanToken: null
    const expiredPurchaseId = crypto.randomUUID();
    const expiredCheckoutRequestId = crypto.randomUUID();
    const expiredSessionId = `pending_${expiredPurchaseId}`;
    await stub.fetch("https://organization.internal/internal/ticketing/manage", {
      body: JSON.stringify({
        action: "create_stripe_pending",
        checkout: {
          buyerEmail: "expired.buyer@example.test",
          buyerName: "Expired Buyer",
          checkoutRequestId: expiredCheckoutRequestId,
          eventId: event.id,
          marketingOptIn: false,
          quantity: 1,
        },
        organizationId: "organization-alpha",
        providerSessionId: expiredSessionId,
        purchaseId: expiredPurchaseId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await stub.fetch("https://organization.internal/internal/ticketing/manage", {
      body: JSON.stringify({
        action: "stripe_ticket_expired",
        checkoutRequestId: expiredCheckoutRequestId,
        organizationId: "organization-alpha",
        providerPaymentId: "",
        providerSessionId: expiredSessionId,
        stripeEventId: crypto.randomUUID(),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const expiredToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      expiresAt: issuedAt + 86400,
      issuedAt,
      nonce: crypto.randomUUID(),
      organizationId: "organization-alpha",
      purpose: "ticket_receipt",
      resourceId: expiredPurchaseId,
      version: 1,
    });
    const expiredReceiptRes = await exports.default.fetch(
      api(
        "tickets.example.test",
        `/api/public/tickets/order?token=${encodeURIComponent(expiredToken)}`,
      ),
    );
    expect(expiredReceiptRes.status).toBe(200);
    const expiredReceipt = publicTicketPurchaseResponseSchema.parse(await expiredReceiptRes.json());
    expect(expiredReceipt.status).toBe("expired");
    expect(expiredReceipt.scanToken).toBeNull();

    // 8. Injected internal receipt-service failure -> 503 rather than being masked as 404
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE ticket_purchases SET event_starts_at = 'invalid-datetime' WHERE id = ?",
        pendingPurchaseId,
      );
    });
    const errorReceiptRes = await exports.default.fetch(
      api(
        "tickets.example.test",
        `/api/public/tickets/order?token=${encodeURIComponent(receiptToken)}`,
      ),
    );
    expect(errorReceiptRes.status).toBe(503);
    expect(await errorReceiptRes.json()).toMatchObject({ code: "ticket_order_unavailable" });
  });
});
