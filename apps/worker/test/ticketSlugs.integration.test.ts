import {
  organizationEventSchema,
  organizationEventsResponseSchema,
  organizationVenueSchema,
  publishedOrganizationProjectionSchema,
  ticketBundleSchema,
} from "@choir/contracts";
import { futureIsoDate, futureDateString } from "@choir/testkit";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { organizationSchemaMigrations } from "../src/organization/schema/migrations";
import { ensureTicketSlug } from "../src/organization/ticketSlugs";
import {
  api,
  exports,
  jsonWrite,
  setupTicketingIntegration,
  signIn,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

beforeEach(setupTicketingIntegration);
afterEach(teardownTicketingIntegration);

describe("stable Organization ticket URL names", () => {
  it("persists names across renames, disambiguates duplicates, and projects them publicly", async () => {
    const cookie = await signIn();
    const venueResponse = await jsonWrite(
      "alpha.localhost",
      "/api/organization/venues",
      "POST",
      { name: "Concert Hall", address: "" },
      cookie,
    );
    const venue = organizationVenueSchema.parse(await venueResponse.json());
    const eventInput = {
      title: "Christmas by Candlelight",
      rsvpDeadlineDate: futureDateString({ days: 10 }),
      type: "Performance",
      startsAt: futureIsoDate({ days: 30 }),
      venueId: venue.id,
      isTicketingEnabled: true,
      publishOnWebsite: true,
    };
    const create = async () => {
      const response = await jsonWrite(
        "alpha.localhost",
        "/api/organization/events",
        "POST",
        eventInput,
        cookie,
      );
      expect(response.status).toBe(201);
      return organizationEventSchema.parse(await response.json());
    };
    const first = await create();
    const second = await create();
    expect(first.ticketSlug).toBe("christmas-by-candlelight");
    expect(second.ticketSlug).toBe("christmas-by-candlelight-2");
    const renamedResponse = await jsonWrite(
      "alpha.localhost",
      `/api/organization/events/${first.id}`,
      "PUT",
      { ...eventInput, title: "Renamed Concert" },
      cookie,
    );
    expect(renamedResponse.status).toBe(200);
    expect(organizationEventSchema.parse(await renamedResponse.json()).ticketSlug).toBe(
      first.ticketSlug,
    );
    const listed = organizationEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/events", cookie))
      ).json(),
    );
    expect(listed.events.find((event) => event.id === first.id)?.ticketSlug).toBe(first.ticketSlug);

    const bundleInput = {
      title: "Season Pass",
      eventIds: [first.id],
      priceCents: 1000,
      saleEndAt: futureIsoDate({ days: 20 }),
    };
    const savedBundle = await jsonWrite(
      "alpha.localhost",
      "/api/organization/tickets/bundles",
      "POST",
      bundleInput,
      cookie,
    );
    expect(savedBundle.status).toBe(200);
    const bundle = ticketBundleSchema.parse(await savedBundle.json());
    expect(bundle.ticketSlug).toBe("season-pass");
    const renamedBundle = await jsonWrite(
      "alpha.localhost",
      `/api/organization/tickets/bundles/${bundle.id}`,
      "PUT",
      { ...bundleInput, title: "Renamed Pass" },
      cookie,
    );
    expect(ticketBundleSchema.parse(await renamedBundle.json()).ticketSlug).toBe(bundle.ticketSlug);
    const projectionResponse = await exports.default.fetch(
      api("tickets.example.test", "/api/public/commerce-projection"),
    );
    expect(projectionResponse.status).toBe(200);
    const projection = publishedOrganizationProjectionSchema.parse(await projectionResponse.json());
    expect(projection.payload.performances.find((event) => event.id === first.id)?.ticketSlug).toBe(
      first.ticketSlug,
    );
    expect(projection.payload.ticketBundles.find((item) => item.id === bundle.id)?.ticketSlug).toBe(
      bundle.ticketSlug,
    );
    const deleted = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/tickets/bundles/${bundle.id}`, cookie, {
        method: "DELETE",
      }),
    );
    expect(deleted.status).toBe(200);
    const replacementResponse = await jsonWrite(
      "alpha.localhost",
      "/api/organization/tickets/bundles",
      "POST",
      bundleInput,
      cookie,
    );
    expect(ticketBundleSchema.parse(await replacementResponse.json()).ticketSlug).toBe(
      "season-pass-2",
    );
    const other = await exports.default.fetch(
      api("bravo.localhost", "/api/public/commerce-projection"),
    );
    const otherProjection = publishedOrganizationProjectionSchema.parse(await other.json());
    expect(otherProjection.payload.performances).toEqual([]);
    expect(otherProjection.payload.ticketBundles).toEqual([]);
  });

  it("backfills existing records once and reserves names independently per Organization and route", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const result = await runInDurableObject<OrganizationStore, string[]>(
      stub,
      (_instance, state) => {
        const sql = state.storage.sql;
        const now = new Date().toISOString();
        for (const id of ["older", "newer"]) {
          sql.exec(
            "INSERT INTO events (id, title, type, starts_at, created_at, updated_at) VALUES (?, 'Spring Concert', 'Performance', ?, ?, ?)",
            id,
            now,
            now,
            now,
          );
        }
        const migration = organizationSchemaMigrations.find((item) => item.version === 113);
        migration?.apply?.(sql);
        const names = [
          ensureTicketSlug(sql, "performance", "older", "Different Title"),
          ensureTicketSlug(sql, "performance", "newer", "Different Title"),
        ];
        sql.exec("DELETE FROM events WHERE id = 'older'");
        names.push(ensureTicketSlug(sql, "performance", "replacement", "Spring Concert"));
        names.push(ensureTicketSlug(sql, "bundle", "bundle", "Spring Concert"));
        names.push(ensureTicketSlug(sql, "performance", "numbered", "Spring Concert 4"));
        names.push(ensureTicketSlug(sql, "performance", "another", "Spring Concert"));
        migration?.apply?.(sql);
        return names;
      },
    );
    // Creation timestamps tie; the deterministic ID order gives 'newer' the first name.
    expect(result).toEqual([
      "spring-concert-2",
      "spring-concert",
      "spring-concert-3",
      "spring-concert",
      "spring-concert-4",
      "spring-concert-5",
    ]);
    const other = stores.get(stores.idFromName("organization-bravo"));
    expect(
      await runInDurableObject<OrganizationStore, string>(other, (_instance, state) =>
        ensureTicketSlug(state.storage.sql, "performance", "other", "Spring Concert"),
      ),
    ).toBe("spring-concert");
  });
});
