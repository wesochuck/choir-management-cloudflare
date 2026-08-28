import { organizationRsvpSchema, singerEventsResponseSchema } from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { queueRsvpDeclineNotice } from "../src/organization/rsvpDeclineNotifications";

const USER_EMAIL = "self-rsvp@example.test";
const ADMIN_EMAIL = "rsvp-admin@example.test";
const ADMIN_PROFILE = "33333333-3333-4333-8333-333333333333";
const ALPHA_PROFILE = "11111111-1111-4111-8111-111111111111";
const BRAVO_PROFILE = "22222222-2222-4222-8222-222222222222";
const PERFORMANCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REHEARSAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const signedLinkSecret = requireBinding(env.SIGNED_LINK_SECRET, "SIGNED_LINK_SECRET");
const notificationEnv = {
  CONTROL_DB: database,
  ORGANIZATION_STORE: stores,
  SIGNED_LINK_SECRET: signedLinkSecret,
};

const api = (host: string, path: string, cookie?: string, init?: RequestInit) =>
  organizationRequest(host, path, cookie, init);

const provision = async (id: string, name: string, slug: string, profileId: string) => {
  await provisionOrganization(database, stores, {
    id,
    name,
    role: "member",
    slug,
    userId: "self-rsvp-user",
  });
  await database
    .prepare("UPDATE member SET profileId = ? WHERE id = ?")
    .bind(profileId, `member-${slug}`)
    .run();
  const stub = stores.get(stores.idFromName(id));
  await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
    const createdAt = new Date().toISOString();
    const startsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1_000).toISOString();
    state.storage.sql.exec(
      `INSERT INTO profiles
        (id, display_name, voice_part, created_at, updated_at)
       VALUES (?, ?, 'S1', ?, ?)`,
      profileId,
      `${name} Singer`,
      createdAt,
      createdAt,
    );
    state.storage.sql.exec(
      `INSERT INTO events
        (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
         parent_performance_id, details, set_list_json, set_list_approved,
         is_archived, created_at, updated_at)
       VALUES (?, ?, 'Performance', ?, 150, '', '', NULL, NULL, '', '[]', 0, 0, ?, ?)`,
      id === "organization-alpha" ? PERFORMANCE_ID : crypto.randomUUID(),
      `${name} Performance`,
      startsAt,
      createdAt,
      createdAt,
    );
    if (id === "organization-alpha") {
      state.storage.sql.exec(
        `INSERT INTO events
          (id, title, type, starts_at, duration_minutes, call_time, location, venue_id,
           parent_performance_id, details, set_list_json, set_list_approved,
           is_archived, created_at, updated_at)
         VALUES (?, 'Alpha Rehearsal', 'Rehearsal', ?, 120, '', '', NULL, ?, '', '[]', 0, 0, ?, ?)`,
        REHEARSAL_ID,
        new Date(new Date(startsAt).getTime() + 24 * 60 * 60 * 1_000).toISOString(),
        PERFORMANCE_ID,
        createdAt,
        createdAt,
      );
      state.storage.sql.exec(
        `INSERT INTO event_rosters (event_id, profile_id, rsvp, created_at, updated_at)
         VALUES (?, ?, 'Yes', ?, ?), (?, ?, 'Pending', ?, ?)`,
        PERFORMANCE_ID,
        profileId,
        createdAt,
        createdAt,
        REHEARSAL_ID,
        profileId,
        createdAt,
        createdAt,
      );
    }
    return null;
  });
};

async function provisionRsvpAdministrator(): Promise<void> {
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO member (id, organizationId, userId, role, createdAt, profileId)
       VALUES ('member-rsvp-admin', 'organization-alpha', 'rsvp-admin-user', 'admin', ?, ?)`,
    )
    .bind(now, ADMIN_PROFILE)
    .run();
  await runInDurableObject<OrganizationStore, null>(
    stores.get(stores.idFromName("organization-alpha")),
    (_instance, state) => {
      const createdAt = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO profiles
          (id, display_name, voice_part, receive_rsvp_decline_notices, created_at, updated_at)
         VALUES (?, 'RSVP Administrator', 'S1', 1, ?, ?)`,
        ADMIN_PROFILE,
        createdAt,
        createdAt,
      );
      return null;
    },
  );
}

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "self-rsvp-user", USER_EMAIL, "Self RSVP");
  await seedAuthUser(database, "rsvp-admin-user", ADMIN_EMAIL, "RSVP Administrator");
  await provision("organization-alpha", "Organization Alpha", "alpha", ALPHA_PROFILE);
  await provision("organization-bravo", "Organization Bravo", "bravo", BRAVO_PROFILE);
  await provisionRsvpAdministrator();
});

afterEach(async () => {
  await reset();
});

describe("linked-Profile self-service RSVP", () => {
  it("rejects self-service RSVP when the linked Profile has no voice part", async () => {
    const cookie = await signIn();
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec("UPDATE profiles SET voice_part = '' WHERE id = ?", ALPHA_PROFILE);
        return null;
      },
    );
    const response = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${PERFORMANCE_ID}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "Yes" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "rsvp_voice_part_required",
    });
  });

  it("shows inherited status and updates only the caller's hostname-linked Profile", async () => {
    expect(await exports.default.fetch(api("alpha.localhost", "/api/singer/events"))).toMatchObject(
      { status: 401 },
    );
    const cookie = await signIn();
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          `UPDATE events SET set_list_json = ?, set_list_approved = 1 WHERE id = ?`,
          JSON.stringify([
            { id: "opening", title: "Opening Song", duration: "3:30", type: "song" },
            {
              id: "feature",
              isFeaturedNumber: true,
              performerCredits: [
                {
                  displayName: "Organization Alpha Singer",
                  kind: "profile",
                  profileId: ALPHA_PROFILE,
                },
              ],
              title: "Featured Song",
              type: "song",
            },
          ]),
          PERFORMANCE_ID,
        );
        return null;
      },
    );
    const alpha = singerEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/events", cookie))
      ).json(),
    );
    expect(alpha.profileId).toBe(ALPHA_PROFILE);
    expect(alpha.events.map((event) => event.title)).toEqual([
      "Organization Alpha Performance",
      "Alpha Rehearsal",
    ]);
    expect(alpha.events[1]).toMatchObject({
      directRsvp: "Pending",
      inheritedFromParent: true,
      resolvedRsvp: "Yes",
    });
    expect(alpha.events[0]?.setList.map(({ title }) => title)).toEqual([
      "Opening Song",
      "Featured Song",
    ]);
    expect(alpha.events[0]?.setList[1]?.performerCredits).toEqual([
      expect.objectContaining({
        displayName: "Organization Alpha Singer",
        profileId: ALPHA_PROFILE,
      }),
    ]);
    expect(alpha.events[1]?.setList).toEqual([]);

    const response = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${REHEARSAL_ID}/rsvp`, cookie, {
        body: JSON.stringify({
          profileId: BRAVO_PROFILE,
          rsvp: "No",
          rsvpNote: "   ",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "rsvp_decline_note_required",
    });

    const validResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${REHEARSAL_ID}/rsvp`, cookie, {
        body: JSON.stringify({
          profileId: BRAVO_PROFILE,
          rsvp: "No",
          rsvpNote: "Travel conflict",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(validResponse.status).toBe(200);
    const updatedRsvp = organizationRsvpSchema.parse(await validResponse.json());
    expect(updatedRsvp).toMatchObject({
      eventId: REHEARSAL_ID,
      profileId: ALPHA_PROFILE,
      rsvp: "No",
      rsvpNote: "Travel conflict",
    });

    await queueRsvpDeclineNotice(notificationEnv, {
      actorUserId: "self-rsvp-user",
      eventId: REHEARSAL_ID,
      organizationId: "organization-alpha",
      organizationOrigin: "https://alpha.localhost",
      profileId: ALPHA_PROFILE,
      requestId: "66666666-6666-4666-8666-666666666666",
      updatedAt: updatedRsvp.updatedAt,
    });
    await queueRsvpDeclineNotice(notificationEnv, {
      actorUserId: "self-rsvp-user",
      eventId: REHEARSAL_ID,
      organizationId: "organization-alpha",
      organizationOrigin: "https://alpha.localhost",
      profileId: ALPHA_PROFILE,
      requestId: "66666666-6666-4666-8666-666666666666",
      updatedAt: updatedRsvp.updatedAt,
    });
    const notice = await runInDurableObject<
      OrganizationStore,
      { readonly content: string; readonly destination: string; readonly subject: string } | null
    >(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{
            readonly content: string;
            readonly destination: string;
            readonly subject: string;
          }>(
            `SELECT m.content_markdown AS content, d.destination, m.subject
             FROM communication_messages m
             JOIN communication_deliveries d ON d.message_id = m.id
             WHERE d.profile_id = ? LIMIT 1`,
            ADMIN_PROFILE,
          )
          .toArray()
          .at(0) ?? null,
    );
    expect(notice).toMatchObject({
      destination: ADMIN_EMAIL,
      subject: "Organization Alpha Singer declined rehearsal: Alpha Rehearsal",
    });
    expect(notice?.content).toContain("Travel conflict");

    const revisedNoteResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${REHEARSAL_ID}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "No", rsvpNote: "Updated travel conflict" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(revisedNoteResponse.status).toBe(200);
    await expect(revisedNoteResponse.json()).resolves.toMatchObject({
      rsvpNote: "Updated travel conflict",
    });
    const revisedNote = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly rsvpNote: string }>(
            `SELECT rsvp_note AS rsvpNote FROM event_rosters
             WHERE event_id = ? AND profile_id = ?`,
            REHEARSAL_ID,
            ALPHA_PROFILE,
          )
          .one().rsvpNote,
    );
    expect(revisedNote).toBe("Updated travel conflict");

    const updated = singerEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/events", cookie))
      ).json(),
    );
    expect(updated.events[1]).toMatchObject({
      directRsvp: "No",
      inheritedFromParent: false,
      resolvedRsvp: "No",
      rsvpNote: "Updated travel conflict",
    });
    const bravo = singerEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("bravo.localhost", "/api/singer/events", cookie))
      ).json(),
    );
    expect(bravo.profileId).toBe(BRAVO_PROFILE);
    expect(bravo.events.map((event) => event.title)).toEqual(["Organization Bravo Performance"]);
    expect(bravo.events[0]?.setList).toEqual([]);

    const alphaRsvp = await runInDurableObject<
      OrganizationStore,
      { readonly note: string; readonly rsvp: string } | null
    >(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ note: string; rsvp: string }>(
            `SELECT rsvp, rsvp_note AS note FROM event_rosters
             WHERE event_id = ? AND profile_id = ?`,
            REHEARSAL_ID,
            ALPHA_PROFILE,
          )
          .toArray()
          .at(0) ?? null,
    );
    expect(alphaRsvp).toEqual({ note: "Updated travel conflict", rsvp: "No" });

    const attendingResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${REHEARSAL_ID}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "Yes", rsvpNote: "must be cleared" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(attendingResponse.status).toBe(200);
    const clearedNote = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ note: string }>(
            `SELECT rsvp_note AS note FROM event_rosters
             WHERE event_id = ? AND profile_id = ?`,
            REHEARSAL_ID,
            ALPHA_PROFILE,
          )
          .one().note,
    );
    expect(clearedNote).toBe("");
  });

  it("closes linked-member self-service RSVP after the Organization deadline", async () => {
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE events SET starts_at = ?, rsvp_deadline_date = ? WHERE id = ?",
          new Date(Date.now() + 3 * 86_400_000).toISOString(),
          new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
          PERFORMANCE_ID,
        );
        return null;
      },
    );
    const cookie = await signIn();
    const schedule = singerEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/events", cookie))
      ).json(),
    );
    expect(schedule.events[0]).toMatchObject({
      rsvpDeadlinePassed: true,
      rsvpSelfServiceOpen: false,
    });
    const response = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${PERFORMANCE_ID}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "No" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "rsvp_closed" });
  });

  it("hides every linked rehearsal after the member declines its parent performance", async () => {
    const cookie = await signIn();
    const rehearsalResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${REHEARSAL_ID}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "Yes" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(rehearsalResponse.status).toBe(200);

    const performanceResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${PERFORMANCE_ID}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "No" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(performanceResponse.status).toBe(200);

    const schedule = singerEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/events", cookie))
      ).json(),
    );
    expect(schedule.events.map((event) => event.id)).toEqual([PERFORMANCE_ID]);
  });

  it("hides past events unless the member asks to show them", async () => {
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE events SET starts_at = ? WHERE id = ?",
          new Date(Date.now() - 2 * 86_400_000).toISOString(),
          PERFORMANCE_ID,
        );
        return null;
      },
    );
    const cookie = await signIn();
    const upcoming = singerEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/events", cookie))
      ).json(),
    );
    expect(upcoming.events.some((event) => event.id === PERFORMANCE_ID)).toBe(false);

    const withPast = singerEventsResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/singer/events?includePast=true", cookie),
        )
      ).json(),
    );
    expect(withPast.events.some((event) => event.id === PERFORMANCE_ID)).toBe(true);
  });
});
