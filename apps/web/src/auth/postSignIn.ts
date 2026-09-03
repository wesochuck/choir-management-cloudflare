import type { OrganizationAuthStatusResponse } from "@choir/contracts";

import { getOrganizationAuthStatus } from "../api/organization";

export const authenticatedRoutePrefixes = [
  "/seating/",
  "/account/",
  "/admin/",
  "/platform/",
] as const;

export const defaultAuthenticatedExactRoutes: ReadonlySet<string> = new Set([
  "/setup",
  "/dashboard",
  "/schedule",
  "/profile",
  "/directory",
  "/dues",
  "/practice",
  "/member/resources",
  "/calendar",
  "/account",
  "/admin",
  "/platform",
]);

export function isKnownAuthenticatedRoute(pathname: string): boolean {
  return (
    defaultAuthenticatedExactRoutes.has(pathname) ||
    authenticatedRoutePrefixes.some((prefix) => pathname.startsWith(prefix))
  );
}

export const isAuthenticatedRoute = isKnownAuthenticatedRoute;

export function isPrivilegedRoute(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/platform" ||
    pathname.startsWith("/platform/") ||
    pathname.startsWith("/seating/") ||
    pathname === "/setup"
  );
}

export interface DeterminePostSignInPathOptions {
  readonly currentPathname: string;
  readonly getAuthStatus?: (signal?: AbortSignal) => Promise<OrganizationAuthStatusResponse>;
  readonly isAuthenticatedRoute?: (pathname: string) => boolean;
  readonly search?: string;
  readonly signal?: AbortSignal;
}

function isSafeRelativeRedirect(url: string): boolean {
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\")) {
    return false;
  }
  if (url.toLowerCase().includes("%5c")) {
    return false;
  }
  // Reject control characters (0x00 - 0x1f and 0x7f)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(url)) {
    return false;
  }
  return true;
}

function parseReturnTo(
  search: string,
  isAuthenticatedRoute: (pathname: string) => boolean,
): string | null {
  const rawReturnTo = new URLSearchParams(search).get("returnTo");
  if (!rawReturnTo || !isSafeRelativeRedirect(rawReturnTo)) {
    return null;
  }
  try {
    const parsed = new URL(rawReturnTo, "https://local.test");
    if (parsed.origin !== "https://local.test") {
      return null;
    }
    if (!isAuthenticatedRoute(parsed.pathname)) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function isPreservedPath(
  pathname: string,
  isAuthenticatedRoute: (pathname: string) => boolean,
): boolean {
  return (
    pathname !== "/login" &&
    pathname !== "/dashboard" &&
    pathname !== "/" &&
    isAuthenticatedRoute(pathname)
  );
}

export async function determinePostSignInPath({
  currentPathname,
  getAuthStatus = getOrganizationAuthStatus,
  isAuthenticatedRoute = isKnownAuthenticatedRoute,
  search = "",
  signal,
}: DeterminePostSignInPathOptions): Promise<string> {
  let isAdmin = false;
  try {
    const authStatus = await getAuthStatus(signal);
    isAdmin = authStatus.role === "administrator" || authStatus.role === "owner";
  } catch {
    // Non-tenant host, unauthenticated session, request failure, or aborted timeout.
  }

  const returnTo = parseReturnTo(search, isAuthenticatedRoute);
  if (returnTo) {
    const returnToPath = returnTo.split(/[?#]/)[0] ?? returnTo;
    if (!isPrivilegedRoute(returnToPath) || isAdmin) {
      return returnTo;
    }
  }

  if (isPreservedPath(currentPathname, isAuthenticatedRoute)) {
    if (!isPrivilegedRoute(currentPathname) || isAdmin) {
      return currentPathname;
    }
  }

  return isAdmin ? "/admin" : "/dashboard";
}
