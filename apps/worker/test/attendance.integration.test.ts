import {
  organizationAttendanceResponseSchema,
  organizationEventSchema,
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
         VALUES (?, ?, ?, 'active', ?, 9, ?, ?, ?)`,
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
          displayName: "Alpha Pending",
        })
      ).json(),
    );
    const explicitNoProfile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Alpha No",
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
              { attendance: "Present", profileId: alphaProfile.id },
              { attendance: "Absent", profileId: explicitNoProfile.id },
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
  });
});
