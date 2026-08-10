import {
  organizationEventSchema,
  organizationTicketOrderSchema,
  organizationVenueSchema,
  ticketCheckoutResponseSchema,
} from "@choir/contracts";
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

describe("Organization ticket refunds", () => {
  it("refunds a legacy free simulated order without a payment attempt", async () => {
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
            advancePriceCents: 0,
            callTime: "18:00",
            dayOfPriceCents: 0,
            details: "",
            doorsOpenTime: "18:30",
            durationMinutes: 90,
            isTicketingEnabled: true,
            location: "Downtown",
            parentPerformanceId: null,
            publicDetails: "A free concert.",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            setList: [],
            setListApproved: false,
            startsAt: "2027-12-20T00:00:00.000Z",
            ticketCapacity: 10,
            title: "Free Winter Tickets",
            type: "Performance",
            venueId: venue.id,
          },
          cookie,
        )
      ).json(),
    );
    const checkout = ticketCheckoutResponseSchema.parse(
      await (
        await jsonWrite("tickets.example.test", "/api/public/tickets/checkout", "POST", {
          buyerEmail: "free-buyer@example.test",
          buyerName: "Free Ticket Buyer",
          checkoutRequestId: crypto.randomUUID(),
          eventId: event.id,
          marketingOptIn: false,
          quantity: 1,
        })
      ).json(),
    );
    expect(checkout.purchase.amountPaidCents).toBe(0);

    await runInDurableObject<OrganizationStore, undefined>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          "DELETE FROM payment_attempts WHERE resource_id = ?",
          checkout.purchase.id,
        );
        return undefined;
      },
    );

    const refundResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/tickets/${checkout.purchase.id}/refund`, cookie, {
        method: "POST",
      }),
    );
    expect(refundResponse.status).toBe(200);
    expect(organizationTicketOrderSchema.parse(await refundResponse.json()).status).toBe(
      "refunded",
    );
    expect(
      await runInDurableObject<OrganizationStore, string>(
        stores.get(stores.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly status: string }>(
              "SELECT status FROM ticket_purchases WHERE id = ? LIMIT 1",
              checkout.purchase.id,
            )
            .one().status,
      ),
    ).toBe("refunded");
  });
});
