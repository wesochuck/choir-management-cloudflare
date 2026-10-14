import {
  calendarFeedUrlsResponseSchema,
  organizationCalendarSettingsResponseSchema,
  organizationDashboardSummaryResponseSchema,
  organizationEventArchiveResponseSchema,
  organizationEventSchema,
  organizationEventsResponseSchema,
  organizationProfileResponseSchema,
  organizationRsvpSchema,
  organizationVenueSchema,
  organizationVenuesResponseSchema,
  setupStatusSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  readEmailOneTimeCode,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  requireIntegrationBinding,
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";

const USER_EMAIL = "calendar.manager@example.test";

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
    displayName: "Calendar Manager",
    email: USER_EMAIL,
    organizations: [
      { id: "organization-alpha", name: "Organization Alpha", slug: "alpha" },
      { id: "organization-bravo", name: "Organization Bravo", slug: "bravo" },
    ],
    userId: "calendar-manager",
  });
});

afterEach(async () => {
  await teardownOrganizationIntegration();
});

describe("Calendar events and RSVP integration", () => {
  it("creates isolated venue/event/RSVP data that populates the signed calendar feed", async () => {
    const cookie = await signIn();
    const setupStatus = await exports.default.fetch(
      api("alpha.localhost", "/api/setup/status", cookie),
    );
    expect(setupStatus.status).toBe(200);
    expect(setupStatusSchema.parse(await setupStatus.json())).toMatchObject({
      organizationId: "organization-alpha",
      organizationName: "Organization Alpha",
      completedSteps: [],
      launched: false,
    });
    const invalidTimezone = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/calendar-settings", cookie, {
        body: JSON.stringify({ timezone: "Not/A_Zone" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(invalidTimezone.status).toBe(400);
    const timezoneResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/calendar-settings", cookie, {
        body: JSON.stringify({ timezone: "America/New_York" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(
      organizationCalendarSettingsResponseSchema.parse(await timezoneResponse.json()).timezone,
    ).toBe("America/New_York");
    const profile = organizationProfileResponseSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Singer",
          voicePart: "S1",
        })
      ).json(),
    );
    await database
      .prepare(
        `UPDATE member SET profileId = ?
         WHERE organizationId = 'organization-alpha' AND userId = 'calendar-manager'`,
      )
      .bind(profile.id)
      .run();
    const venue = organizationVenueSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/venues", cookie, {
          address: "123 Main St",
          name: "Main Sanctuary",
        })
      ).json(),
    );
    const disposableVenue = organizationVenueSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/venues", cookie, {
          address: "",
          name: "Disposable Hall",
        })
      ).json(),
    );
    const deleteDisposable = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/venues/${disposableVenue.id}`, cookie, {
        method: "DELETE",
      }),
    );
    expect(deleteDisposable.status).toBe(200);
    const startsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1_000).toISOString();
    const performance = organizationEventSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/events", cookie, {
          callTime: "18:00",
          details: "Black folders",
          durationMinutes: 150,
          location: "",
          parentPerformanceId: null,
          setList: [{ composer: "Composer", title: "Finale" }],
          setListApproved: true,
          startsAt,
          title: "API Concert",
          type: "Performance",
          rsvpDeadlineDate: "2030-01-01",
          venueId: venue.id,
        })
      ).json(),
    );
    const invalidPerformanceParent = await post(
      "alpha.localhost",
      "/api/organization/events",
      cookie,
      {
        parentPerformanceId: performance.id,
        startsAt: new Date(new Date(startsAt).getTime() + 12 * 60 * 60 * 1_000).toISOString(),
        title: "Invalid Performance Parent",
        type: "Performance",
        rsvpDeadlineDate: "2030-01-01",
        venueId: venue.id,
      },
    );
    expect(invalidPerformanceParent.status).toBe(400);
    expect(await invalidPerformanceParent.json()).toMatchObject({ code: "validation_failed" });
    const rehearsal = organizationEventSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(new Date(startsAt).getTime() + 24 * 60 * 60 * 1_000).toISOString(),
          title: "API Rehearsal",
          type: "Rehearsal",
          parentPerformanceId: performance.id,
          venueId: venue.id,
        })
      ).json(),
    );
    const linkedVenueDelete = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/venues/${venue.id}`, cookie, {
        method: "DELETE",
      }),
    );
    expect(linkedVenueDelete.status).toBe(409);
    const updatedPerformanceResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/events/${performance.id}`, cookie, {
        body: JSON.stringify({
          callTime: performance.callTime,
          details: performance.details,
          durationMinutes: performance.durationMinutes,
          location: performance.location,
          parentPerformanceId: performance.parentPerformanceId,
          setList: performance.setList,
          setListApproved: performance.setListApproved,
          startsAt: performance.startsAt,
          rsvpDeadlineDate: performance.rsvpDeadlineDate,
          title: "API Concert Updated",
          type: performance.type,
          venueId: performance.venueId,
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(organizationEventSchema.parse(await updatedPerformanceResponse.json()).title).toBe(
      "API Concert Updated",
    );
    const archivedCandidate = organizationEventSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(new Date(startsAt).getTime() + 48 * 60 * 60 * 1_000).toISOString(),
          title: "Archive Me",
          type: "Performance",
          rsvpDeadlineDate: "2030-01-01",
          venueId: venue.id,
        })
      ).json(),
    );
    await post("alpha.localhost", "/api/organization/events", cookie, {
      parentPerformanceId: archivedCandidate.id,
      startsAt: new Date(new Date(startsAt).getTime() + 72 * 60 * 60 * 1_000).toISOString(),
      title: "Archive Child",
      type: "Rehearsal",
      venueId: venue.id,
    });
    const archiveResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/events/${archivedCandidate.id}`, cookie, {
        method: "DELETE",
      }),
    );
    expect(organizationEventArchiveResponseSchema.parse(await archiveResponse.json()).status).toBe(
      "archived",
    );
    for (const [eventId, rsvp] of [
      [performance.id, "Yes"],
      [rehearsal.id, "Pending"],
    ] as const) {
      const response = await exports.default.fetch(
        api("alpha.localhost", `/api/organization/events/${eventId}/rsvp`, cookie, {
          body: JSON.stringify({ profileId: profile.id, rsvp }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }),
      );
      expect(organizationRsvpSchema.parse(await response.json()).rsvp).toBe(rsvp);
    }

    const venues = organizationVenuesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/venues", cookie))
      ).json(),
    );
    const events = organizationEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/events", cookie))
      ).json(),
    );
    const summary = organizationDashboardSummaryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/dashboard-summary", cookie),
        )
      ).json(),
    );
    expect(summary.activeProfileCount).toBe(1);
    expect(summary.upcomingEventCount).toBe(2);
    expect(summary.nextEvents.map((event) => event.title)).toEqual([
      "API Concert Updated",
      "API Rehearsal",
    ]);
    expect(venues.venues.map((item) => item.name)).toEqual(["Main Sanctuary"]);
    expect(events.events.map((item) => item.title)).toEqual([
      "API Rehearsal",
      "API Concert Updated",
    ]);
    expect(
      organizationVenuesResponseSchema.parse(
        await (
          await exports.default.fetch(api("bravo.localhost", "/api/organization/venues", cookie))
        ).json(),
      ).venues,
    ).toEqual([]);
    await database
      .prepare(
        `UPDATE member SET role = 'member'
         WHERE organizationId = 'organization-bravo' AND userId = 'calendar-manager'`,
      )
      .run();
    const memberDelete = await exports.default.fetch(
      api("bravo.localhost", `/api/organization/venues/${venue.id}`, cookie, {
        method: "DELETE",
      }),
    );
    expect(memberDelete.status).toBe(403);
    await database
      .prepare(
        `UPDATE member SET role = 'admin'
         WHERE organizationId = 'organization-bravo' AND userId = 'calendar-manager'`,
      )
      .run();
    const crossOrganizationDelete = await exports.default.fetch(
      api("bravo.localhost", `/api/organization/venues/${venue.id}`, cookie, {
        method: "DELETE",
      }),
    );
    expect(crossOrganizationDelete.status).toBe(404);

    const credential = calendarFeedUrlsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/calendar-feed-url", cookie))
      ).json(),
    );
    const feed = await (await exports.default.fetch(new Request(credential.httpsUrl))).text();
    expect(feed).toContain("SUMMARY:API Concert Updated");
    expect(feed).toContain("SUMMARY:API Rehearsal");
    expect(feed).toContain("LOCATION:Main Sanctuary\\, 123 Main St");

    const auditCount = await runInDurableObject<OrganizationStore, number>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM audit_events
             WHERE action IN ('organization.timezone.updated', 'venue.created',
               'venue.deleted', 'event.created', 'event.updated', 'event.archived',
               'event.rsvp.updated')`,
          )
          .one().count,
    );
    expect(auditCount).toBe(12);
    const archiveSummary = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ changeSummary: string }>(
            `SELECT change_summary AS changeSummary FROM audit_events
             WHERE action = 'event.archived' AND target_id = ?`,
            archivedCandidate.id,
          )
          .one().changeSummary,
    );

    expect(archiveSummary).toBe('{"archived":true,"childEventsArchived":1}');
  });

  it("requires an explicit Performance RSVP deadline and honors past and edited dates", async () => {
    const cookie = await signIn();
    const venue = organizationVenueSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/venues", cookie, {
          address: "123 RSVP St",
          name: "RSVP Hall",
        })
      ).json(),
    );
    const startsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const missingDeadline = await post("alpha.localhost", "/api/organization/events", cookie, {
      startsAt,
      title: "No Deadline Performance",
      type: "Performance",
      venueId: venue.id,
    });
    expect(missingDeadline.status).toBe(400);

    const pastDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const created = organizationEventSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/events", cookie, {
          rsvpDeadlineDate: pastDate,
          startsAt,
          title: "Past Deadline Performance",
          type: "Performance",
          venueId: venue.id,
        })
      ).json(),
    );
    expect(created.rsvpDeadlineDate).toBe(pastDate);
    expect(created.rsvpDeadlinePassed).toBe(true);
    expect(created.rsvpSelfServiceOpen).toBe(false);

    const futureDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const updated = organizationEventSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/events/${created.id}`, cookie, {
            body: JSON.stringify({
              rsvpDeadlineDate: futureDate,
              startsAt: created.startsAt,
              title: created.title,
              type: created.type,
              venueId: created.venueId,
            }),
            headers: { "content-type": "application/json" },
            method: "PUT",
          }),
        )
      ).json(),
    );
    expect(updated.rsvpDeadlineDate).toBe(futureDate);
    expect(updated.rsvpSelfServiceOpen).toBe(true);

    const rehearsal = await post("alpha.localhost", "/api/organization/events", cookie, {
      parentPerformanceId: created.id,
      rsvpDeadlineDate: futureDate,
      startsAt: created.startsAt,
      title: "Rehearsal With Deadline",
      type: "Rehearsal",
      venueId: venue.id,
    });
    expect(rehearsal.status).toBe(400);
  });

  it("persists, round-trips, and defaults setListDefaultTransitionSeconds for performances", async () => {
    const cookie = await signIn();
    const venue = organizationVenueSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/venues", cookie, {
          address: "123 Setlist St",
          name: "Setlist Hall",
        })
      ).json(),
    );
    const created = organizationEventSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/events", cookie, {
            body: JSON.stringify({
              rsvpDeadlineDate: "2026-10-01",
              setListDefaultTransitionSeconds: 30,
              startsAt: "2026-10-15T19:30:00.000Z",
              title: "Performance with Transitions",
              type: "Performance",
              venueId: venue.id,
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        )
      ).json(),
    );
    expect(created.setListDefaultTransitionSeconds).toBe(30);

    const listed = organizationEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/events", cookie))
      ).json(),
    );
    const found = listed.events.find((e) => e.id === created.id);
    expect(found?.setListDefaultTransitionSeconds).toBe(30);

    const updated = organizationEventSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/events/${created.id}`, cookie, {
            body: JSON.stringify({
              rsvpDeadlineDate: "2026-10-01",
              setListDefaultTransitionSeconds: 45,
              startsAt: created.startsAt,
              title: created.title,
              type: created.type,
              venueId: created.venueId,
            }),
            headers: { "content-type": "application/json" },
            method: "PUT",
          }),
        )
      ).json(),
    );
    expect(updated.setListDefaultTransitionSeconds).toBe(45);

    // Verify omitting setListDefaultTransitionSeconds defaults to 0
    const omittedCreated = organizationEventSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/events", cookie, {
            body: JSON.stringify({
              rsvpDeadlineDate: "2026-10-01",
              startsAt: "2026-10-20T19:30:00.000Z",
              title: "Default Transition Performance",
              type: "Performance",
              venueId: venue.id,
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        )
      ).json(),
    );
    expect(omittedCreated.setListDefaultTransitionSeconds).toBe(0);
  });
});
