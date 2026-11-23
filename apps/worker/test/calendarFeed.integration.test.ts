import { calendarFeedUrlsResponseSchema } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "calendar.member@example.test";
const ALPHA_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const BRAVO_PROFILE_ID = "22222222-2222-4222-8222-222222222222";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) {
    throw new Error(`The ${name} integration-test binding is missing.`);
  }
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const apiRequest = (hostname: string, path: string, cookie?: string, method = "GET") =>
  organizationRequest(hostname, path, cookie, { method });

async function seedOrganization(
  organizationId: string,
  name: string,
  slug: string,
  profileId: string,
): Promise<void> {
  await provisionOrganization(controlDatabase, organizationStore, {
    id: organizationId,
    slug,
    userId: "calendar-user",
    name,
    role: "member",
  });
  await controlDatabase
    .prepare("UPDATE member SET profileId = ? WHERE organizationId = ? AND userId = ?")
    .bind(profileId, organizationId, "calendar-user")
    .run();
  const stub = organizationStore.get(organizationStore.idFromName(organizationId));
  await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
    const timestamp = new Date().toISOString();
    state.storage.sql.exec(
      `INSERT INTO profiles (id, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      profileId,
      `${name} Singer`,
      timestamp,
      timestamp,
    );
    return null;
  });
}

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(controlDatabase, "calendar-user", USER_EMAIL, "Calendar Member");
  await seedOrganization("organization-alpha", "Organization Alpha", "alpha", ALPHA_PROFILE_ID);
  await seedOrganization("organization-bravo", "Organization Bravo", "bravo", BRAVO_PROFILE_ID);
  const now = new Date().toISOString();
  await controlDatabase
    .prepare(
      `INSERT INTO organization_domains
        (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
       VALUES ('domain-alpha-public', 'organization-alpha', 'calendar.example.test',
         'custom_public', 'active', 1, ?, ?)`,
    )
    .bind(now, now)
    .run();
});

afterEach(async () => {
  await reset();
});

describe("calendar feed credentials", () => {
  it("issues on the canonical host and invalidates the old feed immediately after reset", async () => {
    const cookie = await signIn();
    const credentialResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/singer/calendar-feed-url", cookie),
    );
    expect(credentialResponse.status).toBe(200);
    const credential = calendarFeedUrlsResponseSchema.parse(await credentialResponse.json());
    expect(credential.httpsUrl).toContain(
      "http://alpha.localhost/api/calendar/feed/Organization%20Alpha.ics?token=",
    );
    expect(credential.webcalUrl).toContain(
      "webcal://alpha.localhost/api/calendar/feed/Organization%20Alpha.ics?token=",
    );

    const feedResponse = await exports.default.fetch(new Request(credential.httpsUrl));
    expect(feedResponse.status).toBe(200);
    expect(feedResponse.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    await expect(feedResponse.text()).resolves.toContain("X-WR-CALNAME:Organization Alpha");

    const legacyUrl = new URL("/api/calendar/feed", credential.httpsUrl);
    legacyUrl.search = new URL(credential.httpsUrl).search;
    const legacyResponse = await exports.default.fetch(new Request(legacyUrl));
    expect(legacyResponse.status).toBe(200);
    expect(legacyResponse.headers.get("content-type")).toBe("text/calendar; charset=utf-8");

    const crossOrganizationUrl = new URL(credential.httpsUrl);
    crossOrganizationUrl.hostname = "bravo.localhost";
    expect(await exports.default.fetch(new Request(crossOrganizationUrl))).toMatchObject({
      status: 404,
    });
    const customPublicUrl = new URL(credential.httpsUrl);
    customPublicUrl.hostname = "calendar.example.test";
    expect(await exports.default.fetch(new Request(customPublicUrl))).toMatchObject({
      status: 404,
    });

    const resetResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/singer/calendar-feed-url/reset", cookie, "POST"),
    );
    expect(resetResponse.status).toBe(200);
    const resetCredential = calendarFeedUrlsResponseSchema.parse(await resetResponse.json());
    expect(resetCredential.httpsUrl).not.toBe(credential.httpsUrl);
    expect(await exports.default.fetch(new Request(credential.httpsUrl))).toMatchObject({
      status: 404,
    });
    expect(await exports.default.fetch(new Request(resetCredential.httpsUrl))).toMatchObject({
      status: 200,
    });

    const audit = await runInDurableObject<OrganizationStore, { action: string } | null>(
      organizationStore.get(organizationStore.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ action: string }>(
            "SELECT action FROM audit_events WHERE action = 'profile.calendar_feed.reset'",
          )
          .toArray()
          .at(0) ?? null,
    );
    expect(audit).toEqual({ action: "profile.calendar_feed.reset" });
  });

  it("fails closed for anonymous credential access, malformed tokens, and missing profile links", async () => {
    expect(
      await exports.default.fetch(apiRequest("alpha.localhost", "/api/singer/calendar-feed-url")),
    ).toMatchObject({ status: 401 });
    expect(
      await exports.default.fetch(apiRequest("alpha.localhost", "/api/calendar/feed?token=bad")),
    ).toMatchObject({ status: 404 });
    await controlDatabase
      .prepare("UPDATE member SET profileId = NULL WHERE organizationId = 'organization-alpha'")
      .run();
    const cookie = await signIn();
    expect(
      await exports.default.fetch(
        apiRequest("alpha.localhost", "/api/singer/calendar-feed-url", cookie),
      ),
    ).toMatchObject({ status: 404 });
  });

  it("renders Organization-local events with RSVP inheritance, venues, and call times", async () => {
    const eventStart = new Date(Date.now() + 10 * 24 * 60 * 60 * 1_000);
    eventStart.setUTCHours(23, 0, 0, 0);
    const rehearsalStart = new Date(eventStart.getTime() + 24 * 60 * 60 * 1_000);
    const localStartParts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      month: "2-digit",
      timeZone: "America/New_York",
      year: "numeric",
    }).formatToParts(eventStart);
    const localHour = Number(localStartParts.find((part) => part.type === "hour")?.value);
    const callTime = `${String(localHour - 1).padStart(2, "0")}:00`;
    const stub = organizationStore.get(organizationStore.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec("UPDATE organization_metadata SET timezone = 'America/New_York'");
      state.storage.sql.exec(
        `INSERT INTO venues (id, name, address, created_at, updated_at)
         VALUES ('venue-main', 'Main Sanctuary', '123 Main St', ?, ?)`,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO events
          (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
           parent_performance_id, details, set_list_json, set_list_approved,
           is_archived, created_at, updated_at)
         VALUES
          ('performance-main', 'Summer, Concert', 'Performance', ?, 150, ?, '', 'venue-main',
           NULL, 'Black folders',
           '[{"title":"Finale","composer":"Composer","isFeaturedNumber":true,"performerCredits":[{"displayName":"Soloist"}]}]',
           1, 0, ?, ?),
          ('rehearsal-child', 'Dress Rehearsal', 'Rehearsal', ?, NULL, '', 'Choir Room', NULL,
           'performance-main', '', '[]', 0, 0, ?, ?),
          ('event-declined', 'Declined Event', 'Performance', ?, 90, '', '', NULL,
           NULL, '', '[]', 0, 0, ?, ?)`,
        eventStart.toISOString(),
        callTime,
        now,
        now,
        rehearsalStart.toISOString(),
        now,
        now,
        new Date(rehearsalStart.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO event_rosters (event_id, profile_id, rsvp, created_at, updated_at)
         VALUES
          ('performance-main', ?, 'Yes', ?, ?),
          ('rehearsal-child', ?, 'Pending', ?, ?),
          ('event-declined', ?, 'No', ?, ?)`,
        ALPHA_PROFILE_ID,
        now,
        now,
        ALPHA_PROFILE_ID,
        now,
        now,
        ALPHA_PROFILE_ID,
        now,
        now,
      );
      return null;
    });

    const cookie = await signIn();
    const credentialResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/singer/calendar-feed-url", cookie),
    );
    const credential = calendarFeedUrlsResponseSchema.parse(await credentialResponse.json());
    const feedResponse = await exports.default.fetch(new Request(credential.httpsUrl));
    expect(feedResponse.status).toBe(200);
    const feed = await feedResponse.text();
    expect(feed).toContain("NAME:Organization Alpha");
    expect(feed).toContain("X-WR-TIMEZONE:America/New_York");
    expect(feed).toContain("SUMMARY:Summer\\, Concert");
    expect(feed).toContain("SUMMARY:Call Time: Summer\\, Concert");
    expect(feed).toContain("LOCATION:Main Sanctuary\\, 123 Main St");
    expect(feed).toContain("SUMMARY:Dress Rehearsal");
    expect(feed).toContain("Your Status: Attending");
    expect(feed).toContain("Set List:\\n1. Finale (Composer)\\n   Solo — Soloist");
    expect(feed).not.toContain("Declined Event");
    const localCallTime = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: "America/New_York",
      year: "numeric",
    })
      .formatToParts(new Date(eventStart.getTime() - 60 * 60 * 1_000))
      .reduce<Record<string, string>>((values, part) => {
        values[part.type] = part.value;
        return values;
      }, {});
    const readLocalPart = (type: string): string => {
      const value = localCallTime[type];
      if (!value) throw new Error(`Missing ${type} in local calendar timestamp.`);
      return value;
    };
    expect(feed).toContain(
      `DTSTART;TZID=America/New_York:${readLocalPart("year")}${readLocalPart("month")}${readLocalPart("day")}T${readLocalPart("hour") === "24" ? "00" : readLocalPart("hour")}${readLocalPart("minute")}${readLocalPart("second")}`,
    );
  });

  it("embeds stable clickable Practice Player links on published performances and linked rehearsals for Yes RSVPs only", async () => {
    const publishedEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const rehearsalEventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const pendingEventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const unpublishedEventId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const pieceId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const trackFileId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const baseStart = new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000);
    baseStart.setUTCHours(23, 0, 0, 0);

    const stub = organizationStore.get(organizationStore.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO music_pieces
          (id, title, composer, track_file_ids_json, created_at, updated_at)
         VALUES (?, 'Earth Song', 'Frank Ticheli', ?, ?, ?)`,
        pieceId,
        JSON.stringify({ Tenor: trackFileId }),
        now,
        now,
      );
      const setListJson = JSON.stringify([
        { composer: "Frank Ticheli", pieceId, title: "Earth Song" },
      ]);
      state.storage.sql.exec(
        `INSERT INTO events
          (id, title, type, starts_at, duration_minutes, call_time, location,
           parent_performance_id, details, set_list_json, set_list_approved,
           is_archived, created_at, updated_at)
         VALUES
          (?, 'Spring Showcase', 'Performance', ?, 120, '18:00', 'Concert Hall',
           NULL, 'Bring black folders', ?, 1, 0, ?, ?),
          (?, 'Weekly Rehearsal', 'Rehearsal', ?, 90, '', 'Choir Room',
           ?, 'Warm up at 7', '[]', 0, 0, ?, ?),
          (?, 'Pending Concert', 'Performance', ?, 120, '', 'Concert Hall',
           NULL, '', ?, 1, 0, ?, ?),
          (?, 'Draft Concert', 'Performance', ?, 120, '', 'Concert Hall',
           NULL, '', ?, 0, 0, ?, ?)`,
        publishedEventId,
        baseStart.toISOString(),
        setListJson,
        now,
        now,
        rehearsalEventId,
        new Date(baseStart.getTime() - 3 * 24 * 60 * 60 * 1_000).toISOString(),
        publishedEventId,
        now,
        now,
        pendingEventId,
        new Date(baseStart.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
        setListJson,
        now,
        now,
        unpublishedEventId,
        new Date(baseStart.getTime() + 14 * 24 * 60 * 60 * 1_000).toISOString(),
        setListJson,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO event_rosters (event_id, profile_id, rsvp, created_at, updated_at)
         VALUES
          (?, ?, 'Yes', ?, ?),
          (?, ?, 'Pending', ?, ?),
          (?, ?, 'Pending', ?, ?),
          (?, ?, 'Yes', ?, ?)`,
        publishedEventId,
        ALPHA_PROFILE_ID,
        now,
        now,
        rehearsalEventId,
        ALPHA_PROFILE_ID,
        now,
        now,
        pendingEventId,
        ALPHA_PROFILE_ID,
        now,
        now,
        unpublishedEventId,
        ALPHA_PROFILE_ID,
        now,
        now,
      );
      return null;
    });

    const cookie = await signIn();
    const credentialResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/singer/calendar-feed-url", cookie),
    );
    const credential = calendarFeedUrlsResponseSchema.parse(await credentialResponse.json());

    const firstResponse = await exports.default.fetch(new Request(credential.httpsUrl));
    expect(firstResponse.status).toBe(200);
    const firstFeed = await firstResponse.text();

    const secondResponse = await exports.default.fetch(new Request(credential.httpsUrl));
    expect(secondResponse.status).toBe(200);
    const secondFeed = await secondResponse.text();

    const vevents = firstFeed.split("BEGIN:VEVENT").slice(1);
    const findVevent = (uid: string) => {
      const match = vevents.find((block) => block.includes(`UID:${uid}\r\n`));
      if (!match) throw new Error(`Missing VEVENT for ${uid}`);
      return match;
    };

    const callTimeVevent = findVevent(`call-event-${publishedEventId}@choir-management.local`);
    const performanceVevent = findVevent(`event-${publishedEventId}@choir-management.local`);
    const rehearsalVevent = findVevent(`event-${rehearsalEventId}@choir-management.local`);
    const pendingVevent = findVevent(`event-${pendingEventId}@choir-management.local`);
    const draftVevent = findVevent(`event-${unpublishedEventId}@choir-management.local`);

    // Call Time, Pending RSVP, and unpublished set lists omit Practice Player links.
    expect(callTimeVevent).not.toContain("URL:");
    expect(callTimeVevent).not.toContain("X-ALT-DESC");
    expect(pendingVevent).not.toContain("URL:");
    expect(pendingVevent).not.toContain("X-ALT-DESC");
    expect(draftVevent).not.toContain("URL:");
    expect(draftVevent).not.toContain("X-ALT-DESC");

    // Performance and linked Rehearsal both receive the same stable personalized link.
    const perfUrlMatch = /URL:(http:\/\/alpha\.localhost\/player\?token=[^\r\n]+)/.exec(
      performanceVevent,
    );
    const rehUrlMatch = /URL:(http:\/\/alpha\.localhost\/player\?token=[^\r\n]+)/.exec(
      rehearsalVevent,
    );
    expect(perfUrlMatch?.[1]).toBeDefined();
    expect(rehUrlMatch?.[1]).toBe(perfUrlMatch?.[1]);

    // HTML alternative description carries a clickable short link; plain DESCRIPTION stays URL-free.
    const playerUrl = perfUrlMatch?.[1] ?? "";
    expect(performanceVevent).toContain("X-ALT-DESC;FMTTYPE=text/html:");
    expect(performanceVevent).toContain(`href="${playerUrl}">Open Practice Player</a>`);
    expect(rehearsalVevent).toContain(`href="${playerUrl}">Open Practice Player</a>`);
    const perfPlainDesc = /DESCRIPTION:([^\r\n]+)/.exec(performanceVevent)?.[1] ?? "";
    expect(perfPlainDesc).not.toContain("/player?token=");
    const rehPlainDesc = /DESCRIPTION:([^\r\n]+)/.exec(rehearsalVevent)?.[1] ?? "";
    expect(rehPlainDesc).not.toContain("/player?token=");

    // Repeated feed fetches within the same 7-day window emit the exact same URL.
    const secondUrlMatch = /URL:(http:\/\/alpha\.localhost\/player\?token=[^\r\n]+)/.exec(
      secondFeed,
    );
    expect(secondUrlMatch?.[1]).toBe(playerUrl);

    // Embedded token resolves live Practice Player details on alpha.localhost and fails closed on bravo.localhost.
    const parsedUrl = new URL(playerUrl);
    const token = parsedUrl.searchParams.get("token") ?? "";
    const playerDetails = await exports.default.fetch(
      organizationRequest("alpha.localhost", "/api/public/player-details", undefined, {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(playerDetails.status).toBe(200);
    await expect(playerDetails.json()).resolves.toMatchObject({
      eventId: publishedEventId,
      profileId: ALPHA_PROFILE_ID,
    });

    const crossOrgDetails = await exports.default.fetch(
      organizationRequest("bravo.localhost", "/api/public/player-details", undefined, {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(crossOrgDetails.status).toBe(404);
  });
});
