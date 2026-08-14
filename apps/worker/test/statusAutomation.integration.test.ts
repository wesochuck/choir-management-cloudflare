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

  it("applies the On Break timeout to an automatically managed Idle profile", async () => {
    const cookie = await signIn();
    const profile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "On Break Singer",
          voicePart: "S1",
        })
      ).json(),
    );
    const roster = organizationRosterConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/roster-configuration", cookie),
        )
      ).json(),
    );
    const saved = await write(
      "alpha.localhost",
      "/api/organization/roster-configuration",
      cookie,
      { ...roster, onBreakTimeoutDays: 30 },
      "PUT",
    );
    expect(saved.status).toBe(200);
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          `UPDATE profiles SET global_status = 'Idle', status_is_manual = 0,
             status_changed_at = ?, status_change_reason = 'Planned leave'
           WHERE id = ?`,
          new Date(Date.now() - 60 * 86_400_000).toISOString(),
          profile.id,
        );
        return null;
      },
    );
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        runRosterAutomations(state.storage, "organization-alpha", new Date());
        return null;
      },
    );
    const profiles = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/profiles", cookie))
      ).json(),
    );
    expect(profiles.profiles.find(({ id }) => id === profile.id)?.globalStatus).toBe("Inactive");
    const history = organizationProfileStatusHistoryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/profiles/${profile.id}/status-history`, cookie),
        )
      ).json(),
    );
    expect(history.entries[0]).toMatchObject({
      newStatus: "Inactive",
      reason: "On Break has reached its 30-day timeout.",
      triggerType: "on_break_timeout",
    });
  });

  it("seeds only a marked hidden fixture before running the real timeout rule", async () => {
    const cookie = await signIn();
    const profile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "QUAL-STATUS-AUTOMATION-local",
          doNotEmail: true,
          globalStatus: "Idle",
          showInDirectory: false,
          statusIsManual: false,
          voicePart: "S1",
        })
      ).json(),
    );
    expect(profile).toMatchObject({
      doNotEmail: true,
      globalStatus: "Idle",
      showInDirectory: false,
      statusIsManual: false,
      voicePart: "S1",
    });

    const disabledRoute = await write(
      "alpha.localhost",
      "/api/platform/maintenance/status-automation-fixture",
      cookie,
      { profileId: profile.id },
    );
    expect(disabledRoute.status).toBe(404);

    const crossOrganizationFixture = await stores
      .get(stores.idFromName("organization-alpha"))
      .fetch("https://organization.internal/internal/roster/status-automation-fixture", {
        body: JSON.stringify({
          actorUserId: "status-automation-manager",
          organizationId: "organization-bravo",
          profileId: profile.id,
          requestId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    expect(crossOrganizationFixture.status).toBe(404);
    await expect(crossOrganizationFixture.json()).resolves.toMatchObject({
      code: "organization_not_found",
    });

    const unmarked = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Unmarked Status Automation Profile",
          globalStatus: "Idle",
          showInDirectory: false,
          statusIsManual: false,
          voicePart: "S1",
        })
      ).json(),
    );
    const invalidFixture = await stores
      .get(stores.idFromName("organization-alpha"))
      .fetch("https://organization.internal/internal/roster/status-automation-fixture", {
        body: JSON.stringify({
          actorUserId: "status-automation-manager",
          organizationId: "organization-alpha",
          profileId: unmarked.id,
          requestId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    expect(invalidFixture.status).toBe(409);
    await expect(invalidFixture.json()).resolves.toMatchObject({
      code: "invalid_status_automation_fixture",
    });

    const fixture = await stores
      .get(stores.idFromName("organization-alpha"))
      .fetch("https://organization.internal/internal/roster/status-automation-fixture", {
        body: JSON.stringify({
          actorUserId: "status-automation-manager",
          organizationId: "organization-alpha",
          profileId: profile.id,
          requestId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    expect(fixture.status).toBe(200);
    await expect(fixture.json()).resolves.toMatchObject({
      fixture: true,
      profileId: profile.id,
      timeoutDays: 365,
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
      currentStatus: "Idle",
      nextStatus: "Inactive",
    });

    const maintenance = await exports.default.fetch(
      api("alpha.localhost", "/api/platform/maintenance/run", cookie),
    );
    expect(maintenance.status).toBe(200);
    const updated = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/profiles", cookie))
      ).json(),
    );
    expect(updated.profiles.find(({ id }) => id === profile.id)).toMatchObject({
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
      actorType: "system",
      newStatus: "Inactive",
      triggerType: "on_break_timeout",
    });
  });

  it("processes automation profiles across the supported 5,000-profile envelope", async () => {
    const cookie = await signIn();
    const tailProfileId = "00000000-0000-4000-8000-000000005000";
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        const createdAt = new Date("2025-01-01T00:00:00.000Z").toISOString();
        for (let offset = 0; offset < 4_999; offset += 25) {
          const rows = Array.from({ length: Math.min(25, 4_999 - offset) }, (_, index) => {
            const sequence = String(offset + index).padStart(4, "0");
            return [
              `scale-status-profile-${sequence}`,
              `Scale Status Profile ${sequence}`,
              createdAt,
              createdAt,
            ] as const;
          });
          const placeholders = rows.map(() => "(?, ?, ?, ?)").join(", ");
          state.storage.sql.exec(
            `INSERT INTO profiles (id, display_name, created_at, updated_at)
             VALUES ${placeholders}`,
            ...rows.flat(),
          );
        }
        state.storage.sql.exec(
          `INSERT INTO profiles
             (id, display_name, voice_part, global_status, status_is_manual,
              status_changed_at, status_change_reason, created_at, updated_at)
           VALUES (?, ?, 'S1', 'Idle', 0, ?, 'Planned leave', ?, ?)`,
          tailProfileId,
          "zz-scale-status-tail",
          new Date("2025-01-01T00:00:00.000Z").toISOString(),
          createdAt,
          createdAt,
        );
        state.storage.sql.exec(
          `UPDATE profiles SET voice_part = 'S1', global_status = 'Idle', status_is_manual = 0,
             status_changed_at = ?, status_change_reason = 'Planned leave'
           WHERE id LIKE 'scale-status-profile-%'`,
          new Date("2025-01-01T00:00:00.000Z").toISOString(),
        );
        return null;
      },
    );

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
          profileId: tailProfileId,
        })
      ).json(),
    );
    expect(preview.selectedProfile).toMatchObject({
      currentStatus: "Idle",
      id: tailProfileId,
      nextStatus: "Inactive",
    });
    expect(preview).toMatchObject({
      affectedProfileCount: 5_000,
      onBreakTimeoutCount: 5_000,
      statusChangeCount: 5_000,
    });

    const result = await runInDurableObject<
      OrganizationStore,
      { readonly profileStatusChanges: number }
    >(stores.get(stores.idFromName("organization-alpha")), (_instance, state) =>
      runRosterAutomations(
        state.storage,
        "organization-alpha",
        new Date("2031-02-01T00:00:00.000Z"),
      ),
    );
    expect(result.profileStatusChanges).toBe(5_000);
    await expect(
      runInDurableObject<OrganizationStore, { readonly globalStatus: string }>(
        stores.get(stores.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly globalStatus: string }>(
              "SELECT global_status AS globalStatus FROM profiles WHERE id = ?",
              tailProfileId,
            )
            .one(),
      ),
    ).resolves.toEqual({ globalStatus: "Inactive" });
  });

  it("leaves manually managed and non-performer profiles untouched by automation runs", async () => {
    const cookie = await signIn();
    const manual = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Manual Singer",
          voicePart: "S2",
        })
      ).json(),
    );
    const staff = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Staff Member",
        })
      ).json(),
    );
    for (let index = 1; index <= 3; index += 1) {
      const event = organizationEventSchema.parse(
        await (
          await write("alpha.localhost", "/api/organization/events", cookie, {
            startsAt: new Date(Date.now() - index * 3 * 86_400_000).toISOString(),
            title: `Staff Missed Performance ${String(index)}`,
            type: "Performance",
          })
        ).json(),
      );
      await write(
        "alpha.localhost",
        `/api/organization/events/${event.id}/rsvp`,
        cookie,
        { profileId: staff.id, rsvp: "No" },
        "PUT",
      );
    }
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          `UPDATE profiles SET global_status = 'Idle', status_is_manual = 1,
             status_changed_at = ?, status_change_reason = 'Manual hold'
           WHERE id = ?`,
          new Date(Date.now() - 60 * 86_400_000).toISOString(),
          manual.id,
        );
        return null;
      },
    );
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        runRosterAutomations(state.storage, "organization-alpha", new Date());
        return null;
      },
    );
    const profiles = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/profiles", cookie))
      ).json(),
    );
    expect(profiles.profiles.find(({ id }) => id === manual.id)?.globalStatus).toBe("Idle");
    expect(profiles.profiles.find(({ id }) => id === staff.id)?.globalStatus).toBe("Active");
  });

  it("does not expire pending RSVPs when RSVP expiry is disabled", async () => {
    const cookie = await signIn();
    await write("alpha.localhost", "/api/organization/profiles", cookie, {
      displayName: "Expiry Disabled Singer",
      voicePart: "S1",
    });
    const roster = organizationRosterConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/roster-configuration", cookie),
        )
      ).json(),
    );
    const saved = await write(
      "alpha.localhost",
      "/api/organization/roster-configuration",
      cookie,
      { ...roster, rsvpExpiryEnabled: false },
      "PUT",
    );
    expect(saved.status).toBe(200);
    const future = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          title: "Expiry Disabled Performance",
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
    const rows = organizationAttendanceResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/events/${future.id}/attendance`, cookie),
        )
      ).json(),
    );
    expect(rows.rows.every((row) => row.rsvp === "Pending")).toBe(true);
  });

  it("does not change statuses when status automation is disabled", async () => {
    const cookie = await signIn();
    const profile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Automation Disabled Singer",
          voicePart: "S1",
        })
      ).json(),
    );
    const roster = organizationRosterConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/roster-configuration", cookie),
        )
      ).json(),
    );
    const saved = await write(
      "alpha.localhost",
      "/api/organization/roster-configuration",
      cookie,
      { ...roster, statusAutomationEnabled: false },
      "PUT",
    );
    expect(saved.status).toBe(200);
    for (let index = 1; index <= 3; index += 1) {
      const event = organizationEventSchema.parse(
        await (
          await write("alpha.localhost", "/api/organization/events", cookie, {
            startsAt: new Date(Date.now() - index * 3 * 86_400_000).toISOString(),
            title: `Disabled Missed Performance ${String(index)}`,
            type: "Performance",
          })
        ).json(),
      );
      await write(
        "alpha.localhost",
        `/api/organization/events/${event.id}/rsvp`,
        cookie,
        { profileId: profile.id, rsvp: "No" },
        "PUT",
      );
    }
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        runRosterAutomations(state.storage, "organization-alpha", new Date());
        return null;
      },
    );
    const profiles = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/profiles", cookie))
      ).json(),
    );
    expect(profiles.profiles.find(({ id }) => id === profile.id)?.globalStatus).toBe("Active");
  });

  it("marks a performer Inactive after three Absent attendances", async () => {
    const cookie = await signIn();
    const profile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Absent Singer",
          voicePart: "S1",
        })
      ).json(),
    );
    for (let index = 1; index <= 3; index += 1) {
      const event = organizationEventSchema.parse(
        await (
          await write("alpha.localhost", "/api/organization/events", cookie, {
            startsAt: new Date(Date.now() - index * 3 * 86_400_000).toISOString(),
            title: `Absent Performance ${String(index)}`,
            type: "Performance",
          })
        ).json(),
      );
      const attendance = await write(
        "alpha.localhost",
        `/api/organization/events/${event.id}/attendance`,
        cookie,
        { updates: [{ attendance: "Absent", profileId: profile.id }] },
        "PUT",
      );
      expect(attendance.status).toBe(200);
    }
    const profiles = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/profiles", cookie))
      ).json(),
    );
    expect(profiles.profiles.find(({ id }) => id === profile.id)?.globalStatus).toBe("Inactive");
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
  });

  it("previews pending status changes, On Break timeouts, and RSVP expiries", async () => {
    const cookie = await signIn();
    const missed = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Preview Missed Singer",
          voicePart: "S1",
        })
      ).json(),
    );
    const onBreak = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Preview On Break Singer",
          voicePart: "S2",
        })
      ).json(),
    );
    const missedEventIds: string[] = [];
    for (let index = 1; index <= 3; index += 1) {
      const event = organizationEventSchema.parse(
        await (
          await write("alpha.localhost", "/api/organization/events", cookie, {
            startsAt: new Date(Date.now() - index * 3 * 86_400_000).toISOString(),
            title: `Preview Missed Performance ${String(index)}`,
            type: "Performance",
          })
        ).json(),
      );
      missedEventIds.push(event.id);
    }
    const now = new Date().toISOString();
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        for (const eventId of missedEventIds) {
          state.storage.sql.exec(
            `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at)
             VALUES (?, ?, 'No', 'Pending', ?, ?)`,
            eventId,
            missed.id,
            now,
            now,
          );
        }
        state.storage.sql.exec(
          `UPDATE profiles SET global_status = 'Idle', status_is_manual = 0,
             status_changed_at = ?, status_change_reason = 'Planned leave'
           WHERE id = ?`,
          new Date(Date.now() - 60 * 86_400_000).toISOString(),
          onBreak.id,
        );
        return null;
      },
    );
    await write("alpha.localhost", "/api/organization/events", cookie, {
      startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      title: "Preview Expiry Performance",
      type: "Performance",
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
          configuration: { ...roster, onBreakTimeoutDays: 30 },
          profileId: null,
        })
      ).json(),
    );
    expect(preview).toMatchObject({
      affectedProfileCount: 2,
      onBreakTimeoutCount: 1,
      rsvpExpiryCount: 2,
      statusChangeCount: 2,
    });
    expect(preview.selectedProfile).toBeNull();
  });

  it("applies the On Break timeout when the roster configuration is saved", async () => {
    const cookie = await signIn();
    const profile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Config Save Singer",
          voicePart: "S1",
        })
      ).json(),
    );
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          `UPDATE profiles SET global_status = 'Idle', status_is_manual = 0,
             status_changed_at = ?, status_change_reason = 'Planned leave'
           WHERE id = ?`,
          new Date(Date.now() - 60 * 86_400_000).toISOString(),
          profile.id,
        );
        return null;
      },
    );
    const roster = organizationRosterConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/roster-configuration", cookie),
        )
      ).json(),
    );
    const saved = await write(
      "alpha.localhost",
      "/api/organization/roster-configuration",
      cookie,
      { ...roster, onBreakTimeoutDays: 30 },
      "PUT",
    );
    expect(saved.status).toBe(200);
    const profiles = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/profiles", cookie))
      ).json(),
    );
    expect(profiles.profiles.find(({ id }) => id === profile.id)?.globalStatus).toBe("Inactive");
  });

  it("writes audit events for automated RSVP and status changes", async () => {
    const cookie = await signIn();
    const profile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Audit Singer",
          voicePart: "S1",
        })
      ).json(),
    );
    for (let index = 1; index <= 3; index += 1) {
      const event = organizationEventSchema.parse(
        await (
          await write("alpha.localhost", "/api/organization/events", cookie, {
            startsAt: new Date(Date.now() - index * 3 * 86_400_000).toISOString(),
            title: `Audit Missed Performance ${String(index)}`,
            type: "Performance",
          })
        ).json(),
      );
      await write(
        "alpha.localhost",
        `/api/organization/events/${event.id}/rsvp`,
        cookie,
        { profileId: profile.id, rsvp: "No" },
        "PUT",
      );
    }
    await write("alpha.localhost", "/api/organization/events", cookie, {
      startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      title: "Audit Expiry Performance",
      type: "Performance",
    });
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        runRosterAutomations(state.storage, "organization-alpha", new Date());
        return null;
      },
    );
    const auditActions: string[] = [];
    const auditActorTypes: string[] = [];
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        for (const row of state.storage.sql
          .exec<{ readonly action: string; readonly actorType: string }>(
            "SELECT action, actor_type AS actorType FROM audit_events",
          )
          .toArray()) {
          auditActions.push(row.action);
          auditActorTypes.push(row.actorType);
        }
        return null;
      },
    );
    expect(auditActions).toContain("profile.status.automated");
    expect(auditActions).toContain("event.rsvp.automated");
    const automatedIndexes = auditActions
      .map((action, index) =>
        action === "profile.status.automated" || action === "event.rsvp.automated" ? index : -1,
      )
      .filter((index) => index >= 0);
    for (const index of automatedIndexes) {
      expect(auditActorTypes[index]).toBe("system");
    }
  });
});
