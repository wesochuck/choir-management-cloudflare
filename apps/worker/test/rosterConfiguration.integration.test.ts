import {
  organizationProfileResponseSchema,
  organizationRosterConfigurationResponseSchema,
} from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
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

const apiRequest = (hostname: string, path: string, cookie?: string, init?: RequestInit) =>
  organizationRequest(hostname, path, cookie, init);

const provision = (organizationId: string, name: string, slug: string, role: "admin" | "member") =>
  provisionOrganization(controlDatabase, organizationStore, {
    id: organizationId,
    name,
    role,
    slug,
    userId: "roster-manager",
  });

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(controlDatabase, "roster-manager", USER_EMAIL, "Roster Manager");
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
    expect(defaults).toMatchObject(defaultRosterConfiguration);

    const custom = {
      performerLabel: "Musician",
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
    expect(bravo).toMatchObject(defaultRosterConfiguration);

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
