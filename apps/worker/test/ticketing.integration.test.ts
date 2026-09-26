import {
  organizationEventSchema,
  organizationTicketOrderSchema,
  organizationTicketOrdersResponseSchema,
  organizationVenueSchema,
  publicTicketPurchaseResponseSchema,
  publishedOrganizationProjectionSchema,
  ticketCheckoutResponseSchema,
  ticketScanResponseSchema,
  donationSettingsResponseSchema,
  organizationPaymentSettingsResponseSchema,
  transactionFeeSettingsResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueSignedLink } from "../src/security/signedLinks";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

async function triggerScheduler(stub: DurableObjectStub<OrganizationStore>): Promise<void> {
  const overdueAt = new Date(Date.now() - 1_000).toISOString();
  await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1",
      overdueAt,
      overdueAt,
    );
    return state.storage.setAlarm(Date.now() + 60_000).then(() => undefined);
  });
  await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
}
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

describe("Organization ticketing", () => {
  it("persists donation levels and serves them on the public Organization host", async () => {
    const cookie = await signIn();
    const initial = donationSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/donation-settings", cookie),
        )
      ).json(),
    );
    expect(initial.levels).toHaveLength(4);

    const updated = {
      buttonText: "Support the next concert",
      description: "Help us bring live choral music to more neighbors.",
      levels: [
        {
          amountCents: 7_500,
          benefit: "Name in the concert program",
          id: "community-friend",
          label: "Community friend",
        },
      ],
    };
    const saved = donationSettingsResponseSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/donation-settings",
          "PUT",
          updated,
          cookie,
        )
      ).json(),
    );
    expect(saved).toMatchObject(updated);

    const publicSettings = donationSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(api("tickets.example.test", "/api/public/donation-settings"))
      ).json(),
    );
    expect(publicSettings).toMatchObject(updated);
  });

  it("persists transaction fees and serves them on the public Organization host", async () => {
    const cookie = await signIn();
    const initial = transactionFeeSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/transaction-fee-settings", cookie),
        )
      ).json(),
    );
    expect(initial).toMatchObject({ fixedCents: 30, passFeeToDonor: false, percentage: 2.9 });

    const updated = { fixedCents: 45, passFeeToDonor: true, percentage: 3.25 };
    const saved = transactionFeeSettingsResponseSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/transaction-fee-settings",
          "PUT",
          updated,
          cookie,
        )
      ).json(),
    );
    expect(saved).toMatchObject(updated);

    const publicSettings = transactionFeeSettingsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("tickets.example.test", "/api/public/transaction-fee-settings"),
        )
      ).json(),
    );
    expect(publicSettings).toMatchObject(updated);
  });

  it("shows payment readiness to managers and keeps activation fail-closed", async () => {
    const cookie = await signIn();
    const settingsResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/payment-settings", cookie),
    );
    expect(settingsResponse.status).toBe(200);
    const settings = organizationPaymentSettingsResponseSchema.parse(await settingsResponse.json());
    expect(settings.activations).toEqual({ donations: false, dues: false, tickets: false });
    expect(settings.globalPaymentsEnabled).toBe(false);
    expect(settings.stripe.status).toBe("not_started");

    const notReady = await jsonWrite(
      "alpha.localhost",
      "/api/organization/payment-settings/activation",
      "POST",
      { confirm: true, enabled: true, moduleId: "tickets" },
      cookie,
    );
    expect(notReady.status).toBe(409);
    expect(await notReady.json()).toMatchObject({ code: "payments_not_ready" });

    const memberResponse = await exports.default.fetch(
      api("bravo.localhost", "/api/organization/payment-settings", cookie),
    );
    expect(memberResponse.status).toBe(403);
  });

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
          { eventId: event.id, token: `${receipt.scanToken ?? ""}x` },
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
    expect(willCall.headers.get("content-disposition")).toContain("will-call-winter-tickets.csv");
    expect(await willCall.text()).toContain('"Ticket Buyer","buyer@example.test","2"');
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

  it("queues one confirmation and one 24-hour reminder through the durable ticket outbox", async () => {
    const cookie = await signIn();
    const startsAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
    const event = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          {
            advancePriceCents: 1_500,
            callTime: "",
            dayOfPriceCents: 1_500,
            details: "",
            doorsOpenTime: "",
            durationMinutes: 60,
            isTicketingEnabled: true,
            location: "Hall",
            parentPerformanceId: null,
            publicDetails: "",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            setList: [],
            setListApproved: false,
            startsAt,
            ticketCapacity: 20,
            title: "Tomorrow Concert",
            type: "Performance",
            rsvpDeadlineDate: "2030-01-01",
            venueId: null,
          },
          cookie,
        )
      ).json(),
    );
    expect(
      (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "reminder@example.test",
          buyerName: "Reminder Buyer",
          checkoutRequestId: crypto.randomUUID(),
          eventId: event.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).status,
    ).toBe(201);
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const overdueAt = new Date(Date.now() - 1_000).toISOString();
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE scheduler_state SET next_due_at = ?, updated_at = ? WHERE singleton = 1",
        overdueAt,
        overdueAt,
      );
      return state.storage.setAlarm(Date.now() + 60_000).then(() => undefined);
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const notificationKinds = await runInDurableObject<OrganizationStore, string[]>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<Record<string, SqlStorageValue> & { kind: string }>(
            "SELECT kind FROM ticket_notifications ORDER BY kind",
          )
          .toArray()
          .map(({ kind }) => kind),
    );
    expect(notificationKinds).toEqual(["confirmation", "reminder"]);
    await deliverQueuedTicketNotification("organization-alpha");
    await deliverQueuedTicketNotification("organization-alpha");
    expect(
      await runInDurableObject<OrganizationStore, number>(
        stub,
        (_instance, state) =>
          state.storage.sql
            .exec<Record<string, SqlStorageValue> & { count: number }>(
              "SELECT COUNT(*) AS count FROM ticket_notifications WHERE status = 'sent'",
            )
            .one().count,
      ),
    ).toBe(2);
  });

  it("handles receipt lifecycle across pending, paid, refunded, and expired states with scanToken invariants", async () => {
    const cookie = await signIn();
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
            rsvpDeadlineDate: "2026-10-10",
            rsvpFollowUpLeadHours: null,
            rsvpFollowUpMode: "inherit",
            setList: [],
            setListApproved: false,
            startsAt: "2026-10-15T19:00:00Z",
            ticketCapacity: 50,
            title: "Receipt Invariant Concert",
            type: "Performance",
            venueId: null,
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

  it("wakes the Organization scheduler promptly on Stripe ticket completion and enqueues confirmation", async () => {
    const cookie = await signIn();
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
            details: "Stripe fulfillment test performance",
            doorsOpenTime: "18:30",
            durationMinutes: 90,
            isTicketingEnabled: true,
            location: "Hall A",
            parentPerformanceId: null,
            publicDetails: "Public notes",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            rsvpDeadlineDate: "2026-10-10",
            rsvpFollowUpLeadHours: null,
            rsvpFollowUpMode: "inherit",
            setList: [],
            setListApproved: false,
            startsAt: "2026-10-15T19:00:00Z",
            ticketCapacity: 50,
            title: "Stripe Fulfillment Event",
            type: "Performance",
            venueId: null,
          },
          cookie,
        )
      ).json(),
    );
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event.id}/tickets/settings`,
      "PUT",
      {
        currency: "usd",
        enabled: true,
        pricingTiers: [
          {
            capacity: 50,
            description: "General admission",
            id: "tier-general",
            name: "General",
            priceCents: 2_500,
          },
        ],
        salesCutoffMinutes: 60,
        salesOpen: true,
        timezone: "America/New_York",
      },
      cookie,
    );

    const stub = stores.get(stores.idFromName("organization-alpha"));
    const pendingPurchaseId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const pendingSessionId = `pending_session_${pendingPurchaseId}`;
    const providerPaymentId = `pi_${pendingPurchaseId}`;
    const stripeEventId = `evt_stripe_${pendingPurchaseId}`;

    // 1. Create a Stripe pending purchase
    const pendingResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "create_stripe_pending",
          checkout: {
            buyerEmail: "stripe.buyer@example.test",
            buyerName: "Stripe Buyer",
            checkoutRequestId,
            eventId: event.id,
            marketingOptIn: false,
            quantity: 2,
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

    // 2. Put Organization alarm sufficiently far in the future
    const distantFutureAlarm = Date.now() + 3_600_000;
    await runInDurableObject<OrganizationStore, undefined>(stub, async (_instance, state) => {
      await state.storage.setAlarm(distantFutureAlarm);
      return undefined;
    });
    const beforeAlarm = await runInDurableObject<OrganizationStore, number | null>(
      stub,
      async (_instance, state) => state.storage.getAlarm(),
    );
    expect(beforeAlarm).toBe(distantFutureAlarm);

    // 3. Invoke stripe_ticket_completed
    const completeResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "stripe_ticket_completed",
          checkoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId,
          providerSessionId: pendingSessionId,
          stripeEventId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(completeResponse.status).toBe(200);

    // 4. Assert purchase is paid, confirmation + outbox exist, and alarm moved promptly forward
    const checkState = await runInDurableObject<
      OrganizationStore,
      {
        alarm: number | null;
        notificationCount: number;
        notificationStatus: string | null;
        outboxCount: number;
        purchaseStatus: string | null;
      }
    >(stub, async (_instance, state) => {
      const alarm = await state.storage.getAlarm();
      const purchase = state.storage.sql
        .exec<{ status: string }>(
          "SELECT status FROM ticket_purchases WHERE id = ? LIMIT 1",
          pendingPurchaseId,
        )
        .toArray()
        .at(0);
      const notification = state.storage.sql
        .exec<{ status: string }>(
          "SELECT status FROM ticket_notifications WHERE purchase_id = ? LIMIT 1",
          pendingPurchaseId,
        )
        .toArray()
        .at(0);
      const outbox = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE kind = 'ticket_notification'",
        )
        .toArray()
        .at(0);
      return {
        alarm,
        notificationCount: notification ? 1 : 0,
        notificationStatus: notification?.status ?? null,
        outboxCount: outbox?.count ?? 0,
        purchaseStatus: purchase?.status ?? null,
      };
    });

    expect(checkState.purchaseStatus).toBe("paid");
    expect(checkState.notificationCount).toBe(1);
    expect(checkState.notificationStatus).toBe("queued");
    expect(checkState.outboxCount).toBe(1);
    expect(checkState.alarm).not.toBeNull();
    expect(checkState.alarm).toBeLessThan(distantFutureAlarm);
    expect(checkState.alarm).toBeLessThanOrEqual(Date.now() + 5_000);

    // 5. Run Durable Object alarm -> marks outbox enqueued
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const enqueuedState = await runInDurableObject<OrganizationStore, boolean>(
      stub,
      (_instance, state) => {
        const outbox = state.storage.sql
          .exec<{ enqueuedAt: string | null }>(
            "SELECT enqueued_at AS enqueuedAt FROM scheduled_job_outbox WHERE kind = 'ticket_notification' LIMIT 1",
          )
          .toArray()
          .at(0);
        return Boolean(outbox?.enqueuedAt);
      },
    );
    expect(enqueuedState).toBe(true);

    // 6. Deliver queued job and assert delivery result recorded
    await deliverQueuedTicketNotification("organization-alpha");
    const deliveredStatus = await runInDurableObject<OrganizationStore, string | null>(
      stub,
      (_instance, state) => {
        const notification = state.storage.sql
          .exec<{ status: string }>(
            "SELECT status FROM ticket_notifications WHERE purchase_id = ? LIMIT 1",
            pendingPurchaseId,
          )
          .toArray()
          .at(0);
        return notification?.status ?? null;
      },
    );
    expect(deliveredStatus).toBe("sent");

    // 7. Replay same Stripe webhook -> assert no duplicate confirmation/outbox work
    const replayResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "stripe_ticket_completed",
          checkoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId,
          providerSessionId: pendingSessionId,
          stripeEventId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toMatchObject({ duplicate: true });

    const postReplayState = await runInDurableObject<
      OrganizationStore,
      { notificationCount: number; outboxCount: number }
    >(stub, (_instance, state) => {
      const notifications = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ?",
          pendingPurchaseId,
        )
        .toArray()
        .at(0);
      const outbox = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE kind = 'ticket_notification'",
        )
        .toArray()
        .at(0);
      return {
        notificationCount: notifications?.count ?? 0,
        outboxCount: outbox?.count ?? 0,
      };
    });
    expect(postReplayState.notificationCount).toBe(1);
    expect(postReplayState.outboxCount).toBe(1);
  });

  it("handles ticket reminder creation and delivery when performances are rescheduled before or after reminders exist", async () => {
    const cookie = await signIn();
    const eventBody = {
      advancePriceCents: 1_500,
      callTime: "",
      dayOfPriceCents: 1_500,
      details: "",
      doorsOpenTime: "",
      durationMinutes: 60,
      isTicketingEnabled: true,
      location: "Grand Hall",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: true,
      setList: [],
      setListApproved: false,
      ticketCapacity: 20,
      title: "Reschedule Test Concert",
      type: "Performance" as const,
      rsvpDeadlineDate: "2030-01-01",
      venueId: null,
    };
    const now = Date.now();

    // SCENARIO 1: Rescheduled before any reminder exists
    // 1. Create event 5 days in the future
    const event1StartsAt = new Date(now + 120 * 60 * 60 * 1000).toISOString();
    const event1 = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          { ...eventBody, startsAt: event1StartsAt, title: "Future Concert 1" },
          cookie,
        )
      ).json(),
    );
    // Paid checkout
    const checkout1 = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "reschedule1@example.test",
          buyerName: "Buyer 1",
          checkoutRequestId: crypto.randomUUID(),
          eventId: event1.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).json(),
    );
    expect(checkout1.purchase.status).toBe("paid");

    const stub = stores.get(stores.idFromName("organization-alpha"));

    // 2. Scheduler runs while outside horizon: no reminder generated
    await triggerScheduler(stub);
    const remindersBeforeMove = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'",
            checkout1.purchase.id,
          )
          .one().count,
    );
    expect(remindersBeforeMove).toBe(0);

    // 3. Move event into the 24-hour reminder horizon (e.g. 10 hours from now)
    const revised1StartsAt = new Date(now + 10 * 60 * 60 * 1000).toISOString();
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event1.id}`,
      "PUT",
      { ...eventBody, id: event1.id, startsAt: revised1StartsAt, title: "Future Concert 1" },
      cookie,
    );

    // 4. Scheduler runs inside new horizon: exactly one reminder produced for the new date
    await triggerScheduler(stub);
    const remindersAfterMove = await runInDurableObject<
      OrganizationStore,
      { dedupeKey: string; status: string }[]
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ dedupeKey: string; status: string }>(
          `SELECT dedupe_key AS dedupeKey, status
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'`,
          checkout1.purchase.id,
        )
        .toArray(),
    );
    expect(remindersAfterMove).toHaveLength(1);
    const [firstReminderAfterMove] = remindersAfterMove;
    expect(firstReminderAfterMove?.dedupeKey).toBe(
      `ticket-reminder:${checkout1.purchase.id}:${event1.id}:${revised1StartsAt}`,
    );
    expect(firstReminderAfterMove?.status).toBe("queued");

    // 5. Repeated scheduler runs do not duplicate
    await triggerScheduler(stub);
    const countAfterReplay1 = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'",
            checkout1.purchase.id,
          )
          .one().count,
    );
    expect(countAfterReplay1).toBe(1);

    // Deliver confirmation and reminder
    await deliverQueuedTicketNotification("organization-alpha"); // confirmation
    await deliverQueuedTicketNotification("organization-alpha"); // reminder
    const sentCount1 = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder' AND status = 'sent'",
            checkout1.purchase.id,
          )
          .one().count,
    );
    expect(sentCount1).toBe(1);

    // SCENARIO 2: Rescheduled after reminder was sent
    // 1. Move event1 to 4 days out (outside horizon)
    const laterStartsAt = new Date(now + 96 * 60 * 60 * 1000).toISOString();
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event1.id}`,
      "PUT",
      { ...eventBody, id: event1.id, startsAt: laterStartsAt, title: "Future Concert 1" },
      cookie,
    );

    // 2. Scheduler runs outside new horizon: no second reminder yet
    await triggerScheduler(stub);
    const countOutside2 = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'",
            checkout1.purchase.id,
          )
          .one().count,
    );
    expect(countOutside2).toBe(1);

    // 3. Move event1 to 8 hours out (inside new horizon)
    const secondRevisedStartsAt = new Date(now + 8 * 60 * 60 * 1000).toISOString();
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event1.id}`,
      "PUT",
      { ...eventBody, id: event1.id, startsAt: secondRevisedStartsAt, title: "Future Concert 1" },
      cookie,
    );

    // 4. Scheduler runs inside new horizon: second reminder is produced
    await triggerScheduler(stub);
    const remindersAfterSecondMove = await runInDurableObject<
      OrganizationStore,
      { dedupeKey: string; status: string }[]
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ dedupeKey: string; status: string }>(
          `SELECT dedupe_key AS dedupeKey, status
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'
           ORDER BY created_at`,
          checkout1.purchase.id,
        )
        .toArray(),
    );
    expect(remindersAfterSecondMove).toHaveLength(2);
    const [firstHistorical, secondQueued] = remindersAfterSecondMove;
    // Historical first reminder is still sent
    expect(firstHistorical?.status).toBe("sent");
    expect(firstHistorical?.dedupeKey).toBe(
      `ticket-reminder:${checkout1.purchase.id}:${event1.id}:${revised1StartsAt}`,
    );
    // Second reminder is queued
    expect(secondQueued?.status).toBe("queued");
    expect(secondQueued?.dedupeKey).toBe(
      `ticket-reminder:${checkout1.purchase.id}:${event1.id}:${secondRevisedStartsAt}`,
    );

    // 5. Repeated scheduler runs do not duplicate
    await triggerScheduler(stub);
    const countAfterReplay2 = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'",
            checkout1.purchase.id,
          )
          .one().count,
    );
    expect(countAfterReplay2).toBe(2);

    // Deliver second reminder
    await deliverQueuedTicketNotification("organization-alpha");
    const finalSentCount = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder' AND status = 'sent'",
            checkout1.purchase.id,
          )
          .one().count,
    );
    expect(finalSentCount).toBe(2);

    // SCENARIO 3: Rescheduled while old reminder is queued
    // 1. Create a new event within 24h horizon
    const event2StartsAt = new Date(now + 14 * 60 * 60 * 1000).toISOString();
    const event2 = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          { ...eventBody, startsAt: event2StartsAt, title: "Queued Reschedule Concert" },
          cookie,
        )
      ).json(),
    );
    const checkout2 = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "queued.reschedule@example.test",
          buyerName: "Buyer 2",
          checkoutRequestId: crypto.randomUUID(),
          eventId: event2.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).json(),
    );
    // Deliver confirmation for checkout2
    await deliverQueuedTicketNotification("organization-alpha");

    // 2. Scheduler runs and creates reminder for original date (queued)
    await triggerScheduler(stub);
    const queuedReminder = await runInDurableObject<
      OrganizationStore,
      { dedupeKey: string; failureDetail: string; status: string } | undefined
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ dedupeKey: string; failureDetail: string; status: string }>(
          `SELECT dedupe_key AS dedupeKey, status, failure_detail AS failureDetail
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'`,
          checkout2.purchase.id,
        )
        .toArray()
        .at(0),
    );
    expect(queuedReminder?.status).toBe("queued");

    // 3. Before delivery, update event2's start time to 5 days in the future
    const event2RescheduledAt = new Date(now + 120 * 60 * 60 * 1000).toISOString();
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event2.id}`,
      "PUT",
      {
        ...eventBody,
        id: event2.id,
        startsAt: event2RescheduledAt,
        title: "Queued Reschedule Concert",
      },
      cookie,
    );

    // 4. Verify the queued reminder was marked suppressed with 'Performance rescheduled'
    const suppressedReminder = await runInDurableObject<
      OrganizationStore,
      { failureDetail: string; status: string } | undefined
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ failureDetail: string; status: string }>(
          `SELECT status, failure_detail AS failureDetail
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'`,
          checkout2.purchase.id,
        )
        .toArray()
        .at(0),
    );
    expect(suppressedReminder).toMatchObject({
      failureDetail: "Performance rescheduled",
      status: "suppressed",
    });

    // 5. Deliver the queued notification job — verifies it cannot be delivered with old-date semantics
    await deliverQueuedTicketNotification("organization-alpha");
    // Verify it remains suppressed and never reached sent
    const staleReminderAfterDeliver = await runInDurableObject<
      OrganizationStore,
      { failureDetail: string; status: string } | undefined
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ failureDetail: string; status: string }>(
          `SELECT status, failure_detail AS failureDetail
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'`,
          checkout2.purchase.id,
        )
        .toArray()
        .at(0),
    );
    expect(staleReminderAfterDeliver?.status).toBe("suppressed");

    // 6. Move event2 into the horizon (e.g. 5 hours out)
    const event2RevisedStartsAt = new Date(now + 5 * 60 * 60 * 1000).toISOString();
    await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event2.id}`,
      "PUT",
      {
        ...eventBody,
        id: event2.id,
        startsAt: event2RevisedStartsAt,
        title: "Queued Reschedule Concert",
      },
      cookie,
    );

    // 7. Scheduler runs inside new horizon: new reminder is generated for revised occurrence
    await triggerScheduler(stub);
    const event2Reminders = await runInDurableObject<
      OrganizationStore,
      { dedupeKey: string; failureDetail: string; status: string }[]
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ dedupeKey: string; failureDetail: string; status: string }>(
          `SELECT dedupe_key AS dedupeKey, status, failure_detail AS failureDetail
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'
           ORDER BY created_at`,
          checkout2.purchase.id,
        )
        .toArray(),
    );
    expect(event2Reminders).toHaveLength(2);
    const [firstEvent2Reminder, secondEvent2Reminder] = event2Reminders;
    // Historical stale reminder
    expect(firstEvent2Reminder?.status).toBe("suppressed");
    expect(firstEvent2Reminder?.failureDetail).toBe("Performance rescheduled");
    // New reminder for revised occurrence
    expect(secondEvent2Reminder?.status).toBe("queued");
    expect(secondEvent2Reminder?.dedupeKey).toBe(
      `ticket-reminder:${checkout2.purchase.id}:${event2.id}:${event2RevisedStartsAt}`,
    );

    // 8. Deliver new reminder: reaches sent
    await deliverQueuedTicketNotification("organization-alpha");
    const event2FinalSent = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder' AND status = 'sent'",
            checkout2.purchase.id,
          )
          .one().count,
    );
    expect(event2FinalSent).toBe(1);
  });

  it("suppresses queued reminders when an event is canceled or archived", async () => {
    const cookie = await signIn();
    const eventBody = {
      advancePriceCents: 1_500,
      callTime: "",
      dayOfPriceCents: 1_500,
      details: "",
      doorsOpenTime: "",
      durationMinutes: 60,
      isTicketingEnabled: true,
      location: "Grand Hall",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: true,
      setList: [],
      setListApproved: false,
      ticketCapacity: 20,
      title: "Cancellation Test Concert",
      type: "Performance" as const,
      rsvpDeadlineDate: "2030-01-01",
      venueId: null,
    };
    const now = Date.now();
    const startsAt = new Date(now + 12 * 60 * 60 * 1000).toISOString();
    const event = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          { ...eventBody, startsAt },
          cookie,
        )
      ).json(),
    );
    const checkout = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "cancel.test@example.test",
          buyerName: "Cancel Buyer",
          checkoutRequestId: crypto.randomUUID(),
          eventId: event.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).json(),
    );
    await deliverQueuedTicketNotification("organization-alpha"); // confirmation

    const stub = stores.get(stores.idFromName("organization-alpha"));
    await triggerScheduler(stub);

    // Cancel the event
    const cancelRes = await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${event.id}/cancel`,
      "POST",
      {},
      cookie,
    );
    expect(cancelRes.status).toBe(200);

    // Check that the queued reminder was marked suppressed
    const reminderStatus = await runInDurableObject<
      OrganizationStore,
      { failureDetail: string; status: string } | undefined
    >(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ failureDetail: string; status: string }>(
          `SELECT status, failure_detail AS failureDetail
           FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'`,
          checkout.purchase.id,
        )
        .toArray()
        .at(0),
    );
    expect(reminderStatus).toMatchObject({
      failureDetail: "Performance canceled",
      status: "suppressed",
    });

    // Attempt delivery: handles cleanly without error
    await deliverQueuedTicketNotification("organization-alpha");

    // Re-running scheduler does not recreate reminder for canceled event
    await triggerScheduler(stub);
    const reminderCount = await runInDurableObject<OrganizationStore, number>(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_notifications WHERE purchase_id = ? AND kind = 'reminder'",
            checkout.purchase.id,
          )
          .one().count,
    );
    expect(reminderCount).toBe(1);
  });
});
