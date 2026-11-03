import "./main.css";
import "./styles/theme.css";

import type { PlatformMfaStatusResponse, PublishedOrganizationProjection } from "@choir/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { clearAuthenticatedLayoutMetadata } from "./account/layoutMetadataCache";
import { getHealth } from "./api";
import { clearPublishedOrganizationProjectionCache } from "./api/public";
import {
  handleSignInLanding,
  initialServiceState,
  initialSessionState,
  readAppLocation,
  readPasswordResetLocation,
  renderAppContent,
  resolveDisplayName,
  resolveRouteRequirements,
  selectContent,
  type AppLocation,
  type ServiceState,
  type SessionState,
} from "./appRouting";
import { getCurrentSession, getPublishedOrganizationProjection } from "./auth/api";
import { readOAuthCompletionState } from "./auth/googleAuth";
import {
  isAuthenticatedRoute,
  isOrganizationHost,
  resolvePostSignInResolution,
  type PostSignInBootstrap,
} from "./auth/postSignIn";
import { purgeCachedPlayerMetadata, purgeOfflineAudioForSource } from "./offline/mediaStore";

const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

export function App() {
  const [appLocation, setAppLocation] = useState<AppLocation>(readAppLocation);
  const pathname = appLocation.pathname;

  const initialReqs = resolveRouteRequirements(pathname);

  const [serviceState, setServiceState] = useState<ServiceState>(() =>
    initialServiceState(initialReqs.isPublic),
  );
  const [sessionState, setSessionState] = useState<SessionState>(() =>
    initialSessionState(initialReqs.isPublic),
  );
  const [sessionChecked, setSessionChecked] = useState<boolean>(false);
  const [shellBootstrap, setShellBootstrap] = useState<PostSignInBootstrap | null>(null);
  const [shellPlatformMfaStatus, setShellPlatformMfaStatus] =
    useState<PlatformMfaStatusResponse | null>(null);
  const [baseHostname, setBaseHostname] = useState<string | null>(null);
  const [publishedProjection, setPublishedProjection] =
    useState<PublishedOrganizationProjection | null>();
  const [auditionHeading, setAuditionHeading] = useState<string | undefined>();
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [logoFileId, setLogoFileId] = useState<string | null>(null);
  const [projectionVersion, setProjectionVersion] = useState<number>(1);
  const [resetLocation] = useState(() => readPasswordResetLocation(pathname));
  const [oauthCompletion] = useState(() =>
    readOAuthCompletionState(typeof window !== "undefined" ? window.location.search : ""),
  );

  const checkService = useCallback((signal?: AbortSignal) => {
    return getHealth(signal)
      .then((health) => {
        setServiceState("ready");
        setBaseHostname(health.baseHostname ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setServiceState("offline");
      });
  }, []);

  const checkSession = useCallback((signal?: AbortSignal) => {
    return getCurrentSession(signal)
      .then((session) => {
        setSessionState(session ? { session, status: "authenticated" } : { status: "anonymous" });
        setSessionChecked(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setSessionState({ reason: "unavailable", status: "error" });
        setSessionChecked(true);
      });
  }, []);

  const applyProjection = useCallback((projection: PublishedOrganizationProjection | null) => {
    setPublishedProjection(projection);
    if (projection?.payload.organizationName) {
      setOrganizationName(projection.payload.organizationName);
      setAuditionHeading(projection.payload.settings.pageLabels?.auditions?.heading);
      setLogoFileId(projection.payload.settings.logoFileId ?? null);
      setProjectionVersion(projection.version);
    }
  }, []);

  const checkProjection = useCallback(
    (signal?: AbortSignal) => {
      return getPublishedOrganizationProjection(signal)
        .then((projection) => {
          applyProjection(projection);
          return projection;
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setPublishedProjection(null);
          }
          return null;
        });
    },
    [applyProjection],
  );

  const navigateWithinApp = useCallback((destination: string, replace = false) => {
    const target = new URL(destination, window.location.origin);
    if (target.origin !== window.location.origin) {
      window.location.assign(target.href);
      return;
    }
    const url = `${target.pathname}${target.search}${target.hash}`;
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    setAppLocation({
      pathname: target.pathname.replace(/\/+$/, "") || "/",
      search: target.search,
    });
  }, []);

  const onWorkspaceResolved = useCallback(
    (
      path: string,
      bootstrap: PostSignInBootstrap | null,
      platformMfaStatus: PlatformMfaStatusResponse | null,
    ) => {
      setShellBootstrap(bootstrap);
      setShellPlatformMfaStatus(platformMfaStatus);
      navigateWithinApp(path, true);
    },
    [navigateWithinApp],
  );

  useEffect(() => {
    const onPopState = () => {
      const location = readAppLocation();
      if (sessionState.status === "authenticated" && isAuthenticatedRoute(location.pathname)) {
        return;
      }
      setAppLocation(location);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [sessionState.status]);

  useEffect(() => {
    const abortController = new AbortController();
    const reqs = resolveRouteRequirements(pathname);

    if (reqs.needsService) {
      void checkService(abortController.signal);
    }
    if (reqs.needsSession) {
      void checkSession(abortController.signal);
    }
    if (reqs.needsProjection) {
      void checkProjection(abortController.signal).then((projection) => {
        if (abortController.signal.aborted) return;
        if (pathname === "/" && projection === null) {
          void checkService(abortController.signal);
          void checkSession(abortController.signal);
        }
      });
    }

    return () => {
      abortController.abort();
    };
  }, [checkProjection, checkService, checkSession, pathname]);

  useEffect(() => {
    if (pathname === "/reset-password" && (window.location.search || window.location.hash)) {
      window.history.replaceState(null, "", "/reset-password");
    }
  }, [pathname]);

  function finishSignIn(destination?: string) {
    setSessionState({ status: "checking" });
    setShellBootstrap(null);
    setShellPlatformMfaStatus(null);
    void (async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, 8000);
      try {
        await checkService(controller.signal);
        const session = await getCurrentSession(controller.signal);
        setSessionChecked(true);
        if (!session) {
          setSessionState({ reason: "unconfirmed", status: "error" });
          return;
        }
        if (destination) {
          setSessionState({ session, status: "authenticated" });
          setShellPlatformMfaStatus(null);
          navigateWithinApp(destination, true);
          return;
        }
        const resolution = await resolvePostSignInResolution({
          baseHostname,
          baseHostnameResolved: serviceState !== "checking",
          currentPathname: pathname,
          layoutCacheHost: window.location.host,
          layoutCacheUserId: session.user.id,
          search: window.location.search,
          signal: controller.signal,
        });
        handleSignInLanding(
          resolution.landing,
          resolution.bootstrap,
          resolution.platformMfaStatus,
          session,
          navigateWithinApp,
          onWorkspaceResolved,
          setSessionState,
        );
      } catch {
        setSessionState({ reason: "unavailable", status: "error" });
      } finally {
        window.clearTimeout(timeoutId);
      }
    })();
  }

  function finishSignOut() {
    if (sessionState.status === "authenticated") {
      clearAuthenticatedLayoutMetadata(window.location.host, sessionState.session.user.id);
    }
    setShellBootstrap(null);
    setShellPlatformMfaStatus(null);
    setSessionState({ status: "anonymous" });
    setSessionChecked(false);
    clearPublishedOrganizationProjectionCache();
    // Purge session Offline Copies and cached player metadata before leaving: navigation
    // would otherwise cut cleanup short on shared devices. Sign-out proceeds even if cleanup fails.
    void Promise.allSettled([
      purgeOfflineAudioForSource(window.location.host, "session"),
      purgeCachedPlayerMetadata(window.location.host),
    ]).finally(() => {
      window.location.assign("/");
    });
  }

  function finishInvitationSignIn() {
    finishSignIn(`/accept-invitation${window.location.search}`);
  }

  useEffect(() => {
    if (organizationName) {
      document.title = organizationName;
    }
  }, [organizationName]);

  const isOrganization = isOrganizationHost(
    typeof window !== "undefined" ? window.location.hostname : "",
    baseHostname,
  );

  const content = selectContent(
    pathname,
    resetLocation,
    sessionState,
    oauthCompletion,
    finishSignIn,
    finishSignOut,
    finishInvitationSignIn,
    isOrganization,
    auditionHeading,
    organizationName,
    baseHostname,
    serviceState !== "checking",
    logoFileId,
    shellBootstrap,
    shellPlatformMfaStatus,
    onWorkspaceResolved,
  );

  const displayName = resolveDisplayName(isOrganization, pathname, organizationName);
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const productShell = (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label={`${displayName} home`}>
          {logoFileId ? (
            <img
              src={`/api/public/media/${String(projectionVersion)}/${encodeURIComponent(logoFileId)}`}
              alt=""
              className="brand-logo"
            />
          ) : (
            <span className="brand-mark" aria-hidden="true">
              {initials}
            </span>
          )}
          <span>{displayName}</span>
        </a>
        <div className="header-actions">
          {serviceState === "offline" ? (
            <span className="service-status service-status--offline" role="status">
              <span aria-hidden="true" className="service-status__dot" />
              Service unavailable
            </span>
          ) : null}
          <nav aria-label="Account">
            <a
              href={
                isOrganization
                  ? "/login"
                  : sessionState.status === "authenticated"
                    ? "/account"
                    : "/login"
              }
            >
              {sessionState.status === "authenticated"
                ? isOrganization
                  ? "Workspace"
                  : "Account"
                : "Sign in"}
            </a>
          </nav>
        </div>
      </header>

      {content}

      <footer>
        <p>
          © {new Date().getFullYear()} {displayName}. All rights reserved.
        </p>
      </footer>
    </div>
  );

  const allowAccountFallback =
    sessionChecked &&
    (sessionState.status === "anonymous" || sessionState.status === "authenticated");

  const rendered = renderAppContent(
    pathname,
    sessionState,
    sessionChecked,
    publishedProjection,
    content,
    productShell,
    allowAccountFallback,
    applyProjection,
  );

  return <QueryClientProvider client={appQueryClient}>{rendered}</QueryClientProvider>;
}
