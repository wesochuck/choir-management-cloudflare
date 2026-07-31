import {
  calendarFeedUrlsResponseSchema,
  organizationCalendarSettingsResponseSchema,
  organizationDashboardSummaryResponseSchema,
  organizationEventSchema,
  organizationEventArchiveResponseSchema,
  organizationEventsResponseSchema,
  organizationProfileResponseSchema,
  organizationRsvpSchema,
  setupStatusSchema,
  organizationVenueSchema,
  organizationVenuesResponseSchema,
  organizationExportManifestSchema,
  organizationExportStartResponseSchema,
  organizationExportStatusResponseSchema,
  organizationAuditionListResponseSchema,
  organizationAuditionResponseSchema,
  organizationAuditionSettingsResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  reset,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { processDeliveryBatch } from "../src/jobs/consumer";

const USER_EMAIL = "calendar.manager@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const organizationFiles = requireBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");

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
  it("queues, completes, downloads, and replays an asynchronous Organization export", async () => {
    const cookie = await signIn();
    await database
      .prepare("UPDATE member SET role = 'owner' WHERE organizationId = ? AND userId = ?")
      .bind("organization-alpha", "calendar-manager")
      .run();

    const started = await post("alpha.localhost", "/api/organization/export", cookie, {
      format: "json",
    });
    expect(started.status).toBe(202);
    const startedBody = await started.json();
    const exportId = organizationExportStartResponseSchema.parse(startedBody).exportId;

    const queued = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/export/${exportId}`, cookie),
    );
    expect(organizationExportStatusResponseSchema.parse(await queued.json()).status).toBe("queued");

    const message = {
      attempts: 1,
      body: {
        attempt: 1,
        idempotencyKey: `organization-export:${exportId}`,
        jobId: exportId,
        kind: "organization_export",
        organizationId: "organization-alpha",
        version: 1,
      },
      id: `export-${exportId}`,
      timestamp: new Date("2026-07-21T12:00:00.000Z"),
    } as const;
    const batch = createMessageBatch("choir-management-jobs-local", [message]);
    const executionContext = createExecutionContext();
    await processDeliveryBatch(batch, {
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_FILES: organizationFiles,
      ORGANIZATION_STORE: stores,
      PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
      SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
    });
    await getQueueResult(batch, executionContext);

    const completed = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/export/${exportId}`, cookie),
    );
    const completedBody = organizationExportStatusResponseSchema.parse(await completed.json());
    expect(completedBody).toMatchObject({ status: "completed", exportId });
    const auditActorTypes = await runInDurableObject<OrganizationStore, string[]>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly actorType: string }>(
            `SELECT actor_type AS actorType FROM audit_events
             WHERE target_id = ? AND action IN ('organization.export.requested', 'organization.export.completed')
             ORDER BY action`,
            exportId,
          )
          .toArray()
          .map(({ actorType }) => actorType),
    );
    expect(auditActorTypes).toEqual(["organization_member", "organization_member"]);
    const downloaded = await exports.default.fetch(
      api("alpha.localhost", completedBody.downloadUrl ?? "/missing", cookie),
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("x-export-checksum-sha256")).toBe(completedBody.checksumSha256);

    const replay = createMessageBatch("choir-management-jobs-local", [
      { ...message, id: `export-replay-${exportId}` },
    ]);
    await processDeliveryBatch(replay, {
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_FILES: organizationFiles,
      ORGANIZATION_STORE: stores,
      PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
      SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
    });
    await getQueueResult(replay, executionContext);
    expect(
      organizationExportStatusResponseSchema.parse(
        await (
          await exports.default.fetch(
            api("alpha.localhost", `/api/organization/export/${exportId}`, cookie),
          )
        ).json(),
      ).status,
    ).toBe("completed");
  });

  it("covers the authorized audition settings and lifecycle routes with tenant isolation", async () => {
    const cookie = await signIn();
    await database
      .prepare("UPDATE member SET role = 'owner' WHERE organizationId = ? AND userId = ?")
      .bind("organization-alpha", "calendar-manager")
      .run();

    const settingsResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/audition-settings", cookie),
    );
    const settings = organizationAuditionSettingsResponseSchema.parse(
      await settingsResponse.json(),
    );
    expect(settings.enabled).toBe(true);
    const settingsUpdate = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/audition-settings", cookie, {
        body: JSON.stringify({ ...settings, confirmationMessage: "We received your inquiry." }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(
      organizationAuditionSettingsResponseSchema.parse(await settingsUpdate.json())
        .confirmationMessage,
    ).toBe("We received your inquiry.");

    const invalidPerformanceSettings = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/audition-settings", cookie, {
        body: JSON.stringify({
          ...settings,
          defaultPerformanceId: "00000000-0000-4000-8000-000000000999",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(invalidPerformanceSettings.status).toBe(400);
    expect(await invalidPerformanceSettings.json()).toMatchObject({
      code: "performance_not_found",
      message:
        "The selected target Performance is no longer available. Choose another Performance.",
    });

    const invalidSlotSettings = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/audition-settings", cookie, {
        body: JSON.stringify({
          ...settings,
          slots: [
            {
              endsAt: "2026-07-30T17:45:00.000Z",
              id: "invalid-slot",
              startsAt: "2026-07-30T18:00:00.000Z",
            },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(invalidSlotSettings.status).toBe(400);
    expect(await invalidSlotSettings.json()).toMatchObject({
      code: "validation_failed",
      message: "Check audition time slot 1: An audition slot must end after it starts.",
    });

    const created = await post("alpha.localhost", "/api/organization/auditions", cookie, {
      availabilityNotes: "Weekends",
      email: "admin-created@example.com",
      experience: "Community choir",
      name: "Admin Created Singer",
      requestedSlots: [],
      status: "pending",
      voicePart: "Alto",
    });
    expect(created.status).toBe(201);
    const audition = organizationAuditionResponseSchema.parse(await created.json());
    const listed = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/auditions", cookie),
    );
    expect(organizationAuditionListResponseSchema.parse(await listed.json()).auditions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: audition.id })]),
    );

    const updated = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/auditions/${audition.id}`, cookie, {
        body: JSON.stringify({
          adminNotes: "Review complete",
          scheduledTimeSlot: "2026-08-01T15:00:00.000Z",
          status: "scheduled",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(organizationAuditionResponseSchema.parse(await updated.json()).status).toBe("scheduled");
    const tokenResponse = await post(
      "alpha.localhost",
      "/api/organization/audition-tokens",
      cookie,
      {
        auditionIds: [audition.id],
      },
    );
    expect(await tokenResponse.json()).toMatchObject({ tokens: expect.any(Object) });
    const deleted = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/auditions/${audition.id}`, cookie, {
        method: "DELETE",
      }),
    );
    expect(deleted.status).toBe(200);
    const crossTenant = await exports.default.fetch(
      api("bravo.localhost", `/api/organization/auditions/${audition.id}`, cookie, {
        body: JSON.stringify({ status: "completed" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(crossTenant.status).toBe(404);
  });

  it("keeps the dashboard summary bounded for a large Organization dataset", async () => {
    const cookie = await signIn();
    await database
      .prepare("UPDATE member SET role = 'owner' WHERE organizationId = ? AND userId = ?")
      .bind("organization-alpha", "calendar-manager")
      .run();

    const now = new Date("2030-01-01T00:00:00.000Z");
    const createdAt = new Date("2029-12-01T00:00:00.000Z").toISOString();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      for (let offset = 0; offset < 5_000; offset += 25) {
        const rows = Array.from({ length: 25 }, (_, index) => {
          const sequence = String(offset + index);
          const id = `scale-profile-${sequence}`;
          return [id, `Scale Profile ${sequence}`, createdAt, createdAt] as const;
        });
        const placeholders = rows.map(() => "(?, ?, ?, ?)").join(", ");
        state.storage.sql.exec(
          `INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES ${placeholders}`,
          ...rows.flat(),
        );
      }
      for (let offset = 0; offset < 500; offset += 10) {
        const rows = Array.from({ length: 10 }, (_, index) => {
          const sequence = offset + index;
          const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
          return [
            id,
            `Scale Event ${String(sequence)}`,
            "Rehearsal",
            new Date(now.getTime() + (offset + index + 1) * 60_000).toISOString(),
            createdAt,
            createdAt,
          ] as const;
        });
        const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
        state.storage.sql.exec(
          `INSERT INTO events (id, title, type, starts_at, created_at, updated_at) VALUES ${placeholders}`,
          ...rows.flat(),
        );
      }
    });

    const startedAt = performance.now();
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/dashboard-summary", cookie),
    );
    const elapsedMs = performance.now() - startedAt;
    expect(response.status).toBe(200);
    const summary = organizationDashboardSummaryResponseSchema.parse(await response.json());
    expect(summary.activeProfileCount).toBe(5_000);
    expect(summary.upcomingEventCount).toBe(500);
    expect(summary.nextEvents).toHaveLength(5);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("exports a bounded, checksummed Organization snapshot only for the Owner", async () => {
    const cookie = await signIn();
    const denied = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/export.json", cookie),
    );
    expect(denied.status).toBe(403);
    await database
      .prepare("UPDATE member SET role = 'owner' WHERE organizationId = ? AND userId = ?")
      .bind("organization-alpha", "calendar-manager")
      .run();
    const exported = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/export.json", cookie),
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain("organization-export-");
    const body: unknown = await exported.json();
    expect(body).toMatchObject({
      payload: {
        exportVersion: 1,
        organizationId: "organization-alpha",
      },
    });
    if (typeof body !== "object" || body === null || !("manifest" in body)) {
      throw new Error("The export manifest was missing.");
    }
    organizationExportManifestSchema.parse(body.manifest);
    const crossTenant = await exports.default.fetch(
      api("bravo.localhost", "/api/organization/export.json", cookie),
    );
    expect(crossTenant.status).toBe(403);
  });

  it("preserves a Durable Object setup identity failure instead of masking it as 503", async () => {
    const cookie = await signIn();
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE organization_metadata SET organization_id = ?",
          "organization-other",
        );
        return null;
      },
    );
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/setup/status", cookie),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "organization_not_found" });
  });

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
