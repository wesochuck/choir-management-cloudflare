import {
  organizationAuditionListResponseSchema,
  organizationAuditionResponseSchema,
  organizationAuditionSettingsResponseSchema,
  organizationAuditionSettingsSchema,
  organizationEventSchema,
  organizationVenueSchema,
  publicAuditionSettingsSchema,
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

describe("Auditions integration", () => {
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
          venueId: auditionVenue.id,
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
});
