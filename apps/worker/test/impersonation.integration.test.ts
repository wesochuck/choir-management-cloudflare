import {
  memberDashboardResponseSchema,
  memberProfileResponseSchema,
  organizationImpersonationStatusResponseSchema,
  organizationProfileResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import { applyD1Migrations, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";

const ADMIN_EMAIL = "admin.user@example.test";
const OTHER_ADMIN_EMAIL = "other.admin@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const database = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const apiRequest = (hostname: string, path: string, cookie?: string, init?: RequestInit) =>
  organizationRequest(hostname, path, cookie, init);

const provision = (id: string, name: string, slug: string, role: "admin" | "member") =>
  provisionOrganization(database, stores, { id, name, role, slug, userId: "admin-user-id" });

const signIn = (email = ADMIN_EMAIL) =>
  signInWithOtp(exports.default, "alpha.localhost", email, (e) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), e),
  );

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "admin-user-id", ADMIN_EMAIL, "Admin User");
  await seedAuthUser(database, "other-admin-id", OTHER_ADMIN_EMAIL, "Other Admin");
  await provision("organization-alpha", "Organization Alpha", "alpha", "admin");
});

afterEach(async () => {
  await reset();
});

describe("Organization member impersonation", () => {
  it("allows an admin to impersonate a roster member and view their member endpoints", async () => {
    const adminCookie = await signIn(ADMIN_EMAIL);

    // Create a regular singer profile
    const createProfileResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Alice Alto",
          email: "alice.alto@example.test",
          phone: "555-0199",
          voicePart: "A1",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(createProfileResponse.status).toBe(201);
    const memberProfile = organizationProfileResponseSchema.parse(
      await createProfileResponse.json(),
    );

    await seedAuthUser(database, "alice-user-id", "alice.alto@example.test", "Alice Alto");
    await database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt)
         VALUES ('member-alice', 'organization-alpha', 'alice-user-id', 'member', ?, unixepoch())`,
      )
      .bind(memberProfile.id)
      .run();

    // Initial status: not impersonating
    const initialStatusResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/impersonation/status", adminCookie),
    );
    expect(initialStatusResponse.status).toBe(200);
    const initialStatus = organizationImpersonationStatusResponseSchema.parse(
      await initialStatusResponse.json(),
    );
    expect(initialStatus.active).toBe(false);

    // Start impersonation
    const startResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/impersonation", adminCookie, {
        body: JSON.stringify({ profileId: memberProfile.id }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(startResponse.status).toBe(200);
    const startData = organizationImpersonationStatusResponseSchema.parse(
      await startResponse.json(),
    );
    expect(startData.active).toBe(true);
    expect(startData.impersonatedProfile?.id).toBe(memberProfile.id);
    expect(startData.impersonatedProfile?.displayName).toBe("Alice Alto");

    const setCookieHeader = startResponse.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toContain("choir_impersonation=");
    const impersonationToken = setCookieHeader.split(";")[0] ?? "";
    const combinedCookie = `${adminCookie}; ${impersonationToken}`;

    // Status check now returns active
    const statusResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/impersonation/status", combinedCookie),
    );
    const currentStatus = organizationImpersonationStatusResponseSchema.parse(
      await statusResponse.json(),
    );
    expect(currentStatus.active).toBe(true);
    expect(currentStatus.impersonatedProfile?.displayName).toBe("Alice Alto");

    // Member dashboard returns Alice's dashboard
    const dashboardResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/singer/dashboard", combinedCookie),
    );
    expect(dashboardResponse.status).toBe(200);
    const dashboardData = memberDashboardResponseSchema.parse(await dashboardResponse.json());
    expect(dashboardData.profile?.displayName).toBe("Alice Alto");

    // Member profile endpoint returns Alice's profile
    const profileResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/singer/profile", combinedCookie),
    );
    expect(profileResponse.status).toBe(200);
    const profileData = memberProfileResponseSchema.parse(await profileResponse.json());
    expect(profileData.displayName).toBe("Alice Alto");
    expect(profileData.email).toBe("alice.alto@example.test");
    expect(profileData.voicePart).toBe("A1");

    // Stop impersonation
    const stopResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/impersonation/stop", combinedCookie, {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(stopResponse.status).toBe(200);
    const stopCookie = stopResponse.headers.get("set-cookie") ?? "";
    expect(stopCookie).toContain("Max-Age=0");

    // Verify audit logs were written
    const auditLogs = await database
      .prepare(
        `SELECT action, actor_user_id, organization_id, target_id FROM platform_audit_events
         WHERE organization_id = 'organization-alpha' AND action LIKE 'organization.impersonation.%'
         ORDER BY occurred_at ASC`,
      )
      .all<{ action: string; actor_user_id: string; organization_id: string; target_id: string }>();

    expect(auditLogs.results).toHaveLength(2);
    expect(auditLogs.results[0]).toMatchObject({
      action: "organization.impersonation.started",
      actor_user_id: "admin-user-id",
      organization_id: "organization-alpha",
      target_id: memberProfile.id,
    });
    expect(auditLogs.results[1]).toMatchObject({
      action: "organization.impersonation.stopped",
      actor_user_id: "admin-user-id",
      organization_id: "organization-alpha",
      target_id: memberProfile.id,
    });
  });

  it("prevents an admin from impersonating another Administrator or Owner", async () => {
    const adminCookie = await signIn(ADMIN_EMAIL);

    // Create an admin profile
    const createOtherAdminResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Other Admin",
          voicePart: "T1",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(createOtherAdminResponse.status).toBe(201);
    const otherAdminProfile = organizationProfileResponseSchema.parse(
      await createOtherAdminResponse.json(),
    );

    // Link other admin in D1 member table with role 'admin'
    await database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt)
         VALUES ('member-other-admin', 'organization-alpha', 'other-admin-id', 'admin', ?, unixepoch())`,
      )
      .bind(otherAdminProfile.id)
      .run();

    // Attempt to impersonate the other admin
    const startResponse = await exports.default.fetch(
      apiRequest("alpha.localhost", "/api/organization/impersonation", adminCookie, {
        body: JSON.stringify({ profileId: otherAdminProfile.id }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(startResponse.status).toBe(403);
    expect(await startResponse.json()).toMatchObject({
      message: expect.stringContaining(
        "Administrators cannot impersonate other Administrators or Owners",
      ),
    });
  });
});
