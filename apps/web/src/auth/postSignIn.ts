import type {
  AccountOrganization,
  HealthResponse,
  ModuleState,
  OrganizationAuthStatusResponse,
  PlatformMfaStatusResponse,
  PlatformOrganizationContextResponse,
} from "@choir/contracts";

import { listAccountOrganizations } from "../api/account";
import { getHealth } from "../api/health";
import { getOrganizationModuleState, getOrganizationAuthStatus } from "../api/organization";
import { getPlatformMfaStatus, getPlatformOrganizationContext } from "../api/platform";
import { writeAuthenticatedLayoutModules } from "../account/layoutMetadataCache";

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
  "/join-roster",
  "/accept-invitation",
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

export function isOrganizationHost(
  hostname: string,
  baseHostname: string | null | undefined,
): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (baseHostname) {
    return normalized !== baseHostname.trim().toLowerCase();
  }
  if (normalized.endsWith(".localhost")) {
    return true;
  }
  if (normalized === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
    return false;
  }
  const parts = normalized.split(".");
  return parts.length > 2;
}

/**
 * Typed post-sign-in landing outcome (issue #147). Callers must not collapse
 * `no_access` / `unavailable` into a generic member dashboard: the former
 * needs a clear choose-an-Organization recovery, the latter a retry.
 */
export type PostSignInLanding =
  | { readonly kind: "navigate"; readonly path: string }
  | { readonly kind: "no_access" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "verification"; readonly path: string };

export interface DeterminePostSignInPathOptions {
  readonly currentPathname: string;
  readonly getAccountOrganizations?: (
    signal?: AbortSignal,
  ) => Promise<readonly AccountOrganization[]>;
  readonly getHealth?: (signal?: AbortSignal) => Promise<HealthResponse>;
  readonly hostname?: string;
  readonly getModuleState?: (signal?: AbortSignal) => Promise<readonly ModuleState[]>;
  readonly getAuthStatus?: (signal?: AbortSignal) => Promise<OrganizationAuthStatusResponse>;
  readonly getPlatformMfaStatus?: (signal?: AbortSignal) => Promise<PlatformMfaStatusResponse>;
  readonly getPlatformOrganizationContext?: (
    signal?: AbortSignal,
  ) => Promise<PlatformOrganizationContextResponse>;
  readonly baseHostname?: string | null;
  readonly baseHostnameResolved?: boolean;
  readonly isAuthenticatedRoute?: (pathname: string) => boolean;
  /** Host and user identity for caching low-sensitivity layout metadata only. */
  readonly layoutCacheHost?: string;
  readonly layoutCacheUserId?: string;
  readonly search?: string;
  readonly signal?: AbortSignal;
}

export interface PostSignInBootstrap {
  readonly host: string;
  readonly modules: readonly ModuleState[] | null;
  readonly organizationAuthStatus: OrganizationAuthStatusResponse;
  readonly userId: string;
}

export interface PostSignInResolution {
  readonly bootstrap: PostSignInBootstrap | null;
  readonly landing: PostSignInLanding;
  readonly platformMfaStatus: PlatformMfaStatusResponse | null;
}

function errorStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { readonly status: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
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

function pathOf(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
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

export function safePlatformContinuation(value: string): string | null {
  const target = parseReturnTo(`?returnTo=${encodeURIComponent(value)}`, isKnownAuthenticatedRoute);
  return target && pathOf(target) === "/admin" ? target : null;
}

function verificationLanding(intendedPath: string): PostSignInLanding {
  const intended = safePlatformContinuation(intendedPath) ?? "/admin";
  return {
    kind: "verification",
    path: `/platform/access?returnTo=${encodeURIComponent(intended)}`,
  };
}

interface LandingDeps {
  readonly getAccountOrganizations: NonNullable<
    DeterminePostSignInPathOptions["getAccountOrganizations"]
  >;
  readonly getPlatformMfaStatus: NonNullable<
    DeterminePostSignInPathOptions["getPlatformMfaStatus"]
  >;
  readonly getPlatformOrganizationContext: NonNullable<
    DeterminePostSignInPathOptions["getPlatformOrganizationContext"]
  >;
}

async function resolvePlatformFallback(
  deps: LandingDeps,
  returnTo: string | null,
  signal?: AbortSignal,
): Promise<PostSignInLanding> {
  try {
    await deps.getPlatformOrganizationContext(signal);
  } catch (platformError: unknown) {
    const platformStatus = errorStatus(platformError);
    if (platformStatus === 401 || platformStatus === 403) {
      try {
        const mfaStatus = await deps.getPlatformMfaStatus(signal);
        if (mfaStatus.activePlatformAdministrator) {
          return verificationLanding(returnTo ?? "/admin");
        }
      } catch {
        return { kind: "unavailable" };
      }
      return { kind: "no_access" };
    }
    if (platformStatus === 404) {
      return { kind: "no_access" };
    }
    return { kind: "unavailable" };
  }
  // Scoped overview access does not authorize arbitrary operational admin pages.
  if (returnTo && pathOf(returnTo) === "/admin") {
    return { kind: "navigate", path: returnTo };
  }
  return { kind: "navigate", path: "/admin" };
}

function isRosterModuleEnabled(modules: readonly ModuleState[]): boolean {
  const roster = modules.find((module) => module.id === "roster");
  if (roster !== undefined) return roster.enabled;
  const people = modules.find((module) => module.id === "people");
  if (people !== undefined) return people.enabled;
  return false;
}

async function resolveMemberLanding(
  deps: LandingDeps,
  authStatus: OrganizationAuthStatusResponse,
  options: DeterminePostSignInPathOptions,
  warmedModules: Promise<readonly ModuleState[] | null> | null,
): Promise<PostSignInLanding> {
  const signal = options.signal;
  let organizations: readonly AccountOrganization[];
  try {
    organizations = await deps.getAccountOrganizations(signal);
  } catch {
    return { kind: "unavailable" };
  }
  const linkedProfileId =
    organizations.find((organization) => organization.organizationId === authStatus.organizationId)
      ?.profileId ?? null;
  if (!linkedProfileId) return { kind: "navigate", path: "/dashboard" };
  try {
    const modules = warmedModules
      ? await warmedModules
      : await (options.getModuleState ?? getOrganizationModuleState)(signal);
    if (!modules) return { kind: "unavailable" };
    return {
      kind: "navigate",
      path: isRosterModuleEnabled(modules) ? "/profile" : "/dashboard",
    };
  } catch {
    return { kind: "unavailable" };
  }
}

function resolveNonTenantLanding(
  returnTo: string | null,
  currentPathname: string,
  checkRoute: (pathname: string) => boolean,
): PostSignInLanding {
  if (returnTo && !isPrivilegedRoute(pathOf(returnTo))) {
    return { kind: "navigate", path: returnTo };
  }
  if (isPreservedPath(currentPathname, checkRoute) && !isPrivilegedRoute(currentPathname)) {
    return { kind: "navigate", path: currentPathname };
  }
  return { kind: "navigate", path: "/dashboard" };
}

type AuthAttempt =
  | { readonly authStatus: OrganizationAuthStatusResponse; readonly ok: true }
  | { readonly landing: PostSignInLanding; readonly ok: false };

async function attemptAuthStatus(
  deps: LandingDeps,
  options: DeterminePostSignInPathOptions,
  returnTo: string | null,
): Promise<AuthAttempt> {
  const getAuthStatus = options.getAuthStatus ?? getOrganizationAuthStatus;
  try {
    return { authStatus: await getAuthStatus(options.signal), ok: true };
  } catch (authError: unknown) {
    const status = errorStatus(authError);
    if (status === 404) {
      let baseHostname = options.baseHostname ?? null;
      if (!options.baseHostnameResolved) {
        try {
          const health = await (options.getHealth ?? getHealth)(options.signal);
          baseHostname = health.baseHostname ?? null;
        } catch {
          return { landing: { kind: "unavailable" }, ok: false };
        }
      }
      const hostname =
        options.hostname ?? (typeof window === "undefined" ? "" : window.location.hostname);
      if (isOrganizationHost(hostname, baseHostname)) {
        return { landing: { kind: "no_access" }, ok: false };
      }
      return {
        landing: resolveNonTenantLanding(
          returnTo,
          options.currentPathname,
          options.isAuthenticatedRoute ?? isKnownAuthenticatedRoute,
        ),
        ok: false,
      };
    }
    if (status !== 403) {
      return { landing: { kind: "unavailable" }, ok: false };
    }
    return {
      landing: await resolvePlatformFallback(deps, returnTo, options.signal),
      ok: false,
    };
  }
}

function createLandingDeps(
  options: DeterminePostSignInPathOptions,
  getPlatformStatus: NonNullable<DeterminePostSignInPathOptions["getPlatformMfaStatus"]>,
): LandingDeps {
  return {
    getAccountOrganizations: options.getAccountOrganizations ?? listAccountOrganizations,
    getPlatformMfaStatus: getPlatformStatus,
    getPlatformOrganizationContext:
      options.getPlatformOrganizationContext ?? getPlatformOrganizationContext,
  };
}

async function attemptPlatformAdminLanding(
  deps: LandingDeps,
  requestedPath: string | null,
  signal?: AbortSignal,
): Promise<PostSignInLanding | null> {
  try {
    const status = await deps.getPlatformMfaStatus(signal);
    if (!status.activePlatformAdministrator) return null;
    const platformLanding = await resolvePlatformFallback(deps, requestedPath, signal);
    if (requestedPath && !isPrivilegedRoute(pathOf(requestedPath))) {
      return { kind: "navigate", path: requestedPath };
    }
    return platformLanding;
  } catch {
    return { kind: "unavailable" };
  }
}

function resolvePreservedPath(
  path: string | null,
  isOrganizationAdmin: boolean,
): PostSignInLanding | null {
  if (!path) return null;
  const privileged = isPrivilegedRoute(pathOf(path));
  if (!privileged) {
    return { kind: "navigate", path };
  }
  if (isOrganizationAdmin && !pathOf(path).startsWith("/platform")) {
    return { kind: "navigate", path };
  }
  return null;
}

async function determineTenantLanding(
  deps: LandingDeps,
  options: DeterminePostSignInPathOptions,
  authStatus: OrganizationAuthStatusResponse,
  returnTo: string | null,
  warmedModules: Promise<readonly ModuleState[] | null> | null,
): Promise<PostSignInLanding> {
  const checkRoute = options.isAuthenticatedRoute ?? isKnownAuthenticatedRoute;
  const isOrganizationAdmin = authStatus.role === "administrator" || authStatus.role === "owner";
  const currentPreserved = isPreservedPath(options.currentPathname, checkRoute)
    ? options.currentPathname
    : null;
  const requestedPath = returnTo ?? currentPreserved;

  if (!isOrganizationAdmin || requestedPath?.startsWith("/platform")) {
    const platformLanding = await attemptPlatformAdminLanding(deps, requestedPath, options.signal);
    if (platformLanding) return platformLanding;
  }

  const preservedLanding =
    resolvePreservedPath(returnTo, isOrganizationAdmin) ??
    resolvePreservedPath(currentPreserved, isOrganizationAdmin);
  if (preservedLanding) return preservedLanding;
  if (isOrganizationAdmin) return { kind: "navigate", path: "/admin" };
  return resolveMemberLanding(deps, authStatus, options, warmedModules);
}

interface PlatformStatusMemo {
  readonly get: (signal?: AbortSignal) => Promise<PlatformMfaStatusResponse>;
  readonly current: () => PlatformMfaStatusResponse | null;
}

function createPlatformStatusMemo(options: DeterminePostSignInPathOptions): PlatformStatusMemo {
  let currentStatus: PlatformMfaStatusResponse | null = null;
  let statusPromise: Promise<PlatformMfaStatusResponse> | null = null;
  const get = (signal?: AbortSignal) => {
    statusPromise ??= (options.getPlatformMfaStatus ?? getPlatformMfaStatus)(signal).then(
      (status) => {
        currentStatus = status;
        return status;
      },
    );
    return statusPromise;
  };
  return { current: () => currentStatus, get };
}

function isPostSignInTenantHost(options: DeterminePostSignInPathOptions): boolean {
  const hostname =
    options.hostname ?? (typeof window === "undefined" ? "" : window.location.hostname);
  const baseHostname = options.baseHostnameResolved ? options.baseHostname : null;
  return isOrganizationHost(hostname, baseHostname);
}

function prewarmOrganizationModules(
  options: DeterminePostSignInPathOptions,
  isTenantHost: boolean,
): Promise<readonly ModuleState[]> | null {
  const cacheHost = options.layoutCacheHost;
  const cacheUserId = options.layoutCacheUserId;
  if (!isTenantHost || !cacheHost || !cacheUserId) return null;
  return (options.getModuleState ?? getOrganizationModuleState)(options.signal).then((modules) => {
    writeAuthenticatedLayoutModules(cacheHost, cacheUserId, modules);
    return modules;
  });
}

function settleModuleWarmup(
  warmedModules: Promise<readonly ModuleState[]> | null,
): Promise<readonly ModuleState[] | null> | null {
  return (
    warmedModules?.then(
      (modules) => modules,
      () => null,
    ) ?? null
  );
}

function createPostSignInBootstrap(
  isTenantHost: boolean,
  options: DeterminePostSignInPathOptions,
  authStatus: OrganizationAuthStatusResponse,
  modules: readonly ModuleState[] | null,
): PostSignInBootstrap | null {
  const host = options.layoutCacheHost;
  const userId = options.layoutCacheUserId;
  if (!isTenantHost || !host || !userId) return null;
  return { host, modules, organizationAuthStatus: authStatus, userId };
}

function createPostSignInResolution(
  landing: PostSignInLanding,
  bootstrap: PostSignInBootstrap | null,
  platformMfaStatus: PlatformMfaStatusResponse | null,
): PostSignInResolution {
  return { bootstrap, landing, platformMfaStatus };
}

export async function resolvePostSignInResolution(
  options: DeterminePostSignInPathOptions,
): Promise<PostSignInResolution> {
  const platformStatus = createPlatformStatusMemo(options);
  const deps = createLandingDeps(options, platformStatus.get);
  const checkRoute = options.isAuthenticatedRoute ?? isKnownAuthenticatedRoute;
  const returnTo = parseReturnTo(options.search ?? "", checkRoute);
  const isTenantHost = isPostSignInTenantHost(options);
  if (options.baseHostnameResolved === true && !isTenantHost) {
    const platformLanding = await attemptPlatformAdminLanding(deps, returnTo, options.signal);
    return createPostSignInResolution(
      platformLanding ?? resolveNonTenantLanding(returnTo, options.currentPathname, checkRoute),
      null,
      platformStatus.current(),
    );
  }

  const warmedModules = prewarmOrganizationModules(options, isTenantHost);
  const settledModules = settleModuleWarmup(warmedModules);

  const attempt = await attemptAuthStatus(deps, options, returnTo);
  if (!attempt.ok) {
    return createPostSignInResolution(attempt.landing, null, platformStatus.current());
  }
  const { authStatus } = attempt;
  const [landing, modules] = await Promise.all([
    determineTenantLanding(deps, options, authStatus, returnTo, settledModules),
    settledModules ?? Promise.resolve(null),
  ]);
  const bootstrap = createPostSignInBootstrap(isTenantHost, options, authStatus, modules);
  return createPostSignInResolution(landing, bootstrap, platformStatus.current());
}

export async function resolvePostSignInLanding(
  options: DeterminePostSignInPathOptions,
): Promise<PostSignInLanding> {
  return (await resolvePostSignInResolution(options)).landing;
}

/**
 * String-returning compatibility wrapper. `no_access` maps to the
 * choose-an-Organization recovery and `unavailable` to the retry entry
 * for legacy callers; new code should use `resolvePostSignInLanding`.
 */
export async function determinePostSignInPath(
  options: DeterminePostSignInPathOptions,
): Promise<string> {
  const landing = await resolvePostSignInLanding(options);
  switch (landing.kind) {
    case "navigate":
    case "verification":
      return landing.path;
    case "no_access":
      return "/account/organizations";
    case "unavailable":
      return "/login";
  }
}
