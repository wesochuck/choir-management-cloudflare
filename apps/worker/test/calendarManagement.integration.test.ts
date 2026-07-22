import {
  calendarFeedUrlsResponseSchema,
  organizationCalendarSettingsResponseSchema,
  organizationEventSchema,
  organizationEventArchiveResponseSchema,
  organizationEventsResponseSchema,
  organizationProfileResponseSchema,
  organizationRsvpSchema,
  organizationVenueSchema,
  organizationVenuesResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "calendar.manager@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

function api(host: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function provision(id: string, name: string, slug: string): Promise<void> {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 13, ?, ?, ?)`,
      )
      .bind(id, name, slug, id, now, now, now),
    database
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, id, `${slug}.localhost`, now, now),
    database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, 'calendar-manager', 'admin', ?)`,
      )
      .bind(`member-${slug}`, id, Date.now()),
  ]);
  const response = await stores
    .get(stores.idFromName(id))
    .fetch("https://organization.internal/internal/provision", {
      body: JSON.stringify({
        actorUserId: "bootstrap",
        canonicalHostname: `${slug}.localhost`,
        canonicalStatus: "active",
        name,
        organizationId: id,
        requestId: crypto.randomUUID(),
        slug,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  expect(response.status).toBe(200);
}

async function signIn(): Promise<string> {
  await exports.default.fetch(
    api("alpha.localhost", "/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const otp = readCapturedPlatformEmailsForTest()
    .find((message) => message.kind === "email-one-time-code" && message.recipient === USER_EMAIL)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  const response = await exports.default.fetch(
    api("alpha.localhost", "/api/auth/sign-in/email-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, otp }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function post(host: string, path: string, cookie: string, body: unknown): Promise<Response> {
  return exports.default.fetch(
    api(host, path, cookie, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES ('calendar-manager', 'Calendar Manager', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "Organization Alpha", "alpha");
  await provision("organization-bravo", "Organization Bravo", "bravo");
});

afterEach(async () => {
  await reset();
});

describe("Organization calendar management", () => {
  it("creates isolated venue/event/RSVP data that populates the signed calendar feed", async () => {
    const cookie = await signIn();
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
          venueId: venue.id,
        })
      ).json(),
    );
    const rehearsal = organizationEventSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(new Date(startsAt).getTime() + 24 * 60 * 60 * 1_000).toISOString(),
          title: "API Rehearsal",
          type: "Rehearsal",
          parentPerformanceId: performance.id,
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
        })
      ).json(),
    );
    await post("alpha.localhost", "/api/organization/events", cookie, {
      parentPerformanceId: archivedCandidate.id,
      startsAt: new Date(new Date(startsAt).getTime() + 72 * 60 * 60 * 1_000).toISOString(),
      title: "Archive Child",
      type: "Rehearsal",
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
    expect(venues.venues.map((item) => item.name)).toEqual(["Main Sanctuary"]);
    expect(events.events.map((item) => item.title)).toEqual([
      "API Concert Updated",
      "API Rehearsal",
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
});
