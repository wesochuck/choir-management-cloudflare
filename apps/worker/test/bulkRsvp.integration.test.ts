import {
  organizationAttendanceResponseSchema,
  organizationEventRsvpHistoryResponseSchema,
  organizationEventSchema,
  organizationProfileResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import { applyD1Migrations, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";

const MANAGER_EMAIL = "bulk-rsvp.manager@example.test";
const PERFORMANCE_TITLE = "Bulk RSVP Performance";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const write = (host: string, path: string, cookie: string, body: unknown, method = "POST") =>
  writeJson(exports.default, host, path, cookie, body, method);
const api = organizationRequest;

const provision = (id: string, slug: string) =>
  provisionOrganization(database, stores, { id, slug, userId: "bulk-rsvp-manager" });

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", MANAGER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

async function createProfile(
  cookie: string,
  displayName: string,
  voicePart: string,
): Promise<string> {
  const response = await write("alpha.localhost", "/api/organization/profiles", cookie, {
    displayName,
    voicePart,
  });
  expect(response.status).toBe(201);
  return organizationProfileResponseSchema.parse(await response.json()).id;
}

async function createPerformance(cookie: string): Promise<string> {
  const response = await write("alpha.localhost", "/api/organization/events", cookie, {
    advancePriceCents: 0,
    callTime: "",
    dayOfPriceCents: 0,
    details: "",
    doorsOpenTime: "",
    durationMinutes: null,
    isTicketingEnabled: false,
    location: "",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    setList: [],
    setListApproved: false,
    startsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    ticketCapacity: null,
    title: PERFORMANCE_TITLE,
    type: "Performance",
    rsvpDeadlineDate: "2030-01-01",
    venueId: null,
  });
  expect(response.status).toBe(201);
  return organizationEventSchema.parse(await response.json()).id;
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "bulk-rsvp-manager", MANAGER_EMAIL, "Bulk RSVP Manager");
  await provision("organization-alpha", "alpha");
  await provision("organization-bravo", "bravo");
});

afterEach(async () => {
  await reset();
});

describe("bulk Organization RSVP updates", () => {
  it("applies mixed RSVP updates atomically, records history once, and skips no-op changes", async () => {
    const cookie = await signIn();
    const attendingProfile = await createProfile(cookie, "Attending Singer", "S1");
    const decliningProfile = await createProfile(cookie, "Declining Singer", "A1");
    const resetProfile = await createProfile(cookie, "Reset Singer", "T2");
    const eventId = await createPerformance(cookie);

    // Seed one pre-existing RSVP so the batch covers insert and update paths.
    await write(
      "alpha.localhost",
      `/api/organization/events/${eventId}/rsvp`,
      cookie,
      { profileId: resetProfile, rsvp: "Yes" },
      "PUT",
    );

    const response = await write(
      "alpha.localhost",
      `/api/organization/events/${eventId}/rsvp/bulk`,
      cookie,
      {
        updates: [
          { profileId: attendingProfile, rsvp: "Yes" },
          { profileId: decliningProfile, rsvp: "No", rsvpNote: "" },
          { profileId: resetProfile, rsvp: "Pending" },
        ],
      },
      "PUT",
    );
    expect(response.status).toBe(200);
    const payload = organizationAttendanceResponseSchema.parse(await response.json());
    expect(payload.eventId).toBe(eventId);
    const rsvpByProfile = new Map(payload.rows.map((row) => [row.profileId, row.rsvp]));
    expect(rsvpByProfile.get(attendingProfile)).toBe("Yes");
    expect(rsvpByProfile.get(decliningProfile)).toBe("No");
    expect(rsvpByProfile.get(resetProfile)).toBe("Pending");

    const historyResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/events/${eventId}/rsvp-history`, cookie),
    );
    const history = organizationEventRsvpHistoryResponseSchema.parse(await historyResponse.json());
    const transitionsFor = (profileId: string): readonly (readonly string[])[] =>
      history.entries
        .filter((entry) => entry.profileId === profileId)
        .toReversed()
        .map((entry) => [entry.previousRsvp, entry.newRsvp]);
    expect(transitionsFor(attendingProfile)).toEqual([["Pending", "Yes"]]);
    expect(transitionsFor(decliningProfile)).toEqual([["Pending", "No"]]);
    // The seeded Yes (recorded before the bulk change) is followed by the bulk reset.
    expect(transitionsFor(resetProfile)).toEqual([
      ["Pending", "Yes"],
      ["Yes", "Pending"],
    ]);
    expect(history.entries.every((entry) => entry.reason === "Administrator updated RSVP.")).toBe(
      true,
    );

    const replayResponse = await write(
      "alpha.localhost",
      `/api/organization/events/${eventId}/rsvp/bulk`,
      cookie,
      {
        updates: [
          { profileId: attendingProfile, rsvp: "Yes" },
          { profileId: decliningProfile, rsvp: "No" },
          { profileId: resetProfile, rsvp: "Pending" },
        ],
      },
      "PUT",
    );
    expect(replayResponse.status).toBe(200);
    const replayHistory = organizationEventRsvpHistoryResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/events/${eventId}/rsvp-history`, cookie),
        )
      ).json(),
    );
    expect(replayHistory.entries).toHaveLength(history.entries.length);
  });

  it("rejects duplicate, unassigned, and missing Profiles, and leaves existing responses untouched", async () => {
    const cookie = await signIn();
    const assignedProfile = await createProfile(cookie, "Assigned Singer", "B1");
    const unassignedProfile = await createProfile(cookie, "Unassigned Singer", "");
    const eventId = await createPerformance(cookie);

    await write(
      "alpha.localhost",
      `/api/organization/events/${eventId}/rsvp`,
      cookie,
      { profileId: assignedProfile, rsvp: "Yes" },
      "PUT",
    );

    const duplicateResponse = await write(
      "alpha.localhost",
      `/api/organization/events/${eventId}/rsvp/bulk`,
      cookie,
      {
        updates: [
          { profileId: assignedProfile, rsvp: "No" },
          { profileId: assignedProfile, rsvp: "Yes" },
        ],
      },
      "PUT",
    );
    expect(duplicateResponse.status).toBe(400);
    await expect(duplicateResponse.json()).resolves.toMatchObject({ code: "duplicate_profile" });

    const unassignedResponse = await write(
      "alpha.localhost",
      `/api/organization/events/${eventId}/rsvp/bulk`,
      cookie,
      {
        updates: [
          { profileId: assignedProfile, rsvp: "No" },
          { profileId: unassignedProfile, rsvp: "Yes" },
        ],
      },
      "PUT",
    );
    expect(unassignedResponse.status).toBe(422);
    await expect(unassignedResponse.json()).resolves.toMatchObject({
      code: "rsvp_voice_part_required",
    });
    const missingProfileResponse = await write(
      "alpha.localhost",
      `/api/organization/events/${eventId}/rsvp/bulk`,
      cookie,
      {
        updates: [
          { profileId: assignedProfile, rsvp: "No" },
          { profileId: "00000000-0000-4000-8000-000000000000", rsvp: "Yes" },
        ],
      },
      "PUT",
    );
    expect(missingProfileResponse.status).toBe(404);
    await expect(missingProfileResponse.json()).resolves.toMatchObject({
      code: "profile_not_found",
    });

    const attendance = organizationAttendanceResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/events/${eventId}/attendance`, cookie),
        )
      ).json(),
    );
    expect(attendance.rows.find((row) => row.profileId === assignedProfile)?.rsvp).toBe("Yes");
  });

  it("rejects bulk RSVP changes for canceled events and other Organizations' events", async () => {
    const cookie = await signIn();
    const singerProfile = await createProfile(cookie, "Isolation Singer", "S2");
    const eventId = await createPerformance(cookie);

    await expect(
      write(
        "bravo.localhost",
        `/api/organization/events/${eventId}/rsvp/bulk`,
        cookie,
        { updates: [{ profileId: singerProfile, rsvp: "Yes" }] },
        "PUT",
      ),
    ).resolves.toMatchObject({ status: 404 });

    const cancelResponse = await write(
      "alpha.localhost",
      `/api/organization/events/${eventId}/cancel`,
      cookie,
      {},
    );
    expect(cancelResponse.status).toBe(200);

    const canceledResponse = await write(
      "alpha.localhost",
      `/api/organization/events/${eventId}/rsvp/bulk`,
      cookie,
      { updates: [{ profileId: singerProfile, rsvp: "Yes" }] },
      "PUT",
    );
    expect(canceledResponse.status).toBe(409);
    await expect(canceledResponse.json()).resolves.toMatchObject({ code: "event_canceled" });
  });
});
