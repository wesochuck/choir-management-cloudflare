import {
  organizationProfileActivityResponseSchema,
  organizationProfileResponseSchema,
} from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";

const ADMIN_EMAIL = "activity.admin@example.test";
const SINGER_EMAIL = "activity.singer@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(controlDatabase, "activity-admin", ADMIN_EMAIL, "Activity Admin");
  await seedAuthUser(controlDatabase, "activity-singer", SINGER_EMAIL, "Activity Singer");
  await provisionOrganization(controlDatabase, organizationStore, {
    id: "organization-alpha",
    name: "Organization Alpha",
    role: "admin",
    slug: "alpha",
    userId: "activity-admin",
  });
  await provisionOrganization(controlDatabase, organizationStore, {
    id: "organization-bravo",
    name: "Organization Bravo",
    role: "admin",
    slug: "bravo",
    userId: "activity-admin",
  });
});

afterEach(async () => {
  await reset();
});

describe("Organization Profile Activity endpoint", () => {
  it("enforces admin authorization, records org-scoped lastActiveAt, and prevents cross-org leakage", async () => {
    const adminCookie = await signInWithOtp(exports.default, "alpha.localhost", ADMIN_EMAIL, (e) =>
      readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), e),
    );

    // Create a singer profile in Alpha.
    const createProfileResponse = await exports.default.fetch(
      organizationRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Activity Singer",
          email: SINGER_EMAIL,
          voicePart: "",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(createProfileResponse.status).toBe(201);
    const created = organizationProfileResponseSchema.parse(await createProfileResponse.json());
    const profileId = created.id;

    // Link singer to both Alpha (with profileId) and Bravo (without profileId).
    await controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt, profileId)
         VALUES
           ('mem-singer-alpha', 'organization-alpha', 'activity-singer', 'member', '2026-02-01T12:00:00.000Z', ?),
           ('mem-singer-bravo', 'organization-bravo', 'activity-singer', 'member', '2026-02-02T12:00:00.000Z', NULL)`,
      )
      .bind(profileId)
      .run();

    // Unauthenticated request is rejected with 401.
    const unauthRes = await exports.default.fetch(
      organizationRequest("alpha.localhost", `/api/organization/profiles/${profileId}/activity`),
    );
    expect(unauthRes.status).toBe(401);

    // Invalid profile ID is rejected with 400.
    const invalidRes = await exports.default.fetch(
      organizationRequest(
        "alpha.localhost",
        "/api/organization/profiles/not-a-uuid/activity",
        adminCookie,
      ),
    );
    expect(invalidRes.status).toBe(400);

    // Unknown profile in Bravo (cross-tenant probe) returns 404.
    const crossTenantRes = await exports.default.fetch(
      organizationRequest(
        "bravo.localhost",
        `/api/organization/profiles/${profileId}/activity`,
        adminCookie,
      ),
    );
    expect(crossTenantRes.status).toBe(404);

    // Before the singer visits Alpha, lastActiveAt is null — even if admin impersonates them.
    const impersonateRes = await exports.default.fetch(
      organizationRequest("alpha.localhost", "/api/organization/impersonation", adminCookie, {
        body: JSON.stringify({ profileId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(impersonateRes.status).toBe(200);
    await exports.default.fetch(
      organizationRequest("alpha.localhost", "/api/singer/profile", adminCookie),
    );
    await exports.default.fetch(
      organizationRequest("alpha.localhost", "/api/organization/impersonation", adminCookie, {
        method: "DELETE",
      }),
    );

    const beforeVisitRes = await exports.default.fetch(
      organizationRequest(
        "alpha.localhost",
        `/api/organization/profiles/${profileId}/activity`,
        adminCookie,
      ),
    );
    expect(beforeVisitRes.status).toBe(200);
    const beforeVisit = organizationProfileActivityResponseSchema.parse(
      await beforeVisitRes.json(),
    );
    expect(beforeVisit.portal.linked).toBe(true);
    expect(beforeVisit.portal.lastActiveAt).toBeNull();

    // Singer signs in and visits Bravo first — must NOT stamp Alpha's lastActiveAt.
    const singerCookie = await signInWithOtp(
      exports.default,
      "alpha.localhost",
      SINGER_EMAIL,
      (e) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), e),
    );
    const bravoContextRes = await exports.default.fetch(
      organizationRequest("bravo.localhost", "/api/organization/context", singerCookie),
    );
    expect(bravoContextRes.status).toBe(200);

    const afterBravoOnlyRes = await exports.default.fetch(
      organizationRequest(
        "alpha.localhost",
        `/api/organization/profiles/${profileId}/activity`,
        adminCookie,
      ),
    );
    const afterBravoOnly = organizationProfileActivityResponseSchema.parse(
      await afterBravoOnlyRes.json(),
    );
    expect(afterBravoOnly.portal.lastActiveAt).toBeNull();

    // Regular member cannot read profile activity (403) — and accessing Alpha stamps lastActiveAt!
    const memberForbiddenRes = await exports.default.fetch(
      organizationRequest(
        "alpha.localhost",
        `/api/organization/profiles/${profileId}/activity`,
        singerCookie,
      ),
    );
    expect(memberForbiddenRes.status).toBe(403);

    // Admin now sees the singer's org-scoped lastActiveAt populated in Alpha.
    const afterAlphaRes = await exports.default.fetch(
      organizationRequest(
        "alpha.localhost",
        `/api/organization/profiles/${profileId}/activity`,
        adminCookie,
      ),
    );
    expect(afterAlphaRes.status).toBe(200);
    const afterAlpha = organizationProfileActivityResponseSchema.parse(await afterAlphaRes.json());
    expect(afterAlpha.portal.linked).toBe(true);
    expect(afterAlpha.portal.role).toBe("member");
    expect(afterAlpha.portal.lastActiveAt).not.toBeNull();
    expect(afterAlpha.portal.joinedAt).toBe("2026-02-01T12:00:00.000Z");
    expect(afterAlpha.timeline.some((event) => event.kind === "portal_joined")).toBe(true);
    expect(afterAlpha.timeline.some((event) => event.kind === "profile_created")).toBe(true);
  });
});
