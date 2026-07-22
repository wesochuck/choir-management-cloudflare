import {
  memberProfileResponseSchema,
  organizationDirectoryResponseSchema,
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

const USER_EMAIL = "member.profile@example.test";

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
         VALUES (?, ?, 'member-profile-user', 'admin', ?)`,
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

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES ('member-profile-user', 'Member Profile', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "alpha");
  await provision("organization-bravo", "bravo");
});

afterEach(async () => {
  await reset();
});

describe("linked-member Profile and directory", () => {
  it("limits self-service fields and exposes only opted-in non-Inactive directory entries", async () => {
    const cookie = await signIn();
    const own = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Member Singer",
          globalStatus: "Idle",
          notes: "Manager-only note",
          phone: "555-0100",
          voicePart: "S1",
        })
      ).json(),
    );
    const publicProfile = organizationProfileResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/profiles", cookie, {
          displayName: "Public Singer",
          phone: "555-0200",
          voicePart: "A1",
        })
      ).json(),
    );
    await write("alpha.localhost", "/api/organization/profiles", cookie, {
      displayName: "Hidden Singer",
      showInDirectory: false,
      voicePart: "T1",
    });
    await write("alpha.localhost", "/api/organization/profiles", cookie, {
      displayName: "Inactive Singer",
      globalStatus: "Inactive",
      voicePart: "B1",
    });
    await database.batch([
      database
        .prepare(
          `UPDATE member SET profileId = ?, role = 'member'
           WHERE organizationId = 'organization-alpha' AND userId = 'member-profile-user'`,
        )
        .bind(own.id),
      database.prepare(
        `UPDATE member SET role = 'member'
           WHERE organizationId = 'organization-bravo' AND userId = 'member-profile-user'`,
      ),
    ]);

    expect(
      await exports.default.fetch(api("alpha.localhost", "/api/singer/profile")),
    ).toMatchObject({ status: 401 });
    const initial = memberProfileResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/profile", cookie))
      ).json(),
    );
    expect(initial).toMatchObject({
      displayName: "Member Singer",
      email: USER_EMAIL,
      globalStatus: "Idle",
      id: own.id,
      voicePart: "S1",
    });

    const updated = memberProfileResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          "/api/singer/profile",
          cookie,
          {
            displayName: "Member Updated",
            globalStatus: "Active",
            notes: "Client attempted overwrite",
            phone: "555-0199",
            showInDirectory: false,
            voicePart: "B1",
          },
          "PUT",
        )
      ).json(),
    );
    expect(updated).toMatchObject({
      displayName: "Member Updated",
      globalStatus: "Idle",
      phone: "555-0199",
      showInDirectory: false,
      voicePart: "S1",
    });

    const hiddenDirectory = organizationDirectoryResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/directory", cookie))
      ).json(),
    );
    expect(hiddenDirectory.profiles).toEqual([
      {
        displayName: "Public Singer",
        email: "",
        id: publicProfile.id,
        phone: "555-0200",
        photoFileId: null,
        voicePart: "A1",
      },
    ]);

    await write(
      "alpha.localhost",
      "/api/singer/profile",
      cookie,
      { displayName: "Member Updated", phone: "555-0199", showInDirectory: true },
      "PUT",
    );
    const visibleDirectory = organizationDirectoryResponseSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/singer/directory", cookie))
      ).json(),
    );
    expect(visibleDirectory.profiles.map(({ displayName }) => displayName)).toEqual([
      "Member Updated",
      "Public Singer",
    ]);
    expect(visibleDirectory.profiles[0]?.email).toBe(USER_EMAIL);

    expect(
      await exports.default.fetch(api("alpha.localhost", "/api/organization/profiles", cookie)),
    ).toMatchObject({ status: 403 });
    expect(
      await exports.default.fetch(api("bravo.localhost", "/api/singer/profile", cookie)),
    ).toMatchObject({ status: 404 });
    expect(
      await exports.default.fetch(api("localhost", "/api/singer/directory", cookie)),
    ).toMatchObject({ status: 404 });

    const persisted = await runInDurableObject<
      OrganizationStore,
      { readonly auditCount: number; readonly globalStatus: string; readonly notes: string }
    >(stores.get(stores.idFromName("organization-alpha")), (_instance, state) => {
      const profile = state.storage.sql
        .exec<{ readonly globalStatus: string; readonly notes: string }>(
          "SELECT global_status AS globalStatus, notes FROM profiles WHERE id = ?",
          own.id,
        )
        .one();
      const auditCount = state.storage.sql
        .exec<{ readonly count: number }>(
          `SELECT COUNT(*) AS count FROM audit_events
           WHERE action = 'profile.self_updated' AND actor_id = 'member-profile-user'`,
        )
        .one().count;
      return { auditCount, ...profile };
    });
    expect(persisted).toEqual({ auditCount: 2, globalStatus: "Idle", notes: "Manager-only note" });
  });
});
