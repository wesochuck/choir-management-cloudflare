import {
  organizationEventSchema,
  publicTicketPurchaseResponseSchema,
  publishedOrganizationProjectionSchema,
  ticketBundleSchema,
  ticketBundlesResponseSchema,
  ticketCheckoutResponseSchema,
  ticketScanResponseSchema,
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

describe("Organization ticket bundles", () => {
  it("publishes capacity-safe bundle passes that validate at every included performance", async () => {
    const cookie = await signIn();
    const eventBody = {
      advancePriceCents: 2_000,
      callTime: "18:00",
      dayOfPriceCents: 2_500,
      details: "",
      doorsOpenTime: "18:30",
      durationMinutes: 90,
      isTicketingEnabled: true,
      location: "Main Hall",
      parentPerformanceId: null,
      publicDetails: "Public concert",
      publicGraphicFileId: null,
      publishOnWebsite: true,
      setList: [],
      setListApproved: false,
      ticketCapacity: 2,
      type: "Performance" as const,
      venueId: null,
    };
    const firstEvent = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          { ...eventBody, startsAt: "2027-10-01T23:00:00.000Z", title: "Autumn Concert" },
          cookie,
        )
      ).json(),
    );
    const secondEvent = organizationEventSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/events",
          "POST",
          { ...eventBody, startsAt: "2027-12-01T23:00:00.000Z", title: "Winter Concert" },
          cookie,
        )
      ).json(),
    );
    const bundle = ticketBundleSchema.parse(
      await (
        await jsonWrite(
          "alpha.localhost",
          "/api/organization/tickets/bundles",
          "POST",
          {
            capacity: 2,
            eventIds: [firstEvent.id, secondEvent.id],
            isActive: true,
            priceCents: 3_000,
            saleEndAt: "2027-09-30T23:00:00.000Z",
            title: "Season Pass",
          },
          cookie,
        )
      ).json(),
    );
    expect(
      ticketBundlesResponseSchema.parse(
        await (
          await exports.default.fetch(
            api("alpha.localhost", "/api/organization/tickets/bundles", cookie),
          )
        ).json(),
      ).bundles,
    ).toHaveLength(1);
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
    expect(projection.payload.ticketBundles).toEqual([
      expect.objectContaining({ eventIds: [firstEvent.id, secondEvent.id], id: bundle.id }),
    ]);

    const checkout = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          bundleId: bundle.id,
          buyerEmail: "season@example.test",
          buyerName: "Season Buyer",
          checkoutRequestId: crypto.randomUUID(),
          marketingOptIn: false,
          quantity: 2,
        })
      ).json(),
    );
    expect(checkout.purchase).toMatchObject({
      bundleId: bundle.id,
      bundleTitle: "Season Pass",
      quantity: 2,
      unitPriceCents: 3_000,
    });
    expect(checkout.purchase.includedEvents.map(({ id }) => id)).toEqual([
      firstEvent.id,
      secondEvent.id,
    ]);
    expect(
      (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "late@example.test",
          buyerName: "Late Buyer",
          checkoutRequestId: crypto.randomUUID(),
          eventId: secondEvent.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).status,
    ).toBe(409);

    const receipt = publicTicketPurchaseResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "tickets.example.test",
            `/api/public/tickets/order?token=${encodeURIComponent(checkout.successToken)}`,
          ),
        )
      ).json(),
    );
    for (const eventId of [firstEvent.id, secondEvent.id]) {
      expect(
        ticketScanResponseSchema.parse(
          await (
            await jsonWrite(
              "alpha.localhost",
              "/api/organization/tickets/scan",
              "POST",
              { eventId, token: receipt.scanToken },
              cookie,
            )
          ).json(),
        ),
      ).toMatchObject({ eventId, valid: true });
    }
    const winterWillCall = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/tickets/will-call?eventId=${encodeURIComponent(secondEvent.id)}`,
        cookie,
      ),
    );
    expect(await winterWillCall.text()).toContain('"Season Buyer","season@example.test","2"');
    const bundleRefund = await jsonWrite(
      "alpha.localhost",
      `/api/organization/tickets/${encodeURIComponent(checkout.purchase.id)}/refund`,
      "POST",
      {},
      cookie,
    );
    expect(bundleRefund.status).toBe(200);
    expect(
      (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/tickets/bundles/${encodeURIComponent(bundle.id)}`,
            cookie,
            { method: "DELETE" },
          ),
        )
      ).status,
    ).toBe(409);
  });
});
