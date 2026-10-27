import {
  organizationAttendanceResponseSchema,
  organizationAttendanceReportResponseSchema,
  organizationEventSchema,
  organizationEventRsvpHistoryResponseSchema,
  organizationProfileFolderNumberSchema,
  organizationProfileFolderNumbersResponseSchema,
  organizationProfileResponseSchema,
  organizationRsvpSchema,
  organizationVenueSchema,
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
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "attendance.manager@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const write = (host: string, path: string, cookie: string, body: unknown, method = "POST") =>
  writeJson(exports.default, host, path, cookie, body, method);
const api = organizationRequest;

async function createVenue(cookie: string, host = "alpha.localhost"): Promise<string> {
  const response = await write(host, "/api/organization/venues", cookie, {
    address: "1 Test Way",
    name: "Test Hall",
  });
  return organizationVenueSchema.parse(await response.json()).id;
}

const provision = (id: string, slug: string) =>
  provisionOrganization(database, stores, { id, slug, userId: "attendance-manager" });

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "attendance-manager", USER_EMAIL, "Attendance Manager");
  await provision("organization-alpha", "alpha");
  await provision("organization-bravo", "bravo");
});

afterEach(async () => {
  await reset();
});

describe("Organization attendance", () => {
  it("updates atomically, preserves explicit RSVP choices, and enforces manager tenancy", async () => {
    const cookie = await signIn();
    const alphaProfile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "John Doe",
          isSectionLeader: true,
          voicePart: "S1",
        })
      ).json(),
    );
    const explicitNoProfile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Alice Smith",
          voicePart: "A1",
        })
      ).json(),
    );
    const unassignedProfile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Unassigned Profile",
        })
      ).json(),
    );
    const bravoProfile = organizationProfileResponseSchema.parse(
      await (
        await write("bravo.localhost", "/api/organization/profiles", cookie, {
          displayName: "Bravo Singer",
        })
      ).json(),
    );
    const venueId = await createVenue(cookie);
    const event = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          title: "Attendance Rehearsal",
          type: "Rehearsal",
          venueId,
        })
      ).json(),
    );
    expect(
      organizationRsvpSchema.parse(
        await (
          await write(
            "alpha.localhost",
            `/api/organization/events/${event.id}/rsvp`,
            cookie,
            { profileId: explicitNoProfile.id, rsvp: "No" },
            "PUT",
          )
        ).json(),
      ).rsvp,
    ).toBe("No");

    const unassignedRsvp = await write(
      "alpha.localhost",
      `/api/organization/events/${event.id}/rsvp`,
      cookie,
      { profileId: unassignedProfile.id, rsvp: "Yes" },
      "PUT",
    );
    expect(unassignedRsvp.status).toBe(422);
    await expect(unassignedRsvp.json()).resolves.toMatchObject({
      code: "rsvp_voice_part_required",
    });

    const rejected = await write(
      "alpha.localhost",
      `/api/organization/events/${event.id}/attendance`,
      cookie,
      {
        updates: [
          { attendance: "Present", profileId: alphaProfile.id },
          { attendance: "Absent", profileId: bravoProfile.id },
        ],
      },
      "PUT",
    );
    expect(rejected.status).toBe(503);
    const afterRejected = organizationAttendanceResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/events/${event.id}/attendance`, cookie),
        )
      ).json(),
    );
    expect(
      afterRejected.rows.find(({ profileId }) => profileId === alphaProfile.id)?.attendance,
    ).toBe("Pending");

    const updated = organizationAttendanceResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/events/${event.id}/attendance`,
          cookie,
          {
            updates: [
              {
                attendance: "Present",
                profileId: alphaProfile.id,
              },
              {
                attendance: "Absent",
                profileId: explicitNoProfile.id,
              },
            ],
          },
          "PUT",
        )
      ).json(),
    );
    expect(updated.rows.find(({ profileId }) => profileId === alphaProfile.id)?.rsvp).toBe("Yes");
    expect(updated.rows.find(({ profileId }) => profileId === explicitNoProfile.id)?.rsvp).toBe(
      "No",
    );
    const attendanceOnly = organizationAttendanceResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/events/${event.id}/attendance`,
          cookie,
          { updates: [{ attendance: "Absent", profileId: alphaProfile.id }] },
          "PUT",
        )
      ).json(),
    );
    expect(
      attendanceOnly.rows.find(({ profileId }) => profileId === alphaProfile.id),
    ).toMatchObject({
      attendance: "Absent",
      rsvp: "Yes",
    });

    const folderPerformance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(Date.now() + 172_800_000).toISOString(),
          title: "Folder Performance",
          type: "Performance",
          rsvpDeadlineDate: "2030-01-01",
          venueId,
        })
      ).json(),
    );
    const linkedRehearsal = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          parentPerformanceId: folderPerformance.id,
          startsAt: new Date(Date.now() + 259_200_000).toISOString(),
          title: "Folder Rehearsal",
          type: "Rehearsal",
          venueId,
        })
      ).json(),
    );

    const folderNumbers = organizationProfileFolderNumbersResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/profiles/${alphaProfile.id}/folder-numbers`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(folderNumbers.folderNumbers).toHaveLength(1);
    expect(folderNumbers.folderNumbers[0]).toMatchObject({
      eventId: folderPerformance.id,
      folderNumber: "",
      folderReturned: false,
      profileId: alphaProfile.id,
    });
    const savedFolder = organizationProfileFolderNumberSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/profiles/${alphaProfile.id}/folder-numbers/${folderPerformance.id}`,
          cookie,
          { folderNumber: "A-12", folderReturned: false },
          "PUT",
        )
      ).json(),
    );
    expect(savedFolder).toMatchObject({
      eventId: folderPerformance.id,
      folderNumber: "A-12",
      folderReturned: false,
      profileId: alphaProfile.id,
    });
    expect(
      await write(
        "alpha.localhost",
        `/api/organization/profiles/${alphaProfile.id}/folder-numbers/${linkedRehearsal.id}`,
        cookie,
        { folderNumber: "A-13", folderReturned: false },
        "PUT",
      ),
    ).toMatchObject({ status: 409 });

    const auditActor = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ actorId: string }>(
            `SELECT actor_id AS actorId FROM audit_events
             WHERE action = 'event.attendance.updated' LIMIT 1`,
          )
          .one().actorId,
    );
    expect(auditActor).toBe("attendance-manager");

    const rsvpExport = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/events/${event.id}/rsvp-export.csv?sort=section`,
        cookie,
      ),
    );
    expect(rsvpExport.status).toBe(200);
    expect(rsvpExport.headers.get("cache-control")).toBe("private, no-store");
    expect(rsvpExport.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(rsvpExport.headers.get("content-disposition")).toMatch(
      /^attachment; filename="attendance_rehearsal_rsvp_export_[0-9]{4}-[A-Z][a-z]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}-(AM|PM)-UTC\.csv"$/,
    );
    expect(await rsvpExport.text()).toBe(
      [
        "Name,Last Name,Section,Performer,Event Title,RSVP Status",
        '"Attending (Yes)",,,,,',
        '"John Doe","Doe","Sopranos","S1","Attendance Rehearsal","Yes"',
        "",
        '"Declined (No)",,,,,',
        '"Alice Smith","Smith","Altos","A1","Attendance Rehearsal","No"',
        "",
        '"No Response (Pending)",,,,,',
        '"Unassigned Profile","Profile","Unassigned","Not sure","Attendance Rehearsal","Pending"',
        "",
        "Section Leaders,,,,,",
        "Name,Last Name,Section,Performer,Event Title,RSVP Status",
        '"John Doe","Doe","Sopranos","S1","Attendance Rehearsal","Yes"',
      ].join("\n"),
    );
    expect(
      await exports.default.fetch(
        api("bravo.localhost", `/api/organization/events/${event.id}/rsvp-export.csv`, cookie),
      ),
    ).toMatchObject({ status: 404 });
    expect(
      await exports.default.fetch(
        api("bravo.localhost", `/api/organization/events/${event.id}/attendance`, cookie),
      ),
    ).toMatchObject({ status: 404 });
    expect(
      await exports.default.fetch(
        api("bravo.localhost", `/api/organization/events/${event.id}/rsvp-history`, cookie),
      ),
    ).toMatchObject({ status: 404 });

    await database
      .prepare(
        `UPDATE member SET role = 'member'
         WHERE organizationId = 'organization-alpha' AND userId = 'attendance-manager'`,
      )
      .run();
    const memberResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/events/${event.id}/attendance`, cookie),
    );
    expect(memberResponse.status).toBe(403);
    expect(
      await exports.default.fetch(
        api("alpha.localhost", `/api/organization/events/${event.id}/rsvp-export.csv`, cookie),
      ),
    ).toMatchObject({ status: 403 });
  });

  it("resolves rehearsal attendance from the linked performance RSVP while retaining the full roster", async () => {
    const cookie = await signIn();
    async function createProfile(displayName: string) {
      return organizationProfileResponseSchema.parse(
        await (
          await write("alpha.localhost", "/api/organization/profiles", cookie, {
            displayName,
            voicePart: "S1",
          })
        ).json(),
      );
    }

    const inheritedYesProfile = await createProfile("Inherited Yes");
    const inheritedNoProfile = await createProfile("Inherited No");
    const directYesProfile = await createProfile("Direct Yes");
    const pendingProfile = await createProfile("No RSVP");
    const venueId = await createVenue(cookie);
    const performance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          title: "Linked Performance",
          type: "Performance",
          rsvpDeadlineDate: "2030-01-01",
          venueId,
        })
      ).json(),
    );
    const rehearsal = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          parentPerformanceId: performance.id,
          startsAt: new Date(Date.now() + 172_800_000).toISOString(),
          title: "Linked Rehearsal",
          type: "Rehearsal",
          venueId,
        })
      ).json(),
    );

    for (const profileId of [inheritedYesProfile.id, inheritedNoProfile.id]) {
      const rsvp = profileId === inheritedYesProfile.id ? "Yes" : "No";
      expect(
        organizationRsvpSchema.parse(
          await (
            await write(
              "alpha.localhost",
              `/api/organization/events/${performance.id}/rsvp`,
              cookie,
              { profileId, rsvp },
              "PUT",
            )
          ).json(),
        ).rsvp,
      ).toBe(rsvp);
    }
    expect(
      organizationRsvpSchema.parse(
        await (
          await write(
            "alpha.localhost",
            `/api/organization/events/${rehearsal.id}/rsvp`,
            cookie,
            { profileId: directYesProfile.id, rsvp: "Yes" },
            "PUT",
          )
        ).json(),
      ).rsvp,
    ).toBe("Yes");

    const attendance = organizationAttendanceResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/events/${rehearsal.id}/attendance`, cookie),
        )
      ).json(),
    );
    expect(attendance.rows).toHaveLength(4);
    expect(attendance.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profileId: inheritedYesProfile.id, rsvp: "Yes" }),
        expect.objectContaining({ profileId: inheritedNoProfile.id, rsvp: "No" }),
        expect.objectContaining({ profileId: directYesProfile.id, rsvp: "Yes" }),
        expect.objectContaining({ profileId: pendingProfile.id, rsvp: "Pending" }),
      ]),
    );
  });

  it("aggregates attendance report server-side across linked rehearsals with tenant isolation and index use", async () => {
    const cookie = await signIn();

    const venueId = await createVenue(cookie);
    // 1. Create a performance with no rehearsals -> reports 0 totalRehearsals and empty rows
    const emptyPerf = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          durationMinutes: 120,
          rsvpDeadlineDate: "2026-10-10",
          startsAt: "2026-10-15T19:00:00Z",
          title: "Empty Performance",
          type: "Performance",
          venueId,
        })
      ).json(),
    );

    const emptyReport = organizationAttendanceReportResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/events/${emptyPerf.id}/attendance-report`,
            cookie,
          ),
        )
      ).json(),
    );
    expect(emptyReport.eventId).toBe(emptyPerf.id);
    expect(emptyReport.totalRehearsals).toBe(0);
    expect(emptyReport.rows).toEqual([]);

    // 2. Create another performance with 2 active rehearsals, 1 canceled rehearsal, and another unrelated performance with rehearsals
    const performance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          durationMinutes: 120,
          rsvpDeadlineDate: "2026-11-10",
          startsAt: "2026-11-15T19:00:00Z",
          title: "Main Performance",
          type: "Performance",
          venueId,
        })
      ).json(),
    );

    const rehearsal1 = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          durationMinutes: 120,
          parentPerformanceId: performance.id,
          startsAt: "2026-11-01T19:00:00Z",
          title: "Rehearsal 1",
          type: "Rehearsal",
          venueId,
        })
      ).json(),
    );

    const rehearsal2 = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          durationMinutes: 120,
          parentPerformanceId: performance.id,
          startsAt: "2026-11-08T19:00:00Z",
          title: "Rehearsal 2",
          type: "Rehearsal",
          venueId,
        })
      ).json(),
    );

    // Canceled rehearsal - must be excluded
    const canceledRehearsal = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          durationMinutes: 120,
          parentPerformanceId: performance.id,
          startsAt: "2026-11-05T19:00:00Z",
          title: "Canceled Rehearsal",
          type: "Rehearsal",
          venueId,
        })
      ).json(),
    );
    await write(
      "alpha.localhost",
      `/api/organization/events/${canceledRehearsal.id}/cancel`,
      cookie,
      {},
    );

    // Another performance's rehearsal - must be excluded
    const otherPerformance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          durationMinutes: 120,
          rsvpDeadlineDate: "2026-12-10",
          startsAt: "2026-12-15T19:00:00Z",
          title: "Other Performance",
          type: "Performance",
          venueId,
        })
      ).json(),
    );
    await write("alpha.localhost", "/api/organization/events", cookie, {
      durationMinutes: 120,
      parentPerformanceId: otherPerformance.id,
      startsAt: "2026-12-01T19:00:00Z",
      title: "Other Rehearsal",
      type: "Rehearsal",
      venueId,
    });

    // Create 3 singers:
    // Singer A (Bob): Absent in R1, Absent in R2 -> absences: 2, present: 0
    // Singer B (Alice): Present in R1, Absent in R2 -> absences: 1, present: 1
    // Singer C (Charlie): Present in R1, Present in R2 -> absences: 0, present: 2
    const bob = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Bob Baritone",
          voicePart: "B1",
        })
      ).json(),
    );
    const alice = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Alice Alto",
          voicePart: "A1",
        })
      ).json(),
    );
    const charlie = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Charlie Tenor",
          voicePart: "T1",
        })
      ).json(),
    );

    for (const profile of [bob, alice, charlie]) {
      const rsvp = await write(
        "alpha.localhost",
        `/api/organization/events/${performance.id}/rsvp`,
        cookie,
        {
          profileId: profile.id,
          rsvp: "Yes",
        },
        "PUT",
      );
      expect(rsvp.status).toBe(200);
    }

    // Set attendance in R1
    await write(
      "alpha.localhost",
      `/api/organization/events/${rehearsal1.id}/attendance`,
      cookie,
      {
        updates: [
          { attendance: "Absent", profileId: bob.id },
          { attendance: "Present", profileId: alice.id },
          { attendance: "Present", profileId: charlie.id },
        ],
      },
      "PUT",
    );

    // Set attendance in R2
    await write(
      "alpha.localhost",
      `/api/organization/events/${rehearsal2.id}/attendance`,
      cookie,
      {
        updates: [
          { attendance: "Absent", profileId: bob.id },
          { attendance: "Absent", profileId: alice.id },
          { attendance: "Present", profileId: charlie.id },
        ],
      },
      "PUT",
    );

    // Seating receives the same linked-rehearsal counts for every Profile, with strict > semantics.
    const seatingAttendance = organizationAttendanceResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/events/${performance.id}/attendance`, cookie),
        )
      ).json(),
    );
    expect(
      seatingAttendance.rows.find((row) => row.profileId === bob.id)?.attendanceWarning,
    ).toEqual({ missedRehearsals: 2, totalRehearsals: 2, threshold: 1, status: "warning" });
    expect(
      seatingAttendance.rows.find((row) => row.profileId === alice.id)?.attendanceWarning,
    ).toEqual({ missedRehearsals: 1, totalRehearsals: 2, threshold: 1, status: "clear" });
    expect(
      seatingAttendance.rows.find((row) => row.profileId === charlie.id)?.attendanceWarning,
    ).toEqual({ missedRehearsals: 0, totalRehearsals: 2, threshold: 1, status: "clear" });

    // Fetch the attendance report
    const reportResponse = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/events/${performance.id}/attendance-report`,
        cookie,
      ),
    );
    expect(reportResponse.status).toBe(200);
    const report = organizationAttendanceReportResponseSchema.parse(await reportResponse.json());

    expect(report.eventId).toBe(performance.id);
    expect(report.totalRehearsals).toBe(2);

    const bobRow = report.rows.find((r) => r.profileId === bob.id);
    expect(bobRow).toEqual({
      absences: 2,
      name: "Bob Baritone",
      present: 0,
      profileId: bob.id,
      total: 2,
      voicePart: "B1",
    });

    const aliceRow = report.rows.find((r) => r.profileId === alice.id);
    expect(aliceRow).toEqual({
      absences: 1,
      name: "Alice Alto",
      present: 1,
      profileId: alice.id,
      total: 2,
      voicePart: "A1",
    });

    const charlieRow = report.rows.find((r) => r.profileId === charlie.id);
    expect(charlieRow).toEqual({
      absences: 0,
      name: "Charlie Tenor",
      present: 2,
      profileId: charlie.id,
      total: 2,
      voicePart: "T1",
    });

    // Verify ordering: Bob (2 absences) comes before Alice (1 absence) comes before Charlie (0 absences)
    const bobIndex = report.rows.findIndex((r) => r.profileId === bob.id);
    const aliceIndex = report.rows.findIndex((r) => r.profileId === alice.id);
    const charlieIndex = report.rows.findIndex((r) => r.profileId === charlie.id);
    expect(bobIndex).toBeLessThan(aliceIndex);
    expect(aliceIndex).toBeLessThan(charlieIndex);

    // Lookup still needs warnings for singers who are not RSVP'd Attending.
    await write(
      "alpha.localhost",
      `/api/organization/events/${performance.id}/rsvp`,
      cookie,
      { profileId: bob.id, rsvp: "No" },
      "PUT",
    );
    const lookupRows = organizationAttendanceResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", `/api/organization/events/${performance.id}/attendance`, cookie),
        )
      ).json(),
    ).rows;
    expect(lookupRows.find((row) => row.profileId === bob.id)).toMatchObject({
      rsvp: "No",
      attendanceWarning: { missedRehearsals: 2, status: "warning" },
    });

    // 3. Tenant isolation: bravo cannot access alpha's performance attendance report
    const crossOrgResponse = await exports.default.fetch(
      api(
        "bravo.localhost",
        `/api/organization/events/${performance.id}/attendance-report`,
        cookie,
      ),
    );
    expect(crossOrgResponse.status).toBe(404);

    // 4. Verify query plan uses idx_event_rosters_profile index
    const stub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      const plan = state.storage.sql
        .exec<{ readonly detail: string }>(
          `EXPLAIN QUERY PLAN
           SELECT
             p.id AS profileId,
             p.display_name AS name,
             COALESCE(p.voice_part, '') AS voicePart,
             CAST(COUNT(CASE WHEN r.attendance = 'Absent' THEN 1 END) AS INTEGER) AS absences,
             CAST(COUNT(CASE WHEN r.attendance = 'Present' THEN 1 END) AS INTEGER) AS present
           FROM (
             SELECT profile.id, profile.display_name, profile.voice_part
             FROM event_rosters commitment
             JOIN profiles profile ON profile.id = commitment.profile_id
             WHERE commitment.event_id = ? AND commitment.rsvp = 'Yes'
             ORDER BY profile.display_name COLLATE NOCASE ASC, profile.id ASC
             LIMIT 500
           ) p
           LEFT JOIN event_rosters r
             ON r.profile_id = p.id
             AND r.event_id IN (
               SELECT id FROM events WHERE parent_performance_id = ?
                 AND type = 'Rehearsal' AND is_archived = 0 AND is_canceled = 0
             )
           GROUP BY p.id
           LIMIT 500`,
          performance.id,
          performance.id,
        )
        .toArray();
      const planDetails = plan.map((p) => p.detail).join("\n");
      // Must use index lookup for event_rosters
      expect(planDetails).toContain("SEARCH r USING INDEX");
      expect(planDetails).toMatch(/SEARCH commitment USING (?:COVERING )?INDEX/);
      return null;
    });
  });
});

it("aggregates more than 100 rehearsals with bounded parent bindings and an indexed event selection", async () => {
  const cookie = await signIn();
  const eventId = await runInDurableObject<OrganizationStore, string>(
    stores.getByName("organization-alpha"),
    (_instance, state) => {
      const at = new Date().toISOString();
      const id = crypto.randomUUID();
      state.storage.sql.exec(
        "INSERT INTO events (id, title, type, starts_at, created_at, updated_at) VALUES (?, 'Large report', 'Performance', ?, ?, ?)",
        id,
        at,
        at,
        at,
      );
      const profileId = crypto.randomUUID();
      state.storage.sql.exec(
        "INSERT INTO profiles (id, display_name, voice_part, created_at, updated_at) VALUES (?, 'Report Singer', 'S1', ?, ?)",
        profileId,
        at,
        at,
      );
      state.storage.sql.exec(
        "INSERT INTO event_rosters (event_id, profile_id, rsvp, created_at, updated_at) VALUES (?, ?, 'Yes', ?, ?)",
        id,
        profileId,
        at,
        at,
      );
      for (let index = 0; index < 101; index += 1) {
        const rehearsalId = crypto.randomUUID();
        state.storage.sql.exec(
          "INSERT INTO events (id, title, type, parent_performance_id, starts_at, created_at, updated_at) VALUES (?, ?, 'Rehearsal', ?, ?, ?, ?)",
          rehearsalId,
          `Rehearsal ${String(index)}`,
          id,
          at,
          at,
          at,
        );
        state.storage.sql.exec(
          "INSERT INTO event_rosters (event_id, profile_id, attendance, created_at, updated_at) VALUES (?, ?, 'Present', ?, ?)",
          rehearsalId,
          profileId,
          at,
          at,
        );
      }
      const plan = state.storage.sql
        .exec<{ readonly detail: string }>(
          `EXPLAIN QUERY PLAN SELECT id FROM events WHERE parent_performance_id = ?
       AND type = 'Rehearsal' AND is_canceled = 0 AND is_archived = 0`,
          id,
        )
        .toArray();
      expect(
        plan.some(
          (row) =>
            row.detail.includes("SEARCH") &&
            row.detail.includes("idx_events_active_rehearsals_parent"),
        ),
      ).toBe(true);
      return id;
    },
  );
  const response = await exports.default.fetch(
    api("alpha.localhost", `/api/organization/events/${eventId}/attendance-report`, cookie),
  );
  expect(response.status).toBe(200);
  const report = organizationAttendanceReportResponseSchema.parse(await response.json());
  expect(report.totalRehearsals).toBe(101);
  expect(report.rows.find((row) => row.name === "Report Singer")).toMatchObject({
    present: 101,
    total: 101,
    absences: 0,
  });
});

it("includes only Yes RSVPs for the selected performance before applying the roster limit", async () => {
  const cookie = await signIn();
  const seeded = await runInDurableObject(
    stores.getByName("organization-alpha"),
    (_instance: OrganizationStore, state) => {
      const at = new Date().toISOString();
      const eventId = crypto.randomUUID();
      const otherId = crypto.randomUUID();
      const rehearsalId = crypto.randomUUID();
      const attendingId = crypto.randomUUID();
      const unrecordedId = crypto.randomUUID();
      state.storage.transactionSync(() => {
        for (const id of [eventId, otherId]) {
          state.storage.sql.exec(
            "INSERT INTO events (id, title, type, starts_at, created_at, updated_at) VALUES (?, 'RSVP report', 'Performance', ?, ?, ?)",
            id,
            at,
            at,
            at,
          );
        }
        state.storage.sql.exec(
          "INSERT INTO events (id, title, type, parent_performance_id, starts_at, created_at, updated_at) VALUES (?, 'Report rehearsal', 'Rehearsal', ?, ?, ?, ?)",
          rehearsalId,
          eventId,
          at,
          at,
          at,
        );
        const profiles = [
          {
            id: attendingId,
            name: "Z Expected",
            event: eventId,
            rsvp: "Yes",
            attendance: "Present",
          },
          {
            id: unrecordedId,
            name: "Z Not yet marked",
            event: eventId,
            rsvp: "Yes",
            attendance: null,
          },
          {
            id: crypto.randomUUID(),
            name: "Declined",
            event: eventId,
            rsvp: "No",
            attendance: "Absent",
          },
          {
            id: crypto.randomUUID(),
            name: "Pending",
            event: eventId,
            rsvp: "Pending",
            attendance: "Absent",
          },
          {
            id: crypto.randomUUID(),
            name: "No response",
            event: null,
            rsvp: "Yes",
            attendance: "Present",
          },
          {
            id: crypto.randomUUID(),
            name: "Other performance",
            event: otherId,
            rsvp: "Yes",
            attendance: "Present",
          },
        ];
        for (const profile of profiles) {
          state.storage.sql.exec(
            "INSERT INTO profiles (id, display_name, voice_part, created_at, updated_at) VALUES (?, ?, 'S1', ?, ?)",
            profile.id,
            profile.name,
            at,
            at,
          );
          if (profile.event) {
            state.storage.sql.exec(
              "INSERT INTO event_rosters (event_id, profile_id, rsvp, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              profile.event,
              profile.id,
              profile.rsvp,
              at,
              at,
            );
          }
          if (profile.attendance) {
            state.storage.sql.exec(
              "INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at) VALUES (?, ?, 'Yes', ?, ?, ?)",
              rehearsalId,
              profile.id,
              profile.attendance,
              at,
              at,
            );
          }
        }
        // Nonparticipants sort ahead of the eligible singers. Filtering must
        // happen before LIMIT 500, rather than truncating the entire roster.
        for (let index = 0; index < 501; index += 1) {
          state.storage.sql.exec(
            "INSERT INTO profiles (id, display_name, voice_part, created_at, updated_at) VALUES (?, ?, 'S1', ?, ?)",
            crypto.randomUUID(),
            `A Nonparticipant ${String(index)}`,
            at,
            at,
          );
        }
      });
      return { eventId, attendingId, unrecordedId };
    },
  );
  const readReport = async () => {
    const response = await exports.default.fetch(
      api(
        "alpha.localhost",
        `/api/organization/events/${seeded.eventId}/attendance-report`,
        cookie,
      ),
    );
    expect(response.status).toBe(200);
    return organizationAttendanceReportResponseSchema.parse(await response.json());
  };
  const report = await readReport();
  expect(report.totalRehearsals).toBe(1);
  expect(report.rows).toEqual([
    {
      profileId: seeded.attendingId,
      name: "Z Expected",
      voicePart: "S1",
      present: 1,
      absences: 0,
      total: 1,
    },
    {
      profileId: seeded.unrecordedId,
      name: "Z Not yet marked",
      voicePart: "S1",
      present: 0,
      absences: 0,
      total: 1,
    },
  ]);
  await runInDurableObject(
    stores.getByName("organization-alpha"),
    (_instance: OrganizationStore, state) => {
      state.storage.sql.exec(
        "UPDATE event_rosters SET rsvp = 'No' WHERE event_id = ?",
        seeded.eventId,
      );
    },
  );
  expect((await readReport()).rows).toEqual([]);
});

it("excludes archived profiles by ID, rejects stale saves atomically, and preserves history through restore", async () => {
  const cookie = await signIn();
  const venueId = await createVenue(cookie);
  const createEvent = async (
    title: string,
    type: "Performance" | "Rehearsal",
    parentPerformanceId?: string,
  ) => {
    const response = await write("alpha.localhost", "/api/organization/events", cookie, {
      title,
      type,
      venueId,
      parentPerformanceId,
      rsvpDeadlineDate:
        type === "Performance"
          ? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
          : null,
      startsAt: new Date(Date.now() + 172_800_000).toISOString(),
    });
    const body: unknown = await response.json();
    expect(body).toMatchObject({ title });
    expect(response.status).toBe(201);
    return organizationEventSchema.parse(body);
  };
  const performance = await createEvent("Archive history performance", "Performance");
  const rehearsal = await createEvent("Archive attendance rehearsal", "Rehearsal", performance.id);
  const profiles = [];
  for (const input of [
    { displayName: "Test Singer" },
    { displayName: "Test Singer" },
    { displayName: "Archived Unique" },
    { displayName: "Archived No History" },
    { displayName: "Directory Opt Out", showInDirectory: false },
    { displayName: "Off Roster Only", hidden: true },
    { displayName: "Ordinary Inactive", globalStatus: "Inactive" },
    { displayName: "On Break", globalStatus: "Idle" },
    { displayName: "Off Roster On Break", globalStatus: "Idle", hidden: true },
  ]) {
    profiles.push(
      organizationProfileResponseSchema.parse(
        await (
          await write("alpha.localhost", "/api/organization/profiles", cookie, {
            voicePart: "S1",
            statusIsManual: true,
            ...input,
          })
        ).json(),
      ),
    );
  }
  const [kept, archived, unique, noHistory] = profiles;
  if (!kept || !archived || !unique || !noHistory) throw new Error("Missing archive fixtures");
  const path = `/api/organization/events/${rehearsal.id}/attendance`;
  const readAttendance = async () => {
    const response = await exports.default.fetch(api("alpha.localhost", path, cookie));
    expect(response.status).toBe(200);
    return organizationAttendanceResponseSchema.parse(await response.json());
  };
  const initialRows = (await readAttendance()).rows;
  expect(initialRows).toHaveLength(9);
  expect(initialRows.filter(({ displayName }) => displayName === "Test Singer")).toHaveLength(2);
  expect(
    await write(
      "alpha.localhost",
      path,
      cookie,
      {
        updates: [archived, unique].map(({ id }) => ({ profileId: id, attendance: "Present" })),
      },
      "PUT",
    ),
  ).toMatchObject({ status: 200 });

  const historyPath = `/api/organization/events/${rehearsal.id}/rsvp-history`;
  const readHistory = async () =>
    organizationEventRsvpHistoryResponseSchema.parse(
      await (await exports.default.fetch(api("alpha.localhost", historyPath, cookie))).json(),
    ).entries;
  const historyBefore = await readHistory();
  const reportPath = `/api/organization/events/${performance.id}/attendance-report`;
  const readReport = async () =>
    organizationAttendanceReportResponseSchema.parse(
      await (await exports.default.fetch(api("alpha.localhost", reportPath, cookie))).json(),
    );
  const reportBefore = await readReport();
  expect(reportBefore.rows.map(({ profileId }) => profileId).sort()).toEqual(
    [archived.id, unique.id].sort(),
  );

  const snapshot = () =>
    runInDurableObject(
      stores.getByName("organization-alpha"),
      (_instance: OrganizationStore, state) => ({
        rosters: state.storage.sql
          .exec("SELECT * FROM event_rosters ORDER BY event_id, profile_id")
          .toArray(),
        rsvp: state.storage.sql.exec("SELECT * FROM event_rsvp_history ORDER BY id").toArray(),
        statuses: state.storage.sql
          .exec("SELECT * FROM profile_status_history ORDER BY id")
          .toArray(),
      }),
    );
  for (const profile of [archived, unique, noHistory]) {
    expect(
      await write(
        "alpha.localhost",
        `/api/organization/profiles/${profile.id}`,
        cookie,
        {
          ...profile,
          globalStatus: "Inactive",
          hidden: true,
          statusIsManual: true,
        },
        "PUT",
      ),
    ).toMatchObject({ status: 200 });
  }
  const beforeStaleSave = await snapshot();
  expect(beforeStaleSave.rosters).toHaveLength(4);
  expect(beforeStaleSave.rsvp).not.toHaveLength(0);
  expect(beforeStaleSave.statuses).not.toHaveLength(0);
  const expectedIds = profiles
    .filter(({ id }) => ![archived.id, unique.id, noHistory.id].includes(id))
    .map(({ id }) => id)
    .sort();
  // Repeated reads represent polling/reload; equal names must not collapse distinct profiles.
  for (let read = 0; read < 2; read += 1) {
    expect((await readAttendance()).rows.map(({ profileId }) => profileId).sort()).toEqual(
      expectedIds,
    );
  }
  for (const updates of [
    [{ profileId: archived.id, attendance: "Present" }],
    [{ profileId: noHistory.id, attendance: "Absent" }],
    [
      { profileId: kept.id, attendance: "Present" },
      { profileId: archived.id, attendance: "Pending" },
    ],
  ]) {
    const response = await write("alpha.localhost", path, cookie, { updates }, "PUT");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "attendance_profile_ineligible" });
  }
  expect(await snapshot()).toEqual(beforeStaleSave);
  expect(await readHistory()).toEqual(historyBefore);
  expect(await readReport()).toMatchObject({
    rows: reportBefore.rows,
    totalRehearsals: reportBefore.totalRehearsals,
  });

  expect(
    await write(
      "alpha.localhost",
      `/api/organization/profiles/${archived.id}`,
      cookie,
      {
        ...archived,
        globalStatus: "Active",
        hidden: false,
        statusIsManual: true,
      },
      "PUT",
    ),
  ).toMatchObject({ status: 200 });
  const restored = (await readAttendance()).rows;
  expect(
    restored
      .filter(({ displayName }) => displayName === "Test Singer")
      .map(({ profileId }) => profileId)
      .sort(),
  ).toEqual([kept.id, archived.id].sort());
  expect(restored.find(({ profileId }) => profileId === archived.id)).toMatchObject({
    attendance: "Present",
    rsvp: "Yes",
  });
  expect((await snapshot()).rosters).toEqual(beforeStaleSave.rosters);
});

it("filters archived profiles before the attendance limit, including profiles without event rows", async () => {
  const cookie = await signIn();
  const seeded = await runInDurableObject(
    stores.getByName("organization-alpha"),
    (_instance: OrganizationStore, state) => {
      const at = new Date().toISOString();
      const eventId = crypto.randomUUID();
      const eligibleId = crypto.randomUUID();
      state.storage.sql.exec(
        "INSERT INTO events (id, title, type, starts_at, created_at, updated_at) VALUES (?, 'Attendance limit', 'Rehearsal', ?, ?, ?)",
        eventId,
        at,
        at,
        at,
      );
      state.storage.transactionSync(() => {
        for (let index = 0; index < 501; index += 1) {
          state.storage.sql.exec(
            "INSERT INTO profiles (id, display_name, global_status, hidden, status_is_manual, created_at, updated_at) VALUES (?, ?, 'Inactive', 1, 1, ?, ?)",
            crypto.randomUUID(),
            `A Archived ${String(index)}`,
            at,
            at,
          );
        }
        state.storage.sql.exec(
          "INSERT INTO profiles (id, display_name, voice_part, created_at, updated_at) VALUES (?, 'Z Eligible', 'S1', ?, ?)",
          eligibleId,
          at,
          at,
        );
      });
      const plan = state.storage.sql
        .exec<{ readonly detail: string }>(
          `EXPLAIN QUERY PLAN SELECT p.id FROM profiles p
         JOIN events e ON e.id = ?
         LEFT JOIN event_rosters r ON r.profile_id = p.id AND r.event_id = ?
         WHERE p.hidden = 0 OR p.global_status != 'Inactive'
         ORDER BY p.display_name COLLATE NOCASE ASC, p.id ASC LIMIT 500`,
          eventId,
          eventId,
        )
        .toArray()
        .map(({ detail }) => detail)
        .join("\n");
      expect(plan).toContain("idx_profiles_attendance_eligible");
      expect(plan).not.toContain("USE TEMP B-TREE FOR ORDER BY");
      return { eventId, eligibleId };
    },
  );
  const response = await exports.default.fetch(
    api("alpha.localhost", `/api/organization/events/${seeded.eventId}/attendance`, cookie),
  );
  expect(response.status).toBe(200);
  const { rows } = organizationAttendanceResponseSchema.parse(await response.json());
  expect(rows.map(({ profileId }) => profileId)).toEqual([seeded.eligibleId]);
});
