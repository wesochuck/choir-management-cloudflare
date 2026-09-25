import { organizationEventSchema, organizationTicketOrdersResponseSchema } from "@choir/contracts";
import { calculatePaymentFinancialSummary } from "@choir/domain";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  jsonWrite,
  setupTicketingIntegration,
  signIn,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

beforeEach(async () => setupTicketingIntegration());
afterEach(async () => {
  vi.restoreAllMocks();
  await teardownTicketingIntegration();
});

describe("Stripe processor fee reconciliation and refund-aware financials", () => {
  it("reconciles Stripe processor fee, persists balance transaction ID, preserves fees on refund, and is idempotent", async () => {
    const cookie = await signIn();

    // 1. Create an event
    const event = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          {
            advancePriceCents: 5_000,
            callTime: "18:00",
            dayOfPriceCents: 5_000,
            doorsOpenTime: "18:30",
            durationMinutes: 90,
            isTicketingEnabled: true,
            location: "Concert Hall",
            parentPerformanceId: null,
            publicDetails: "Fee reconciliation test concert",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            rsvpDeadlineDate: "2026-11-01",
            rsvpFollowUpLeadHours: null,
            rsvpFollowUpMode: "inherit",
            setList: [],
            setListApproved: false,
            startsAt: "2026-11-15T19:00:00Z",
            ticketCapacity: 100,
            title: "Financial Reconciliation Concert",
            type: "Performance",
            venueId: null,
          },
          cookie,
        )
      ).json(),
    );

    const purchaseId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const providerPaymentId = `pi_${purchaseId}`;
    const providerSessionId = `cs_${purchaseId}`;
    const balanceTransactionId = `txn_${purchaseId}`;
    const stub = stores.get(stores.idFromName("organization-alpha"));

    // 2. Create pending purchase via internal ticketing DO route
    const pendingResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "create_stripe_pending",
          checkout: {
            buyerEmail: "reconciliation.buyer@example.test",
            buyerName: "Reconcile Buyer",
            checkoutRequestId,
            eventId: event.id,
            marketingOptIn: false,
            quantity: 1,
          },
          organizationId: "organization-alpha",
          providerSessionId,
          purchaseId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(pendingResponse.status).toBe(201);

    // 3. Mark payment completed
    const completeResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "stripe_ticket_completed",
          checkoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId,
          providerSessionId,
          stripeEventId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(completeResponse.status).toBe(200);

    // 4. Verify orders list before reconciliation: processorFeeCents is null
    const ordersResBefore = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/tickets/orders", cookie),
    );
    expect(ordersResBefore.status).toBe(200);
    const ordersBefore = organizationTicketOrdersResponseSchema.parse(
      await ordersResBefore.json(),
    ).orders;
    const orderBefore = ordersBefore.find((o) => o.id === purchaseId);
    expect(orderBefore).toBeDefined();
    expect(orderBefore?.status).toBe("paid");
    expect(orderBefore?.processorFeeCents).toBeNull();
    expect(orderBefore?.providerBalanceTransactionId).toBeNull();
    expect(orderBefore?.processorFeeReconciledAt).toBeNull();

    // 5. Reconcile processor fee via internal payments DO route
    const reconcileResponse = await stub.fetch(
      "https://organization.internal/internal/payments/manage",
      {
        body: JSON.stringify({
          action: "reconcile_payment_processor_fee",
          organizationId: "organization-alpha",
          processorFeeCents: 175,
          providerBalanceTransactionId: balanceTransactionId,
          providerPaymentId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(reconcileResponse.status).toBe(200);
    const reconcileJson = await reconcileResponse.json();
    expect(reconcileJson).toMatchObject({ reconciled: true });

    // 6. Idempotent duplicate reconciliation returns duplicate: true
    const dupReconcileRes = await stub.fetch(
      "https://organization.internal/internal/payments/manage",
      {
        body: JSON.stringify({
          action: "reconcile_payment_processor_fee",
          organizationId: "organization-alpha",
          processorFeeCents: 175,
          providerBalanceTransactionId: balanceTransactionId,
          providerPaymentId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(dupReconcileRes.status).toBe(200);
    const dupJson = await dupReconcileRes.json();
    expect(dupJson).toMatchObject({ duplicate: true, reconciled: true });

    // 7. Verify order has reconciled processor fee and balance transaction ID
    const ordersResAfter = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/tickets/orders", cookie),
    );
    expect(ordersResAfter.status).toBe(200);
    const ordersAfter = organizationTicketOrdersResponseSchema.parse(
      await ordersResAfter.json(),
    ).orders;
    const orderAfter = ordersAfter.find((o) => o.id === purchaseId);
    expect(orderAfter).toBeDefined();
    if (!orderAfter) throw new Error("Order not found");
    expect(orderAfter.processorFeeCents).toBe(175);
    expect(orderAfter.providerBalanceTransactionId).toBe(balanceTransactionId);
    expect(typeof orderAfter.processorFeeReconciledAt === "string").toBe(true);

    // Financial summary on paid order with fee:
    const paidSummary = calculatePaymentFinancialSummary(ordersAfter);
    expect(paidSummary.grossChargedCents).toBe(orderAfter.amountPaidCents);
    expect(paidSummary.customerFeeCents).toBe(orderAfter.feeCents);
    expect(paidSummary.refundCents).toBe(0);
    expect(paidSummary.processorFeeCents).toBe(175);
    expect(paidSummary.unreconciledProcessorFeeCount).toBe(0);
    expect(paidSummary.netProceedsCents).toBe(orderAfter.amountPaidCents - 0 - 175);

    // 8. Refund the ticket order (via Stripe webhook dispatch)
    const refundResponse = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "stripe_ticket_refunded",
          checkoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId,
          providerRefundId: `re_${purchaseId}`,
          stripeEventId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(refundResponse.status).toBe(200);

    // 9. Check orders list reflects preserved fee
    const ordersResRefunded = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/tickets/orders", cookie),
    );
    const ordersRefunded = organizationTicketOrdersResponseSchema.parse(
      await ordersResRefunded.json(),
    ).orders;
    const orderRefundedInList = ordersRefunded.find((o) => o.id === purchaseId);
    expect(orderRefundedInList?.status).toBe("refunded");
    expect(orderRefundedInList?.processorFeeCents).toBe(175);
    expect(orderRefundedInList?.providerBalanceTransactionId).toBe(balanceTransactionId);

    // 10. Financial summary on refunded order:
    // Full buyer refund ($51.80), retained processor fee ($1.75), Organization net proceeds is -$1.75
    const refundedSummary = calculatePaymentFinancialSummary(ordersRefunded);
    expect(refundedSummary.grossChargedCents).toBe(orderAfter.amountPaidCents);
    expect(refundedSummary.refundCents).toBe(orderAfter.amountPaidCents);
    expect(refundedSummary.processorFeeCents).toBe(175);
    expect(refundedSummary.netProceedsCents).toBe(-175);
    expect(refundedSummary.unreconciledProcessorFeeCount).toBe(0);
  });

  it("handles unreconciled payments cleanly with hasPendingProcessorFees = true", () => {
    // Simulate an unreconciled Stripe paid order
    const unreconciledOrder = {
      buyerEmail: "unreconciled@example.test",
      buyerName: "Unreconciled Buyer",
      checkoutRequestId: "cr_unrec",
      createdAt: new Date().toISOString(),
      customerFeeCents: 0,
      donationCents: 0,
      eventId: "evt-1",
      eventTitle: "Unreconciled Event",
      id: crypto.randomUUID(),
      paymentMethod: "stripe" as const,
      processorFeeCents: null,
      processorFeeReconciledAt: null,
      providerBalanceTransactionId: null,
      quantity: 1,
      refundedAt: null,
      revenueCents: 3_000,
      scannedAt: null,
      status: "paid" as const,
      totalChargedCents: 3_000,
      unitPriceCents: 3_000,
      venueName: "Hall",
    };

    const summary = calculatePaymentFinancialSummary([unreconciledOrder]);
    expect(summary.grossChargedCents).toBe(3_000);
    expect(summary.processorFeeCents).toBe(0);
    expect(summary.unreconciledProcessorFeeCount).toBe(1);
    expect(summary.netProceedsCents).toBeNull();
  });

  it("handles duplicate webhook completion idempotently without corrupting reconciled fees", async () => {
    const cookie = await signIn();
    const event = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          {
            advancePriceCents: 4_000,
            callTime: "18:00",
            dayOfPriceCents: 4_000,
            doorsOpenTime: "18:30",
            durationMinutes: 60,
            isTicketingEnabled: true,
            location: "Hall",
            parentPerformanceId: null,
            publicDetails: "Concert",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            rsvpDeadlineDate: "2026-11-01",
            rsvpFollowUpLeadHours: null,
            rsvpFollowUpMode: "inherit",
            setList: [],
            setListApproved: false,
            startsAt: "2026-11-20T19:00:00Z",
            ticketCapacity: 50,
            title: "Idempotency Concert",
            type: "Performance",
            venueId: null,
          },
          cookie,
        )
      ).json(),
    );

    const purchaseId = crypto.randomUUID();
    const checkoutRequestId = crypto.randomUUID();
    const providerPaymentId = `pi_${purchaseId}`;
    const providerSessionId = `cs_${purchaseId}`;
    const stub = stores.get(stores.idFromName("organization-alpha"));

    // 1. Pending
    const pendingRes = await stub.fetch("https://organization.internal/internal/ticketing/manage", {
      body: JSON.stringify({
        action: "create_stripe_pending",
        checkout: {
          buyerEmail: "idempotency@example.test",
          buyerName: "Idempotency Buyer",
          checkoutRequestId,
          eventId: event.id,
          marketingOptIn: false,
          quantity: 1,
        },
        organizationId: "organization-alpha",
        providerSessionId,
        purchaseId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(pendingRes.status).toBe(201);

    // 2. Initial completion
    const firstComplete = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "stripe_ticket_completed",
          checkoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId,
          providerSessionId,
          stripeEventId: "evt_1",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(firstComplete.status).toBe(200);

    // 3. Reconcile fee
    await stub.fetch("https://organization.internal/internal/payments/manage", {
      body: JSON.stringify({
        action: "reconcile_payment_processor_fee",
        organizationId: "organization-alpha",
        processorFeeCents: 150,
        providerBalanceTransactionId: "txn_initial",
        providerPaymentId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    // 4. Duplicate webhook completion arrives
    const dupComplete = await stub.fetch(
      "https://organization.internal/internal/ticketing/manage",
      {
        body: JSON.stringify({
          action: "stripe_ticket_completed",
          checkoutRequestId,
          organizationId: "organization-alpha",
          providerPaymentId,
          providerSessionId,
          stripeEventId: "evt_1",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(dupComplete.status).toBe(200);
    const dupJson = await dupComplete.json();
    expect(dupJson).toMatchObject({ duplicate: true });

    // 5. Verify processor fee remains intact after duplicate event
    const ordersRes = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/tickets/orders", cookie),
    );
    const orders = organizationTicketOrdersResponseSchema.parse(await ordersRes.json()).orders;
    const order = orders.find((o) => o.id === purchaseId);
    expect(order?.processorFeeCents).toBe(150);
    expect(order?.providerBalanceTransactionId).toBe("txn_initial");
  });
});
