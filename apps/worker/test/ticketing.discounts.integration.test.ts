import {
  discountCodeListResponseSchema,
  discountCodeSchema,
  organizationEventSchema,
  organizationTicketOrdersResponseSchema,
  organizationVenueSchema,
  ticketBundleSchema,
  ticketCheckoutQuoteSchema,
  ticketCheckoutResponseSchema,
} from "@choir/contracts";
import { exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  api,
  jsonWrite,
  setupTicketingIntegration,
  signIn,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

beforeEach(async () => setupTicketingIntegration());
afterEach(async () => teardownTicketingIntegration());

describe("Organization ticket discounts", () => {
  it("applies per-unit discounts, confirms complimentary orders, and reports immutable redemptions", async () => {
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
            publicDetails: "A discounted concert.",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            setList: [],
            setListApproved: false,
            startsAt: "2027-12-20T00:00:00.000Z",
            ticketCapacity: 10,
            title: "Discounted Winter Tickets",
            type: "Performance",
            rsvpDeadlineDate: "2030-01-01",
            venueId: venue.id,
          },
          cookie,
        )
      ).json(),
    );

    const code = discountCodeSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/discount-codes",
          "POST",
          {
            active: true,
            bundleId: null,
            code: " save10 ",
            discountType: "fixed",
            discountValue: 250,
            eventId: event.id,
            redemptionLimit: 1,
          },
          cookie,
        )
      ).json(),
    );
    expect(code).toMatchObject({
      code: "save10",
      discountType: "fixed",
      discountValue: 250,
      editable: true,
      redemptionLimit: 1,
    });

    const availability = await exports.default.fetch(
      api(
        "tickets.example.test",
        "/api/public/tickets/discount-availability?eventId=" + encodeURIComponent(event.id),
      ),
    );
    expect(availability.status).toBe(200);
    expect(await availability.json()).toEqual({ hasRedeemableCode: true });

    const quote = ticketCheckoutQuoteSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/quote", "POST", {
          discountCode: " SAVE10 ",
          eventId: event.id,
          quantity: 2,
        })
      ).json(),
    );
    expect(quote).toMatchObject({
      discountAmountCents: 500,
      discountCode: "save10",
      discountedSubtotalCents: 1_500,
      feeCents: 76,
      originalSubtotalCents: 2_000,
      totalCents: 1_576,
    });

    const checkout = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "discount-buyer@example.test",
          buyerName: "Discount Buyer",
          checkoutRequestId: crypto.randomUUID(),
          discountCode: "save10",
          eventId: event.id,
          marketingOptIn: false,
          quantity: 2,
        })
      ).json(),
    );
    expect(checkout.purchase).toMatchObject({
      amountPaidCents: 1_576,
      discountAmountCents: 500,
      discountCode: "save10",
      discountedSubtotalCents: 1_500,
      originalSubtotalCents: 2_000,
      originalUnitPriceCents: 1_000,
      status: "paid",
    });

    const exhausted = await exports.default.fetch(
      api(
        "tickets.example.test",
        "/api/public/tickets/discount-availability?eventId=" + encodeURIComponent(event.id),
      ),
    );
    expect(await exhausted.json()).toEqual({ hasRedeemableCode: false });
    const invalid = await jsonWrite("tickets.example.test", "/api/public/tickets/quote", "POST", {
      discountCode: "save10",
      eventId: event.id,
      quantity: 1,
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({
      message: "This code is not valid for this purchase.",
    });

    const freeCode = discountCodeSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/discount-codes",
          "POST",
          {
            active: true,
            bundleId: null,
            code: "FREE100",
            discountType: "percentage",
            discountValue: 100,
            eventId: event.id,
            redemptionLimit: null,
          },
          cookie,
        )
      ).json(),
    );
    const freeCheckout = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "free-discount@example.test",
          buyerName: "Free Discount Buyer",
          checkoutRequestId: crypto.randomUUID(),
          discountCode: freeCode.code,
          eventId: event.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).json(),
    );
    expect(freeCheckout).toMatchObject({
      checkoutMode: "free",
      purchase: {
        amountPaidCents: 0,
        discountAmountCents: 1_000,
        feeCents: 0,
        status: "paid",
      },
    });
    const freeOrders = organizationTicketOrdersResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/tickets/orders", cookie),
        )
      ).json(),
    ).orders;
    expect(freeOrders.find(({ id }) => id === freeCheckout.purchase.id)).toMatchObject({
      checkoutMode: "free",
      discountCode: "FREE100",
    });

    const bundle = ticketBundleSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/bundles",
          "POST",
          {
            capacity: 10,
            eventIds: [event.id],
            isActive: true,
            priceCents: 500,
            saleEndAt: "2027-12-19T00:00:00.000Z",
            title: "Winter bundle",
          },
          cookie,
        )
      ).json(),
    );
    await jsonWrite(
      "alpha.localhost",
      "/api/organization/tickets/discount-codes",
      "POST",
      {
        active: true,
        bundleId: bundle.id,
        code: "BUNDLE200",
        discountType: "fixed",
        discountValue: 200,
        eventId: null,
        redemptionLimit: null,
      },
      cookie,
    );
    const bundleQuote = ticketCheckoutQuoteSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/quote", "POST", {
          bundleId: bundle.id,
          discountCode: "BUNDLE200",
          quantity: 2,
        })
      ).json(),
    );
    expect(bundleQuote).toMatchObject({
      discountAmountCents: 400,
      discountedSubtotalCents: 600,
      originalSubtotalCents: 1_000,
      quantity: 2,
    });

    const codes = discountCodeListResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/tickets/discount-codes", cookie),
        )
      ).json(),
    ).codes;
    expect(codes.find(({ id }) => id === code.id)).toMatchObject({
      discountAmountCents: 500,
      editable: false,
      originalRevenueCents: 2_000,
      redemptionCount: 1,
      revenueCents: 1_576,
    });
    const immutable = await jsonWrite(
      "alpha.localhost",
      "/api/organization/tickets/discount-codes/" + code.id,
      "PUT",
      {
        active: true,
        bundleId: null,
        code: code.code,
        discountType: "percentage",
        discountValue: 10,
        eventId: event.id,
        redemptionLimit: 1,
      },
      cookie,
    );
    expect(immutable.status).toBe(409);
    expect(await immutable.json()).toMatchObject({ code: "discount_code_immutable" });
  });

  it("rejects a discounted 43-cent total before creating checkout state", async () => {
    const cookie = await signIn();
    const venue = organizationVenueSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/venues",
          "POST",
          { address: "2 Stage Road", name: "Minimum Hall" },
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
            advancePriceCents: 1_000,
            callTime: "18:00",
            dayOfPriceCents: 1_000,
            details: "",
            doorsOpenTime: "18:30",
            durationMinutes: 90,
            isTicketingEnabled: true,
            location: "Downtown",
            parentPerformanceId: null,
            publicDetails: "",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            setList: [],
            setListApproved: false,
            startsAt: "2027-12-20T00:00:00.000Z",
            ticketCapacity: 10,
            title: "Minimum charge tickets",
            type: "Performance",
            rsvpDeadlineDate: "2030-01-01",
            venueId: venue.id,
          },
          cookie,
        )
      ).json(),
    );
    const code = discountCodeSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/discount-codes",
          "POST",
          {
            active: true,
            bundleId: null,
            code: "MIN43",
            discountType: "fixed",
            discountValue: 989,
            eventId: event.id,
            redemptionLimit: null,
          },
          cookie,
        )
      ).json(),
    );
    const checkoutRequestId = crypto.randomUUID();
    const store = stores.get(stores.idFromName("organization-alpha"));
    const jobsBefore = await runInDurableObject<OrganizationStore, number>(
      store,
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
            "SELECT COUNT(*) AS count FROM scheduled_job_outbox",
          )
          .one().count,
    );
    const response = await jsonWrite(
      "tickets.example.test",
      "/api/public/tickets/checkout",
      "POST",
      {
        buyerEmail: "minimum-charge@example.test",
        buyerName: "Minimum Charge Buyer",
        checkoutRequestId,
        discountCode: code.code,
        eventId: event.id,
        marketingOptIn: false,
        quantity: 1,
      },
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "ticket_checkout_amount_too_small" });
    const state = await runInDurableObject<OrganizationStore, readonly number[]>(
      store,
      (_instance, durable) => [
        durable.storage.sql
          .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
            "SELECT COUNT(*) AS count FROM ticket_purchases WHERE checkout_request_id = ?",
            checkoutRequestId,
          )
          .one().count,
        durable.storage.sql
          .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
            "SELECT COUNT(*) AS count FROM payment_attempts WHERE checkout_request_id = ?",
            checkoutRequestId,
          )
          .one().count,
        durable.storage.sql
          .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
            "SELECT COUNT(*) AS count FROM discount_code_redemptions WHERE checkout_request_id = ?",
            checkoutRequestId,
          )
          .one().count,
        durable.storage.sql
          .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
            "SELECT COUNT(*) AS count FROM scheduled_job_outbox",
          )
          .one().count,
      ],
    );
    expect(state).toEqual([0, 0, 0, jobsBefore]);
  });

  it("supports audited deactivation and reactivation of unused and redeemed discount codes without altering locked terms", async () => {
    const cookie = await signIn();
    const store = stores.get(stores.idFromName("organization-alpha"));

    const venue = organizationVenueSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/venues",
          "POST",
          { address: "10 Stage Road", name: "Reactivation Hall" },
          cookie,
        )
      ).json(),
    );

    const eventA = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          {
            advancePriceCents: 1_000,
            callTime: "18:00",
            dayOfPriceCents: 1_200,
            details: "",
            doorsOpenTime: "18:30",
            durationMinutes: 90,
            isTicketingEnabled: true,
            location: "Stage A",
            parentPerformanceId: null,
            publicDetails: "Concert A",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            setList: [],
            setListApproved: false,
            startsAt: "2027-12-20T00:00:00.000Z",
            ticketCapacity: 20,
            title: "Performance A",
            type: "Performance",
            rsvpDeadlineDate: "2030-01-01",
            venueId: venue.id,
          },
          cookie,
        )
      ).json(),
    );

    const eventB = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          {
            advancePriceCents: 1_500,
            callTime: "18:00",
            dayOfPriceCents: 1_800,
            details: "",
            doorsOpenTime: "18:30",
            durationMinutes: 90,
            isTicketingEnabled: true,
            location: "Stage B",
            parentPerformanceId: null,
            publicDetails: "Concert B",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            setList: [],
            setListApproved: false,
            startsAt: "2027-12-21T00:00:00.000Z",
            ticketCapacity: 20,
            title: "Performance B",
            type: "Performance",
            rsvpDeadlineDate: "2030-01-01",
            venueId: venue.id,
          },
          cookie,
        )
      ).json(),
    );

    // --- 1. UNUSED CODE ---
    // 1. Create active code
    const unusedCreated = discountCodeSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/discount-codes",
          "POST",
          {
            active: true,
            bundleId: null,
            code: "UNUSED10",
            discountType: "percentage",
            discountValue: 10,
            eventId: eventA.id,
            redemptionLimit: 5,
          },
          cookie,
        )
      ).json(),
    );
    expect(unusedCreated).toMatchObject({
      active: true,
      code: "UNUSED10",
      editable: true,
      redemptionCount: 0,
      redemptionLimit: 5,
    });

    // 2. Deactivate
    const unusedDeactivated = discountCodeSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          `/api/organization/tickets/discount-codes/${unusedCreated.id}/deactivate`,
          "POST",
          {},
          cookie,
        )
      ).json(),
    );
    // 3. Verify inactive; terms and editable unchanged
    expect(unusedDeactivated).toMatchObject({
      active: false,
      code: "UNUSED10",
      discountType: "percentage",
      discountValue: 10,
      editable: true,
      eventId: eventA.id,
      redemptionLimit: 5,
    });
    expect(unusedDeactivated.deactivatedAt).toBeTruthy();

    // Verify inactive code cannot be quoted
    const inactiveQuote = await jsonWrite(
      "tickets.example.test",
      "/api/public/tickets/quote",
      "POST",
      {
        discountCode: "UNUSED10",
        eventId: eventA.id,
        quantity: 1,
      },
    );
    expect(inactiveQuote.status).toBe(422);

    // Verify availability cannot be flipped through the generic term update
    const flipAvailability = await jsonWrite(
      "alpha.localhost",
      `/api/organization/tickets/discount-codes/${unusedCreated.id}`,
      "PUT",
      {
        active: true,
        bundleId: null,
        code: "UNUSED10",
        discountType: "percentage",
        discountValue: 10,
        eventId: eventA.id,
        redemptionLimit: 5,
      },
      cookie,
    );
    expect(flipAvailability.status).toBe(400);
    expect(await flipAvailability.json()).toMatchObject({
      code: "discount_code_availability_lifecycle_required",
    });

    // 4. Reactivate
    const unusedReactivated = discountCodeSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          `/api/organization/tickets/discount-codes/${unusedCreated.id}/reactivate`,
          "POST",
          {},
          cookie,
        )
      ).json(),
    );
    // 5. Verify active again; 6. verify terms are unchanged
    expect(unusedReactivated).toMatchObject({
      active: true,
      code: "UNUSED10",
      discountType: "percentage",
      discountValue: 10,
      editable: true,
      eventId: eventA.id,
      redemptionLimit: 5,
    });
    expect(unusedReactivated.deactivatedAt).toBeNull();

    // Verify unused code terms can be edited while preserving its active status
    const unusedEdited = discountCodeSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          `/api/organization/tickets/discount-codes/${unusedCreated.id}`,
          "PUT",
          {
            active: true,
            bundleId: null,
            code: "UNUSED15",
            discountType: "percentage",
            discountValue: 15,
            eventId: eventA.id,
            redemptionLimit: 8,
          },
          cookie,
        )
      ).json(),
    );
    expect(unusedEdited).toMatchObject({
      active: true,
      code: "UNUSED15",
      discountValue: 15,
      editable: true,
      redemptionLimit: 8,
    });

    // --- 2. REDEEMED CODE ---
    // 1. Create and redeem code
    const redeemedCreated = discountCodeSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/discount-codes",
          "POST",
          {
            active: true,
            bundleId: null,
            code: "REDEEM50",
            discountType: "fixed",
            discountValue: 300,
            eventId: eventA.id,
            redemptionLimit: 2,
          },
          cookie,
        )
      ).json(),
    );

    const firstCheckout = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "buyer1@example.test",
          buyerName: "Buyer One",
          checkoutRequestId: crypto.randomUUID(),
          discountCode: "REDEEM50",
          eventId: eventA.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).json(),
    );
    expect(firstCheckout.purchase.discountCode).toBe("REDEEM50");

    // 2. Verify editable === false
    const codesAfterRedemption = discountCodeListResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/tickets/discount-codes", cookie),
        )
      ).json(),
    ).codes;
    const redeemedBefore = codesAfterRedemption.find(({ id }) => id === redeemedCreated.id);
    expect(redeemedBefore).toBeDefined();
    if (!redeemedBefore) {
      throw new Error("Expected redeemedBefore to be defined");
    }
    expect(redeemedBefore).toMatchObject({
      active: true,
      editable: false,
      redemptionCount: 1,
      redemptionLimit: 2,
    });
    const snapshotFirstRedeemedAt = redeemedBefore.firstRedeemedAt;
    const snapshotRevenueCents = redeemedBefore.revenueCents;
    const snapshotDiscountAmountCents = redeemedBefore.discountAmountCents;

    // 3. Deactivate redeemed code
    const redeemedDeactivated = discountCodeSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          `/api/organization/tickets/discount-codes/${redeemedCreated.id}/deactivate`,
          "POST",
          {},
          cookie,
        )
      ).json(),
    );
    expect(redeemedDeactivated).toMatchObject({
      active: false,
      editable: false,
      redemptionCount: 1,
    });

    // Verify deactivated redeemed code cannot be quoted
    const deactivatedRedeemedQuote = await jsonWrite(
      "tickets.example.test",
      "/api/public/tickets/quote",
      "POST",
      {
        discountCode: "REDEEM50",
        eventId: eventA.id,
        quantity: 1,
      },
    );
    expect(deactivatedRedeemedQuote.status).toBe(422);

    // 4. Reactivate redeemed code
    const redeemedReactivated = discountCodeSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          `/api/organization/tickets/discount-codes/${redeemedCreated.id}/reactivate`,
          "POST",
          {},
          cookie,
        )
      ).json(),
    );
    // 5. Verify it becomes active; 6. editable remains false; 7. terms, count, revenue, snapshots unchanged
    expect(redeemedReactivated).toMatchObject({
      active: true,
      code: "REDEEM50",
      discountType: "fixed",
      discountValue: 300,
      editable: false,
      eventId: eventA.id,
      firstRedeemedAt: snapshotFirstRedeemedAt,
      redemptionCount: 1,
      redemptionLimit: 2,
      revenueCents: snapshotRevenueCents,
      discountAmountCents: snapshotDiscountAmountCents,
    });
    expect(redeemedReactivated.deactivatedAt).toBeNull();

    // --- 3. LOCKED-TERM PROTECTION ---
    // After redemption/reactivation, attempt to change terms via PUT:
    // a. change code
    const changeCode = await jsonWrite(
      "alpha.localhost",
      `/api/organization/tickets/discount-codes/${redeemedCreated.id}`,
      "PUT",
      {
        active: true,
        bundleId: null,
        code: "NEWCODE",
        discountType: "fixed",
        discountValue: 300,
        eventId: eventA.id,
        redemptionLimit: 2,
      },
      cookie,
    );
    expect(changeCode.status).toBe(409);
    expect(await changeCode.json()).toMatchObject({ code: "discount_code_immutable" });

    // b. change eligible item
    const changeItem = await jsonWrite(
      "alpha.localhost",
      `/api/organization/tickets/discount-codes/${redeemedCreated.id}`,
      "PUT",
      {
        active: true,
        bundleId: null,
        code: "REDEEM50",
        discountType: "fixed",
        discountValue: 300,
        eventId: eventB.id,
        redemptionLimit: 2,
      },
      cookie,
    );
    expect(changeItem.status).toBe(409);
    expect(await changeItem.json()).toMatchObject({ code: "discount_code_immutable" });

    // c. change discount type / value
    const changeValue = await jsonWrite(
      "alpha.localhost",
      `/api/organization/tickets/discount-codes/${redeemedCreated.id}`,
      "PUT",
      {
        active: true,
        bundleId: null,
        code: "REDEEM50",
        discountType: "fixed",
        discountValue: 400,
        eventId: eventA.id,
        redemptionLimit: 2,
      },
      cookie,
    );
    expect(changeValue.status).toBe(409);
    expect(await changeValue.json()).toMatchObject({ code: "discount_code_immutable" });

    // d. change redemption limit
    const changeLimit = await jsonWrite(
      "alpha.localhost",
      `/api/organization/tickets/discount-codes/${redeemedCreated.id}`,
      "PUT",
      {
        active: true,
        bundleId: null,
        code: "REDEEM50",
        discountType: "fixed",
        discountValue: 300,
        eventId: eventA.id,
        redemptionLimit: 10,
      },
      cookie,
    );
    expect(changeLimit.status).toBe(409);
    expect(await changeLimit.json()).toMatchObject({ code: "discount_code_immutable" });

    // Verify reactivated code is eligible for new checkouts
    const secondCheckout = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "buyer2@example.test",
          buyerName: "Buyer Two",
          checkoutRequestId: crypto.randomUUID(),
          discountCode: "REDEEM50",
          eventId: eventA.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).json(),
    );
    expect(secondCheckout.purchase.discountCode).toBe("REDEEM50");

    // Code has now reached redemptionLimit (2), so next attempt is exhausted
    const thirdQuote = await jsonWrite(
      "tickets.example.test",
      "/api/public/tickets/quote",
      "POST",
      {
        discountCode: "REDEEM50",
        eventId: eventA.id,
        quantity: 1,
      },
    );
    expect(thirdQuote.status).toBe(422);

    // --- 4. AUDIT EVENT VERIFICATION ---
    const unusedAuditActions = await runInDurableObject<OrganizationStore, readonly string[]>(
      store,
      (_instance, durable) =>
        durable.storage.sql
          .exec<{ readonly action: string }>(
            "SELECT action FROM audit_events WHERE target_id = ? ORDER BY occurred_at ASC",
            unusedCreated.id,
          )
          .toArray()
          .map((row) => row.action),
    );
    expect(unusedAuditActions).toContain("ticket.discount_code.deactivated");
    expect(unusedAuditActions).toContain("ticket.discount_code.reactivated");

    const redeemedAuditActions = await runInDurableObject<OrganizationStore, readonly string[]>(
      store,
      (_instance, durable) =>
        durable.storage.sql
          .exec<{ readonly action: string }>(
            "SELECT action FROM audit_events WHERE target_id = ? ORDER BY occurred_at ASC",
            redeemedCreated.id,
          )
          .toArray()
          .map((row) => row.action),
    );
    expect(redeemedAuditActions).toContain("ticket.discount_code.deactivated");
    expect(redeemedAuditActions).toContain("ticket.discount_code.reactivated");
  });
});
