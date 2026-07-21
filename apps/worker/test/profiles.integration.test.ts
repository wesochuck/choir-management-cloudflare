import {
  organizationProfileResponseSchema,
  organizationProfilesResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "profile.manager@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

function apiRequest(hostname: string, path: string, cookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${hostname}`);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${hostname}${path}`, { ...init, headers });
}

async function provision(
  organizationId: string,
  name: string,
  slug: string,
  role: "admin" | "member",
): Promise<void> {
  const now = new Date().toISOString();
  await controlDatabase.batch([
    controlDatabase
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 8, ?, ?, ?)`,
      )
      .bind(organizationId, name, slug, organizationId, now, now, now),
    controlDatabase
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${slug}`, organizationId, `${slug}.localhost`, now, now),
    controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, 'profile-manager', ?, ?)`,
      )
      .bind(`member-${slug}`, organizationId, role, Date.now()),
  ]);
  const response = await organizationStore
    .get(organizationStore.idFromName(organizationId))
    .fetch("https://organization.internal/internal/provision", {
      body: JSON.stringify({
        actorUserId: "bootstrap",
        canonicalHostname: `${slug}.localhost`,
        canonicalStatus: "active",
        name,
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
  const send = await exports.default.fetch(
    apiRequest("alpha.localhost", "/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  expect(send.status).toBe(200);
  const code = readCapturedPlatformEmailsForTest()
    .find((message) => message.kind === "email-one-time-code" && message.recipient === USER_EMAIL)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
  const response = await exports.default.fetch(
    apiRequest("alpha.localhost", "/api/auth/sign-in/email-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, otp: code }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toContain("choir-management.session_token=");
  return cookie ?? "";
}

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  const now = Date.now();
  await controlDatabase
    .prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES ('profile-manager', 'Profile Manager', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "Organization Alpha", "alpha", "admin");
  await provision("organization-bravo", "Organization Bravo", "bravo", "member");
});

afterEach(async () => {
  await reset();
});

describe("Organization Profiles", () => {
  it("creates and lists Profiles only within the canonical authenticated Organization", async () => {
    expect(
      await exports.default.fetch(apiRequest("alpha.localhost", "/api/organization/profiles")),
    ).toMatchObject({ status: 401 });
    const cookie = await signIn();
    const createdResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        body: JSON.stringify({ displayName: "  Alpha Singer  " }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(createdResponse.status).toBe(201);
    const created = organizationProfileResponseSchema.parse(await createdResponse.json());
    expect(created.displayName).toBe("Alpha Singer");

    const alphaList = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", "/api/organization/profiles", cookie),
        )
      ).json(),
    );
    expect(alphaList.profiles).toEqual([
      {
        createdAt: created.createdAt,
        displayName: "Alpha Singer",
        id: created.id,
        updatedAt: created.updatedAt,
      },
    ]);
    const bravoList = organizationProfilesResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("bravo.localhost", "/api/organization/profiles", cookie),
        )
      ).json(),
    );
    expect(bravoList.profiles).toEqual([]);
    expect(
      await exports.default.fetch(
        apiRequest("bravo.localhost", "/api/organization/profiles", cookie, {
          body: JSON.stringify({ displayName: "Forbidden Singer" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
    ).toMatchObject({ status: 403 });

    const audit = await runInDurableObject<OrganizationStore, { actorId: string } | null>(
      organizationStore.get(organizationStore.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ actorId: string }>(
            `SELECT actor_id AS actorId FROM audit_events
             WHERE action = 'profile.created' AND target_id = ?`,
            created.id,
          )
          .toArray()
          .at(0) ?? null,
    );
    expect(audit).toEqual({ actorId: "profile-manager" });
  });
});
