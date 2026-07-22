import {
  organizationProfileResponseSchema,
  organizationRosterConfigurationResponseSchema,
} from "@choir/contracts";
import { defaultRosterConfiguration } from "@choir/domain";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

const USER_EMAIL = "roster.manager@example.test";

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
         VALUES (?, ?, ?, 'active', ?, 12, ?, ?, ?)`,
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
         VALUES (?, ?, 'roster-manager', ?, ?)`,
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
  await exports.default.fetch(
    apiRequest("alpha.localhost", "/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email: USER_EMAIL, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
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
       VALUES ('roster-manager', 'Roster Manager', ?, 0, ?, ?, 0)`,
    )
    .bind(USER_EMAIL, now, now)
    .run();
  await provision("organization-alpha", "Organization Alpha", "alpha", "admin");
  await provision("organization-bravo", "Organization Bravo", "bravo", "member");
});

afterEach(async () => {
  await reset();
});

describe("Organization roster configuration", () => {
  it("enforces defaults, Profile references, authorization, audit, and isolation", async () => {
    expect(
      await exports.default.fetch(
        apiRequest("alpha.localhost", "/api/organization/roster-configuration"),
      ),
    ).toMatchObject({ status: 401 });
    const cookie = await signIn();
    const defaults = organizationRosterConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("alpha.localhost", "/api/organization/roster-configuration", cookie),
        )
      ).json(),
    );
    expect({ sections: defaults.sections, voiceParts: defaults.voiceParts }).toEqual(
      defaultRosterConfiguration,
    );

    const custom = {
      sections: [{ code: "H", color: "#123456", name: "High voices", trackOnly: false }],
      voiceParts: [{ fullName: "High voice", label: "High", sectionCode: "H" }],
    };
    const updatedResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/roster-configuration", cookie, {
        body: JSON.stringify(custom),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(updatedResponse.status).toBe(200);
    expect(
      organizationRosterConfigurationResponseSchema.parse(await updatedResponse.json()),
    ).toMatchObject(custom);

    const invalidProfileResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        body: JSON.stringify({ displayName: "Invalid Voice", voicePart: "Missing" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(invalidProfileResponse.status).toBe(400);
    await expect(invalidProfileResponse.json()).resolves.toMatchObject({
      code: "voice_part_not_configured",
    });

    const profileResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", cookie, {
        body: JSON.stringify({ displayName: "Assigned Singer", voicePart: "High" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(organizationProfileResponseSchema.parse(await profileResponse.json()).voicePart).toBe(
      "High",
    );
    const removalResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/roster-configuration", cookie, {
        body: JSON.stringify(defaultRosterConfiguration),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(removalResponse.status).toBe(409);
    await expect(removalResponse.json()).resolves.toMatchObject({ code: "voice_part_in_use" });

    expect(
      await exports.default.fetch(
        apiRequest("alpha.localhost", "/api/organization/roster-configuration", cookie, {
          body: JSON.stringify({
            sections: custom.sections,
            voiceParts: [{ ...custom.voiceParts[0], sectionCode: "missing" }],
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await exports.default.fetch(
        apiRequest("bravo.localhost", "/api/organization/roster-configuration", cookie, {
          body: JSON.stringify(custom),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }),
      ),
    ).toMatchObject({ status: 403 });
    const bravo = organizationRosterConfigurationResponseSchema.parse(
      await (
        await exports.default.fetch(
          apiRequest("bravo.localhost", "/api/organization/roster-configuration", cookie),
        )
      ).json(),
    );
    expect({ sections: bravo.sections, voiceParts: bravo.voiceParts }).toEqual(
      defaultRosterConfiguration,
    );

    const stub = organizationStore.get(organizationStore.idFromName("organization-alpha"));
    const auditCount = await runInDurableObject(
      stub,
      (_instance: OrganizationStore, state) =>
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'organization.roster_configuration.updated'",
          )
          .one().count,
    );
    expect(auditCount).toBe(1);
  });
});
