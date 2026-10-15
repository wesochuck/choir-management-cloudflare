import {
  organizationEventSchema,
  organizationProfileResponseSchema,
  organizationVenueSchema,
  singerEventsResponseSchema,
} from "@choir/contracts";
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

const USER_EMAIL = "other.events.manager@example.test";

const database = requireIntegrationBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireIntegrationBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const api = organizationRequest;

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

const post = (host: string, path: string, cookie: string, body: unknown) =>
  writeJson(exports.default, host, path, cookie, body);

beforeEach(async () => {
  await setupOrganizationIntegration(database, stores, {
    displayName: "Other Events Manager",
    email: USER_EMAIL,
    organizations: [{ id: "organization-alpha", name: "Organization Alpha", slug: "alpha" }],
    userId: "other-events-manager",
  });
});

afterEach(async () => {
  await teardownOrganizationIntegration();
});

describe("Other Events with targeted RSVP, open volunteering, and staffing goals", () => {
  it("creates, validates, RSVPs, and tracks staffing goals for Other events", async () => {
    const cookie = await signIn();

    // 1. Setup profile and venue
    const profile = organizationProfileResponseSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Alice Soprano",
          voicePart: "S1",
        })
      ).json(),
    );
    await database
      .prepare(
        `UPDATE member SET profileId = ?
         WHERE organizationId = 'organization-alpha' AND userId = 'other-events-manager'`,
      )
      .bind(profile.id)
      .run();

    const venue = organizationVenueSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/venues", cookie, {
          address: "100 Community Way",
          name: "Fellowship Hall",
        })
      ).json(),
    );

    const startsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1_000).toISOString();

    // 2. Validation: Other events cannot carry ticketing, website publishing, or parent performance
    const forbiddenTicketing = await post("alpha.localhost", "/api/organization/events", cookie, {
      advancePriceCents: 1000,
      details: "Gala setup",
      isTicketingEnabled: true,
      otherEventRsvpMode: "optional",
      startsAt,
      title: "Forbidden Tickets",
      type: "Other",
      venueId: venue.id,
    });
    expect(forbiddenTicketing.status).toBe(400);

    const forbiddenPublishing = await post("alpha.localhost", "/api/organization/events", cookie, {
      details: "Gala setup",
      publishOnWebsite: true,
      startsAt,
      title: "Forbidden Website",
      type: "Other",
      venueId: venue.id,
    });
    expect(forbiddenPublishing.status).toBe(400);

    // 3. Create a valid Other event with targeted RSVP and staffing goal
    const createdRes = await post("alpha.localhost", "/api/organization/events", cookie, {
      details: "Help setting up tables and greeting guests",
      location: "",
      otherEventAudience: {
        profileIds: [],
        type: "targeted",
        voiceParts: ["S1"],
      },
      otherEventRsvpMode: "response_requested",
      otherEventStaffingGoal: 5,
      startsAt,
      title: "Spring Gala Setup",
      type: "Other",
      venueId: venue.id,
    });
    expect(createdRes.status).toBe(201);
    const createdEvent = organizationEventSchema.parse(await createdRes.json());
    expect(createdEvent.type).toBe("Other");
    expect(createdEvent.otherEventRsvpMode).toBe("response_requested");
    expect(createdEvent.otherEventStaffingGoal).toBe(5);
    expect(createdEvent.otherEventAudience).toEqual({
      profileIds: [],
      type: "targeted",
      voiceParts: ["S1"],
    });

    // 4. Singer schedule query (/api/singer/events)
    const scheduleRes = await exports.default.fetch(
      api("alpha.localhost", "/api/singer/events", cookie),
    );
    expect(scheduleRes.status).toBe(200);
    const schedule = singerEventsResponseSchema.parse(await scheduleRes.json());
    const eventInSchedule = schedule.events.find((e) => e.id === createdEvent.id);
    expect(eventInSchedule).toBeDefined();
    expect(eventInSchedule?.type).toBe("Other");
    expect(eventInSchedule?.otherEventRsvpMode).toBe("response_requested");
    expect(eventInSchedule?.isInvited).toBe(true);
    expect(eventInSchedule?.volunteerGoal).toBe(5);
    expect(eventInSchedule?.volunteerCount).toBe(0);
    expect(eventInSchedule?.resolvedRsvp).toBe("Pending");

    // 5. Singer commits "Yes" to help
    const rsvpYesRes = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${createdEvent.id}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "Yes" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(rsvpYesRes.status).toBe(200);

    const scheduleAfterYes = singerEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/events", cookie))
      ).json(),
    );
    const eventAfterYes = scheduleAfterYes.events.find((e) => e.id === createdEvent.id);
    expect(eventAfterYes?.resolvedRsvp).toBe("Yes");
    expect(eventAfterYes?.volunteerCount).toBe(1);

    // 6. Singer withdraws (RSVP "No")
    const rsvpNoRes = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${createdEvent.id}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "No" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(rsvpNoRes.status).toBe(200);

    const scheduleAfterNo = singerEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/events", cookie))
      ).json(),
    );
    const eventAfterNo = scheduleAfterNo.events.find((e) => e.id === createdEvent.id);
    expect(eventAfterNo?.resolvedRsvp).toBe("No");
    expect(eventAfterNo?.volunteerCount).toBe(0);

    // 7. Test mode "off": cannot RSVP
    const offEventRes = await post("alpha.localhost", "/api/organization/events", cookie, {
      details: "Informational event only",
      location: "",
      otherEventAudience: { type: "everyone" },
      otherEventRsvpMode: "off",
      startsAt,
      title: "Board Meeting (Informational)",
      type: "Other",
      venueId: venue.id,
    });
    expect(offEventRes.status).toBe(201);
    const offEvent = organizationEventSchema.parse(await offEventRes.json());

    const rsvpOffRes = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${offEvent.id}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "Yes" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(rsvpOffRes.status).toBe(409);
    const errorJson = await rsvpOffRes.json();
    expect(errorJson).toMatchObject({ code: "rsvp_closed" });
  });
});
