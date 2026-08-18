import { memberDashboardResponseSchema, singerEventsResponseSchema } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "member-dashboard@example.test";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PERFORMANCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REHEARSAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PIECE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SEASON_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DUES_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const POLL_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const POLL_OPTION_ID = "99999999-9999-4999-8999-999999999999";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

function readToken(body: unknown): string {
  if (
    typeof body !== "object" ||
    body === null ||
    !("token" in body) ||
    typeof body.token !== "string"
  ) {
    throw new Error("The practice-link response did not include a token.");
  }
  return body.token;
}

function readUrl(body: unknown): string {
  if (
    typeof body !== "object" ||
    body === null ||
    !("url" in body) ||
    typeof body.url !== "string"
  ) {
    throw new Error("The practice-link response did not include a URL.");
  }
  return body.url;
}

function readPublicEventId(body: unknown): string {
  if (
    typeof body !== "object" ||
    body === null ||
    !("event" in body) ||
    typeof body.event !== "object" ||
    body.event === null ||
    !("id" in body.event) ||
    typeof body.event.id !== "string"
  ) {
    throw new Error("The public practice response did not include an event.");
  }
  return body.event.id;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

function api(host: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

async function provision(
  id: string,
  name: string,
  slug: string,
  profileId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 14, ?, ?, ?)`,
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
        `INSERT INTO member (id, organizationId, userId, role, createdAt, profileId)
         VALUES (?, ?, 'member-dashboard-user', 'member', ?, ?)`,
      )
      .bind(`member-${slug}`, id, Date.now(), profileId),
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

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES ('member-dashboard-user', 'Dashboard Member', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "Organization Alpha", "alpha", PROFILE_ID);
  await provision("organization-bravo", "Organization Bravo", "bravo", null);
  await runInDurableObject<OrganizationStore, null>(
    stores.get(stores.idFromName("organization-alpha")),
    (_instance, state) => {
      const nowIso = new Date().toISOString();
      const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000).toISOString();
      const rehearsalStartsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
      state.storage.sql.exec(
        `INSERT INTO setup_state
          (organization_id, organization_name, module_config, created_at, updated_at)
         VALUES (?, 'Organization Alpha', ?, ?, ?)
         ON CONFLICT(organization_id) DO UPDATE SET module_config = excluded.module_config`,
        "organization-alpha",
        JSON.stringify({ events: true, people: true, programs: true }),
        nowIso,
        nowIso,
      );
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, voice_part, created_at, updated_at)
         VALUES (?, 'Dashboard Member', 'S', ?, ?)`,
        PROFILE_ID,
        nowIso,
        nowIso,
      );
      state.storage.sql.exec(
        `INSERT INTO music_pieces
          (id, title, track_file_ids_json, created_at, updated_at)
         VALUES (?, 'Opening Song', ?, ?, ?)`,
        PIECE_ID,
        JSON.stringify({ tutti: "11111111-1111-4111-8111-111111111111" }),
        nowIso,
        nowIso,
      );
      const setList = JSON.stringify([
        {
          id: "featured",
          isFeaturedNumber: true,
          performerCredits: [
            { displayName: "Dashboard Member", kind: "profile", profileId: PROFILE_ID },
          ],
          pieceId: PIECE_ID,
          title: "Opening Song",
          type: "song",
        },
      ]);
      state.storage.sql.exec(
        `INSERT INTO events
          (id, title, type, starts_at, duration_minutes, call_time, location,
           parent_performance_id, details, set_list_json, set_list_approved,
           is_archived, created_at, updated_at)
         VALUES (?, 'Spring Performance', 'Performance', ?, 120, '18:00', 'Main Hall', NULL, '', ?, 1, 0, ?, ?)`,
        PERFORMANCE_ID,
        startsAt,
        setList,
        nowIso,
        nowIso,
      );
      state.storage.sql.exec(
        `INSERT INTO events
          (id, title, type, starts_at, duration_minutes, call_time, location,
           parent_performance_id, details, set_list_json, set_list_approved,
           is_archived, created_at, updated_at)
         VALUES (?, 'Spring Rehearsal', 'Rehearsal', ?, 90, '', 'Studio', ?, '', '[]', 0, 0, ?, ?)`,
        REHEARSAL_ID,
        rehearsalStartsAt,
        PERFORMANCE_ID,
        nowIso,
        nowIso,
      );
      state.storage.sql.exec(
        `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at)
         VALUES (?, ?, 'Yes', 'Pending', ?, ?), (?, ?, 'Pending', 'Absent', ?, ?)`,
        PERFORMANCE_ID,
        PROFILE_ID,
        nowIso,
        nowIso,
        REHEARSAL_ID,
        PROFILE_ID,
        nowIso,
        nowIso,
      );
      state.storage.sql.exec(
        `INSERT INTO seating_charts
          (id, event_id, name, formation_id, row_counts_json, assignments_json, created_at, updated_at)
         VALUES (?, ?, 'Main chart', 'default', '[2]', '{}', ?, ?)`,
        "12121212-1212-4121-8121-121212121212",
        PERFORMANCE_ID,
        nowIso,
        nowIso,
      );
      state.storage.sql.exec(
        `INSERT INTO organization_resources
          (id, title, url, sort_order, created_at, updated_at)
         VALUES (?, 'Welcome guide', 'https://example.test/guide', 0, ?, ?)`,
        "13131313-1313-4131-8131-131313131313",
        nowIso,
        nowIso,
      );
      state.storage.sql.exec(
        `INSERT INTO seasons (id, name, starts_at, ends_at, dues_amount_cents, is_active, created_at, updated_at)
         VALUES (?, '2026 Season', ?, ?, 10000, 1, ?, ?)`,
        SEASON_ID,
        nowIso,
        new Date(Date.now() + 180 * 24 * 60 * 60 * 1_000).toISOString(),
        nowIso,
        nowIso,
      );
      state.storage.sql.exec(
        `INSERT INTO dues
          (id, season_id, profile_id, amount_cents, provider_session_id, status, paid_at,
           created_at, updated_at, payer_email)
         VALUES (?, ?, ?, 10000, '', 'paid', ?, ?, ?, '')`,
        DUES_ID,
        SEASON_ID,
        PROFILE_ID,
        nowIso,
        nowIso,
        nowIso,
      );
      state.storage.sql.exec(
        `INSERT INTO polls
          (id, title, description, multiple_choice, expires_at, archived_at, created_by, created_at, updated_at)
         VALUES (?, 'Choose a soloist', '', 0, ?, '', 'admin', ?, ?)`,
        POLL_ID,
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
        nowIso,
        nowIso,
      );
      state.storage.sql.exec(
        "INSERT INTO poll_options (id, poll_id, label, sort_order) VALUES (?, ?, 'Member A', 0)",
        POLL_OPTION_ID,
        POLL_ID,
      );
      return null;
    },
  );
});

afterEach(async () => {
  await reset();
});

describe("member dashboard", () => {
  it("aggregates member widgets and uses the parent Performance for inherited practice", async () => {
    const cookie = await signIn();
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/singer/dashboard", cookie),
    );
    expect(response.status).toBe(200);
    const dashboard = memberDashboardResponseSchema.parse(await response.json());
    expect(dashboard.profileLinkRequired).toBe(false);
    expect(dashboard.activeSeasonState).toBe("ready");
    expect(dashboard.activeSeason?.duesStatus).toBe("paid");
    expect(dashboard.resources).toHaveLength(1);
    expect(dashboard.polls).toHaveLength(1);
    const performance = dashboard.events.find((event) => event.id === PERFORMANCE_ID);
    const rehearsal = dashboard.events.find((event) => event.id === REHEARSAL_ID);
    expect(performance).toMatchObject({
      attendanceWarning: { missedRehearsals: 1, status: "warning", totalRehearsals: 1 },
      practice: { status: "available", sourceEventId: PERFORMANCE_ID },
      seating: { status: "not_assigned" },
    });
    expect(performance?.featuredAssignments).toEqual([
      { pieceId: PIECE_ID, title: "Opening Song" },
    ]);
    expect(rehearsal?.practice.sourceEventId).toBe(PERFORMANCE_ID);
  });

  it("keeps today's events available through the Organization-local calendar day", async () => {
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec("UPDATE organization_metadata SET timezone = 'America/New_York'");
        state.storage.sql.exec(
          "UPDATE events SET starts_at = ? WHERE id = ?",
          "2026-08-04T03:30:00.000Z",
          PERFORMANCE_ID,
        );
        return null;
      },
    );

    async function readMemberEventsAt(readAt: string) {
      const response = await stores
        .get(stores.idFromName("organization-alpha"))
        .fetch(
          `https://organization.internal/internal/calendar/member-events?organizationId=organization-alpha&profileId=${PROFILE_ID}&readAt=${encodeURIComponent(readAt)}`,
        );
      expect(response.status).toBe(200);
      return singerEventsResponseSchema.pick({ events: true }).parse(await response.json()).events;
    }

    const beforeLocalMidnight = await readMemberEventsAt("2026-08-04T03:59:59.000Z");
    expect(beforeLocalMidnight.some((event) => event.id === PERFORMANCE_ID)).toBe(true);

    const afterLocalMidnight = await readMemberEventsAt("2026-08-04T04:00:00.000Z");
    expect(afterLocalMidnight.some((event) => event.id === PERFORMANCE_ID)).toBe(false);
  });

  it("keeps an unlinked member dashboard available without leaking personalized data", async () => {
    const cookie = await signIn();
    const response = await exports.default.fetch(
      api("bravo.localhost", "/api/singer/dashboard", cookie),
    );
    expect(response.status).toBe(200);
    const dashboard = memberDashboardResponseSchema.parse(await response.json());
    expect(dashboard.profileLinkRequired).toBe(true);
    expect(dashboard.profile).toBeNull();
    expect(dashboard.events).toEqual([]);
    expect(dashboard.activeSeasonState).toBe("disabled");
    expect(dashboard.bulletinsState).toBe("disabled");
    expect(dashboard.pollsState).toBe("disabled");
  });

  it("keeps optional widgets independently available when resources fail", async () => {
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec("UPDATE organization_resources SET title = ''");
        return null;
      },
    );
    const cookie = await signIn();
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/singer/dashboard", cookie),
    );
    expect(response.status).toBe(200);
    const dashboard = memberDashboardResponseSchema.parse(await response.json());
    expect(dashboard.events).toHaveLength(2);
    expect(dashboard.resources).toEqual([]);
    expect(dashboard.resourcesState).toBe("unavailable");
  });

  it("uses an approved rehearsal track instead of inheriting the parent practice link", async () => {
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          `UPDATE events SET set_list_json = ?, set_list_approved = 1 WHERE id = ?`,
          JSON.stringify([{ pieceId: PIECE_ID, title: "Opening Song", type: "song" }]),
          REHEARSAL_ID,
        );
        return null;
      },
    );
    const cookie = await signIn();
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/singer/dashboard", cookie),
    );
    expect(response.status).toBe(200);
    const dashboard = memberDashboardResponseSchema.parse(await response.json());
    const rehearsal = dashboard.events.find((event) => event.id === REHEARSAL_ID);
    expect(rehearsal?.practice).toMatchObject({
      sourceEventId: REHEARSAL_ID,
      status: "available",
    });
    const parentLink = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/practice-links/${PERFORMANCE_ID}`, cookie),
    );
    const rehearsalLink = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/practice-links/${REHEARSAL_ID}`, cookie),
    );
    expect(parentLink.status).toBe(200);
    expect(rehearsalLink.status).toBe(200);
    expect(readToken(await parentLink.json())).not.toBe(readToken(await rehearsalLink.json()));
  });

  it("serves practice without login and revokes the prior link on rotation", async () => {
    const cookie = await signIn();
    const linkResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/practice-links/${PERFORMANCE_ID}`, cookie),
    );
    expect(linkResponse.status).toBe(200);
    const token = readToken(await linkResponse.json());
    const reusedLinkResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/practice-links/${PERFORMANCE_ID}`, cookie),
    );
    expect(reusedLinkResponse.status).toBe(200);
    expect(readToken(await reusedLinkResponse.json())).toBe(token);
    const publicResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/public/player/playlist?token=${encodeURIComponent(token)}`),
    );
    expect(publicResponse.status).toBe(200);
    expect(readPublicEventId(await publicResponse.json())).toBe(PERFORMANCE_ID);

    await database
      .prepare("UPDATE member SET role = 'owner' WHERE organizationId = 'organization-alpha'")
      .run();
    const rotated = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/player-tokens/${PERFORMANCE_ID}/rotate`, cookie, {
        method: "POST",
      }),
    );
    expect(rotated.status).toBe(200);
    const oldResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/public/player/playlist?token=${encodeURIComponent(token)}`),
    );
    expect(oldResponse.status).toBe(404);
  });

  it("returns a useful response when the set-list player is not publishable", async () => {
    const cookie = await signIn();
    await database
      .prepare("UPDATE member SET role = 'owner' WHERE organizationId = 'organization-alpha'")
      .run();

    const published = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/player-tokens", cookie, {
        body: JSON.stringify({ eventId: PERFORMANCE_ID }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(published.status).toBe(200);
    const publishedBody = await published.json();
    expect(readToken(publishedBody)).toBeTruthy();
    expect(readUrl(publishedBody)).toContain("http://alpha.localhost/player?mode=set-list&token=");
    const publicPlayerResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        "/api/public/player/playlist?token=" + encodeURIComponent(readToken(publishedBody)),
      ),
    );
    expect(publicPlayerResponse.status).toBe(200);

    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE events SET set_list_approved = 0 WHERE id = ?",
          PERFORMANCE_ID,
        );
        return null;
      },
    );
    const unpublished = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/player-tokens", cookie, {
        body: JSON.stringify({ eventId: PERFORMANCE_ID }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(unpublished.status).toBe(409);
    expect(await unpublished.json()).toMatchObject({
      code: "practice_not_published",
      message:
        "The Practice Player needs an approved, active set list with at least one learning track.",
    });
  });

  it("rechecks public practice eligibility after a link is issued", async () => {
    const cookie = await signIn();
    const linkResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/practice-links/${PERFORMANCE_ID}`, cookie),
    );
    const token = readToken(await linkResponse.json());
    const invalidatingColumns = ["is_canceled", "is_archived", "set_list_approved"] as const;
    for (const column of invalidatingColumns) {
      const invalidValue = column === "set_list_approved" ? 0 : 1;
      await runInDurableObject<OrganizationStore, null>(
        stores.get(stores.idFromName("organization-alpha")),
        (_instance, state) => {
          state.storage.sql.exec(
            `UPDATE events SET is_canceled = 0, is_archived = 0, set_list_approved = 1 WHERE id = ?`,
            PERFORMANCE_ID,
          );
          state.storage.sql.exec(
            `UPDATE events SET ${column} = ? WHERE id = ?`,
            invalidValue,
            PERFORMANCE_ID,
          );
          return null;
        },
      );
      const response = await exports.default.fetch(
        api("alpha.localhost", `/api/public/player/playlist?token=${encodeURIComponent(token)}`),
      );
      expect(response.status).toBe(404);
    }
  });

  it("populates placeholders and link tags in member dashboard bulletins", async () => {
    const messageId = "88888888-8888-4888-8888-888888888888";
    const deliveryId = "77777777-7777-4777-8777-777777777777";
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        const nowIso = new Date().toISOString();
        state.storage.sql.exec(
          `INSERT INTO communication_messages
            (id, channel, status, subject, content_markdown, audience_json, reach_json,
             created_by, created_at, updated_at, sent_at)
           VALUES (?, 'Email', 'Sent', 'Update for {singerName}: {eventTitle}',
                   'Hello {singerName}, here are details for {eventTitle} ({eventType}) on {eventDate}. {{RSVP_LINKS}} {{PLAYER_LINK}} {{POLL_LINK:${POLL_ID}}}',
                   ?, '{"total":1}', 'bootstrap', ?, ?, ?)`,
          messageId,
          JSON.stringify({ eventId: PERFORMANCE_ID, targetAudiences: ["Members"] }),
          nowIso,
          nowIso,
          nowIso,
        );
        state.storage.sql.exec(
          `INSERT INTO communication_deliveries
            (id, message_id, profile_id, recipient_name, channel, destination, status,
             created_at, updated_at)
           VALUES (?, ?, ?, 'Dashboard Member', 'email', 'member@example.test', 'sent', ?, ?)`,
          deliveryId,
          messageId,
          PROFILE_ID,
          nowIso,
          nowIso,
        );
        return null;
      },
    );
    const cookie = await signIn();
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/singer/dashboard", cookie),
    );
    expect(response.status).toBe(200);
    const dashboard = memberDashboardResponseSchema.parse(await response.json());
    expect(dashboard.bulletinsState).toBe("ready");
    expect(dashboard.bulletins).toHaveLength(1);
    const bulletin = dashboard.bulletins[0];
    expect(bulletin).toBeDefined();
    if (!bulletin) throw new Error("Expected bulletin");
    expect(bulletin.subject).toBe("Update for Dashboard Member: Spring Performance");
    expect(bulletin.contentMarkdown).toContain("Hello Dashboard Member");
    expect(bulletin.contentMarkdown).toContain("Spring Performance (Performance)");
    expect(bulletin.contentMarkdown).toContain("[Open RSVP](/schedule)");
    expect(bulletin.contentMarkdown).toContain("[Open practice player](/practice)");
    expect(bulletin.contentMarkdown).toContain("[Respond to poll](/poll?token=");
    expect(bulletin.contentMarkdown).not.toContain("{singerName}");
    expect(bulletin.contentMarkdown).not.toContain("{eventTitle}");
    expect(bulletin.contentMarkdown).not.toContain("{{RSVP_LINKS}}");
    expect(bulletin.contentMarkdown).not.toContain("{{PLAYER_LINK}}");
    expect(bulletin.contentMarkdown).not.toContain("{{POLL_LINK:");
    expect(bulletin.preview).toContain("Hello Dashboard Member");
    expect(bulletin.preview).toContain("Respond to poll");
    expect(bulletin.preview).not.toContain("{singerName}");
    expect(bulletin.preview).not.toContain("{{POLL_LINK:");
  });

  it("handles linked rehearsal RSVP overrides, required decline notes, and performance-bound visibility", async () => {
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        const futurePerformance = new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000).toISOString();
        const futureRehearsal = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
        state.storage.sql.exec(
          `UPDATE events SET starts_at = ? WHERE id = ?`,
          futurePerformance,
          PERFORMANCE_ID,
        );
        state.storage.sql.exec(
          `UPDATE events SET starts_at = ? WHERE id = ?`,
          futureRehearsal,
          REHEARSAL_ID,
        );
        return null;
      },
    );
    const cookie = await signIn();

    // 1. Initially, performance is Pending -> Rehearsal is visible and inherits Pending
    const initialSchedule = await exports.default.fetch(
      api("alpha.localhost", "/api/singer/events", cookie),
    );
    expect(initialSchedule.status).toBe(200);
    const initialEvents = singerEventsResponseSchema.parse(await initialSchedule.json()).events;
    expect(initialEvents.some((event) => event.id === REHEARSAL_ID)).toBe(true);

    // 2. Declining a rehearsal without a note fails with 400 rsvp_decline_note_required
    const emptyNoteDecline = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${REHEARSAL_ID}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "No", rsvpNote: "   " }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(emptyNoteDecline.status).toBe(400);
    expect(await emptyNoteDecline.json()).toMatchObject({
      code: "rsvp_decline_note_required",
    });

    // 3. Declining a rehearsal with a note succeeds
    const validDecline = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${REHEARSAL_ID}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "No", rsvpNote: "Family conflict" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(validDecline.status).toBe(200);
    expect(await validDecline.json()).toMatchObject({
      rsvp: "No",
      rsvpNote: "Family conflict",
    });

    // 4. Switching rehearsal back to Yes succeeds and clears the decline note
    const attendRehearsal = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${REHEARSAL_ID}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "Yes", rsvpNote: "" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(attendRehearsal.status).toBe(200);
    expect(await attendRehearsal.json()).toMatchObject({
      rsvp: "Yes",
      rsvpNote: "",
    });

    // Re-decline rehearsal with note for testing performance cascade
    await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${REHEARSAL_ID}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "No", rsvpNote: "Travel" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );

    // 5. Declining the parent performance hides linked rehearsal from member schedule and dashboard
    const declinePerformance = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${PERFORMANCE_ID}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "No", rsvpNote: "" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(declinePerformance.status).toBe(200);

    const scheduleAfterPerfDecline = await exports.default.fetch(
      api("alpha.localhost", "/api/singer/events", cookie),
    );
    const eventsAfterPerfDecline = singerEventsResponseSchema.parse(
      await scheduleAfterPerfDecline.json(),
    ).events;
    expect(eventsAfterPerfDecline.some((event) => event.id === PERFORMANCE_ID)).toBe(true);
    expect(eventsAfterPerfDecline.some((event) => event.id === REHEARSAL_ID)).toBe(false);

    const dashboardAfterPerfDecline = await exports.default.fetch(
      api("alpha.localhost", "/api/singer/dashboard", cookie),
    );
    const dashboardEvents = memberDashboardResponseSchema.parse(
      await dashboardAfterPerfDecline.json(),
    ).events;
    expect(dashboardEvents.some((event) => event.id === PERFORMANCE_ID)).toBe(true);
    expect(dashboardEvents.some((event) => event.id === REHEARSAL_ID)).toBe(false);

    // 6. Attending the parent performance restores linked rehearsal visibility with its saved direct response
    const attendPerformance = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${PERFORMANCE_ID}/rsvp`, cookie, {
        body: JSON.stringify({ rsvp: "Yes", rsvpNote: "" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(attendPerformance.status).toBe(200);

    const restoredSchedule = await exports.default.fetch(
      api("alpha.localhost", "/api/singer/events", cookie),
    );
    const restoredEvents = singerEventsResponseSchema.parse(await restoredSchedule.json()).events;
    const restoredRehearsal = restoredEvents.find((event) => event.id === REHEARSAL_ID);
    expect(restoredRehearsal).toBeDefined();
    expect(restoredRehearsal?.directRsvp).toBe("No");
    expect(restoredRehearsal?.rsvpNote).toBe("Travel");
  });
});
