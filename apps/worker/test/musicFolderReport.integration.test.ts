import {
  musicFolderNumberBatchResponseSchema,
  musicFolderReportProfileDetailResponseSchema,
  musicFolderReportQueryResponseSchema,
  musicFolderReturnStatusResponseSchema,
  organizationEventSchema,
  organizationProfileResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "music-folder-manager@example.test";

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

async function provision(
  organizationId: string,
  slug: string,
  role: "admin" | "member",
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
      .bind(organizationId, `Organization ${slug}`, slug, organizationId, now, now, now),
    database
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, organizationId, `${slug}.localhost`, now, now),
    database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, 'music-folder-manager', ?, ?)`,
      )
      .bind(`member-${slug}`, organizationId, role, Date.now()),
  ]);
  const response = await stores
    .get(stores.idFromName(organizationId))
    .fetch("https://organization.internal/internal/provision", {
      body: JSON.stringify({
        actorUserId: "bootstrap",
        canonicalHostname: `${slug}.localhost`,
        canonicalStatus: "active",
        name: `Organization ${slug}`,
        organizationId,
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
       VALUES ('music-folder-manager', 'Music Folder Manager', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "alpha", "admin");
  await provision("organization-bravo", "bravo", "member");
});

afterEach(async () => {
  await reset();
});

describe("Music Folder Report", () => {
  it("reports historical assignments, handles return updates, and preserves tenant boundaries", async () => {
    const cookie = await signIn();
    const ada = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Ada Adams",
          globalStatus: "Active",
        })
      ).json(),
    );
    const ben = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Ben Baker",
          globalStatus: "Idle",
        })
      ).json(),
    );
    const firstPerformance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: "2026-01-10T19:00:00.000Z",
          title: "Winter Concert",
          type: "Performance",
          rsvpDeadlineDate: "2030-01-01",
        })
      ).json(),
    );
    const secondPerformance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: "2026-05-10T19:00:00.000Z",
          title: "Spring Concert",
          type: "Performance",
          rsvpDeadlineDate: "2030-01-01",
        })
      ).json(),
    );
    const canceledPerformance = organizationEventSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/events", cookie, {
          startsAt: "2026-08-10T19:00:00.000Z",
          title: "Canceled Concert",
          type: "Performance",
          rsvpDeadlineDate: "2030-01-01",
        })
      ).json(),
    );
    expect(
      (
        await write(
          "alpha.localhost",
          `/api/organization/events/${canceledPerformance.id}/cancel`,
          cookie,
          {},
        )
      ).status,
    ).toBe(200);

    const selectedEventIds = [firstPerformance.id, secondPerformance.id];
    const initial = musicFolderReportQueryResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/reports/music-folders/query", cookie, {
          eventIds: [],
        })
      ).json(),
    );
    expect(initial.selectedEventIds).toEqual([]);
    expect(initial.performanceOptions.map((option) => option.id)).toEqual([
      canceledPerformance.id,
      secondPerformance.id,
      firstPerformance.id,
    ]);
    expect(
      initial.performanceOptions.find((option) => option.id === canceledPerformance.id),
    ).toMatchObject({ isCanceled: true, assignedFolderCount: 0 });

    for (const profileId of [ada.id, ben.id]) {
      for (const eventId of selectedEventIds) {
        expect(
          (
            await write(
              "alpha.localhost",
              `/api/organization/profiles/${profileId}/folder-numbers/${eventId}`,
              cookie,
              { folderNumber: "", folderReturned: false },
              "PUT",
            )
          ).status,
        ).toBe(200);
      }
    }

    const adaDetail = musicFolderReportProfileDetailResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/reports/music-folders/profiles/${ada.id}`,
          cookie,
          { eventIds: selectedEventIds },
        )
      ).json(),
    );
    const benDetail = musicFolderReportProfileDetailResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/reports/music-folders/profiles/${ben.id}`,
          cookie,
          { eventIds: selectedEventIds },
        )
      ).json(),
    );
    expect(adaDetail.rows).toHaveLength(2);
    expect(adaDetail.rows.map((row) => row.status)).toEqual(["not_assigned", "not_assigned"]);
    expect(adaDetail.rows[0]?.updatedAt).not.toBeNull();

    const assigned = musicFolderNumberBatchResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          "/api/organization/reports/music-folders/folder-numbers",
          cookie,
          {
            updates: [
              {
                eventId: firstPerformance.id,
                expectedUpdatedAt: adaDetail.rows.find((row) => row.eventId === firstPerformance.id)
                  ?.updatedAt,
                folderNumber: " A-1 ",
                profileId: ada.id,
              },
              {
                eventId: firstPerformance.id,
                expectedUpdatedAt: benDetail.rows.find((row) => row.eventId === firstPerformance.id)
                  ?.updatedAt,
                folderNumber: "A-2",
                profileId: ben.id,
              },
            ],
          },
          "PUT",
        )
      ).json(),
    );
    expect(assigned.results.every((result) => result.result === "applied")).toBe(true);
    expect(assigned.results[0]?.row?.folderNumber).toBe("A-1");

    const report = musicFolderReportQueryResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/reports/music-folders/query", cookie, {
          eventIds: selectedEventIds,
        })
      ).json(),
    );
    expect(report.totals).toMatchObject({
      assigned: 2,
      notAssigned: 2,
      outstanding: 2,
      returned: 0,
    });
    expect(report.summaries.map((summary) => summary.displayName)).toEqual([
      "Ada Adams",
      "Ben Baker",
    ]);

    const adaAssignedRow = report.summaries.find((summary) => summary.profileId === ada.id);
    expect(adaAssignedRow?.notAssigned).toBe(1);
    const adaBeforeReturn = musicFolderReportProfileDetailResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/reports/music-folders/profiles/${ada.id}`,
          cookie,
          { eventIds: selectedEventIds },
        )
      ).json(),
    );
    const returned = musicFolderReturnStatusResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/profiles/${ada.id}/folder-numbers/${firstPerformance.id}/return-status`,
          cookie,
          {
            expectedUpdatedAt: adaBeforeReturn.rows.find(
              (row) => row.eventId === firstPerformance.id,
            )?.updatedAt,
            folderReturned: true,
          },
          "PUT",
        )
      ).json(),
    );
    expect(returned.row).toMatchObject({ folderReturned: true, status: "returned" });
    expect(returned.row.returnedAt).not.toBeNull();

    const stale = await write(
      "alpha.localhost",
      "/api/organization/reports/music-folders/folder-numbers",
      cookie,
      {
        updates: [
          {
            eventId: firstPerformance.id,
            expectedUpdatedAt: adaBeforeReturn.rows.find(
              (row) => row.eventId === firstPerformance.id,
            )?.updatedAt,
            folderNumber: "A-3",
            profileId: ada.id,
          },
        ],
      },
      "PUT",
    );
    expect(musicFolderNumberBatchResponseSchema.parse(await stale.json()).results[0]).toMatchObject(
      {
        code: "stale_folder_row",
        result: "stale",
      },
    );

    const conflict = await write(
      "alpha.localhost",
      "/api/organization/reports/music-folders/folder-numbers",
      cookie,
      {
        updates: [
          {
            eventId: secondPerformance.id,
            expectedUpdatedAt: adaBeforeReturn.rows.find(
              (row) => row.eventId === secondPerformance.id,
            )?.updatedAt,
            folderNumber: "A-2",
            profileId: ada.id,
          },
        ],
      },
      "PUT",
    );
    expect(
      musicFolderNumberBatchResponseSchema.parse(await conflict.json()).results[0],
    ).toMatchObject({
      result: "applied",
    });

    const samePerformanceConflict = await write(
      "alpha.localhost",
      "/api/organization/reports/music-folders/folder-numbers",
      cookie,
      {
        updates: [
          {
            eventId: firstPerformance.id,
            expectedUpdatedAt: returned.row.updatedAt,
            folderNumber: "a-2",
            profileId: ada.id,
          },
        ],
      },
      "PUT",
    );
    expect(
      musicFolderNumberBatchResponseSchema.parse(await samePerformanceConflict.json()).results[0],
    ).toMatchObject({ code: "folder_number_conflict", result: "conflict" });

    const csv = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/reports/music-folders/export.csv", cookie, {
        body: JSON.stringify({ eventIds: selectedEventIds }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain("Folder Return Status");
    expect(
      await runInDurableObject<OrganizationStore, number>(
        stores.get(stores.idFromName("organization-alpha")),
        (_instance, state) =>
          state.storage.sql
            .exec<{ readonly count: number }>(
              "SELECT COUNT(*) AS count FROM pragma_table_info('event_rosters') WHERE name = 'folder_returned_at'",
            )
            .one().count,
      ),
    ).toBe(1);

    const crossTenant = await write(
      "bravo.localhost",
      "/api/organization/reports/music-folders/query",
      cookie,
      { eventIds: selectedEventIds },
    );
    expect(crossTenant.status).toBe(403);

    await database
      .prepare(
        "UPDATE member SET role = 'member' WHERE organizationId = 'organization-alpha' AND userId = 'music-folder-manager'",
      )
      .run();
    const memberDenied = await write(
      "alpha.localhost",
      "/api/organization/reports/music-folders/query",
      cookie,
      { eventIds: selectedEventIds },
    );
    expect(memberDenied.status).toBe(403);
  });
});
