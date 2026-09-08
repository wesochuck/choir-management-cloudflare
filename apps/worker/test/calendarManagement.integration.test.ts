import {
  calendarFeedUrlsResponseSchema,
  donationResponseSchema,
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
  organizationExportStartResponseSchema,
  organizationExportStatusResponseSchema,
  organizationAuditionListResponseSchema,
  organizationAuditionResponseSchema,
  organizationAuditionSettingsSchema,
  organizationAuditionSettingsResponseSchema,
  organizationPollSummariesResponseSchema,
  publicAuditionSettingsSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  readEmailOneTimeCode,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import { processDeliveryBatch } from "../src/jobs/consumer";
import { organizationExportSnapshotSchema } from "../src/jobs/deliveries/shared";
import { organizationExportKey } from "../src/organization/exportStore";
import {
  requireIntegrationBinding,
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";

const USER_EMAIL = "calendar.manager@example.test";

const database = requireIntegrationBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireIntegrationBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const organizationFiles = requireIntegrationBinding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");

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
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect(downloaded.headers.get("x-export-checksum-sha256")).toBe(completedBody.checksumSha256);
    const downloadedArchive: unknown = await downloaded.json();
    expect(downloadedArchive).toMatchObject({
      manifest: expect.objectContaining({
        byteCount: completedBody.byteCount,
        checksumSha256: completedBody.checksumSha256,
        exportVersion: 1,
        organizationId: "organization-alpha",
      }),
      payload: expect.objectContaining({
        exportVersion: 1,
        organizationId: "organization-alpha",
        records: expect.any(Object),
      }),
    });

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

  it("fails oversized exports with explicit safety counts before writing an archive", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.transactionSync(() => {
        for (let index = 0; index < 10_001; index += 1) {
          const suffix = String(index).padStart(5, "0");
          state.storage.sql.exec(
            `INSERT INTO audit_events
                (id, actor_type, actor_id, action, target_type, target_id,
                 request_id, change_summary, occurred_at)
               VALUES (?, 'system', 'export-test', 'export.test', 'export_test', ?, ?, '{}', ?)`,
            `export-overflow-${suffix}`,
            `export-overflow-${suffix}`,
            crypto.randomUUID(),
            now,
          );
        }
      });
      return undefined;
    });
    const createResponse = await stub.fetch(
      "https://organization.internal/internal/export/create",
      {
        body: JSON.stringify({
          actorType: "organization_member",
          actorUserId: "calendar-manager",
          format: "json",
          organizationId: "organization-alpha",
          requestId: "99999999-9999-4999-8999-999999999999",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const created = organizationExportStartResponseSchema
      .pick({ exportId: true })
      .parse(await createResponse.json());
    expect(createResponse.status).toBe(200);
    expect(created.exportId).toMatch(/^[0-9a-f-]{36}$/);

    const snapshotResponse = await stub.fetch(
      "https://organization.internal/internal/export/snapshot?organizationId=organization-alpha",
    );
    const snapshot = organizationExportSnapshotSchema.parse(await snapshotResponse.json());
    expect(snapshotResponse.status).toBe(200);
    expect(snapshot.safety.tooLarge).toBe(true);
    expect(snapshot.safety.tableCounts.audit_events).toBeGreaterThan(10_000);
    expect(snapshot.records.audit_events).toHaveLength(10_000);

    const message = {
      attempts: 1,
      body: {
        attempt: 1,
        idempotencyKey: `organization-export:${created.exportId}`,
        jobId: created.exportId,
        kind: "organization_export",
        organizationId: "organization-alpha",
        version: 1,
      },
      id: `oversized-export-${created.exportId}`,
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
    const queueResult = await getQueueResult(batch, executionContext);
    expect(queueResult).toMatchObject({ retryMessages: expect.any(Array) });

    const statusResponse = await stub.fetch(
      `https://organization.internal/internal/export/job?organizationId=organization-alpha&exportId=${created.exportId}`,
    );
    expect(await statusResponse.json()).toMatchObject({
      errorCode: "export_too_large",
      status: "failed",
    });
    await expect(
      organizationFiles.head(organizationExportKey("organization-alpha", created.exportId)),
    ).resolves.toBeNull();
  });

  it("cleans up an archive when export completion is rejected after the write", async () => {
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const createResponse = await stub.fetch(
      "https://organization.internal/internal/export/create",
      {
        body: JSON.stringify({
          actorType: "organization_member",
          actorUserId: "calendar-manager",
          format: "json",
          organizationId: "organization-alpha",
          requestId: "88888888-8888-4888-8888-888888888888",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const exportId = organizationExportStartResponseSchema
      .pick({ exportId: true })
      .parse(await createResponse.json()).exportId;
    const failingFiles: R2Bucket = {
      ...organizationFiles,
      put: async (...args: Parameters<R2Bucket["put"]>) => {
        const result = await organizationFiles.put(...args);
        await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
          state.storage.sql.exec("DELETE FROM organization_exports WHERE id = ?", exportId);
          return undefined;
        });
        return result;
      },
    };
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
      id: `completion-rejection-${exportId}`,
      timestamp: new Date("2026-07-21T12:00:00.000Z"),
    } as const;
    const batch = createMessageBatch("choir-management-jobs-local", [message]);
    const executionContext = createExecutionContext();
    await processDeliveryBatch(batch, {
      EXTERNAL_EFFECTS_MODE: "fake",
      ORGANIZATION_FILES: failingFiles,
      ORGANIZATION_STORE: stores,
      PRODUCT_BASE_DOMAIN: env.PRODUCT_BASE_DOMAIN,
      SIGNED_LINK_SECRET: env.SIGNED_LINK_SECRET,
    });
    const queueResult = await getQueueResult(batch, executionContext);
    expect(queueResult).toMatchObject({ retryMessages: expect.any(Array) });
    await expect(
      organizationFiles.head(organizationExportKey("organization-alpha", exportId)),
    ).resolves.toBeNull();
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
    const auditionVenue = organizationVenueSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/venues", cookie, {
          address: "123 Audition Lane",
          name: "Audition Hall",
        })
      ).json(),
    );
    const settingsWithVenue = { ...settings, venueId: auditionVenue.id };
    const missingVenueSettings = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/audition-settings", cookie, {
        body: JSON.stringify(settings),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(missingVenueSettings.status).toBe(400);
    expect(await missingVenueSettings.json()).toMatchObject({
      code: "venue_required",
      message: "Choose an Organization venue for the auditions before saving.",
    });
    const settingsUpdate = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/audition-settings", cookie, {
        body: JSON.stringify({
          ...settingsWithVenue,
          confirmationMessage: "We received your inquiry.",
        }),
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
          ...settingsWithVenue,
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
          ...settingsWithVenue,
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
    const auditionPerformance = organizationEventSchema.parse(
      await (
        await post("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: "2026-09-30T17:00:00.000Z",
          title: "Audition Performance",
          type: "Performance",
          rsvpDeadlineDate: "2030-01-01",
        })
      ).json(),
    );
    const validSettings = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/audition-settings", cookie, {
        body: JSON.stringify({
          ...settingsWithVenue,
          defaultPerformanceId: auditionPerformance.id,
          slots: [
            {
              endsAt: "2026-08-26T14:15:00.000Z",
              id: "valid-slot",
              startsAt: "2026-08-26T14:00:00.000Z",
            },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(validSettings.status).toBe(200);
    const savedSettings = organizationAuditionSettingsResponseSchema.parse(
      await validSettings.json(),
    );
    expect(organizationAuditionSettingsSchema.parse(savedSettings)).toMatchObject({
      defaultPerformanceId: auditionPerformance.id,
      venueId: auditionVenue.id,
    });
    const publicSettingsResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-settings"),
    );
    expect(publicSettingsResponse.status).toBe(200);
    expect(publicAuditionSettingsSchema.parse(await publicSettingsResponse.json())).toMatchObject({
      defaultPerformanceId: auditionPerformance.id,
      performance: {
        id: auditionPerformance.id,
        startsAt: auditionPerformance.startsAt,
        title: "Audition Performance",
      },
      sections: expect.arrayContaining([{ code: "S", name: "Sopranos" }]),
      timezone: "UTC",
      venue: {
        address: "123 Audition Lane",
        name: "Audition Hall",
      },
      voiceParts: expect.arrayContaining([
        { fullName: "Soprano 1", label: "S1", sectionCode: "S" },
      ]),
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

    const convertible = await post("alpha.localhost", "/api/organization/auditions", cookie, {
      availabilityNotes: "Evenings",
      email: "convertible@example.com",
      experience: "Local choir",
      name: "Convertible Singer",
      requestedSlots: [],
      status: "pending",
      voicePart: "S1",
    });
    expect(convertible.status).toBe(201);
    const convertibleAudition = organizationAuditionResponseSchema.parse(await convertible.json());
    const converted = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/auditions/${convertibleAudition.id}/convert`,
        cookie,
        { method: "POST" },
      ),
    );
    expect(converted.status).toBe(201);
    expect(await converted.json()).toMatchObject({
      auditionId: convertibleAudition.id,
      profile: { displayName: "Convertible Singer", voicePart: "S1" },
    });
    const repeatedConversion = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/auditions/${convertibleAudition.id}/convert`,
        cookie,
        { method: "POST" },
      ),
    );
    expect(repeatedConversion.status).toBe(409);
    expect(await repeatedConversion.json()).toMatchObject({ code: "audition_already_converted" });

    const deleted = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/auditions/${audition.id}`, cookie, {
        method: "DELETE",
      }),
    );
    expect(deleted.status).toBe(200);

    const openInquiryMissingVenueUpdate = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/audition-settings", cookie, {
        body: JSON.stringify({
          ...settingsWithVenue,
          defaultPerformanceId: "00000000-0000-4000-8000-000000000999",
          mode: "open_inquiry",
          rehearsalNotes: "We rehearse every Tuesday. No audition required!",
          rehearsalSchedule: [
            {
              dayOfWeek: "tuesday",
              endTime: "21:30",
              locationName: "",
              startTime: "19:00",
              venueId: null,
            },
          ],
          slots: [],
          startDate: "2026-09-08",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(openInquiryMissingVenueUpdate.status).toBe(400);
    expect(await openInquiryMissingVenueUpdate.json()).toMatchObject({
      code: "rehearsal_venue_required",
      message: "Choose an Organization venue for each regular rehearsal before saving.",
    });

    const openInquiryInvalidVenueUpdate = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/audition-settings", cookie, {
        body: JSON.stringify({
          ...settingsWithVenue,
          defaultPerformanceId: "00000000-0000-4000-8000-000000000999",
          mode: "open_inquiry",
          rehearsalSchedule: [
            {
              dayOfWeek: "tuesday",
              endTime: "21:30",
              locationName: "",
              startTime: "19:00",
              venueId: "00000000-0000-4000-8000-000000000998",
            },
          ],
          slots: [],
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(openInquiryInvalidVenueUpdate.status).toBe(400);
    expect(await openInquiryInvalidVenueUpdate.json()).toMatchObject({
      code: "rehearsal_venue_not_found",
      message:
        "A regular rehearsal references a venue that is no longer available. Choose another venue.",
    });

    const openInquirySettingsUpdate = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/audition-settings", cookie, {
        body: JSON.stringify({
          ...settingsWithVenue,
          defaultPerformanceId: "00000000-0000-4000-8000-000000000999",
          mode: "open_inquiry",
          rehearsalNotes: "We rehearse every Tuesday. No audition required!",
          rehearsalSchedule: [
            {
              dayOfWeek: "tuesday",
              endTime: "21:30",
              locationName: "",
              startTime: "19:00",
              venueId: auditionVenue.id,
            },
          ],
          slots: [],
          startDate: "2026-09-08",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(openInquirySettingsUpdate.status).toBe(200);
    const openInquirySaved = organizationAuditionSettingsResponseSchema.parse(
      await openInquirySettingsUpdate.json(),
    );
    expect(openInquirySaved).toMatchObject({
      defaultPerformanceId: null,
      mode: "open_inquiry",
      rehearsalNotes: "We rehearse every Tuesday. No audition required!",
      rehearsalSchedule: [
        {
          dayOfWeek: "tuesday",
          endTime: "21:30",
          locationName: "",
          startTime: "19:00",
          venueId: auditionVenue.id,
        },
      ],
      startDate: "2026-09-08",
    });

    const openInquiryPublicSettings = await exports.default.fetch(
      api("alpha.localhost", "/api/public/audition-settings"),
    );
    expect(openInquiryPublicSettings.status).toBe(200);
    expect(
      publicAuditionSettingsSchema.parse(await openInquiryPublicSettings.json()),
    ).toMatchObject({
      mode: "open_inquiry",
      rehearsalNotes: "We rehearse every Tuesday. No audition required!",
      rehearsalSchedule: [
        {
          dayOfWeek: "tuesday",
          endTime: "21:30",
          locationName: "",
          startTime: "19:00",
          venue: {
            address: "123 Audition Lane",
            name: "Audition Hall",
          },
          venueId: auditionVenue.id,
        },
      ],
      startDate: "2026-09-08",
    });

    const publicInquiry = await post("alpha.localhost", "/api/public/audition-inquiry", "", {
      availabilityNotes: "Available Tuesdays",
      email: "join-inquiry@example.com",
      experience: "Sang in high school choir",
      name: "Prospective Community Singer",
      requestedSlots: [],
      voicePart: "Unsure / Voice placement needed",
    });
    expect(publicInquiry.status).toBe(201);

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
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      for (let offset = 0; offset < 500; offset += 25) {
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
      for (let offset = 0; offset < 50; offset += 10) {
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
      return null;
    });

    const startedAt = performance.now();
    const response = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/dashboard-summary", cookie),
    );
    const elapsedMs = performance.now() - startedAt;
    expect(response.status).toBe(200);
    const summary = organizationDashboardSummaryResponseSchema.parse(await response.json());
    expect(summary.activeProfileCount).toBe(500);
    expect(summary.upcomingEventCount).toBe(50);
    expect(summary.nextEvents).toHaveLength(5);
    expect(elapsedMs).toBeLessThan(1_000);
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

  it("tracks the optional data import setup step", async () => {
    const cookie = await signIn();
    const progress = await post("alpha.localhost", "/api/setup/progress", cookie, {
      step: "data_import",
    });
    expect(progress.status).toBe(200);

    const status = setupStatusSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/setup/status", cookie))
      ).json(),
    );
    expect(status).toMatchObject({
      completedSteps: ["data_import"],
      currentStep: "data_import",
    });
  });

  it("claims setup, persists module progress, and completes the Organization lifecycle", async () => {
    const cookie = await signIn();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE organization_metadata SET lifecycle_state = 'provisioning' WHERE organization_id = ?",
        "organization-alpha",
      );
      return null;
    });

    const claim = await post("alpha.localhost", "/api/setup/claim", cookie, {});
    expect(claim.status).toBe(200);
    expect(await claim.json()).toMatchObject({
      claimed: true,
      organizationId: "organization-alpha",
    });

    const progress = await post("alpha.localhost", "/api/setup/progress", cookie, {
      data: { events: true, music_library: true, setlists: false },
      step: "modules",
    });
    expect(progress.status).toBe(200);
    expect(await progress.json()).toEqual({ saved: true });

    const modules = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/module-state", cookie),
    );
    expect(modules.status).toBe(200);
    expect(await modules.json()).toMatchObject({
      modules: expect.arrayContaining([
        expect.objectContaining({ enabled: true, id: "events" }),
        expect.objectContaining({ enabled: true, id: "music_library" }),
        expect.objectContaining({ enabled: false, id: "setlists" }),
      ]),
    });

    const complete = await post("alpha.localhost", "/api/setup/complete", cookie, {});
    expect(complete.status).toBe(200);
    expect(await complete.json()).toEqual({ completed: true });

    const status = setupStatusSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/setup/status", cookie))
      ).json(),
    );
    expect(status).toMatchObject({
      currentStep: null,
      launched: true,
      organizationId: "organization-alpha",
    });
    await expect(
      runInDurableObject<OrganizationStore, { readonly count: number }>(stub, (_instance, state) =>
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM audit_events WHERE id = ?",
            "setup-completed:organization-alpha",
          )
          .one(),
      ),
    ).resolves.toEqual({ count: 1 });
  });

  it("serves empty financial list routes and validates refund identifiers before store access", async () => {
    const cookie = await signIn();
    const listRoutes = [
      ["/api/organization/seasons", "seasons"],
      ["/api/organization/dues", "dues"],
      ["/api/organization/donations", "donations"],
      ["/api/organization/patrons", "patrons"],
    ] as const;
    for (const [path, key] of listRoutes) {
      const response = await exports.default.fetch(api("alpha.localhost", path, cookie));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ [key]: [] });
    }

    const invalidDuesRefund = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/dues/not-a-uuid/refund", cookie, {
        method: "POST",
      }),
    );
    expect(invalidDuesRefund.status).toBe(400);
    expect(await invalidDuesRefund.json()).toMatchObject({ code: "validation_failed" });

    const invalidDonationRefund = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/donations/not-a-uuid/refund", cookie, {
        method: "POST",
      }),
    );
    expect(invalidDonationRefund.status).toBe(400);
    expect(await invalidDonationRefund.json()).toMatchObject({ code: "validation_failed" });

    const donationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          `INSERT INTO donations
            (id, checkout_request_id, status, amount_cents, fee_cents,
             tribute_type, tribute_name, tribute_notify_email, anonymous, marketing_consent,
             buyer_name, buyer_email, patron_id, provider_session_id, provider_payment_id,
             created_at, updated_at, refunded_at)
           VALUES (?, ?, 'paid', 2500, 0, 'none', '', '', 0, 0,
             'Route Donor', 'route-donor@example.test', NULL, ?, ?, ?, ?, NULL)`,
          donationId,
          crypto.randomUUID(),
          `fake_session_${donationId}`,
          `fake_payment_${donationId}`,
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO payment_attempts
            (id, payment_type, resource_id, checkout_request_id, provider_session_id,
             provider_payment_id, status, amount_cents, created_at, updated_at)
           SELECT ?, 'donation', id, checkout_request_id, provider_session_id,
             provider_payment_id, 'paid', amount_cents, created_at, updated_at
           FROM donations WHERE id = ?`,
          `payment-attempt:${donationId}`,
          donationId,
        );
        return null;
      },
    );
    const refundedDonation = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/donations/${donationId}/refund`, cookie, {
        method: "POST",
      }),
    );
    expect(refundedDonation.status).toBe(200);
    expect(await refundedDonation.json()).toMatchObject({
      id: donationId,
      status: "refunded",
    });
    const crossTenantRefund = await exports.default.fetch(
      api("bravo.localhost", `/api/organization/donations/${donationId}/refund`, cookie, {
        method: "POST",
      }),
    );
    expect(crossTenantRefund.status).toBe(404);

    // Record a manual check donation with email
    const manualCheckResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/donations/manual", cookie, {
        body: JSON.stringify({
          amountCents: 5000,
          anonymous: false,
          buyerEmail: "manual-donor@example.test",
          buyerName: "Manual Donor",
          paymentMethod: "check",
          paymentReference: "Check #789",
          thankYouSent: false,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(manualCheckResponse.status).toBe(201);
    const manualCheck = donationResponseSchema.parse(await manualCheckResponse.json());
    expect(manualCheck.donation.thankYouSentAt).toBeNull();

    // Verify patron was linked
    const patronsAfterManual = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/patrons", cookie),
    );
    expect(patronsAfterManual.status).toBe(200);
    expect(await patronsAfterManual.json()).toMatchObject({
      patrons: [
        expect.objectContaining({
          email: "manual-donor@example.test",
          name: "Manual Donor",
          totalDonatedCents: 5000,
        }),
      ],
    });

    // Toggle thank-you letter status to sent
    const thankYouSentResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/donations/thank-you", cookie, {
        body: JSON.stringify({
          donationId: manualCheck.donation.id,
          thankYouSent: true,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(thankYouSentResponse.status).toBe(200);
    const thankYouSentData = donationResponseSchema.parse(await thankYouSentResponse.json());
    expect(thankYouSentData.donation.thankYouSentAt).not.toBeNull();

    // Toggle thank-you letter status back to pending
    const thankYouPendingResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/donations/thank-you", cookie, {
        body: JSON.stringify({
          donationId: manualCheck.donation.id,
          thankYouSent: false,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(thankYouPendingResponse.status).toBe(200);
    const thankYouPendingData = donationResponseSchema.parse(await thankYouPendingResponse.json());
    expect(thankYouPendingData.donation.thankYouSentAt).toBeNull();

    // Refund manual check donation
    const refundManualResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/donations/${manualCheck.donation.id}/refund`,
        cookie,
        {
          method: "POST",
        },
      ),
    );
    expect(refundManualResponse.status).toBe(200);
    expect(await refundManualResponse.json()).toMatchObject({
      id: manualCheck.donation.id,
      status: "refunded",
    });

    const seasonId = crypto.randomUUID();
    const duesId = crypto.randomUUID();
    const duesProfileId = crypto.randomUUID();
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
          duesProfileId,
          "Dues Payer",
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO seasons (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at)
           VALUES (?, 'Refund Season', ?, ?, 2500, ?, ?)`,
          seasonId,
          now,
          now,
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO dues
            (id, season_id, profile_id, amount_cents, fee_cents, provider_session_id,
             provider_payment_id, payer_email, status, payment_method, paid_at, created_at, updated_at)
           VALUES (?, ?, ?, 2500, 0, ?, ?, 'dues@example.test', 'paid', 'online', ?, ?, ?)`,
          duesId,
          seasonId,
          duesProfileId,
          `fake_session_${duesId}`,
          `fake_payment_${duesId}`,
          now,
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO payment_attempts
            (id, payment_type, resource_id, checkout_request_id, provider_session_id,
             provider_payment_id, status, amount_cents, created_at, updated_at)
           VALUES (?, 'dues', ?, ?, ?, ?, 'paid', 2500, ?, ?)`,
          `payment-attempt:${duesId}`,
          duesId,
          crypto.randomUUID(),
          `fake_session_${duesId}`,
          `fake_payment_${duesId}`,
          now,
          now,
        );
        return null;
      },
    );
    const refundedDues = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/dues/${duesId}/refund`, cookie, {
        method: "POST",
      }),
    );
    expect(refundedDues.status).toBe(200);
    expect(await refundedDues.json()).toMatchObject({
      id: duesId,
      status: "refunded",
    });
    const crossTenantDuesRefund = await exports.default.fetch(
      api("bravo.localhost", `/api/organization/dues/${duesId}/refund`, cookie, {
        method: "POST",
      }),
    );
    expect(crossTenantDuesRefund.status).toBe(404);
  });

  it("manages Organization polls and issues recipient-scoped poll tokens", async () => {
    const cookie = await signIn();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const profileId = crypto.randomUUID();
    const pollId = crypto.randomUUID();
    const pollOptionIds = [crypto.randomUUID(), crypto.randomUUID()] as const;
    const createdPollId = crypto.randomUUID();
    const createdOptionIds = [crypto.randomUUID(), crypto.randomUUID()] as const;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000).toISOString();
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        profileId,
        "Poll Recipient",
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO polls
          (id, title, description, multiple_choice, expires_at, archived_at,
           created_by, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, '', ?, ?, ?)`,
        pollId,
        "Initial question",
        "Choose one",
        expiresAt,
        "calendar-manager",
        now,
        now,
      );
      state.storage.sql.exec(
        "INSERT INTO poll_options (id, poll_id, label, sort_order) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
        pollOptionIds[0],
        pollId,
        "First",
        0,
        pollOptionIds[1],
        pollId,
        "Second",
        1,
      );
      return null;
    });

    const list = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/polls", cookie),
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      polls: [expect.objectContaining({ id: pollId, title: "Initial question" })],
    });

    const detail = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/polls/${pollId}`, cookie),
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      id: pollId,
      options: [
        { id: pollOptionIds[0], label: "First" },
        { id: pollOptionIds[1], label: "Second" },
      ],
      title: "Initial question",
    });

    const tokenResponse = await post("alpha.localhost", "/api/organization/poll-tokens", cookie, {
      pollId,
      profileIds: [profileId],
    });
    expect(tokenResponse.status).toBe(200);
    expect(await tokenResponse.json()).toMatchObject({
      tokens: { [profileId]: expect.any(String) },
    });

    const created = await post("alpha.localhost", "/api/organization/polls", cookie, {
      description: "Created through the route",
      expiresAt,
      id: createdPollId,
      multipleChoice: true,
      options: [
        { id: createdOptionIds[0], label: "Yes", sortOrder: 0 },
        { id: createdOptionIds[1], label: "No", sortOrder: 1 },
      ],
      title: "Created question",
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id: createdPollId, title: "Created question" });

    const updated = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/polls/${createdPollId}`, cookie, {
        body: JSON.stringify({
          description: "Updated through the route",
          expiresAt,
          multipleChoice: true,
          options: [
            { id: createdOptionIds[0], label: "Absolutely", sortOrder: 0 },
            { id: createdOptionIds[1], label: "Not yet", sortOrder: 1 },
          ],
          title: "Updated question",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      description: "Updated through the route",
      title: "Updated question",
    });

    const archive = await post(
      "alpha.localhost",
      `/api/organization/polls/${pollId}/archive`,
      cookie,
      {},
    );
    expect(archive.status).toBe(200);
    expect(await archive.json()).toMatchObject({ id: pollId, archivedAt: expect.any(String) });

    const archived = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/polls?archived=true", cookie),
    );
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({
      polls: [expect.objectContaining({ id: pollId, title: "Initial question" })],
    });

    // Record response on createdPollId
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO poll_responses (poll_id, profile_id, option_ids, profile_name, responded_at)
         VALUES (?, ?, ?, 'Poll Recipient', ?)`,
        createdPollId,
        profileId,
        JSON.stringify([createdOptionIds[0]]),
        now,
      );
      return null;
    });

    // Verify option tallies on list endpoint
    const listWithTallies = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/polls", cookie),
    );
    expect(listWithTallies.status).toBe(200);
    const listData = organizationPollSummariesResponseSchema.parse(await listWithTallies.json());
    const createdPollSummary = listData.polls.find((p) => p.id === createdPollId);
    expect(createdPollSummary).toBeDefined();
    expect(createdPollSummary?.optionTallies).toEqual([
      expect.objectContaining({ count: 1, id: createdOptionIds[0] }),
      expect.objectContaining({ count: 0, id: createdOptionIds[1] }),
    ]);

    // Verify results endpoint
    const resultsResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/polls/${createdPollId}/results`, cookie),
    );
    expect(resultsResponse.status).toBe(200);
    const resultsJson = await resultsResponse.json();
    expect(resultsJson).toMatchObject({
      pollId: createdPollId,
      title: "Updated question",
      totalResponses: 1,
      options: [
        expect.objectContaining({
          count: 1,
          id: createdOptionIds[0],
          percentage: 100,
          respondents: [
            expect.objectContaining({
              profileId,
              profileName: "Poll Recipient",
            }),
          ],
        }),
        expect.objectContaining({
          count: 0,
          id: createdOptionIds[1],
          percentage: 0,
          respondents: [],
        }),
      ],
    });

    // Verify updating options is rejected now that responses exist
    const invalidOptionUpdate = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/polls/${createdPollId}`, cookie, {
        body: JSON.stringify({
          description: "Trying to remove options",
          expiresAt,
          multipleChoice: true,
          options: [
            { id: createdOptionIds[0], label: "Only one option", sortOrder: 0 },
            { id: crypto.randomUUID(), label: "New brand option", sortOrder: 1 },
          ],
          title: "Updated question",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(invalidOptionUpdate.status).toBe(400);
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
    const startsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const missingDeadline = await post("alpha.localhost", "/api/organization/events", cookie, {
      startsAt,
      title: "No Deadline Performance",
      type: "Performance",
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
    });
    expect(rehearsal.status).toBe(400);
  });
});
