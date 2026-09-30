import {
  organizationAttendanceResponseSchema,
  organizationAttendanceReportResponseSchema,
  organizationEventSchema,
  organizationProfileFolderNumberSchema,
  organizationProfileFolderNumbersResponseSchema,
  organizationProfileResponseSchema,
  organizationRsvpSchema,
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
    const event = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          title: "Attendance Rehearsal",
          type: "Rehearsal",
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
    expect(rsvpExport.headers.get("content-disposition")).toBe(
      'attachment; filename="attendance_rehearsal_rsvp_export.csv"',
    );
    expect(await rsvpExport.text()).toBe(
      [
        "Name,Section,Performer,Event Title,RSVP Status",
        '"Attending (Yes)",,,,',
        '"John Doe","Sopranos","S1","Attendance Rehearsal","Yes"',
        "",
        '"Declined (No)",,,,',
        '"Alice Smith","Altos","A1","Attendance Rehearsal","No"',
        "",
        '"No Response (Pending)",,,,',
        '"Unassigned Profile","Unassigned","Not sure","Attendance Rehearsal","Pending"',
        "",
        "Section Leaders",
        "Name,Section,Performer,Event Title,RSVP Status",
        '"John Doe","Sopranos","S1","Attendance Rehearsal","Yes"',
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
    const performance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          title: "Linked Performance",
          type: "Performance",
          rsvpDeadlineDate: "2030-01-01",
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

    // 1. Create a performance with no rehearsals -> reports 0 totalRehearsals and empty rows
    const emptyPerf = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          durationMinutes: 120,
          rsvpDeadlineDate: "2026-10-10",
          startsAt: "2026-10-15T19:00:00Z",
          title: "Empty Performance",
          type: "Performance",
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
        })
      ).json(),
    );
    await write("alpha.localhost", "/api/organization/events", cookie, {
      durationMinutes: 120,
      parentPerformanceId: otherPerformance.id,
      startsAt: "2026-12-01T19:00:00Z",
      title: "Other Rehearsal",
      type: "Rehearsal",
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
             SELECT id, display_name, voice_part
             FROM profiles
             ORDER BY display_name COLLATE NOCASE ASC, id ASC
             LIMIT 500
           ) p
           LEFT JOIN event_rosters r
             ON r.profile_id = p.id
             AND r.event_id IN (?, ?)
           GROUP BY p.id
           LIMIT 500`,
          rehearsal1.id,
          rehearsal2.id,
        )
        .toArray();
      const planDetails = plan.map((p) => p.detail).join("\n");
      // Must use index lookup for event_rosters
      expect(planDetails).toContain("SEARCH r USING INDEX");
      return null;
    });
  });
});
