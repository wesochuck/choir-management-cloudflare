import {
  organizationAttendanceResponseSchema,
  organizationEventSchema,
  organizationProfileFolderNumberSchema,
  organizationProfileFolderNumbersResponseSchema,
  organizationProfileResponseSchema,
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

const USER_EMAIL = "attendance.manager@example.test";

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

async function provision(id: string, slug: string): Promise<void> {
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
         VALUES (?, ?, 'attendance-manager', 'admin', ?)`,
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

async function write(host: string, path: string, cookie: string, body: unknown, method = "POST") {
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
       VALUES ('attendance-manager', 'Attendance Manager', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
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
    expect(rsvpExport.headers.get("cache-control")).toBe("no-store");
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
});
