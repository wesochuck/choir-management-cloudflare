import { organizationEventSchema, organizationVenueSchema } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  readEmailOneTimeCode,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";
import {
  requireIntegrationBinding,
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";

const USER_EMAIL = "venue-required.manager@example.test";

const database = requireIntegrationBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireIntegrationBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const api = organizationRequest;
const post = (host: string, path: string, cookie: string, body: unknown) =>
  writeJson(exports.default, host, path, cookie, body, "POST");

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await setupOrganizationIntegration(database, stores, {
    displayName: "Venue Required Manager",
    email: USER_EMAIL,
    organizations: [{ id: "organization-alpha", slug: "alpha" }],
    userId: "venue-required-manager",
  });
});

afterEach(async () => {
  await teardownOrganizationIntegration();
});

function eventBody(venueId: string | null, title = "Venue Required Concert") {
  return {
    advancePriceCents: 0,
    callTime: "",
    dayOfPriceCents: 0,
    details: "",
    doorsOpenTime: "",
    durationMinutes: null,
    isTicketingEnabled: false,
    location: "",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    rsvpDeadlineDate: "2030-01-01",
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    setList: [],
    setListApproved: false,
    startsAt: "2027-12-20T00:00:00.000Z",
    ticketCapacity: null,
    title,
    type: "Performance",
    venueId,
  };
}

describe("Organization event venue requirement", () => {
  it("rejects event creation without a venue and accepts a valid venue", async () => {
    const cookie = await signIn();
    const missing = await post(
      "alpha.localhost",
      "/api/organization/events",
      cookie,
      eventBody(null),
    );
    expect(missing.status).toBe(400);
    // Route-level contract rejection (validation_failed) or store-level defense
    // (venue_required) both satisfy the mandatory-venue guarantee.
    expect(await missing.json()).toMatchObject({
      code: expect.stringMatching(/^(validation_failed|venue_required)$/),
    });

    const venue = organizationVenueSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/venues", cookie, {
          address: "1 Test Way",
          name: "Test Hall",
        })
      ).json(),
    );
    const created = await post(
      "alpha.localhost",
      "/api/organization/events",
      cookie,
      eventBody(venue.id),
    );
    expect(created.status).toBe(201);
    expect(organizationEventSchema.parse(await created.json()).venueId).toBe(venue.id);
  });

  it("rejects unknown venues and venue removal on update", async () => {
    const cookie = await signIn();
    const venue = organizationVenueSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/venues", cookie, {
          address: "2 Test Way",
          name: "Second Hall",
        })
      ).json(),
    );
    const unknownId = "99999999-9999-4999-8999-999999999999";
    const unknown = await post(
      "alpha.localhost",
      "/api/organization/events",
      cookie,
      eventBody(unknownId, "Unknown Venue Concert"),
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "venue_not_found" });

    const created = organizationEventSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/events", cookie, eventBody(venue.id))
      ).json(),
    );
    const removed = await writeJson(
      exports.default,
      "alpha.localhost",
      `/api/organization/events/${created.id}`,
      cookie,
      { ...eventBody(venue.id), venueId: null },
      "PUT",
    );
    expect(removed.status).toBe(400);
  });

  it("returns the same shared record for concurrent TBD venue creates", async () => {
    const cookie = await signIn();
    const first = organizationVenueSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/venues", cookie, {
          address: "",
          name: "TBD",
        })
      ).json(),
    );
    const second = organizationVenueSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/venues", cookie, {
          address: "",
          name: "  tBd ",
        })
      ).json(),
    );
    expect(second.id).toBe(first.id);

    const tbdEvent = await post(
      "alpha.localhost",
      "/api/organization/events",
      cookie,
      eventBody(first.id, "TBD Concert"),
    );
    expect(tbdEvent.status).toBe(201);
    expect(organizationEventSchema.parse(await tbdEvent.json()).venueId).toBe(first.id);

    const venuesResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/venues", cookie),
    );
    const venues = (await venuesResponse.json()) as { venues: { id: string; name: string }[] };
    expect(
      venues.venues.filter((candidate) => candidate.name.trim().toLowerCase() === "tbd"),
    ).toHaveLength(1);
  });
});
