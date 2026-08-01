import {
  organizationAttendanceResponseSchema,
  organizationEventSchema,
  organizationEventRsvpHistoryResponseSchema,
  organizationEventsResponseSchema,
  organizationProfileResponseSchema,
  organizationProfilesResponseSchema,
  organizationProfileStatusHistoryResponseSchema,
  organizationRosterAutomationPreviewResponseSchema,
  organizationRosterConfigurationResponseSchema,
  organizationRsvpSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { runRosterAutomations } from "../src/organization/statusAutomationStore";

const USER_EMAIL = "status-automation.manager@example.test";

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

async function provision(id: string, slug: string, role: "admin" | "member"): Promise<void> {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 14, ?, ?, ?)`,
      )
      .bind(id, `Organization ${slug}`, slug, id, now, now, now),
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
         VALUES (?, ?, 'status-automation-manager', ?, ?)`,
      )
      .bind(`member-${slug}`, id, role, Date.now()),
  ]);
  const response = await stores
    .get(stores.idFromName(id))
    .fetch("https://organization.internal/internal/provision", {
      body: JSON.stringify({
        actorUserId: "bootstrap",
        canonicalHostname: `${slug}.localhost`,
        canonicalStatus: "active",
        name: `Organization ${slug}`,
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

async function write(
  host: string,
  path: string,
  cookie: string,
  body: unknown,
  method = "POST",
): Promise<Response> {
  return exports.default.fetch(
    api(host, path, cookie, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
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
       VALUES ('status-automation-manager', 'Status Automation Manager', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "alpha", "admin");
  await provision("organization-bravo", "bravo", "member");
});

afterEach(async () => {
  await reset();
});

describe("roster status automation", () => {
  it("previews, applies, reconciles, expires, and isolates the automation rules", async () => {
    const cookie = await signIn();
    const profile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Automation Singer",
          voicePart: "S1",
        })
      ).json(),
    );
    expect(profile.id).toBeTruthy();

    const pastPerformanceIds: string[] = [];
    for (let index = 1; index <= 3; index += 1) {
      const event = organizationEventSchema.parse(
        await (
          await write("alpha.localhost", "/api/organization/events", cookie, {
            durationMinutes: 120,
            startsAt: new Date(Date.now() - index * 3 * 86_400_000).toISOString(),
            title: `Missed Performance ${String(index)}`,
            type: "Performance",
          })
        ).json(),
      );
      pastPerformanceIds.push(event.id);
      expect(
        organizationRsvpSchema.parse(
          await (
            await write(
              "alpha.localhost",
              `/api/organization/events/${event.id}/rsvp`,
              cookie,
              { profileId: profile.id, rsvp: "No" },
              "PUT",
            )
          ).json(),
        ).rsvp,
      ).toBe("No");
    }

    const profiles = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/profiles", cookie))
      ).json(),
    );
    expect(profiles.profiles.find(({ id }) => id === profile.id)).toMatchObject({
      globalStatus: "Inactive",
      statusIsManual: false,
    });
    const history = organizationProfileStatusHistoryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/profiles/${profile.id}/status-history`, cookie),
        )
      ).json(),
    );
    expect(history.entries[0]).toMatchObject({
      newStatus: "Inactive",
      triggerType: "performance_miss",
    });

    const roster = organizationRosterConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/roster-configuration", cookie),
        )
      ).json(),
    );
    const preview = organizationRosterAutomationPreviewResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/roster-configuration/preview", cookie, {
          configuration: roster,
          profileId: profile.id,
        })
      ).json(),
    );
    expect(preview.selectedProfile).toMatchObject({
      currentStatus: "Inactive",
      nextStatus: "Inactive",
    });

    const futurePerformance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          title: "Recovery Performance",
          type: "Performance",
        })
      ).json(),
    );
    await write(
      "alpha.localhost",
      `/api/organization/events/${futurePerformance.id}/rsvp`,
      cookie,
      { profileId: profile.id, rsvp: "Yes" },
      "PUT",
    );
    const recovered = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/profiles", cookie))
      ).json(),
    );
    expect(recovered.profiles.find(({ id }) => id === profile.id)?.globalStatus).toBe("Active");
    const recoveredProfile = recovered.profiles.find(({ id }) => id === profile.id);
    if (!recoveredProfile) throw new Error("The recovered Profile was not returned.");
    const manuallyManaged = organizationProfileResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/profiles/${profile.id}`,
          cookie,
          { ...recoveredProfile, globalStatus: "Idle", statusIsManual: true },
          "PUT",
        )
      ).json(),
    );
    expect(manuallyManaged).toMatchObject({ globalStatus: "Idle", statusIsManual: true });
    const manualHistory = organizationProfileStatusHistoryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/profiles/${profile.id}/status-history`, cookie),
        )
      ).json(),
    );
    expect(manualHistory.entries[0]).toMatchObject({
      newStatus: "Idle",
      triggerType: "manual_status_selection",
    });

    const expiryPerformance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          title: "Expiry Performance",
          type: "Performance",
        })
      ).json(),
    );
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        runRosterAutomations(state.storage, "organization-alpha", new Date());
        return null;
      },
    );
    const expiredRows = organizationAttendanceResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/events/${expiryPerformance.id}/attendance`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(expiredRows.rows.find(({ profileId }) => profileId === profile.id)?.rsvp).toBe("No");
    const expiryHistory = organizationEventRsvpHistoryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/events/${expiryPerformance.id}/rsvp-history`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(expiryHistory.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ automatic: true, newRsvp: "No", profileId: profile.id }),
      ]),
    );

    const pastPendingPerformance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          title: "Past Pending Performance",
          type: "Performance",
        })
      ).json(),
    );
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        runRosterAutomations(state.storage, "organization-alpha", new Date());
        return null;
      },
    );
    const pastPendingRows = organizationAttendanceResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/events/${pastPendingPerformance.id}/attendance`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(pastPendingRows.rows.find(({ profileId }) => profileId === profile.id)?.rsvp).toBe(
      "Pending",
    );

    const linkedPerformance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(Date.now() + 40 * 86_400_000).toISOString(),
          title: "Linked Performance",
          type: "Performance",
        })
      ).json(),
    );
    const linkedRehearsal = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          parentPerformanceId: linkedPerformance.id,
          startsAt: new Date(Date.now() + 35 * 86_400_000).toISOString(),
          title: "Linked Rehearsal",
          type: "Rehearsal",
        })
      ).json(),
    );
    const attendance = await write(
      "alpha.localhost",
      `/api/organization/events/${linkedRehearsal.id}/attendance`,
      cookie,
      { updates: [{ attendance: "Present", profileId: profile.id }] },
      "PUT",
    );
    expect(attendance.status).toBe(200);
    const parentRoster = organizationAttendanceResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/events/${linkedPerformance.id}/attendance`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(parentRoster.rows.find(({ profileId }) => profileId === profile.id)?.rsvp).toBe("Yes");
    const rehearsalHistory = organizationEventRsvpHistoryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/events/${linkedRehearsal.id}/rsvp-history`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(rehearsalHistory.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ automatic: true, newRsvp: "Yes", profileId: profile.id }),
      ]),
    );

    const canceledPerformance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          title: "Canceled Performance",
          type: "Performance",
        })
      ).json(),
    );
    const canceledRehearsal = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          parentPerformanceId: canceledPerformance.id,
          startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          title: "Canceled Rehearsal",
          type: "Rehearsal",
        })
      ).json(),
    );
    const cancelResponse = await write(
      "alpha.localhost",
      `/api/organization/events/${canceledPerformance.id}/cancel`,
      cookie,
      {},
    );
    expect(cancelResponse.status).toBe(200);
    const canceledEvents = organizationEventsResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/events", cookie))
      ).json(),
    ).events;
    expect(canceledEvents.find(({ id }) => id === canceledPerformance.id)).toMatchObject({
      isCanceled: true,
      rsvpDeadlineAt: null,
      rsvpSelfServiceOpen: false,
    });
    expect(canceledEvents.find(({ id }) => id === canceledRehearsal.id)?.isCanceled).toBe(true);
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        runRosterAutomations(state.storage, "organization-alpha", new Date());
        return null;
      },
    );
    const canceledRows = organizationAttendanceResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/events/${canceledPerformance.id}/attendance`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(canceledRows.rows.find(({ profileId }) => profileId === profile.id)?.rsvp).toBe(
      "Pending",
    );

    const bravoPreview = await write(
      "bravo.localhost",
      "/api/organization/roster-configuration/preview",
      cookie,
      { configuration: roster, profileId: profile.id },
    );
    expect(bravoPreview.status).toBe(403);
    expect(pastPerformanceIds).toHaveLength(3);
  });
});
