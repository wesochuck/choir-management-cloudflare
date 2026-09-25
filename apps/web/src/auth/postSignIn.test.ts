import type { OrganizationAuthStatusResponse } from "@choir/contracts";
import { describe, expect, it } from "vitest";

import {
  determinePostSignInPath,
  isAuthenticatedRoute,
  isKnownAuthenticatedRoute,
  isPrivilegedRoute,
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
    return Promise.reject(
      new Error("404 Organization authentication status requires a registered canonical hostname."),
    );
  };
}

function mockAbortedAuthStatus(): (
  signal?: AbortSignal,
) => Promise<OrganizationAuthStatusResponse> {
  return () => Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
}

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
    });
    expect(nextPath).toBe("/dashboard");
  });

  it("falls back to /dashboard on non-tenant base platform where auth status returns 404", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockFailedAuthStatus(),
    });
    expect(nextPath).toBe("/dashboard");
  });

  it("falls back gracefully to /dashboard when request aborts due to timeout", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAbortedAuthStatus(),
    });
    expect(nextPath).toBe("/dashboard");
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
      search: "?returnTo=/practice",
    });
    expect(nextPath).toBe("/practice");
  });

  it("role-gates admin returnTo away from non-admin members to /dashboard", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("member"),
      search: "?returnTo=/admin/roster?section=settings",
    });
    expect(nextPath).toBe("/dashboard");
  });

  it("role-gates platform returnTo away from non-admin members to /dashboard", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/login",
      getAuthStatus: mockAuthStatus("member"),
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
    });
    expect(nextPath).toBe("/dashboard");
  });

  it("preserves deep links to authenticated member sub-routes for members", async () => {
    const nextPath = await determinePostSignInPath({
      currentPathname: "/schedule",
      getAuthStatus: mockAuthStatus("member"),
    });
    expect(nextPath).toBe("/schedule");
  });
});
