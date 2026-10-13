import type {
  AccountOrganization,
  OrganizationAuthStatusResponse,
  PlatformMfaStatusResponse,
  PlatformOrganizationContextResponse,
} from "@choir/contracts";
import { describe, expect, it } from "vitest";

import {
  determinePostSignInPath,
  isOrganizationHost,
  safePlatformContinuation,
  isAuthenticatedRoute,
  isKnownAuthenticatedRoute,
  isPrivilegedRoute,
  resolvePostSignInLanding,
} from "./postSignIn";

function mockAuthStatus(
  role: OrganizationAuthStatusResponse["role"],
): (signal?: AbortSignal) => Promise<OrganizationAuthStatusResponse> {
  return (signal) => {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    }
    return Promise.resolve({
      mfaRequired: false,
      mfaSatisfied: true,
      mfaSatisfiedBy: null,
      mfaVerifiedUntil: null,
      organizationId: "org-123",
      requestId: "req-123",
      role,
      twoFactorEnabled: false,
      twoFactorVerified: false,
    });
  };
}

function mockFailedAuthStatus(): (signal?: AbortSignal) => Promise<OrganizationAuthStatusResponse> {
  return (signal) => {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    }
    return Promise.reject(httpError(404));
  };
}

function mockAbortedAuthStatus(): (
  signal?: AbortSignal,
) => Promise<OrganizationAuthStatusResponse> {
  return () => Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
}

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status.toString()}`), { status });
}

function mockAccountOrganizations(
  organizations: readonly AccountOrganization[],
): () => Promise<readonly AccountOrganization[]> {
  return () => Promise.resolve(organizations);
}

function accountOrganization(
  organizationId: string,
  profileId: string | null,
  role: AccountOrganization["role"] = "member",
): AccountOrganization {
  return {
    canonicalHostname: "alpha.example.test",
    canonicalStatus: "active",
    lifecycleState: "active",
    name: "Alpha",
    organizationId,
    profileId,
    role,
    slug: "alpha",
  };
}

function mockPlatformContextOk(): () => Promise<PlatformOrganizationContextResponse> {
  return () =>
    Promise.resolve({
      canEdit: false,
      elevationExpiresAt: null,
      elevationId: null,
      organizationId: "org-123",
      requestId: "req-123",
      userId: "user-1",
    });
}

function mockPlatformContextFail(
  status: number,
): () => Promise<PlatformOrganizationContextResponse> {
  return () => Promise.reject(httpError(status));
}

function mockPlatformMfaStatus(
  activePlatformAdministrator: boolean,
): () => Promise<PlatformMfaStatusResponse> {
  return () =>
    Promise.resolve({
      activePlatformAdministrator,
      enrollmentComplete: activePlatformAdministrator,
      hasPasskey: false,
      requestId: "req-123",
      twoFactorEnabled: activePlatformAdministrator,
    });
}

const baseHostDeps = {
  hostname: "example.test",
  getHealth: () =>
    Promise.resolve({
      baseHostname: "example.test",
      environment: "local" as const,
      fingerprint: "cloudflare-worker" as const,
      requestId: "req-1",
      service: "choir-management-cloudflare" as const,
      status: "ok" as const,
      version: "test",
    }),
};

const noPlatformDeps = {
  getModuleState: () => Promise.resolve([{ id: "roster" as const, enabled: true }]),
  getAccountOrganizations: mockAccountOrganizations([]),
  getPlatformMfaStatus: mockPlatformMfaStatus(false),
  getPlatformOrganizationContext: mockPlatformContextFail(403),
};

describe("isKnownAuthenticatedRoute & isPrivilegedRoute", () => {
  it("recognizes exact authenticated routes", () => {
    expect(isKnownAuthenticatedRoute("/dashboard")).toBe(true);
    expect(isKnownAuthenticatedRoute("/setup")).toBe(true);
    expect(isKnownAuthenticatedRoute("/admin")).toBe(true);
    expect(isKnownAuthenticatedRoute("/platform")).toBe(true);
    expect(isKnownAuthenticatedRoute("/accept-invitation")).toBe(true);
    expect(isAuthenticatedRoute("/practice")).toBe(true);
  });

  it("recognizes authenticated route prefixes", () => {
    expect(isKnownAuthenticatedRoute("/admin/roster")).toBe(true);
    expect(isKnownAuthenticatedRoute("/platform/tenants")).toBe(true);
    expect(isKnownAuthenticatedRoute("/seating/spring-concert")).toBe(true);
    expect(isKnownAuthenticatedRoute("/account/security")).toBe(true);
  });

  it("rejects unknown, unauthenticated, or malformed prefix routes", () => {
    expect(isKnownAuthenticatedRoute("/adminfoo")).toBe(false);
    expect(isKnownAuthenticatedRoute("/platformbar")).toBe(false);
    expect(isKnownAuthenticatedRoute("/login")).toBe(false);
    expect(isKnownAuthenticatedRoute("/")).toBe(false);
    expect(isKnownAuthenticatedRoute("/random")).toBe(false);
  });

  it("correctly identifies privileged routes", () => {
    expect(isPrivilegedRoute("/admin")).toBe(true);
    expect(isPrivilegedRoute("/admin/settings")).toBe(true);
    expect(isPrivilegedRoute("/platform")).toBe(true);
    expect(isPrivilegedRoute("/platform/access")).toBe(true);
    expect(isPrivilegedRoute("/seating/main")).toBe(true);
    expect(isPrivilegedRoute("/setup")).toBe(true);
    expect(isPrivilegedRoute("/adminfoo")).toBe(false);
    expect(isPrivilegedRoute("/dashboard")).toBe(false);
    expect(isPrivilegedRoute("/practice")).toBe(false);
  });
});

describe("determinePostSignInPath", () => {
  it("routes an organization administrator to /admin when logging in from /login", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("administrator"),
    });
    expect(nextPath).toBe("/admin");
  });

  it("routes an organization owner to /admin when logging in from /login", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("owner"),
    });
    expect(nextPath).toBe("/admin");
  });

  it("routes a regular member to /dashboard when logging in from /login", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("member"),
      ...noPlatformDeps,
    });
    expect(nextPath).toBe("/dashboard");
  });

  it("routes an organization administrator to /admin when logging in from /dashboard", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/dashboard",
      getAuthStatus: mockAuthStatus("administrator"),
    });
    expect(nextPath).toBe("/admin");
  });

  it("routes a member to /dashboard when logging in from /dashboard", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/dashboard",
      getAuthStatus: mockAuthStatus("member"),
      ...noPlatformDeps,
    });
    expect(nextPath).toBe("/dashboard");
  });

  it("falls back to /dashboard on non-tenant base platform where auth status returns 404", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockFailedAuthStatus(),
      ...baseHostDeps,
    });
    expect(nextPath).toBe("/dashboard");
  });

  it("returns to the retry entry when request aborts due to timeout", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAbortedAuthStatus(),
    });
    expect(nextPath).toBe("/login");
  });

  it("preserves a valid returnTo relative query parameter for admins", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("administrator"),
      search: "?returnTo=/admin/roster?section=settings",
    });
    expect(nextPath).toBe("/admin/roster?section=settings");
  });

  it("preserves a valid member returnTo relative query parameter for members", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("member"),
      ...noPlatformDeps,
      search: "?returnTo=/practice",
    });
    expect(nextPath).toBe("/practice");
  });

  it("role-gates admin returnTo away from non-admin members to /dashboard", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("member"),
      ...noPlatformDeps,
      search: "?returnTo=/admin/roster?section=settings",
    });
    expect(nextPath).toBe("/dashboard");
  });

  it("role-gates platform returnTo away from non-admin members to /dashboard", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("member"),
      ...noPlatformDeps,
      search: "?returnTo=/platform",
    });
    expect(nextPath).toBe("/dashboard");
  });

  it("ignores protocol-relative and external returnTo targets", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("administrator"),
      search: "?returnTo=//attacker.test/phish",
    });
    expect(nextPath).toBe("/admin");
  });

  it("ignores backslash returnTo targets", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("administrator"),
      search: "?returnTo=/\\attacker.test",
    });
    expect(nextPath).toBe("/admin");
  });

  it("ignores URL-encoded backslash returnTo targets", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("administrator"),
      search: "?returnTo=/%5cattacker.test",
    });
    expect(nextPath).toBe("/admin");
  });

  it("ignores returnTo targets containing control characters", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("administrator"),
      search: "?returnTo=/admin\nSet-Cookie:bad",
    });
    expect(nextPath).toBe("/admin");
  });

  it("ignores returnTo targets pointing to unknown routes", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("administrator"),
      search: "?returnTo=/adminfoo",
    });
    expect(nextPath).toBe("/admin");
  });

  it("preserves deep links to authenticated admin sub-routes for admins", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/admin/events",
      getAuthStatus: mockAuthStatus("administrator"),
    });
    expect(nextPath).toBe("/admin/events");
  });

  it("does not preserve deep links to admin sub-routes for members (routes to /dashboard)", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/admin/events",
      getAuthStatus: mockAuthStatus("member"),
      ...noPlatformDeps,
    });
    expect(nextPath).toBe("/dashboard");
  });

  it("preserves deep links to authenticated member sub-routes for members", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/schedule",
      getAuthStatus: mockAuthStatus("member"),
      ...noPlatformDeps,
    });
    expect(nextPath).toBe("/schedule");
  });
});

describe("resolvePostSignInLanding (issue #147)", () => {
  it("routes a member with a Profile linked to this Organization to /profile", async () => {
    const landing = await resolvePostSignInLanding({
      currentPathname: "/login",
      getModuleState: noPlatformDeps.getModuleState,
      getAccountOrganizations: mockAccountOrganizations([
        accountOrganization("org-123", "profile-1"),
      ]),
      getAuthStatus: mockAuthStatus("member"),
      getPlatformMfaStatus: mockPlatformMfaStatus(false),
      getPlatformOrganizationContext: mockPlatformContextFail(403),
    });
    expect(landing).toEqual({ kind: "navigate", path: "/profile" });
  });

  it("does not use another Organization's linked Profile for /profile", async () => {
    const landing = await resolvePostSignInLanding({
      currentPathname: "/login",
      getAccountOrganizations: mockAccountOrganizations([
        accountOrganization("org-other", "profile-9"),
        accountOrganization("org-123", null),
      ]),
      getAuthStatus: mockAuthStatus("member"),
      getPlatformMfaStatus: mockPlatformMfaStatus(false),
      getPlatformOrganizationContext: mockPlatformContextFail(403),
    });
    expect(landing).toEqual({ kind: "navigate", path: "/dashboard" });
  });

  it("routes a member without a linked Profile to /dashboard", async () => {
    const landing = await resolvePostSignInLanding({
      currentPathname: "/login",
      getAccountOrganizations: mockAccountOrganizations([accountOrganization("org-123", null)]),
      getAuthStatus: mockAuthStatus("member"),
      getPlatformMfaStatus: mockPlatformMfaStatus(false),
      getPlatformOrganizationContext: mockPlatformContextFail(403),
    });
    expect(landing).toEqual({ kind: "navigate", path: "/dashboard" });
  });

  it("routes a verified Platform Administrator without membership to /admin", async () => {
    const landing = await resolvePostSignInLanding({
      currentPathname: "/login",
      getAccountOrganizations: mockAccountOrganizations([]),
      getAuthStatus: () => Promise.reject(httpError(403)),
      getPlatformMfaStatus: mockPlatformMfaStatus(true),
      getPlatformOrganizationContext: mockPlatformContextOk(),
    });
    expect(landing).toEqual({ kind: "navigate", path: "/admin" });
  });

  it("rejects an operational deep link outside scoped overview authority", async () => {
    const landing = await resolvePostSignInLanding({
      currentPathname: "/login",
      getAccountOrganizations: mockAccountOrganizations([]),
      getAuthStatus: () => Promise.reject(httpError(403)),
      getPlatformMfaStatus: mockPlatformMfaStatus(true),
      getPlatformOrganizationContext: mockPlatformContextOk(),
      search: "?returnTo=/admin/roster",
    });
    expect(landing).toEqual({ kind: "navigate", path: "/admin" });
  });

  it("routes a Platform Administrator holding a member role to /admin", async () => {
    const landing = await resolvePostSignInLanding({
      currentPathname: "/login",
      getModuleState: noPlatformDeps.getModuleState,
      getAccountOrganizations: mockAccountOrganizations([
        accountOrganization("org-123", "profile-1"),
      ]),
      getAuthStatus: mockAuthStatus("member"),
      getPlatformMfaStatus: mockPlatformMfaStatus(true),
      getPlatformOrganizationContext: mockPlatformContextOk(),
    });
    expect(landing).toEqual({ kind: "navigate", path: "/admin" });
  });

  it("requires Platform MFA verification when the assertion is stale (401)", async () => {
    const landing = await resolvePostSignInLanding({
      currentPathname: "/login",
      getAccountOrganizations: mockAccountOrganizations([]),
      getAuthStatus: () => Promise.reject(httpError(403)),
      getPlatformMfaStatus: mockPlatformMfaStatus(true),
      getPlatformOrganizationContext: mockPlatformContextFail(401),
    });
    expect(landing).toEqual({
      kind: "verification",
      path: "/platform/access?returnTo=%2Fadmin",
    });
  });

  it("requires Platform MFA enrollment/verification for an active grant rejected with 403", async () => {
    const landing = await resolvePostSignInLanding({
      currentPathname: "/login",
      getAccountOrganizations: mockAccountOrganizations([]),
      getAuthStatus: () => Promise.reject(httpError(403)),
      getPlatformMfaStatus: mockPlatformMfaStatus(true),
      getPlatformOrganizationContext: mockPlatformContextFail(403),
    });
    expect(landing.kind).toBe("verification");
  });

  it("reports no_access for a signed-in user with neither membership nor Platform access", async () => {
    const landing = await resolvePostSignInLanding({
      currentPathname: "/login",
      getAccountOrganizations: mockAccountOrganizations([]),
      getAuthStatus: () => Promise.reject(httpError(403)),
      getPlatformMfaStatus: mockPlatformMfaStatus(false),
      getPlatformOrganizationContext: mockPlatformContextFail(403),
    });
    expect(landing).toEqual({ kind: "no_access" });
  });

  it("reports unavailable on network failure instead of guessing /dashboard", async () => {
    const landing = await resolvePostSignInLanding({
      currentPathname: "/login",
      getAccountOrganizations: mockAccountOrganizations([]),
      getAuthStatus: () => Promise.reject(new Error("network down")),
      getPlatformMfaStatus: mockPlatformMfaStatus(false),
      getPlatformOrganizationContext: mockPlatformContextFail(403),
    });
    expect(landing).toEqual({ kind: "unavailable" });
  });

  it("preserves product-base /dashboard landing when no tenant resolves (404)", async () => {
    const landing = await resolvePostSignInLanding({
      currentPathname: "/login",
      getAccountOrganizations: mockAccountOrganizations([]),
      getAuthStatus: () => Promise.reject(httpError(404)),
      ...baseHostDeps,
      getPlatformMfaStatus: mockPlatformMfaStatus(false),
      getPlatformOrganizationContext: mockPlatformContextFail(404),
    });
    expect(landing).toEqual({ kind: "navigate", path: "/dashboard" });
  });

  it("an explicit returnTo takes precedence over the default member landing", async () => {
    const landing = await resolvePostSignInLanding({
      currentPathname: "/login",
      getModuleState: noPlatformDeps.getModuleState,
      getAccountOrganizations: mockAccountOrganizations([
        accountOrganization("org-123", "profile-1"),
      ]),
      getAuthStatus: mockAuthStatus("member"),
      getPlatformMfaStatus: mockPlatformMfaStatus(false),
      getPlatformOrganizationContext: mockPlatformContextFail(403),
      search: "?returnTo=/practice",
    });
    expect(landing).toEqual({ kind: "navigate", path: "/practice" });
  });
});

describe("landing authorization failures", () => {
  it.each([401, 403])("steps up Platform members with rejected MFA (%i)", async (status) => {
    expect(
      await resolvePostSignInLanding({
        ...noPlatformDeps,
        currentPathname: "/login",
        getAuthStatus: mockAuthStatus("member"),
        getPlatformMfaStatus: mockPlatformMfaStatus(true),
        getPlatformOrganizationContext: mockPlatformContextFail(status),
      }),
    ).toEqual({ kind: "verification", path: "/platform/access?returnTo=%2Fadmin" });
  });

  it("does not grant Platform routes to Organization managers", async () => {
    expect(
      await resolvePostSignInLanding({
        ...noPlatformDeps,
        currentPathname: "/login",
        getAuthStatus: mockAuthStatus("owner"),
        search: "?returnTo=/platform/organizations",
      }),
    ).toEqual({ kind: "navigate", path: "/admin" });
  });

  it("uses a useful fallback when the linked Profile module is disabled", async () => {
    expect(
      await resolvePostSignInLanding({
        ...noPlatformDeps,
        currentPathname: "/login",
        getAuthStatus: mockAuthStatus("member"),
        getAccountOrganizations: mockAccountOrganizations([
          accountOrganization("org-123", "profile-1"),
        ]),
        getModuleState: () => Promise.resolve([{ id: "roster", enabled: false }]),
      }),
    ).toEqual({ kind: "navigate", path: "/dashboard" });
  });

  it("does not treat an unregistered Organization/custom host as the product base", async () => {
    expect(
      await resolvePostSignInLanding({
        ...noPlatformDeps,
        ...baseHostDeps,
        hostname: "unknown.example.test",
        currentPathname: "/login",
        getAuthStatus: () => Promise.reject(httpError(404)),
      }),
    ).toEqual({ kind: "no_access" });
  });

  it("reports unavailable when Platform grant status cannot be checked", async () => {
    expect(
      await resolvePostSignInLanding({
        ...noPlatformDeps,
        currentPathname: "/login",
        getAuthStatus: mockAuthStatus("member"),
        getPlatformMfaStatus: () => Promise.reject(new Error("network")),
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it.each([
    "/admin/roster",
    "/admin/../login",
    "/admin/../../evil",
    "/admin/\\evil.test",
    "//evil.test",
    "/admin/%5canything",
  ])("rejects unsafe or out-of-scope continuation %s", (value) => {
    expect(safePlatformContinuation(value)).toBeNull();
  });
  it("preserves query and fragment for the authorized overview", () => {
    expect(safePlatformContinuation("/admin?tab=overview#summary")).toBe(
      "/admin?tab=overview#summary",
    );
  });
});

describe("isOrganizationHost", () => {
  it("recognizes organization subdomains when baseHostname is configured", () => {
    expect(isOrganizationHost("lmc.musicsite.org", "musicsite.org")).toBe(true);
    expect(isOrganizationHost("lmc.staging.musicsite.org", "staging.musicsite.org")).toBe(true);
    expect(isOrganizationHost("alpha.localhost", "localhost")).toBe(true);
    expect(isOrganizationHost("custom.choir.org", "musicsite.org")).toBe(true);
  });

  it("recognizes baseHostname as non-organization host", () => {
    expect(isOrganizationHost("musicsite.org", "musicsite.org")).toBe(false);
    expect(isOrganizationHost("staging.musicsite.org", "staging.musicsite.org")).toBe(false);
    expect(isOrganizationHost("localhost", "localhost")).toBe(false);
    expect(isOrganizationHost("127.0.0.1", "127.0.0.1")).toBe(false);
  });

  it("handles case-insensitivity in host comparison", () => {
    expect(isOrganizationHost("LMC.MusicSite.Org", "musicsite.org")).toBe(true);
    expect(isOrganizationHost("MusicSite.Org", "musicsite.org")).toBe(false);
  });

  it("falls back to subdomain heuristics when baseHostname is unavailable", () => {
    expect(isOrganizationHost("alpha.localhost", null)).toBe(true);
    expect(isOrganizationHost("localhost", null)).toBe(false);
    expect(isOrganizationHost("127.0.0.1", null)).toBe(false);
    expect(isOrganizationHost("lmc.musicsite.org", null)).toBe(true);
    expect(isOrganizationHost("musicsite.org", null)).toBe(false);
  });
});
