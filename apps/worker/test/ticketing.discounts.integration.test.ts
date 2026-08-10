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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  api,
  jsonWrite,
  setupTicketingIntegration,
  signIn,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

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
      feeCents: 74,
      originalSubtotalCents: 2_000,
      totalCents: 1_574,
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
      amountPaidCents: 1_574,
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
      revenueCents: 1_574,
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
});
